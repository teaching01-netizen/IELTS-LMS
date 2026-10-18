import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { SuiteDefinition, CommandStep } from '../catalog';
import type { ExecutionEnvironment, LoadEvidence, NormalizedResult, RunRecord, SuiteExecution } from '../contracts';
import { emptyResult } from '../contracts';
import { Redactor } from '../evidence';
import type { ResolvedTarget } from '../targets';
import {
  buildAllowlistedEnv,
  ProcessSupervisor,
  type StepOutcome,
  type StepSpec,
} from '../process-supervisor';
import { mergeResults, normalizeStepOutcome } from './results';

export interface ArtifactCandidate {
  path: string;
  fileName: string;
  mediaType: string;
}

export interface SuiteRunOutput {
  result: NormalizedResult;
  failureReason: string | null;
  processIds: number[];
  load: LoadEvidence;
  artifacts: ArtifactCandidate[];
}

export interface LocalDatabaseHandle {
  env: Record<string, string>;
  cleanup: () => Promise<void>;
}

export interface SuiteRunContext {
  run: RunRecord;
  execution: SuiteExecution;
  suite: SuiteDefinition;
  target: ResolvedTarget | null;
  repoRoot: string;
  scratchDir: string;
  resultsDir: string;
  signal: AbortSignal;
  onLog: (line: string) => void;
  onSpawn: (pid: number) => void;
  onProgress: (patch: { processIds?: number[]; load?: LoadEvidence }) => void;
  localDatabase: LocalDatabaseHandle | null;
  fixtureEnv: Record<string, string>;
  secretValues: string[];
}

export interface CommandRunnerDeps {
  repoRoot: string;
  baseEnv: Record<string, string | undefined>;
  gracefulStopSeconds: number;
  forceStopSeconds: number;
  resolveCwd: (relative: string | undefined) => string;
  scratchRoot: string;
  now: () => number;
}

export function generatedReportPaths(resultsDir: string): {
  playwrightJson: string;
  k6Summary: string;
  browserSummary: string;
  goTestJson: string;
} {
  return {
    playwrightJson: path.join(resultsDir, 'playwright.json'),
    k6Summary: path.join(resultsDir, 'k6-summary.json'),
    browserSummary: path.join(resultsDir, 'browser-summary.json'),
    goTestJson: path.join(resultsDir, 'go-test.json'),
  };
}

export class CommandSuiteRunner {
  constructor(private readonly deps: CommandRunnerDeps) {}

  async run(context: SuiteRunContext): Promise<SuiteRunOutput> {
    mkdirSync(context.resultsDir, { recursive: true });
    const reports = generatedReportPaths(context.resultsDir);
    const redactor = new Redactor(context.secretValues);
    const processIds: number[] = [];
    const supervisor = new ProcessSupervisor({
      baseEnv: this.deps.baseEnv,
      redactor,
      onLog: context.onLog,
      gracefulStopSeconds: this.deps.gracefulStopSeconds,
      forceStopSeconds: this.deps.forceStopSeconds,
    });

    const stepResults: NormalizedResult[] = [];
    let failureReason: string | null = null;
    const artifacts: ArtifactCandidate[] = [];

    for (const step of context.suite.steps) {
      if (context.signal.aborted) {
        const cancelled = emptyResult('cancelled');
        cancelled.evidenceComplete = stepResults.every((result) => result.evidenceComplete);
        stepResults.push(cancelled);
        failureReason ??= 'cancelled before step launch';
        break;
      }
      const prepared = this.prepareStep(step, context, reports);
      context.onLog(`[${context.suite.id}] starting ${step.label}: ${step.command} ${step.args.join(' ')}`);
      const outcome = await supervisor.runStep(prepared.spec, {
        signal: context.signal,
        onSpawn: (pid) => {
          processIds.push(pid);
          context.onSpawn(pid);
        },
      });
      const normalized = normalizeStepOutcome(outcome, step.resultKind, reports);
      stepResults.push(normalized.result);
      context.onProgress({ processIds: [...processIds] });
      this.collectArtifacts(step, context, reports, artifacts);
      if (normalized.failureReason !== null && failureReason === null) {
        failureReason = `${step.label}: ${normalized.failureReason}`;
      }
      if (normalized.result.outcome !== 'passed') break;
    }

    if (stepResults.length === 0) {
      const result = emptyResult('failed');
      result.failureKind = 'infrastructure';
      return {
        result,
        failureReason: 'suite has no executable steps',
        processIds,
        load: this.defaultLoad(context),
        artifacts,
      };
    }

    for (const artifact of artifacts) {
      context.onLog(`[${context.suite.id}] evidence: ${artifact.fileName}`);
    }

    const merged = mergeResults(stepResults);
    if (merged.outcome === 'failed' && merged.failureKind === null) merged.failureKind = 'assertion';
    return {
      result: merged,
      failureReason,
      processIds,
      load: this.defaultLoad(context),
      artifacts,
    };
  }

  private defaultLoad(context: SuiteRunContext): LoadEvidence {
    const parameters = context.run.parameters;
    const isBrowser = context.suite.capacity.browserCandidates !== null;
    const requested = isBrowser
      ? parameters.browserCandidates ?? parameters.students ?? null
      : parameters.apiCandidates ?? parameters.students ?? null;
    return {
      requestedCandidates: requested,
      configuredCandidates: requested,
      achievedCandidates: null,
      staffOrControlVus: 0,
      sustained: context.suite.controlOwner === 'k6' && !context.suite.capacity.nativeProof,
    };
  }

