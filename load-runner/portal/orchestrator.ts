import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PortalError,
  approvalDigest,
  canonicalJson,
  emptyResult,
  isTerminalRunStatus,
  sha256Hex,
  toRunSummary,
  type CreateRunRequest,
  type ExecutionEnvironment,
  type FixtureOperation,
  type FixtureOperationStatus,
  type LoadEvidence,
  type NormalizedResult,
  type PlannedSuite,
  type PreflightRequest,
  type PreflightResult,
  type PrerequisiteCheck,
  type RunRecord,
  type SuiteExecution,
} from './contracts';
import { CATALOG_REVISION, expandSelection, getSuite, type SuiteDefinition } from './catalog';
import type { PortalConfig } from './config';
import type { CapabilitySnapshot } from './capabilities';
import { EventHub, LogBuffer, type PortalEvent } from './evidence';
import type { LocalDatabaseHandle } from './local-db';
import type { SuiteRunOutput } from './adapters/command-runner';
import { mergeResults } from './adapters/results';
import { RunStore } from './run-store';
import type { FixtureLedger } from './fixtures';
import type { ResolvedTarget, TargetRegistry } from './targets';

export interface SuiteRunner {
  run(context: {
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
  }): Promise<SuiteRunOutput>;
}

export interface PreparedFixture {
  env: Record<string, string>;
  notes: string[];
}

export type PrepareFixture = (context: {
  run: RunRecord;
  execution: SuiteExecution;
  suite: SuiteDefinition;
  target: ResolvedTarget;
  scratchDir: string;
  ledger: FixtureLedger;
  onLog: (line: string) => void;
}) => Promise<PreparedFixture>;

export interface OrchestratorDeps {
  config: PortalConfig;
  store: RunStore;
  targets: TargetRegistry;
  hub: EventHub;
  runner: SuiteRunner;
  capabilities: CapabilitySnapshot;
  repoRoot: string;
  localDatabaseFactory?: ((run: RunRecord) => Promise<LocalDatabaseHandle | null>) | undefined;
  prepareFixture?: PrepareFixture | undefined;
  fixtureCapabilities?: ReadonlySet<string> | undefined;
  now?: (() => number) | undefined;
}

interface RecoverySummary {
  interrupted: string[];
  held: string[];
  quarantinedRuns: string[];
}

interface DigestRecord {
  digest: string;
  expiresAt: number;
  request: PreflightRequest;
}

const DEFAULT_API_CANDIDATES = 100;
const DEFAULT_BROWSER_CANDIDATES = 10;

export class Orchestrator {
  private readonly config: PortalConfig;
  readonly store: RunStore;
  private readonly targets: TargetRegistry;
  readonly hub: EventHub;
  private readonly runner: SuiteRunner;
  private readonly capabilities: CapabilitySnapshot;
  private readonly repoRoot: string;
  private readonly now: () => number;
  private readonly prepareFixture: PrepareFixture | undefined;
  private readonly fixtureCapabilities: ReadonlySet<string>;
  private readonly digests = new Map<string, DigestRecord>();
  private readonly logBuffers = new Map<string, LogBuffer>();
  private readonly abortControllers = new Map<string, AbortController>();
  private dispatchPromise: Promise<void> | null = null;
  private shuttingDown = false;

  constructor(deps: OrchestratorDeps) {
    this.config = deps.config;
    this.store = deps.store;
    this.targets = deps.targets;
    this.hub = deps.hub;
    this.runner = deps.runner;
    this.capabilities = deps.capabilities;
    this.repoRoot = deps.repoRoot;
    this.now = deps.now ?? (() => Date.now());
    this.prepareFixture = deps.prepareFixture;
    this.fixtureCapabilities = deps.fixtureCapabilities ?? new Set<string>();
    this.localDatabaseFactory = deps.localDatabaseFactory;
  }

  private readonly localDatabaseFactory: ((run: RunRecord) => Promise<LocalDatabaseHandle | null>) | undefined;

  // ------------------------------------------------------------------
  // Preflight
  // ------------------------------------------------------------------

