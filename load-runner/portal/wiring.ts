import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { probeCapabilities } from './capabilities';
import type { PortalConfig } from './config';
import { CommandSuiteRunner } from './adapters/command-runner';
import { EventHub } from './evidence';
import {
  ApiSession,
  createIeltsFixture,
  FetchFixtureHttpClient,
} from './fixtures';
import { provisionLocalDatabase } from './local-db';
import { Orchestrator, type OrchestratorDeps, type PrepareFixture } from './orchestrator';
import { RunStore } from './run-store';
import { TargetRegistry } from './targets';

export interface PortalRuntime {
  config: PortalConfig;
  repoRoot: string;
  store: RunStore;
  targets: TargetRegistry;
  hub: EventHub;
  orchestrator: Orchestrator;
  recovery: ReturnType<RunStore['prune']> & { interrupted: string[]; held: string[] };
}

export function resolveRepoRoot(fromDir: string): string {
  return path.resolve(fromDir, '..', '..');
}

export interface CreateRuntimeOptions {
  config: PortalConfig;
  repoRoot: string;
  now?: () => number;
}

export function createRuntime(options: CreateRuntimeOptions): PortalRuntime {
  const { config, repoRoot } = options;
  const store = new RunStore({
    dataDir: config.dataDir,
    retentionDays: config.retentionDays,
    logLimitBytes: config.logLimitBytes,
    artifactLimitBytes: config.artifactLimitBytes,
    minFreeBytes: config.minFreeBytes,
  });
  store.initialize();

  const targets = new TargetRegistry(config);
  const hub = new EventHub();
  const capabilities = probeCapabilities();
  const runner = new CommandSuiteRunner({
    repoRoot,
    baseEnv: process.env,
    gracefulStopSeconds: config.gracefulStopSeconds,
    forceStopSeconds: config.forceStopSeconds,
    resolveCwd: (relative) => path.resolve(repoRoot, relative ?? '.'),
    scratchRoot: path.join(config.dataDir, 'scratch'),
    now: () => Date.now(),
  });

  const deps: OrchestratorDeps = {
    config,
    store,
    targets,
    hub,
    runner,
    capabilities,
    repoRoot,
    localDatabaseFactory: async () => {
      if (!config.testDbAdminUrl) return null;
      return provisionLocalDatabase(config.testDbAdminUrl, {
        prefix: config.testDbUserPrefix,
        migrationsDir: path.join(repoRoot, 'backend', 'go', 'migrations'),
      });
    },
    prepareFixture: createIeltsFixturePreparer(repoRoot),
    fixtureCapabilities: new Set(['fixtures:fresh-ielts']),
  };
  const orchestrator = new Orchestrator(deps);
  const recovery = orchestrator.recover();
  return {
    config,
    repoRoot,
    store,
    targets,
    hub,
    orchestrator,
    recovery: { ...store.prune(), ...recovery },
  };
}

export function createIeltsFixturePreparer(repoRoot: string): PrepareFixture {
  const httpClient = new FetchFixtureHttpClient();
  return async ({ run, execution, suite, target, scratchDir, ledger, onLog }) => {
    const bundle = target.credentials;
    if (!bundle) throw new Error('Target profile has no credential bundle.');
    const instructor = bundle.admin ?? bundle.staff;
    if (!instructor) throw new Error('Target credential bundle has no admin/staff principal.');
    const proctors = bundle.proctors ?? [];
    if (proctors.length === 0) throw new Error('Target credential bundle has no proctor accounts.');

    const apiCandidates = run.parameters.apiCandidates ?? (suite.capacity.apiCandidates ? 100 : 0);
    const browserCandidates = run.parameters.browserCandidates ?? (suite.capacity.browserCandidates ? 10 : 0);
    const rosterSize = Math.max(apiCandidates + browserCandidates, 1);

    const session = new ApiSession(httpClient, target.origin);
    const login = await session.login(instructor);
    onLog(
      `[fixture] signed in as fixture admin ${instructor.email}${login.userId ? ` (${login.userId})` : ''}; ` +
        `creating owned IELTS fixture with ${rosterSize} synthetic identities`,
    );

    const buildIeltsLikeState = await loadIeltsStateBuilder(repoRoot);
    const fixture = await createIeltsFixture({
      target,
      runId: run.runId,
      scratchDir,
      studentCount: rosterSize,
      instructor,
      proctors,
      ledger,
      session,
      httpClient,
      buildState: (params) => buildIeltsLikeState(params),
    });

    const scheduleId = fixture.resourceIds['scheduleId'];
    if (!scheduleId) throw new Error('Fixture ledger has no schedule id.');
    const env: Record<string, string> = {
      E2E_PROD_TARGET_PATH: fixture.targetPath,
      E2E_PROD_CREDS_PATH: fixture.credentialsPath,
      E2E_PROD_RUNTIME_PATH: fixture.runtimePath,
      REGISTER_URL: `${target.origin}/student/${scheduleId}/register`,
      K6_BASE_URL: target.origin,
      K6_CONFIRM_PROD: 'true',
      K6_STUDENTS: String(apiCandidates),
      USER_COUNT: String(browserCandidates),
      MAX_CONCURRENT_USERS: String(
        run.parameters.browserConcurrency ?? Math.max(1, Math.min(20, browserCandidates || 1)),
      ),
    };

    mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
    if (browserCandidates > 0) {
      const candidates = (bundle.candidates ?? []).slice(0, browserCandidates);
      if (candidates.length < browserCandidates) {
        throw new Error(
          `Requested ${browserCandidates} browser candidates but the credential bundle provides ${candidates.length}.`,
        );
      }
      const usersPath = path.join(scratchDir, 'browser-users.json');
      writeFileSync(
        usersPath,
        JSON.stringify(
          candidates.map((candidate) => ({
            userId: candidate.userId,
            email: candidate.email,
            password: candidate.password,
          })),
          null,
          2,
        ),
        { mode: 0o600 },
      );
      env['USERS_FILE'] = usersPath;
      env['HEADED_USERS'] = String(
        run.parameters.browserConcurrency ?? Math.min(browserCandidates, 3),
      );
    }

    const notes = [
      `fixture: exam=${fixture.resourceIds['examId']} schedule=${scheduleId} version=${fixture.resourceIds['publishedVersionId']} proctors=${fixture.proctorUserIds.length}`,
      'fixture: scenario check-in threshold is cohort-relative for the synthetic roster',
    ];
    onLog(`[fixture] owned schedule ${scheduleId} ready for ${suite.id} (execution ${execution.executionId})`);
    return { env, notes };
  };
}

type IeltsStateBuilder = (params: { title: string; preset: 'Academic' | 'General Training' }) => unknown;

async function loadIeltsStateBuilder(repoRoot: string): Promise<IeltsStateBuilder> {
  // The builder lives in the checked-in E2E support tree. It is imported by
  // path at runtime (the portal runs under tsx) so the product bundle and the
  // portal TypeScript project stay decoupled.
  const modulePath = path.join(repoRoot, 'e2e', 'support', 'prodBootstrap.ts');
  const imported = (await import(pathToFileURL(modulePath).href)) as {
    buildIeltsLikeState?: IeltsStateBuilder;
  };
  if (typeof imported.buildIeltsLikeState !== 'function') {
    throw new Error('e2e/support/prodBootstrap.ts does not export buildIeltsLikeState.');
  }
  return imported.buildIeltsLikeState;
}
