import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PortalConfig } from '../config';
import { loadConfig } from '../config';
import type { CapabilitySnapshot } from '../capabilities';
import type { ExecutionEnvironment } from '../contracts';
import { EventHub } from '../evidence';
import { Orchestrator, type PrepareFixture, type SuiteRunner } from '../orchestrator';
import { RunStore } from '../run-store';
import { TargetRegistry } from '../targets';

export function tempDir(prefix = 'portal-test-'): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function testConfig(overrides: Record<string, string> = {}): PortalConfig {
  return loadConfig({
    PORTAL_DATA_DIR: tempDir(),
    PORTAL_OPERATOR_USERNAME: 'operator',
    PORTAL_OPERATOR_PASSWORD_HASH: 'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
    PORTAL_RETENTION_DAYS: '14',
    ...overrides,
  });
}

export function capabilities(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    tools: new Set(['node', 'bun', 'bunx', 'go', 'gofmt', 'k6', 'cc']),
    browsers: true,
    playwrightBrowserPath: '/ms-playwright',
    ...overrides,
  };
}

export const staffCredential = (email: string, password = 'fixture-password-1234') => ({ email, password });

export function credentialBundleJson(overrides: {
  proctorCount?: number;
  candidateCount?: number;
} = {}): string {
  const proctors = Array.from({ length: overrides.proctorCount ?? 10 }, (_, index) =>
    staffCredential(`proctor${index + 1}@example.test`),
  );
  const candidates = Array.from({ length: overrides.candidateCount ?? 20 }, (_, index) => ({
    ...staffCredential(`candidate${index + 1}@example.test`),
    userId: `user-candidate-${index + 1}`,
  }));
  return JSON.stringify({
    version: 1,
    profiles: {
      staff: { admin: staffCredential('admin@example.test'), proctors, candidates },
    },
  });
}

export function targetsJson(
  profiles: Array<{
    id: string;
    environment: ExecutionEnvironment;
    origin: string;
    credentialRef: string;
    revision?: string;
    enabled?: boolean;
  }>,
): string {
  return JSON.stringify({
    version: 1,
    profiles: profiles.map((profile) => ({
      label: profile.id,
      revision: profile.revision ?? 'rev-1',
      enabled: profile.enabled ?? true,
      ...profile,
    })),
  });
}

export interface HarnessOptions {
  productionEnabled?: boolean;
  stagingPrepared?: boolean;
  stagingCapacity?: number;
  testDbAdminUrl?: string;
  runner?: SuiteRunner;
  prepareFixture?: PrepareFixture;
  fixtureCapabilities?: string[];
  now?: () => number;
}

export interface Harness {
  config: PortalConfig;
  store: RunStore;
  targets: TargetRegistry;
  hub: EventHub;
  orchestrator: Orchestrator;
  runnerCalls: Array<{ suiteId: string; executionId: string }>;
  logs: string[];
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const config = testConfig({
    PORTAL_PRODUCTION_ENABLED: options.productionEnabled ? 'true' : 'false',
    PORTAL_PUBLIC_ORIGIN: 'https://portal.example.test',
    PORTAL_TARGETS_JSON: targetsJson([
      {
        id: 'production-test',
        environment: 'production',
        origin: 'https://app.example.test',
        credentialRef: 'staff',
      },
      {
        id: 'staging-test',
        environment: 'staging',
        origin: 'https://staging.example.test',
        credentialRef: 'staff',
      },
    ]),
    PORTAL_CREDENTIALS_JSON: credentialBundleJson(),
    ...(options.stagingPrepared === undefined
      ? {}
      : { PORTAL_STAGING_PREPARED: options.stagingPrepared ? 'true' : 'false' }),
    ...(options.stagingCapacity === undefined
      ? {}
      : { PORTAL_STAGING_CAPACITY: String(options.stagingCapacity) }),
    ...(options.testDbAdminUrl === undefined ? {} : { PORTAL_TEST_DB_ADMIN_URL: options.testDbAdminUrl }),
  });
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
  const runnerCalls: Array<{ suiteId: string; executionId: string }> = [];
  const logs: string[] = [];
  const runner: SuiteRunner =
    options.runner ??
    {
      run: async (context) => {
        runnerCalls.push({ suiteId: context.suite.id, executionId: context.execution.executionId });
        context.onLog(`fake runner executed ${context.suite.id}`);
        return {
          result: {
            outcome: 'passed',
            failureKind: null,
            executed: 1,
            passed: 1,
            failed: 0,
            skipped: 0,
            requestedCandidates: null,
            configuredCandidates: null,
            achievedCandidates: null,
            evidenceComplete: true,
            thresholdFailures: [],
          },
          failureReason: null,
          processIds: [],
          load: {
            requestedCandidates: null,
            configuredCandidates: null,
            achievedCandidates: null,
            staffOrControlVus: 0,
            sustained: false,
          },
          artifacts: [],
        };
      },
    };
  const orchestrator = new Orchestrator({
    config,
    store,
    targets,
    hub,
    runner,
    capabilities: capabilities(),
    repoRoot: process.cwd(),
    ...(options.prepareFixture === undefined ? {} : { prepareFixture: options.prepareFixture }),
    fixtureCapabilities: new Set(options.fixtureCapabilities ?? ['fixtures:fresh-ielts']),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return { config, store, targets, hub, orchestrator, runnerCalls, logs };
}

export function readManifest(runId: string, dataDir: string): Record<string, unknown> {
  const file = path.join(dataDir, 'runs', runId, 'run.json');
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}