  preflight(request: PreflightRequest): PreflightResult {
    const expanded = expandSelection(request.selection);
    const blockers: PrerequisiteCheck[] = [];
    const warnings: string[] = [];

    if (expanded.unknownIds.length > 0) {
      blockers.push({
        requirement: 'catalog',
        status: 'missing',
        detail: `Unknown suite id(s): ${expanded.unknownIds.join(', ')}`,
      });
    }
    if (expanded.suites.length === 0 && expanded.unknownIds.length === 0) {
      blockers.push({ requirement: 'catalog', status: 'missing', detail: 'No suites selected.' });
    }
    for (const excluded of expanded.excludedIds) {
      warnings.push(`${excluded} is classified but excluded from Run all.`);
    }

    const environments = [...new Set(expanded.suites.flatMap((suite) => suite.environments))];
    const resolved = this.targets.resolveBindings(request.targetBindings, environments);
    for (const blocker of resolved.blockers) {
      blockers.push({ requirement: 'target', status: 'missing', detail: blocker });
    }
    const requireProduction = expanded.suites.some((suite) => suite.environments.includes('production'));
    if (requireProduction && !this.config.productionEnabled) {
      blockers.push({
        requirement: 'production-enabled',
        status: 'missing',
        detail: 'Production execution is disabled (PORTAL_PRODUCTION_ENABLED=false).',
      });
    }
    if (requireProduction && !request.targetBindings.production) {
      blockers.push({
        requirement: 'production-target',
        status: 'missing',
        detail: 'No production target profile is bound.',
      });
    }

    const plannedSuites = expanded.suites.map((suite) => this.planSuite(suite, request, blockers, warnings));
    const anyFixtureCreation = plannedSuites.some((suite) => suite.effects.length > 0);

    const digest = approvalDigest({
      catalogRevision: CATALOG_REVISION,
      selection: request.selection,
      parameters: request.parameters,
      targetBindings: request.targetBindings,
    });
    const createdAt = new Date(this.now()).toISOString();
    const expiresAt = new Date(this.now() + this.config.preflightTtlMinutes * 60 * 1000).toISOString();
    const result: PreflightResult = {
      digest,
      catalogRevision: CATALOG_REVISION,
      createdAt,
      expiresAt,
      mode: request.selection.mode,
      suites: plannedSuites,
      blockers,
      effects: [...new Set(plannedSuites.flatMap((suite) => suite.effects))],
      estimatedMaximumMinutes: plannedSuites.reduce((total, suite) => total + suite.deadlineMinutes, 0),
      warnings,
      confirmation: {
        production: requireProduction,
        syntheticFixtures: anyFixtureCreation,
      },
    };
    this.digests.set(digest, {
      digest,
      expiresAt: this.now() + this.config.preflightTtlMinutes * 60 * 1000,
      request,
    });
    this.pruneDigests();
    return result;
  }

  private planSuite(
    suite: SuiteDefinition,
    request: PreflightRequest,
    blockers: PrerequisiteCheck[],
    warnings: string[],
  ): PlannedSuite {
    const environment = suite.environments[0] ?? 'isolated';
    const parameters = request.parameters;
    const requestedApi =
      suite.capacity.apiCandidates !== null || suite.controlOwner === 'k6'
        ? parameters.apiCandidates ?? parameters.students ?? DEFAULT_API_CANDIDATES
        : null;
    const requestedBrowser =
      suite.capacity.browserCandidates !== null
        ? parameters.browserCandidates ?? parameters.students ?? DEFAULT_BROWSER_CANDIDATES
        : null;

    const allowedParameters = new Set(suite.parameters);
    for (const [name, value] of Object.entries(parameters)) {
      if (value === undefined) continue;
      if (!allowedParameters.has(name as (typeof suite.parameters)[number])) {
        warnings.push(`${suite.id} ignores parameter ${name}.`);
      }
    }

    if (suite.capacity.nativeProof && suite.capacity.apiCandidates !== null) {
      const required = suite.capacity.apiCandidates;
      if (this.config.stagingCapacity < required) {
        blockers.push({
          requirement: `native-capacity:${suite.id}`,
          status: 'missing',
          detail: `${suite.id} requires the native ${required}-candidate proof; configured staging capacity is ${this.config.stagingCapacity}.`,
        });
      }
      if (parameters.apiCandidates !== undefined && parameters.apiCandidates < required) {
        blockers.push({
          requirement: `native-cardinality:${suite.id}`,
          status: 'missing',
          detail: `${suite.id} cannot be reduced below its native ${required}-candidate proof.`,
        });
      }
    }

    for (const requirement of suite.requires) {
      const check = this.checkRequirement(requirement, suite, request, environment);
      if (check) blockers.push(check);
    }

    if (suite.id === 'prod.ielts.hybrid' && request.parameters.apiCandidates !== undefined) {
      const api = request.parameters.apiCandidates;
      const browsers = request.parameters.browserCandidates ?? DEFAULT_BROWSER_CANDIDATES;
      const roster = request.parameters.students;
      if (roster !== undefined && roster < api + browsers) {
        blockers.push({
          requirement: 'synthetic-roster',
          status: 'missing',
          detail: `Hybrid load needs ${api + browsers} distinct candidate identities; the requested roster has ${roster}.`,
        });
      }
    }

    const targetId =
      environment === 'isolated'
        ? request.targetBindings.isolated ?? null
        : request.targetBindings[environment] ?? null;

    return {
      suiteId: suite.id,
      title: suite.title,
      environment,
      controlOwner: suite.controlOwner,
      adapter: suite.adapter,
      deadlineMinutes: suite.deadlineMinutes,
      requestedApiCandidates: requestedApi,
      requestedBrowserCandidates: requestedBrowser,
      effects: suite.effects,
      requiredOutputs: suite.steps.flatMap((step) => step.requiredOutputs ?? []),
      targetId,
    };
  }