  private prepareStep(
    step: CommandStep,
    context: SuiteRunContext,
    reports: ReturnType<typeof generatedReportPaths>,
  ): { spec: StepSpec } {
    const cwd = this.deps.resolveCwd(step.cwd);
    const env = buildAllowlistedEnv(this.deps.baseEnv, this.baseChildEnv(context));
    const args = [...step.args];
    switch (step.resultKind) {
      case 'playwright': {
        args.push('--reporter=json');
        env['PLAYWRIGHT_JSON_OUTPUT_NAME'] = reports.playwrightJson;
        break;
      }
      case 'k6': {
        const runIndex = args.indexOf('run');
        const insertAt = runIndex >= 0 ? runIndex + 1 : args.length;
        args.splice(insertAt, 0, `--summary-export=${reports.k6Summary}`);
        break;
      }
      case 'browser-summary': {
        env['OUTPUT_DIR'] = path.join(context.scratchDir, 'live-runner');
        env['DELETE_ARTIFACTS_ON_FINISH'] = 'false';
        break;
      }
      case 'gofmt':
      case 'exit':
      default:
        break;
    }
    return {
      spec: {
        label: `${context.suite.id}:${step.label}`,
        command: step.command,
        args,
        cwd,
        env,
        deadlineMs: context.suite.deadlineMinutes * 60 * 1000,
        resultKind: step.resultKind,
      },
    };
  }

  private baseChildEnv(context: SuiteRunContext): Record<string, string> {
    const env: Record<string, string> = {
      PORTAL_RUN_ID: context.run.runId,
      PORTAL_EXECUTION_ID: context.execution.executionId,
      PORTAL_SUITE_ID: context.suite.id,
      E2E_PROD_PROVISION_STAFF_DB: 'false',
      E2E_ALLOW_PROD_DB_MUTATIONS: 'false',
      NODE_ENV: 'test',
      CI: 'true',
    };
    if (context.localDatabase) {
      Object.assign(env, context.localDatabase.env);
    }
    Object.assign(env, context.fixtureEnv);
    if (context.target) {
      env['PORTAL_TARGET_ORIGIN'] = context.target.origin;
      env['PROD_BASE_URL'] = context.target.origin;
      env['K6_BASE_URL'] = context.target.origin;
      if (context.target.organizationId) env['PORTAL_TARGET_ORGANIZATION_ID'] = context.target.organizationId;
    }
    const parameters = context.run.parameters;
    if (parameters.apiCandidates !== undefined) {
      env['K6_STUDENTS'] = String(parameters.apiCandidates);
      env['API_CANDIDATES'] = String(parameters.apiCandidates);
    }
    if (parameters.browserCandidates !== undefined) env['BROWSER_CANDIDATES'] = String(parameters.browserCandidates);
    if (parameters.browserConcurrency !== undefined) {
      env['MAX_CONCURRENT_USERS'] = String(parameters.browserConcurrency);
      env['HEADED_USERS'] = String(parameters.browserConcurrency);
    } else {
      env['MAX_CONCURRENT_USERS'] = '20';
    }
    if (parameters.students !== undefined) env['USER_COUNT'] = String(parameters.students);
    if (parameters.userOffset !== undefined) env['USER_OFFSET'] = String(parameters.userOffset);
    if (context.run.approval.confirmProduction) env['K6_CONFIRM_PROD'] = 'true';
    if (context.suite.id === 'prod.ielts.hybrid') {
      env['PORTAL_HYBRID_CONTROL_OWNER'] = context.suite.controlOwner;
    }
    return env;
  }

  private collectArtifacts(
    step: CommandStep,
    context: SuiteRunContext,
    reports: ReturnType<typeof generatedReportPaths>,
    artifacts: ArtifactCandidate[],
  ): void {
    if (step.resultKind === 'playwright' && existsSync(reports.playwrightJson)) {
      artifacts.push({
        path: reports.playwrightJson,
        fileName: 'playwright-results.json',
        mediaType: 'application/json',
      });
    }
    if (step.resultKind === 'k6' && existsSync(reports.k6Summary)) {
      artifacts.push({ path: reports.k6Summary, fileName: 'k6-summary.json', mediaType: 'application/json' });
    }
    if (step.resultKind === 'browser-summary') {
      const discovered = discoverBrowserSummary(path.join(context.scratchDir, 'live-runner'));
      if (discovered) {
        copyFileSync(discovered, reports.browserSummary);
        artifacts.push({
          path: reports.browserSummary,
          fileName: 'browser-summary.json',
          mediaType: 'application/json',
        });
      }
    }
    if (step.label === 'go tests' && existsSync(reports.goTestJson)) {
      artifacts.push({ path: reports.goTestJson, fileName: 'go-test.json', mediaType: 'application/json' });
    }
  }
}

export function discoverBrowserSummary(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter((entry) => /^(live|live-sat)-summary-\d+\.json$/.test(entry))
    .map((entry) => path.join(dir, entry))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const newest = candidates[0];
  if (!newest) return null;
  try {
    return statSync(newest).isFile() ? newest : null;
  } catch {
    return null;
  }
}

export function environmentForStep(step: CommandStep): ExecutionEnvironment {
  return step.resultKind === 'k6' ? 'production' : 'isolated';
}