  private checkRequirement(
    requirement: string,
    suite: SuiteDefinition,
    request: PreflightRequest,
    environment: ExecutionEnvironment,
  ): PrerequisiteCheck | null {
    const missing = (detail: string): PrerequisiteCheck => ({
      requirement: `${requirement}:${suite.id}`,
      status: 'missing',
      detail,
    });
    if (requirement === 'node' || requirement === 'bun' || requirement === 'go' || requirement === 'c-toolchain') {
      const tool = requirement === 'c-toolchain' ? 'cc' : requirement;
      const present = this.capabilities.tools.has(tool) || (requirement === 'c-toolchain' && this.capabilities.tools.has('gcc'));
      return present ? null : missing(`${requirement} is not available on the portal host.`);
    }
    if (requirement === 'browsers') {
      return this.capabilities.browsers ? null : missing('No Playwright browser installation was detected.');
    }
    if (requirement === 'k6') {
      return this.capabilities.tools.has('k6') ? null : missing('k6 is not installed on the portal host.');
    }
    if (requirement === 'test-mysql') {
      return this.config.testDbAdminUrl !== null
        ? null
        : missing('PORTAL_TEST_DB_ADMIN_URL is not configured; disposable MySQL is unavailable.');
    }
    if (requirement === 'local-stack') {
      return this.capabilities.tools.has('go')
        ? null
        : missing('The local stack requires the Go toolchain on the portal host.');
    }
    if (requirement === 'target') {
      const binding =
        environment === 'isolated' ? request.targetBindings.isolated : request.targetBindings[environment];
      return binding ? null : missing(`No ${environment} target profile is bound.`);
    }
    if (requirement.startsWith('target:')) {
      const expected = requirement.slice('target:'.length) as ExecutionEnvironment;
      const binding = request.targetBindings[expected];
      if (!binding) return missing(`No ${expected} target profile is bound.`);
      const readiness = this.targets.get(binding) ? this.targets.readiness(this.targets.get(binding)!) : null;
      if (readiness && !readiness.ready) return missing(readiness.detail);
      return null;
    }
    if (requirement === 'credentials:staff' || requirement === 'credentials:prod-staff') {
      const expected: ExecutionEnvironment = environment === 'isolated' ? 'staging' : environment;
      const binding = request.targetBindings[expected] ?? request.targetBindings.production ?? request.targetBindings.staging;
      if (!binding) return missing('No target binding exists for credential resolution.');
      const profile = this.targets.get(binding);
      if (!profile) return missing(`Target profile ${binding} is not configured.`);
      const bundle = this.targets.credentialsFor(profile);
      if (!bundle) return missing(`Credential reference "${profile.credentialRef}" is not configured.`);
      if (!bundle.staff && !bundle.admin) return missing('Credential bundle has no staff principal.');
      if (bundle.proctors && bundle.proctors.length >= 10) {
        const unique = new Set(bundle.proctors.map((proctor) => proctor.email.toLowerCase()));
        if (unique.size !== bundle.proctors.length) {
          return missing('The ten-proctor bundle must contain ten distinct accounts.');
        }
      }
      return null;
    }
    if (requirement.startsWith('fixtures:')) {
      return this.fixtureCapabilities.has(requirement)
        ? null
        : missing(`${requirement} is not enabled in this deployment.`);
    }
    if (requirement === 'prepared:sat' || requirement === 'prepared:scale') {
      return this.config.stagingPrepared
        ? null
        : missing(`${requirement} requires administrator-prepared staging fixtures (PORTAL_STAGING_PREPARED=true).`);
    }
    if (requirement === 'staging-capacity') {
      return null;
    }
    if (requirement === 'synthetic-roster') {
      return null;
    }
    if (requirement === 'candidate-accounts') {
      const environmentForCredentials: ExecutionEnvironment =
        environment === 'isolated' ? 'staging' : environment;
      const binding =
        request.targetBindings[environmentForCredentials] ?
          request.targetBindings[environmentForCredentials]
        : request.targetBindings.production ?? request.targetBindings.staging;
      if (!binding) return missing('No target binding exists for the candidate account pool.');
      const profile = this.targets.get(binding);
      if (!profile) return missing(`Target profile ${binding} is not configured.`);
      const bundle = this.targets.credentialsFor(profile);
      if (!bundle) return missing(`Credential reference "${profile.credentialRef}" is not configured.`);
      const needed =
        request.parameters.browserCandidates ?? request.parameters.students ?? DEFAULT_BROWSER_CANDIDATES;
      const available = bundle.candidates?.length ?? 0;
      if (available < needed) {
        return missing(
          `This suite needs ${needed} pre-provisioned synthetic candidate accounts; the bundle provides ${available}.`,
        );
      }
      const unique = new Set((bundle.candidates ?? []).map((candidate) => candidate.email.toLowerCase()));
      if (unique.size !== available) return missing('Candidate account pool contains duplicate emails.');
      return null;
    }
    if (requirement === 'legacy') {
      return missing('Legacy destructive remote launcher is not runnable through the portal.');
    }
    return missing(`Unknown prerequisite "${requirement}".`);
  }

  private pruneDigests(): void {
    const now = this.now();
    for (const [digest, record] of this.digests) {
      if (record.expiresAt <= now) this.digests.delete(digest);
    }
    while (this.digests.size > 500) {
      const oldest = this.digests.keys().next();
      if (oldest.done) break;
      this.digests.delete(oldest.value);
    }
  }

  // ------------------------------------------------------------------
  // Admission
  // ------------------------------------------------------------------

  async createRun(
    request: CreateRunRequest,
    operatorId: string,
    idempotencyKey: string,
  ): Promise<{ record: RunRecord; created: boolean }> {
    return this.store.mutate(async () => {
      if (!idempotencyKey || idempotencyKey.length > 200) {
        throw new PortalError(400, 'INVALID_REQUEST', 'A valid Idempotency-Key header is required.');
      }
      const payloadDigest = sha256Hex(
        canonicalJson({
          catalog: CATALOG_REVISION,
          image: this.config.imageRevision,
          selection: request.selection,
          parameters: request.parameters,
          targetBindings: request.targetBindings,
        }),
      );
      const existing = this.store.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.payloadDigest !== payloadDigest) {
          throw new PortalError(409, 'CONFLICT', 'This Idempotency-Key was used for a different payload.');
        }
        return { record: existing, created: false };
      }

      const digestRecord = this.digests.get(request.approval.preflightDigest);
      if (!digestRecord || digestRecord.expiresAt <= this.now()) {
        throw new PortalError(409, 'CONFLICT', 'Approval digest is missing, expired, or does not match this payload.');
      }
      const expected = approvalDigest({
        catalogRevision: CATALOG_REVISION,
        selection: request.selection,
        parameters: request.parameters,
        targetBindings: request.targetBindings,
      });
      if (expected !== request.approval.preflightDigest) {
        throw new PortalError(409, 'CONFLICT', 'Approval digest does not match the submitted selection.');
      }
      if (!approvalMatches(digestRecord.request, request)) {
        throw new PortalError(409, 'CONFLICT', 'Approval digest was issued for a different preflight payload.');
      }

      const preflight = this.preflight({
        selection: request.selection,
        targetBindings: request.targetBindings,
        parameters: request.parameters,
      });
      if (preflight.blockers.length > 0) {
        throw new PortalError(422, 'PREREQUISITES_MISSING', 'The selection is not ready.', preflight.blockers);
      }
      if (preflight.confirmation.production && !request.approval.confirmProduction) {
        throw new PortalError(403, 'FORBIDDEN', 'Production execution requires explicit confirmation.');
      }
      if (preflight.confirmation.syntheticFixtures && !request.approval.confirmSyntheticFixtures) {
        throw new PortalError(403, 'FORBIDDEN', 'Synthetic fixture creation requires explicit confirmation.');
      }
      if (this.store.countQueued() >= this.config.maxQueuedRuns) {
        throw new PortalError(409, 'CONFLICT', 'The run queue is full.');
      }

      const now = new Date(this.now()).toISOString();
      const runId = randomUUID();
      const resolved = this.targets.resolveBindings(
        request.targetBindings,
        [...new Set(preflight.suites.map((suite) => suite.environment))],
      );
      const targets: RunRecord['targets'] = {};
      for (const [environment, target] of resolved.targets) {
        targets[environment] = {
          id: target.id,
          environment: target.environment,
          origin: target.origin,
          revision: target.revision,
        };
      }
      const record: RunRecord = {
        schemaVersion: 1,
        runId,
        idempotencyKey,
        payloadDigest,
        admissionSequence: this.store.nextAdmissionSequence(),
        operatorId,
        createdAt: now,
        updatedAt: now,
        revision: 0,
        status: 'queued',
        catalogRevision: CATALOG_REVISION,
        imageRevision: this.config.imageRevision,
        selection: request.selection,
        parameters: request.parameters,
        targets,
        approval: {
          preflightDigest: request.approval.preflightDigest,
          confirmProduction: request.approval.confirmProduction,
          confirmSyntheticFixtures: request.approval.confirmSyntheticFixtures,
        },
        cancelRequestedAt: null,
        hold: null,
        executions: preflight.suites.map((suite) => ({
          executionId: randomUUID(),
          suiteId: suite.suiteId,
          targetId: suite.targetId,
          environment: suite.environment,
          status: 'pending',
          startedAt: null,
          endedAt: null,
          deadlineAt: null,
          cancelRequestedAt: null,
          failureReason: null,
          processIds: [],
          load: emptyLoad(),
          fixtures: [],
          artifacts: [],
          result: null,
          logPath: null,
        })),
        result: null,
        reconciliationNotes: [],
        artifactsExpireAt: new Date(this.now() + this.config.retentionDays * 24 * 60 * 60 * 1000).toISOString(),
      };
      this.store.insert(record);
      this.emitState(record, 'run admitted');
      void this.kickDispatch();
      return { record, created: true };
    });
  }

  // ------------------------------------------------------------------
  // Cancellation and queue release
  // ------------------------------------------------------------------

  async cancel(runId: string, reason?: string): Promise<RunRecord> {
    return this.store.mutate(() => {
      const record = this.store.require(runId);
      if (isTerminalRunStatus(record.status)) return record;
      const now = new Date(this.now()).toISOString();
      record.cancelRequestedAt ??= now;
      if (reason) record.reconciliationNotes.push(`cancel requested: ${reason}`);
      if (record.status === 'queued') {
        record.status = 'cancelled';
        for (const execution of record.executions) {
          if (execution.status === 'pending') execution.status = 'not_run';
        }
        record.result = emptyResult('cancelled');
        record.result.failureKind = null;
      } else {
        record.status = 'stopping';
        const controller = this.abortControllers.get(runId);
        controller?.abort();
      }
      this.store.save(record);
      this.emitState(record, 'cancel committed');
      for (const execution of record.executions) {
        if (execution.cancelRequestedAt === null && !isTerminalSuite(execution.status)) {
          execution.cancelRequestedAt = now;
        }
      }
      return record;
    });
  }

  async releaseQueue(runIds?: string[]): Promise<{ released: string[]; blockers: Record<string, PrerequisiteCheck[]> }> {
    return this.store.mutate(() => {
      const released: string[] = [];
      const blockers: Record<string, PrerequisiteCheck[]> = {};
      const held = this.store
        .queued()
        .filter((record) => record.hold !== null && (runIds === undefined || runIds.includes(record.runId)));
      for (const record of held) {
        const preflight = this.preflight({
          selection: record.selection,
          targetBindings: bindingsFromRecord(record),
          parameters: record.parameters,
        });
        if (preflight.blockers.length > 0) {
          blockers[record.runId] = preflight.blockers;
          record.hold = {
            reason: `release blocked: ${preflight.blockers.map((blocker) => blocker.detail).join('; ')}`,
            since: new Date(this.now()).toISOString(),
          };
        } else {
          record.hold = null;
          released.push(record.runId);
        }
        this.store.save(record);
      }
      if (released.length > 0) void this.kickDispatch();
      return { released, blockers };
    });
  }

  // ------------------------------------------------------------------
  // Recovery
  // ------------------------------------------------------------------

  recover(): RecoverySummary {
    const summary: RecoverySummary = { interrupted: [], held: [], quarantinedRuns: [] };
    const now = new Date(this.now()).toISOString();
    for (const record of this.store.nonTerminal()) {
      if (record.status === 'queued') {
        record.hold = { reason: 'controller restart: release required', since: now };
        summary.held.push(record.runId);
      } else {
        record.status = 'interrupted';
        for (const execution of record.executions) {
          if (execution.status === 'running' || execution.status === 'preparing' || execution.status === 'finalizing') {
            execution.status = 'interrupted';
          } else if (execution.status === 'pending') {
            execution.status = 'not_run';
          }
        }
        record.result = emptyResult('interrupted');
        record.result.failureKind = 'infrastructure';
        record.reconciliationNotes.push(
          'controller restart: in-flight execution marked interrupted; remote side effects require operator reconciliation',
        );
        summary.interrupted.push(record.runId);
      }
      this.store.save(record);
    }
    // Stale scratch secrets from interrupted executions are removed on sight.
    for (const runId of [...summary.interrupted, ...summary.held]) {
      rmSync(path.join(this.config.dataDir, 'scratch', runId), { recursive: true, force: true });
    }
    return summary;
  }

  // ------------------------------------------------------------------
  // Dispatch
  // ------------------------------------------------------------------

  private async kickDispatch(): Promise<void> {
    if (this.shuttingDown) return;
    if (this.dispatchPromise) return;
    this.dispatchPromise = this.dispatchLoop()
      .catch(() => undefined)
      .finally(() => {
        this.dispatchPromise = null;
      });
  }

  private async dispatchLoop(): Promise<void> {
    for (;;) {
      if (this.shuttingDown) return;
      const next = this.store.queued().find((record) => record.hold === null);
      if (!next) return;
      await this.dispatchRun(next.runId);
    }
  }

  async waitForIdle(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const busy = this.dispatchPromise !== null || this.store.queued().some((record) => record.hold === null);
      if (!busy) return;
      if (Date.now() > deadline) throw new Error('timed out waiting for the dispatch lane to become idle');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async dispatchRun(runId: string): Promise<void> {
    const record = this.store.get(runId);
    if (!record || record.status !== 'queued' || record.hold !== null) return;
    const abort = new AbortController();
    this.abortControllers.set(runId, abort);
    const scratchRoot = path.join(this.config.dataDir, 'scratch', runId);
    let localDatabase: LocalDatabaseHandle | null = null;

    try {
      record.status = 'preparing';
      record.reconciliationNotes.push(
        `dispatch start: catalog=${CATALOG_REVISION} image=${this.config.imageRevision}`,
      );
      this.store.save(record);
      this.emitState(record, 'preparing');

      if (this.localDatabaseFactory && this.requiresLocalDatabase(record)) {
        try {
          localDatabase = await this.localDatabaseFactory(record);
        } catch (error) {
          this.failRun(record, `local database provisioning failed: ${String(error)}`);
          return;
        }
      }

      for (const execution of record.executions) {
        if (execution.status === 'not_run') continue;
        if (record.cancelRequestedAt !== null) {
          execution.status = 'not_run';
          execution.failureReason = 'run cancelled before this suite started';
          continue;
        }
        const suite = this.suiteFor(execution.suiteId);
        if (!suite) {
          execution.status = 'blocked';
          execution.failureReason = `suite ${execution.suiteId} is no longer in the catalog`;
          this.failRun(record, execution.failureReason);
          return;
        }
        let target: ResolvedTarget | null = null;
        try {
          target = this.resolveTargetFor(record, execution);
        } catch (error) {
          this.failSuite(record, execution, 'precondition', String(error));
          return;
        }
        const scratchDir = path.join(scratchRoot, execution.executionId);
        const resultsDir = path.join(scratchDir, 'portal-results');
        mkdirSync(resultsDir, { recursive: true, mode: 0o700 });

        execution.status = 'preparing';
        execution.startedAt = new Date(this.now()).toISOString();
        execution.deadlineAt = new Date(this.now() + suite.deadlineMinutes * 60 * 1000).toISOString();
        this.store.save(record);
        this.emitState(record, `preparing ${suite.id}`);

        const logs = this.logBufferFor(execution.executionId);
        const onLog = (line: string): void => {
          logs.append(line);
          this.store.appendLog(runId, execution.executionId, JSON.stringify({ at: new Date().toISOString(), line }));
          this.hub.publish({
            type: 'log',
            runId,
            revision: record.revision,
            at: new Date().toISOString(),
            data: { executionId: execution.executionId, line },
          });
        };
        execution.logPath = path.relative(this.config.dataDir, this.store.logPath(runId, execution.executionId));

        let fixtureEnv: Record<string, string> = {};
        if (target && suite.requires.includes('fixtures:fresh-ielts')) {
          if (!this.prepareFixture) {
            this.failSuite(record, execution, 'precondition', 'No fixture adapter is configured for this deployment.');
            return;
          }
          try {
            const prepared = await this.prepareFixture({
              run: record,
              execution,
              suite,
              target,
              scratchDir,
              ledger: this.ledgerFor(execution),
              onLog,
            });
            fixtureEnv = prepared.env;
            for (const note of prepared.notes) record.reconciliationNotes.push(note);
          } catch (error) {
            this.failSuite(
              record,
              execution,
              'precondition',
              `fixture preparation failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return;
          }
          this.store.save(record);
          this.emitState(record, `fixtures ready for ${suite.id}`);
        }

        if (record.cancelRequestedAt !== null || abort.signal.aborted) {
          execution.status = 'cancelled';
          execution.result = cancelledResult();
          execution.endedAt = new Date(this.now()).toISOString();
          this.store.save(record);
          continue;
        }

        execution.status = 'running';
        this.store.save(record);
        this.emitState(record, `running ${suite.id}`);

        const secretValues = collectSecrets(target);
        const outcome = await this.runner.run({
          run: record,
          execution,
          suite,
          target,
          repoRoot: this.repoRoot,
          scratchDir,
          resultsDir,
          signal: abort.signal,
          onLog,
          onSpawn: (pid) => {
            if (!execution.processIds.includes(pid)) execution.processIds.push(pid);
          },
          onProgress: (patch) => {
            if (patch.processIds) execution.processIds = [...new Set([...execution.processIds, ...patch.processIds])];
            if (patch.load) execution.load = patch.load;
          },
          localDatabase,
          fixtureEnv,
          secretValues,
        });

        execution.status = outcome.result.outcome === 'passed' ? 'passed' : outcome.result.outcome;
        execution.result = outcome.result;
        execution.endedAt = new Date(this.now()).toISOString();
        execution.failureReason = outcome.failureReason;
        execution.load = { ...execution.load, ...outcome.load };
        this.attachArtifacts(record, execution, outcome);
        this.store.save(record);
        this.emitState(record, `${execution.status} ${suite.id}`);

        if (outcome.result.outcome !== 'passed') {
          if (outcome.result.outcome === 'cancelled') {
            this.finishRun(record, 'cancelled', 'run cancelled during execution');
          } else {
            this.finishRun(record, 'failed', outcome.failureReason ?? 'suite failed');
          }
          return;
        }
      }

      const results = record.executions
        .map((execution) => execution.result)
        .filter((result): result is NormalizedResult => result !== null);
      const merged = mergeResults(results);
      const allPassed =
        merged.outcome === 'passed' &&
        record.executions.every((execution) => execution.result?.outcome === 'passed');
      this.finishRun(record, allPassed ? 'passed' : 'failed', allPassed ? null : 'one or more suites did not pass');
    } finally {
      this.abortControllers.delete(runId);
      if (localDatabase) {
        try {
          await localDatabase.cleanup();
        } catch (error) {
          record.reconciliationNotes.push(`local database cleanup failed: ${String(error)}`);
        }
      }
      // Ephemeral generated secret files are removed after execution.
      rmSync(scratchRoot, { recursive: true, force: true });
    }
  }

  private attachArtifacts(
    record: RunRecord,
    execution: SuiteExecution,
    outcome: SuiteRunOutput,
  ): void {
    for (const candidate of outcome.artifacts) {
      try {
        const artifact = this.store.createArtifact({
          runId: record.runId,
          executionId: execution.executionId,
          sourcePath: candidate.path,
          fileName: candidate.fileName,
          mediaType: candidate.mediaType,
          expiresAt: record.artifactsExpireAt,
        });
        execution.artifacts.push(artifact);
      } catch (error) {
        execution.failureReason ??= `artifact capture failed: ${String(error)}`;
        if (execution.result && execution.result.outcome === 'passed') {
          execution.result.outcome = 'failed';
          execution.result.failureKind = 'infrastructure';
          execution.result.evidenceComplete = false;
          execution.status = 'failed';
        }
      }
    }
  }

  private failSuite(
    record: RunRecord,
    execution: SuiteExecution,
    kind: 'precondition' | 'infrastructure',
    detail: string,
  ): void {
    execution.status = 'failed';
    execution.failureReason = detail;
    execution.endedAt = new Date(this.now()).toISOString();
    const result = emptyResult('failed');
    result.failureKind = kind;
    execution.result = result;
    this.store.save(record);
    this.emitState(record, `failed ${execution.suiteId}`);
    this.finishRun(record, 'failed', detail);
  }

  private failRun(record: RunRecord, detail: string): void {
    record.status = 'failed';
    record.result = emptyResult('failed');
    record.result.failureKind = 'infrastructure';
    record.reconciliationNotes.push(detail);
    this.store.save(record);
    this.emitState(record, `failed run: ${detail}`);
  }

  private finishRun(record: RunRecord, status: 'passed' | 'failed' | 'cancelled', detail: string | null): void {
    for (const execution of record.executions) {
      if (execution.status === 'pending') {
        execution.status = 'not_run';
        execution.failureReason = detail ?? 'run ended before this suite started';
      }
    }
    record.status = status;
    if (status === 'passed') {
      const results = record.executions
        .map((execution) => execution.result)
        .filter((result): result is NormalizedResult => result !== null);
      record.result = mergeResults(results);
    } else {
      const result = emptyResult(status);
      result.failureKind = status === 'cancelled' ? null : 'assertion';
      const partial = record.executions
        .map((execution) => execution.result)
        .filter((candidate): candidate is NormalizedResult => candidate !== null);
      if (partial.length > 0) {
        const merged = mergeResults(partial);
        result.executed = merged.executed;
        result.passed = merged.passed;
        result.failed = merged.failed;
        result.skipped = merged.skipped;
        result.evidenceComplete = merged.evidenceComplete;
        result.thresholdFailures = merged.thresholdFailures;
      }
      record.result = result;
    }
    if (detail) record.reconciliationNotes.push(detail);
    this.store.save(record);
    this.emitState(record, `run ${status}`);
  }

  private requiresLocalDatabase(record: RunRecord): boolean {
    return record.executions.some((execution) => {
      const suite = this.suiteFor(execution.suiteId);
      return suite?.requires.includes('test-mysql') ?? false;
    });
  }

  private suiteFor(suiteId: string): SuiteDefinition | null {
    return getSuite(suiteId);
  }

  private resolveTargetFor(_record: RunRecord, execution: SuiteExecution): ResolvedTarget | null {
    const targetId = execution.targetId;
    if (!targetId) return null;
    return this.targets.resolve(targetId, execution.environment);
  }

  private logBufferFor(executionId: string): LogBuffer {
    let buffer = this.logBuffers.get(executionId);
    if (!buffer) {
      buffer = new LogBuffer();
      this.logBuffers.set(executionId, buffer);
    }
    return buffer;
  }

  private ledgerFor(execution: SuiteExecution): FixtureLedger {
    const fixtures = execution.fixtures;
    return {
      intent: (kind, correlation, targetId) => {
        const operation: FixtureOperation = {
          operationId: randomUUID(),
          kind,
          correlation,
          status: 'planned',
          targetId,
          resourceIds: {},
          startedAt: null,
          completedAt: null,
          detail: null,
        };
        fixtures.push(operation);
        return operation;
      },
      transition: (operationId, status: FixtureOperationStatus, detail, resourceIds = {}) => {
        const operation = fixtures.find((candidate) => candidate.operationId === operationId);
        if (!operation) throw new Error(`Unknown fixture operation ${operationId}`);
        operation.status = status;
        operation.detail = detail;
        if (status === 'requested') operation.startedAt = new Date().toISOString();
        if (status === 'confirmed' || status === 'failed' || status === 'unknown') {
          operation.completedAt = new Date().toISOString();
        }
        Object.assign(operation.resourceIds, resourceIds);
        return operation;
      },
    };
  }

  logTail(runId: string, executionId: string, limit = 400): string[] {
    const buffer = this.logBuffers.get(executionId);
    if (buffer) return buffer.tail(limit);
    return this.store.readLogTail(runId, executionId, limit).map((line) => {
      try {
        const parsed = JSON.parse(line) as { line?: string };
        return parsed.line ?? line;
      } catch {
        return line;
      }
    });
  }

  snapshot(runId: string): { record: RunRecord; summary: ReturnType<typeof toRunSummary> } {
    const record = this.store.require(runId);
    return { record, summary: toRunSummary(record) };
  }

  listRuns(limit: number, beforeSequence?: number): {
    runs: RunRecord[];
    nextCursor: number | null;
  } {
    return this.store.list({ limit, ...(beforeSequence === undefined ? {} : { beforeSequence }) });
  }

  beginShutdown(): void {
    this.shuttingDown = true;
  }

  /** Abort active work and wait briefly for the dispatch lane to drain. */
  async shutdown(timeoutMs = 15_000): Promise<void> {
    this.beginShutdown();
    for (const controller of this.abortControllers.values()) controller.abort();
    try {
      await this.waitForIdle(timeoutMs);
    } catch {
      // Bounded shutdown: the process supervisor stops tracked groups and the
      // next startup reconciles any execution that was still in flight.
    }
  }

  private emitState(record: RunRecord, reason: string): void {
    const event: PortalEvent = {
      type: 'state',
      runId: record.runId,
      revision: record.revision,
      at: new Date().toISOString(),
      data: { reason, summary: toRunSummary(record) },
    };
    this.hub.publish(event);
  }
}

function emptyLoad(): LoadEvidence {
  return {
    requestedCandidates: null,
    configuredCandidates: null,
    achievedCandidates: null,
    staffOrControlVus: 0,
    sustained: false,
  };
}

function cancelledResult(): NormalizedResult {
  const result = emptyResult('cancelled');
  result.failureKind = null;
  return result;
}

function isTerminalSuite(status: SuiteExecution['status']): boolean {
  return ['passed', 'failed', 'cancelled', 'interrupted', 'blocked', 'not_run'].includes(status);
}

function collectSecrets(target: ResolvedTarget | null): string[] {
  if (!target?.credentials) return [];
  const secrets: string[] = [];
  for (const credential of [
    target.credentials.admin,
    target.credentials.staff,
    ...(target.credentials.proctors ?? []),
  ]) {
    if (credential?.password) secrets.push(credential.password);
  }
  return secrets;
}

function bindingsFromRecord(record: RunRecord): PreflightRequest['targetBindings'] {
  const bindings: PreflightRequest['targetBindings'] = {};
  for (const [environment, target] of Object.entries(record.targets)) {
    if (environment === 'isolated' || environment === 'staging' || environment === 'production') {
      bindings[environment] = target.id;
    }
  }
  return bindings;
}

function approvalMatches(original: PreflightRequest, submitted: CreateRunRequest): boolean {
  return (
    canonicalJson(original.selection) === canonicalJson(submitted.selection) &&
    canonicalJson(original.parameters) === canonicalJson(submitted.parameters) &&
    canonicalJson(original.targetBindings) === canonicalJson(submitted.targetBindings)
  );
}
