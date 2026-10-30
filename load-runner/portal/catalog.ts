import {
  CAPS,
  type ControlOwner,
  type ExecutionEnvironment,
  type Selection,
} from './contracts';

/**
 * Canonical suite catalog.
 *
 * Every executable of the application test surface must either appear here
 * (directly, as an alias, or with an explicit classification) or the catalog
 * contract test fails. Commands are fixed argv arrays; no caller-supplied
 * text ever reaches a command.
 */

export const CATALOG_REVISION = '2026-10-21.1';

export type CommandResultKind = 'exit' | 'gofmt' | 'playwright' | 'k6' | 'browser-summary';

export interface CommandStep {
  label: string;
  command: string;
  args: string[];
  /** Repository-relative working directory. */
  cwd?: string;
  resultKind: CommandResultKind;
  /** Required files/globs produced by this step, relative to the step cwd. */
  requiredOutputs?: string[];
}

export type SuiteAdapter = 'command' | 'hybrid' | 'fixture-command';

export interface SuiteDefinition {
  id: string;
  title: string;
  description: string;
  family: string;
  environments: ExecutionEnvironment[];
  adapter: SuiteAdapter;
  controlOwner: ControlOwner;
  steps: CommandStep[];
  requires: string[];
  deadlineMinutes: number;
  parameters: Array<'apiCandidates' | 'browserCandidates' | 'browserConcurrency' | 'students' | 'userOffset'>;
  capacity: {
    apiCandidates: number | null;
    browserCandidates: number | null;
    nativeProof: boolean;
  };
  effects: string[];
  requiredOutputs: string[];
  /** Included when the operator selects Run all. */
  runAll: boolean;
  legacy?: boolean;
  exclusionReason?: string;
}

const ISOLATED: ExecutionEnvironment[] = ['isolated'];
const STAGING: ExecutionEnvironment[] = ['staging'];
const PRODUCTION: ExecutionEnvironment[] = ['production'];
const STAGING_OR_PRODUCTION: ExecutionEnvironment[] = ['staging', 'production'];

const PLAYWRIGHT = (config: string): CommandStep => ({
  label: `playwright ${config}`,
  command: 'bunx',
  args: ['playwright', 'test', '--config', config],
  resultKind: 'playwright',
  requiredOutputs: ['portal-results/playwright.json'],
});

const K6 = (script: string): CommandStep => ({
  label: `k6 ${script}`,
  command: 'k6',
  args: ['run', script],
  resultKind: 'k6',
  requiredOutputs: ['portal-results/k6-summary.json'],
});

const LIVE_SUMMARY: CommandStep = {
  label: 'live browser runner',
  command: 'bun',
  args: ['run', 'e2e:live-runner'],
  resultKind: 'browser-summary',
  requiredOutputs: ['portal-results/browser-summary.json'],
};

function commandSuite(
  definition: Omit<
    SuiteDefinition,
    'adapter' | 'parameters' | 'capacity' | 'requiredOutputs' | 'runAll' | 'effects'
  > & {
    adapter?: SuiteAdapter;
    parameters?: SuiteDefinition['parameters'];
    capacity?: Partial<SuiteDefinition['capacity']>;
    requiredOutputs?: string[];
    runAll?: boolean;
    effects?: string[];
  },
): SuiteDefinition {
  const {
    adapter,
    parameters,
    capacity,
    requiredOutputs,
    runAll,
    effects,
    ...required
  } = definition;
  return {
    ...required,
    adapter: adapter ?? 'command',
    parameters: parameters ?? [],
    capacity: {
      apiCandidates: capacity?.apiCandidates ?? null,
      browserCandidates: capacity?.browserCandidates ?? null,
      nativeProof: capacity?.nativeProof ?? false,
    },
    requiredOutputs: requiredOutputs ?? [],
    runAll: runAll ?? true,
    effects: effects ?? [],
  };
}

const SUITES: SuiteDefinition[] = [
  commandSuite({
    id: 'quality.frontend',
    title: 'Frontend quality gate',
    description: 'Repository typecheck, lint, production build, student bundle isolation, and the full Vitest coverage run.',
    family: 'quality',
    environments: ISOLATED,
    controlOwner: 'suite',
    steps: [
      { label: 'typecheck', command: 'bun', args: ['run', 'typecheck'], resultKind: 'exit' },
      { label: 'staff test typecheck', command: 'bun', args: ['run', 'typecheck:staff-tests'], resultKind: 'exit' },
      { label: 'lint', command: 'bun', args: ['run', 'lint'], resultKind: 'exit' },
      { label: 'build', command: 'bun', args: ['run', 'build'], resultKind: 'exit' },
      {
        label: 'student bundle isolation',
        command: 'bun',
        args: ['run', 'test:student-bundle'],
        resultKind: 'exit',
      },
      { label: 'coverage', command: 'bun', args: ['run', 'test:coverage'], resultKind: 'exit' },
    ],
    requires: ['node', 'bun'],
    deadlineMinutes: 60,
  }),
  commandSuite({
    id: 'quality.coedit',
    title: 'Coedit service quality gate',
    description: 'Typecheck and test the authoring coedit service with its own Vitest boundary.',
    family: 'quality',
    environments: ISOLATED,
    controlOwner: 'suite',
    steps: [
      { label: 'coedit typecheck', command: 'bun', args: ['run', 'coedit:typecheck'], resultKind: 'exit' },
      { label: 'coedit tests', command: 'bun', args: ['run', 'coedit:test'], resultKind: 'exit' },
    ],
    requires: ['node', 'bun'],
    deadlineMinutes: 60,
  }),
  commandSuite({
    id: 'unit.runner',
    title: 'Runner helper unit tests',
    description: 'Prod-load helper contracts, roster construction, and orchestration unit tests.',
    family: 'unit',
    environments: ISOLATED,
    controlOwner: 'suite',
    steps: [{ label: 'runner unit tests', command: 'bun', args: ['run', 'test:live-runner'], resultKind: 'exit' }],
    requires: ['node', 'bun'],
    deadlineMinutes: 60,
  }),
  commandSuite({
    id: 'unit.portal',
    title: 'Portal unit and integration tests',
    description: 'Portal contracts, durability, cancellation, evidence, and adapter failure boundaries.',
    family: 'unit',
    environments: ISOLATED,
    controlOwner: 'suite',
    steps: [
      {
        label: 'portal tests',
        command: 'bunx',
        args: ['vitest', 'run', '--config', 'load-runner/vitest.portal.config.ts'],
        resultKind: 'exit',
      },
    ],
    requires: ['node', 'bun'],
    deadlineMinutes: 60,
  }),
  commandSuite({
    id: 'performance.frontend',
    title: 'Frontend performance budget tests',
    description: 'Vitest performance budget suite for the application.',
    family: 'quality',
    environments: ISOLATED,
    controlOwner: 'suite',
    steps: [{ label: 'performance tests', command: 'bun', args: ['run', 'test:performance'], resultKind: 'exit' }],
    requires: ['node', 'bun'],
    deadlineMinutes: 60,
  }),
  commandSuite({
    id: 'backend.go',
    title: 'Go backend quality gate',
    description: 'Format, vet, build, JSON test output, race tests, and real-MySQL integration contracts.',
    family: 'backend',
    environments: ISOLATED,
    controlOwner: 'suite',
    steps: [
      { label: 'gofmt', command: 'gofmt', args: ['-l', '.'], cwd: 'backend/go', resultKind: 'gofmt' },
      { label: 'go vet', command: 'go', args: ['vet', './...'], cwd: 'backend/go', resultKind: 'exit' },
      { label: 'go build', command: 'go', args: ['build', './...'], cwd: 'backend/go', resultKind: 'exit' },
      {
        label: 'go tests',
        command: 'node',
        args: ['load-runner/portal/tools/run-go-tests.mjs', 'backend/go', './...'],
        resultKind: 'exit',
        requiredOutputs: ['portal-results/go-test.json'],
      },
      {
        label: 'go integration tests',
        command: 'go',
        args: ['test', '-count=1', './integration/...', './cmd/api/...'],
        cwd: 'backend/go',
        resultKind: 'exit',
      },
      {
        label: 'go race tests',
        command: 'go',
        args: ['test', '-race', '-count=1', './internal/authz/...', './internal/schedules/...', './internal/proctor/...'],
        cwd: 'backend/go',
        resultKind: 'exit',
      },
    ],
    requires: ['go', 'test-mysql', 'c-toolchain'],
    deadlineMinutes: 120,
  }),
  commandSuite({
    id: 'browser.local',
    title: 'Local browser matrix',
    description: 'All configured Playwright projects against the isolated local stack.',
    family: 'browser',
    environments: ISOLATED,
    controlOwner: 'suite',
    steps: [PLAYWRIGHT('playwright.config.ts')],
    requires: ['node', 'bun', 'browsers', 'local-stack'],
    deadlineMinutes: 24 * 60,
    capacity: { browserCandidates: 20 },
    effects: ['Creates disposable local fixtures only.'],
  }),
  ...(
    [
      ['sat-a11y', 'SAT accessibility'],
      ['sat-spectrum', 'SAT spectrum controls'],
      ['sat-annotations', 'SAT annotations'],
      ['sat-auto-fit', 'SAT auto-fit'],
      ['sat-results', 'SAT results'],
      ['sat-adaptive-reading', 'SAT adaptive reading'],
      ['sat-screen-zoom', 'SAT screen zoom'],
      ['sat-transition', 'SAT transitions'],
      ['touch-selection', 'Touch selection'],
      ['sat-authoring', 'SAT authoring'],
      ['sat-answered-print', 'SAT answered print'],
      ['sat-code-start', 'SAT code start'],
      ['sat-staff-ux', 'SAT staff UX'],
      ['sat-forms', 'SAT forms and Eva SIM'],
      ['sat-break-boundary', 'SAT break boundaries'],
      ['coedit-live', 'Coedit live collaboration'],
      ['exam-continuity', 'Exam session continuity'],
      ['ielts-offline', 'IELTS offline continuity'],
    ] as const
  ).map(([config, title]) =>
    commandSuite({
      id: `browser.specialized.${config}`,
      title,
      description: `${title} Playwright configuration with its checked-in matching and devices.`,
      family: 'browser-specialized',
      environments: ISOLATED,
      controlOwner: 'suite',
      steps: [PLAYWRIGHT(`playwright.${config}.config.ts`)],
      requires: ['node', 'bun', 'browsers', 'local-stack'],
      deadlineMinutes: 180,
      capacity: { browserCandidates: 20 },
    }),
  ),
  commandSuite({
    id: 'browser.specialized.staff-parity',
    title: 'Staff UI parity',
    description: 'Fixture-backed SAT and IELTS staff visual and interaction references.',
    family: 'browser-specialized',
    environments: ISOLATED,
    controlOwner: 'suite',
    steps: [PLAYWRIGHT('playwright.staff-parity.config.ts')],
    requires: ['node', 'bun', 'browsers'],
    deadlineMinutes: 30,
    runAll: false,
    exclusionReason: 'Screenshot references must run on their reference platform.',
  }),
  commandSuite({
    id: 'browser.specialized.staff-perf',
    title: 'Staff interaction profile',
    description: 'Fixture-backed SAT authoring, large-room proctoring, and grading review interaction timing.',
    family: 'browser-specialized',
    environments: ISOLATED,
    controlOwner: 'suite',
    steps: [PLAYWRIGHT('playwright.staff-perf.config.ts')],
    requires: ['node', 'bun', 'browsers'],
    deadlineMinutes: 15,
    runAll: false,
    exclusionReason: 'Timing budgets are only meaningful on an idle reference machine.',
  }),
  commandSuite({
    id: 'prod.smoke',
    title: 'Production smoke journeys',
    description: 'Read-mostly production smoke Playwright suite for a configured staff profile.',
    family: 'production',
    environments: STAGING_OR_PRODUCTION,
    controlOwner: 'suite',
    steps: [PLAYWRIGHT('playwright.prod-smoke.config.ts')],
    requires: ['node', 'bun', 'browsers', 'target', 'credentials:staff'],
    deadlineMinutes: 180,
    parameters: ['students'],
    capacity: { browserCandidates: 20 },
    effects: ['Signs in as configured staff against the selected remote target.'],
  }),
  commandSuite({
    id: 'prod.ielts.browser.journey',
    title: 'Production IELTS browser journeys',
    description: 'Canonical live IELTS runner, headless and headed journey modes.',
    family: 'production',
    environments: PRODUCTION,
    adapter: 'fixture-command',
    controlOwner: 'portal',
    steps: [LIVE_SUMMARY],
    requires: [
      'node',
      'bun',
      'browsers',
      'target:production',
      'credentials:prod-staff',
      'fixtures:fresh-ielts',
      'synthetic-roster',
      'candidate-accounts',
    ],
    deadlineMinutes: 180,
    parameters: ['browserCandidates', 'browserConcurrency', 'students', 'userOffset'],
    capacity: { browserCandidates: 20 },
    effects: [
      'Creates an owned IELTS exam, publishes it, and creates an owned schedule through application APIs.',
      'Registers synthetic candidates on the owned schedule only.',
      'Starts and completes the owned schedule; answers are submitted by synthetic candidates.',
    ],
  }),
  commandSuite({
    id: 'prod.ielts.browser.control',
    title: 'Production IELTS control-plane suite',
    description: 'Multi-staff control-plane Playwright suite with coordinator-owned student/control sharding.',
    family: 'production',
    environments: PRODUCTION,
    controlOwner: 'portal',
    steps: [PLAYWRIGHT('playwright.prod-load.config.ts')],
    requires: [
      'node',
      'bun',
      'browsers',
      'target:production',
      'credentials:prod-staff',
      'fixtures:fresh-ielts',
      'candidate-accounts',
    ],
    deadlineMinutes: 180,
    parameters: ['students'],
    capacity: { browserCandidates: 20 },
    effects: ['Creates staff contexts within the 20-context browser budget and controls the owned schedule.'],
  }),
  commandSuite({
    id: 'prod.ielts.hybrid',
    title: 'Production IELTS hybrid load',
    description: 'k6 owns runtime control while the browser runner follows the same owned schedule on disjoint identities.',
    family: 'production',
    environments: PRODUCTION,
    adapter: 'hybrid',
    controlOwner: 'k6',
    steps: [K6('k6/prod-start-exam-200.js'), LIVE_SUMMARY],
    requires: [
      'node',
      'bun',
      'browsers',
      'k6',
      'target:production',
      'credentials:prod-staff',
      'fixtures:fresh-ielts',
      'synthetic-roster',
      'candidate-accounts',
    ],
    deadlineMinutes: 180,
    parameters: ['apiCandidates', 'browserCandidates', 'browserConcurrency'],
    capacity: { apiCandidates: CAPS.productionApiCandidates, browserCandidates: CAPS.productionBrowserCandidates },
    effects: [
      'Creates one owned IELTS schedule used by both components.',
      'k6 starts and controls the schedule; browsers follow it on a disjoint identity slice.',
    ],
  }),
  ...(
    [
      ['start-exam', 'prod-start-exam-200.js'],
      ['section-transition', 'prod-section-transition-200.js'],
      ['submit-storm', 'prod-submit-storm-200.js'],
      ['resume', 'prod-resume-100.js'],
      ['auto-submit', 'prod-auto-submit-200.js'],
      ['exam-day', 'prod-exam-day.js'],
    ] as const
  ).map(([name, script]) =>
    commandSuite({
      id: `prod.ielts.k6.${name}`,
      title: `Production IELTS k6 ${name}`,
      description: `k6 scenario ${script} against an owned production fixture.`,
      family: 'production-k6',
      environments: PRODUCTION,
      adapter: 'fixture-command',
      controlOwner: 'k6',
      steps: [K6(`k6/${script}`)],
      requires: ['k6', 'target:production', 'credentials:prod-staff', 'fixtures:fresh-ielts', 'synthetic-roster'],
      deadlineMinutes: 120,
      parameters: ['apiCandidates', 'students', 'userOffset'],
      capacity: { apiCandidates: CAPS.productionApiCandidates },
      effects: ['Creates an owned IELTS fixture and drives synthetic API candidates against it.'],
    }),
  ),
  commandSuite({
    id: 'remote.sat.browser',
    title: 'Remote SAT browser journeys',
    description: 'Standard SAT sample creation, publish, access link, and browser journeys without SQL timing overrides.',
    family: 'sat',
    environments: STAGING_OR_PRODUCTION,
    adapter: 'fixture-command',
    controlOwner: 'portal',
    steps: [
      {
        label: 'live SAT runner',
        command: 'bun',
        args: ['run', 'e2e:live-sat-runner'],
        resultKind: 'browser-summary',
        requiredOutputs: ['portal-results/browser-summary.json'],
      },
    ],
    requires: ['node', 'bun', 'browsers', 'target', 'credentials:staff', 'fixtures:fresh-sat', 'candidate-accounts'],
    deadlineMinutes: 180,
    parameters: ['browserCandidates', 'browserConcurrency'],
    capacity: { browserCandidates: 20 },
    effects: [
      'Creates and publishes an owned SAT sample through provider/authoring APIs.',
      'Creates an owned access link and backing schedule, then admits synthetic candidates.',
    ],
  }),
  commandSuite({
    id: 'staging.sat.k6.exam-day',
    title: 'Staging SAT exam day',
    description: 'Staging-only SAT exam-day k6 scenario with native prepared fixtures.',
    family: 'staging',
    environments: STAGING,
    controlOwner: 'k6',
    steps: [K6('k6/sat-exam-day.js')],
    requires: ['k6', 'target:staging', 'prepared:sat', 'staging-capacity'],
    deadlineMinutes: 120,
    parameters: ['apiCandidates'],
  }),
  commandSuite({
    id: 'staging.sat.k6.device-transfer',
    title: 'Staging SAT device transfer',
    description: 'Staging-only SAT device-transfer scenario.',
    family: 'staging',
    environments: STAGING,
    controlOwner: 'k6',
    steps: [K6('k6/sat-device-transfer.js')],
    requires: ['k6', 'target:staging', 'prepared:sat', 'staging-capacity'],
    deadlineMinutes: 120,
    parameters: ['apiCandidates'],
  }),
  commandSuite({
    id: 'staging.sat.k6.module-entry',
    title: 'Staging SAT module entry',
    description: 'Staging-only SAT module-entry wave with prepared attempts.',
    family: 'staging',
    environments: STAGING,
    controlOwner: 'k6',
    steps: [K6('k6/sat-module-entry-2000.js')],
    requires: ['k6', 'target:staging', 'prepared:sat', 'staging-capacity'],
    deadlineMinutes: 120,
    parameters: ['apiCandidates'],
    capacity: { apiCandidates: 2000, nativeProof: true },
  }),
  commandSuite({
    id: 'staging.sat.k6.recovery-lifecycle',
    title: 'Staging SAT recovery lifecycle',
    description: 'Read-only lifecycle-state projection under up to 2,000 synthetic SAT candidates.',
    family: 'staging',
    environments: STAGING,
    controlOwner: 'k6',
    steps: [K6('k6/sat-recovery-lifecycle-2000.js')],
    requires: ['k6', 'target:staging', 'prepared:sat-recovery-lifecycle', 'staging-capacity'],
    deadlineMinutes: 120,
    parameters: ['apiCandidates'],
    capacity: { apiCandidates: 2000, nativeProof: true },
    effects: ['Reads SAT lifecycle state only; requires distinct synthetic attempt credentials.'],
  }),
  commandSuite({
    id: 'staging.sat.k6.recovery-close',
    title: 'Staging SAT recovery close',
    description: 'Rehearses SAT answer freeze, recovery replay, and next-module entry at up to 2,000 synthetic candidates.',
    family: 'staging',
    environments: STAGING,
    controlOwner: 'k6',
    steps: [K6('k6/sat-recovery-close-2000.js')],
    requires: ['k6', 'target:staging', 'prepared:sat-recovery-close', 'staging-capacity'],
    deadlineMinutes: 120,
    parameters: ['apiCandidates'],
    capacity: { apiCandidates: 2000, nativeProof: true },
    effects: ['Writes synthetic SAT answers and advances only explicitly prepared SAT recovery fixtures.'],
  }),
  commandSuite({
    id: 'staging.sat.k6.m1-m2-handoff',
    title: 'Staging SAT M1/M2 handoff',
    description: 'Staging-only SAT module handoff scenario.',
    family: 'staging',
    environments: STAGING,
    controlOwner: 'k6',
    steps: [K6('k6/sat-m1-m2-handoff.js')],
    requires: ['k6', 'target:staging', 'prepared:sat', 'staging-capacity'],
    deadlineMinutes: 120,
    parameters: ['apiCandidates'],
  }),
  commandSuite({
    id: 'staging.sat.k6.response-contract',
    title: 'Staging SAT response contract',
    description: 'SAT response-contract k6 scenario and its in-script assertions.',
    family: 'staging',
    environments: STAGING,
    controlOwner: 'k6',
    steps: [K6('k6/sat-response-contract.js')],
    requires: ['k6', 'target:staging', 'prepared:sat', 'staging-capacity'],
    deadlineMinutes: 120,
    parameters: ['apiCandidates'],
  }),
  ...(
    [
      ['entry-wave', '0_entry_wave.js', 'Entry wave'],
      ['bootstrap-herd', '1_bootstrap_herd.js', 'Bootstrap herd'],
      ['bootstrap-staggered', '2_bootstrap_staggered.js', 'Staggered bootstrap'],
      ['contend', '2_contend.js', 'Contention'],
      ['bootstrap-arrival', '3_bootstrap_arrival.js', 'One-shot arrival'],
      ['pollers', '3_pollers.js', 'Pollers'],
      ['ws-staff-soak', '4_ws_staff_soak.js', 'Staff websocket soak'],
    ] as const
  ).map(([name, script, title]) =>
    commandSuite({
      id: `staging.scale.${name}`,
      title: `Staging scale proof: ${title}`,
      description: `Native staging scale-proof scenario ${script}; native cardinality is preserved.`,
      family: 'staging-scale',
      environments: STAGING,
      controlOwner: 'k6',
      steps: [K6(`k6/scale-proof/${script}`)],
      requires: ['k6', 'target:staging', 'prepared:scale', 'staging-capacity'],
      deadlineMinutes: 180,
      parameters: ['apiCandidates'],
      capacity: { apiCandidates: 5000, nativeProof: true },
    }),
  ),
  commandSuite({
    id: 'legacy.remote',
    title: 'Legacy destructive remote E2E',
    description: 'Legacy remote launcher that can run destructive seed setup. Local browser regression is the canonical coverage.',
    family: 'legacy',
    environments: STAGING_OR_PRODUCTION,
    controlOwner: 'suite',
    steps: [],
    requires: ['legacy'],
    deadlineMinutes: 60,
    runAll: false,
    legacy: true,
    exclusionReason:
      'Excluded from Run all: the launcher may run destructive seed setup. Use browser.local for regression coverage.',
  }),
  commandSuite({
    id: 'optional.build-storybook',
    title: 'Storybook static build',
    description: 'Optional isolated build check; not a production test.',
    family: 'quality',
    environments: ISOLATED,
    controlOwner: 'suite',
    steps: [{ label: 'storybook build', command: 'bun', args: ['run', 'build-storybook'], resultKind: 'exit' }],
    requires: ['node', 'bun'],
    deadlineMinutes: 60,
    runAll: false,
  }),
  commandSuite({
    id: 'isolated.ielts.k6.personal-timing',
    title: 'Local IELTS personal timing rehearsal',
    description: 'Local-only 500-candidate readiness, reconnect, section-transition, and submission rehearsal.',
    family: 'isolated-load',
    environments: ISOLATED,
    controlOwner: 'k6',
    steps: [K6('k6/ielts-personal-timing-500.js')],
    requires: ['k6', 'target:local', 'prepared:ielts-personal-load', 'credentials:staff'],
    deadlineMinutes: 30,
    capacity: { apiCandidates: 500, nativeProof: true },
    effects: ['Starts a prepared local IELTS schedule, writes synthetic answers, and submits 500 synthetic candidates.'],
    runAll: false,
    exclusionReason: 'Excluded from Run all: the local rehearsal runs complete section timers and submits its prepared 500-candidate schedule.',
  }),
  commandSuite({
    id: 'isolated.ielts.k6.throughput',
    title: 'Local IELTS throughput rehearsal',
    description: 'Local-only open-arrival IELTS answer and runtime throughput scenario against explicitly prepared synthetic attempts.',
    family: 'isolated-load',
    environments: ISOLATED,
    controlOwner: 'k6',
    steps: [K6('k6/ielts-throughput.js')],
    requires: ['k6', 'target:local', 'prepared:ielts-throughput', 'credentials:staff'],
    deadlineMinutes: 60,
    parameters: ['apiCandidates'],
    capacity: { apiCandidates: 2000, nativeProof: true },
    effects: ['Writes synthetic IELTS answers and submits only explicitly prepared attempts.'],
    runAll: false,
    exclusionReason: 'Excluded from Run all: requires a prepared synthetic IELTS cohort and mutates its attempts.',
  }),
  commandSuite({
    id: 'isolated.sat.k6.throughput',
    title: 'Local SAT throughput rehearsal',
    description: 'Local-only open-arrival SAT answer, replay, and state-read throughput scenario against explicitly prepared synthetic attempts.',
    family: 'isolated-load',
    environments: ISOLATED,
    controlOwner: 'k6',
    steps: [K6('k6/sat-throughput.js')],
    requires: ['k6', 'target:local', 'prepared:sat-throughput', 'credentials:staff'],
    deadlineMinutes: 60,
    parameters: ['apiCandidates'],
    capacity: { apiCandidates: 2000, nativeProof: true },
    effects: ['Writes synthetic SAT answers only for explicitly prepared attempts.'],
    runAll: false,
    exclusionReason: 'Excluded from Run all: requires a prepared synthetic SAT cohort and mutates its attempts.',
  }),
];

export const SUITE_CATALOG: readonly SuiteDefinition[] = Object.freeze(SUITES);

export const SUITE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'quality': 'quality.frontend',
  'quality.unit': 'quality.frontend',
  'coedit': 'quality.coedit',
  'runner': 'unit.runner',
  'portal': 'unit.portal',
  'performance': 'performance.frontend',
  'backend': 'backend.go',
  'browser': 'browser.local',
  'prod.smoke.browser': 'prod.smoke',
  'prod.ielts.browser': 'prod.ielts.browser.journey',
  'prod.ielts.k6.start': 'prod.ielts.k6.start-exam',
  'prod.ielts.k6.section': 'prod.ielts.k6.section-transition',
  'prod.ielts.k6.storm': 'prod.ielts.k6.submit-storm',
  'staging.sat.exam-day': 'staging.sat.k6.exam-day',
  'staging.sat.device-transfer': 'staging.sat.k6.device-transfer',
  'staging.sat.module-entry': 'staging.sat.k6.module-entry',
  'staging.sat.handoff': 'staging.sat.k6.m1-m2-handoff',
  'staging.scale': 'staging.scale.entry-wave',
  'legacy': 'legacy.remote',
});

const SUITE_BY_ID = new Map(SUITES.map((suite) => [suite.id, suite]));

export function getSuite(id: string): SuiteDefinition | null {
  const canonical = SUITE_ALIASES[id] ?? id;
  return SUITE_BY_ID.get(canonical) ?? null;
}

export function canonicalSuiteId(id: string): string | null {
  const canonical = SUITE_ALIASES[id] ?? id;
  return SUITE_BY_ID.has(canonical) ? canonical : null;
}

export interface ExpandedSelection {
  suites: SuiteDefinition[];
  unknownIds: string[];
  excludedIds: string[];
}

/** Expand Run all or a selected list into canonical catalog order. */
export function expandSelection(selection: Selection): ExpandedSelection {
  const requested = selection.mode === 'all' ? SUITES.filter((suite) => suite.runAll).map((suite) => suite.id) : selection.suiteIds;
  const unknown: string[] = [];
  const canonical = new Set<string>();
  for (const id of requested) {
    const resolved = canonicalSuiteId(id);
    if (resolved === null) {
      unknown.push(id);
      continue;
    }
    canonical.add(resolved);
  }
  const suites = SUITES.filter((suite) => canonical.has(suite.id));
  const excluded = suites.filter((suite) => suite.legacy || !suite.runAll).map((suite) => suite.id);
  return { suites, unknownIds: unknown, excludedIds: excluded };
}

// ---------------------------------------------------------------------------
// Entrypoint coverage classification
// ---------------------------------------------------------------------------

export type EntrypointClassification = 'executable' | 'alias' | 'helper' | 'legacy' | 'operational';

export interface EntrypointCoverage {
  source: string;
  classification: EntrypointClassification;
  suiteId: string | null;
  note: string;
}

export const PACKAGE_SCRIPT_COVERAGE: Readonly<Record<string, EntrypointCoverage>> = Object.freeze({
  typecheck: { source: 'package.json', classification: 'executable', suiteId: 'quality.frontend', note: 'step' },
  'typecheck:staff-tests': { source: 'package.json', classification: 'executable', suiteId: 'quality.frontend', note: 'step' },
  lint: { source: 'package.json', classification: 'executable', suiteId: 'quality.frontend', note: 'step' },
  build: { source: 'package.json', classification: 'executable', suiteId: 'quality.frontend', note: 'step' },
  'test:student-bundle': { source: 'package.json', classification: 'executable', suiteId: 'quality.frontend', note: 'step' },
  'test:coverage': { source: 'package.json', classification: 'executable', suiteId: 'quality.frontend', note: 'step' },
  'test:run': { source: 'package.json', classification: 'alias', suiteId: 'quality.frontend', note: 'covered by test:coverage' },
  'test:performance': { source: 'package.json', classification: 'executable', suiteId: 'performance.frontend', note: 'step' },
  'coedit:typecheck': { source: 'package.json', classification: 'executable', suiteId: 'quality.coedit', note: 'step' },
  'coedit:test': { source: 'package.json', classification: 'executable', suiteId: 'quality.coedit', note: 'step' },
  'test:live-runner': { source: 'package.json', classification: 'executable', suiteId: 'unit.runner', note: 'step' },
  'e2e:live-runner': { source: 'package.json', classification: 'executable', suiteId: 'prod.ielts.browser.journey', note: 'runner' },
  'e2e:live-sat-runner': { source: 'package.json', classification: 'executable', suiteId: 'remote.sat.browser', note: 'runner' },
  'e2e:live-sat-control': { source: 'package.json', classification: 'helper', suiteId: null, note: 'control server helper for SAT sessions' },
  'e2e:live-with-k6': { source: 'package.json', classification: 'alias', suiteId: 'prod.ielts.hybrid', note: 'shell composition replaced by portal hybrid supervisor' },
  'e2e:prod-smoke': { source: 'package.json', classification: 'alias', suiteId: 'prod.smoke', note: 'playwright config' },
  'e2e:prod-load': { source: 'package.json', classification: 'alias', suiteId: 'prod.ielts.browser.control', note: 'playwright config' },
  'e2e:sat-a11y': { source: 'package.json', classification: 'alias', suiteId: 'browser.specialized.sat-a11y', note: 'playwright config' },
  'e2e:sat-forms': { source: 'package.json', classification: 'alias', suiteId: 'browser.specialized.sat-forms', note: 'playwright config' },
  'e2e:sat-break-boundary': { source: 'package.json', classification: 'alias', suiteId: 'browser.specialized.sat-break-boundary', note: 'playwright config' },
  'e2e:sat-spectrum': { source: 'package.json', classification: 'alias', suiteId: 'browser.specialized.sat-spectrum', note: 'playwright config' },
  'e2e:sat-annotations': { source: 'package.json', classification: 'alias', suiteId: 'browser.specialized.sat-annotations', note: 'playwright config' },
  'e2e:sat-auto-fit': { source: 'package.json', classification: 'alias', suiteId: 'browser.specialized.sat-auto-fit', note: 'playwright config' },
  'e2e:sat-results': { source: 'package.json', classification: 'alias', suiteId: 'browser.specialized.sat-results', note: 'playwright config' },
  'e2e:sat-adaptive-reading': { source: 'package.json', classification: 'alias', suiteId: 'browser.specialized.sat-adaptive-reading', note: 'playwright config' },
  'e2e:sat-screen-zoom': { source: 'package.json', classification: 'alias', suiteId: 'browser.specialized.sat-screen-zoom', note: 'playwright config' },
  'e2e:sat-transition': { source: 'package.json', classification: 'alias', suiteId: 'browser.specialized.sat-transition', note: 'playwright config' },
  'playwright': { source: 'package.json', classification: 'alias', suiteId: 'browser.local', note: 'playwright config' },
  'k6:exam-day': { source: 'package.json', classification: 'alias', suiteId: 'prod.ielts.k6.exam-day', note: 'script' },
  'k6:sat-exam-day': { source: 'package.json', classification: 'alias', suiteId: 'staging.sat.k6.exam-day', note: 'script' },
  'k6:sat-lifecycle': { source: 'package.json', classification: 'alias', suiteId: 'staging.sat.k6.recovery-lifecycle', note: 'script' },
  'k6:sat-close': { source: 'package.json', classification: 'alias', suiteId: 'staging.sat.k6.recovery-close', note: 'script' },
  'k6:start-exam': { source: 'package.json', classification: 'alias', suiteId: 'prod.ielts.k6.start-exam', note: 'script' },
  'k6:section-transition': { source: 'package.json', classification: 'alias', suiteId: 'prod.ielts.k6.section-transition', note: 'script' },
  'k6:submit-storm': { source: 'package.json', classification: 'alias', suiteId: 'prod.ielts.k6.submit-storm', note: 'script' },
  'k6:resume': { source: 'package.json', classification: 'alias', suiteId: 'prod.ielts.k6.resume', note: 'script' },
  'k6:auto-submit': { source: 'package.json', classification: 'alias', suiteId: 'prod.ielts.k6.auto-submit', note: 'script' },
  'e2e:leapcell-ui': { source: 'package.json', classification: 'legacy', suiteId: 'legacy.remote', note: 'unauthenticated legacy control page' },
  'coedit:service': { source: 'package.json', classification: 'operational', suiteId: null, note: 'service process' },
  'coedit:service:dev': { source: 'package.json', classification: 'operational', suiteId: null, note: 'service process' },
  'coedit:manifest': { source: 'package.json', classification: 'operational', suiteId: null, note: 'runtime manifest sync' },
  dev: { source: 'package.json', classification: 'operational', suiteId: null, note: 'dev server' },
  preview: { source: 'package.json', classification: 'operational', suiteId: null, note: 'preview server' },
  clean: { source: 'package.json', classification: 'operational', suiteId: null, note: 'build cleanup' },
  'lint:fix': { source: 'package.json', classification: 'operational', suiteId: null, note: 'developer tool' },
  test: { source: 'package.json', classification: 'operational', suiteId: null, note: 'watch mode' },
  'test:ui': { source: 'package.json', classification: 'operational', suiteId: null, note: 'developer tool' },
  storybook: { source: 'package.json', classification: 'operational', suiteId: null, note: 'developer tool' },
  'build-storybook': { source: 'package.json', classification: 'executable', suiteId: 'optional.build-storybook', note: 'optional isolated build' },
  'playwright:ui': { source: 'package.json', classification: 'operational', suiteId: null, note: 'developer tool' },
  'playwright:debug': { source: 'package.json', classification: 'operational', suiteId: null, note: 'developer tool' },
  'sat:rail': { source: 'package.json', classification: 'operational', suiteId: null, note: 'visual authoring utility' },
  'portal:dev': { source: 'package.json', classification: 'operational', suiteId: null, note: 'portal dev server' },
  'portal:build': { source: 'package.json', classification: 'operational', suiteId: null, note: 'portal build' },
  'portal:start': { source: 'package.json', classification: 'operational', suiteId: null, note: 'portal process' },
  'portal:typecheck': { source: 'package.json', classification: 'operational', suiteId: null, note: 'dedicated portal typecheck' },
  'portal:test': { source: 'package.json', classification: 'alias', suiteId: 'unit.portal', note: 'portal tests' },
  'portal:hash-password': { source: 'package.json', classification: 'helper', suiteId: null, note: 'local credential-hash utility' },
});

export const PLAYWRIGHT_CONFIG_COVERAGE: Readonly<Record<string, EntrypointCoverage>> = Object.freeze({
  'playwright.config.ts': { source: 'playwright.config.ts', classification: 'executable', suiteId: 'browser.local', note: 'full local matrix' },
  'playwright.prod-load.config.ts': { source: 'playwright.prod-load.config.ts', classification: 'executable', suiteId: 'prod.ielts.browser.control', note: 'control-plane' },
  'playwright.prod-smoke.config.ts': { source: 'playwright.prod-smoke.config.ts', classification: 'executable', suiteId: 'prod.smoke', note: 'smoke' },
  'playwright.remote.config.ts': { source: 'playwright.remote.config.ts', classification: 'legacy', suiteId: 'legacy.remote', note: 'destructive seed setup' },
  'playwright.coedit-live.config.ts': { source: 'playwright.coedit-live.config.ts', classification: 'executable', suiteId: 'browser.specialized.coedit-live', note: 'pre-provisioned DB required' },
  'playwright.sat-a11y.config.ts': { source: 'playwright.sat-a11y.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-a11y', note: 'specialized' },
  'playwright.sat-forms.config.ts': { source: 'playwright.sat-forms.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-forms', note: 'specialized' },
  'playwright.sat-adaptive-reading.config.ts': { source: 'playwright.sat-adaptive-reading.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-adaptive-reading', note: 'specialized' },
  'playwright.sat-annotations.config.ts': { source: 'playwright.sat-annotations.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-annotations', note: 'specialized' },
  'playwright.sat-answered-print.config.ts': { source: 'playwright.sat-answered-print.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-answered-print', note: 'specialized' },
  'playwright.sat-authoring.config.ts': { source: 'playwright.sat-authoring.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-authoring', note: 'specialized' },
  'playwright.sat-auto-fit.config.ts': { source: 'playwright.sat-auto-fit.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-auto-fit', note: 'specialized' },
  'playwright.sat-code-start.config.ts': { source: 'playwright.sat-code-start.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-code-start', note: 'specialized' },
  'playwright.exam-continuity.config.ts': { source: 'playwright.exam-continuity.config.ts', classification: 'executable', suiteId: 'browser.specialized.exam-continuity', note: 'specialized' },
  'playwright.ielts-offline.config.ts': { source: 'playwright.ielts-offline.config.ts', classification: 'executable', suiteId: 'browser.specialized.ielts-offline', note: 'production-preview service-worker continuity' },
  'playwright.sat-break-boundary.config.ts': { source: 'playwright.sat-break-boundary.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-break-boundary', note: 'specialized' },
  'playwright.sat-results.config.ts': { source: 'playwright.sat-results.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-results', note: 'specialized' },
  'playwright.sat-screen-zoom.config.ts': { source: 'playwright.sat-screen-zoom.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-screen-zoom', note: 'specialized' },
  'playwright.sat-spectrum.config.ts': { source: 'playwright.sat-spectrum.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-spectrum', note: 'specialized' },
  'playwright.sat-staff-ux.config.ts': { source: 'playwright.sat-staff-ux.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-staff-ux', note: 'specialized' },
  'playwright.staff-parity.config.ts': { source: 'playwright.staff-parity.config.ts', classification: 'executable', suiteId: 'browser.specialized.staff-parity', note: 'fixture-backed visual references' },
  'playwright.staff-perf.config.ts': { source: 'playwright.staff-perf.config.ts', classification: 'executable', suiteId: 'browser.specialized.staff-perf', note: 'fixture-backed interaction profile' },
  'playwright.sat-transition.config.ts': { source: 'playwright.sat-transition.config.ts', classification: 'executable', suiteId: 'browser.specialized.sat-transition', note: 'specialized' },
  'playwright.touch-selection.config.ts': { source: 'playwright.touch-selection.config.ts', classification: 'executable', suiteId: 'browser.specialized.touch-selection', note: 'specialized' },
});

export const K6_COVERAGE: Readonly<Record<string, EntrypointCoverage>> = Object.freeze({
  'k6/ielts-personal-timing-500.js': { source: 'k6/ielts-personal-timing-500.js', classification: 'executable', suiteId: 'isolated.ielts.k6.personal-timing', note: 'local-only 500-candidate timing scenario' },
  'k6/ielts-throughput.js': { source: 'k6/ielts-throughput.js', classification: 'executable', suiteId: 'isolated.ielts.k6.throughput', note: 'local-only open-arrival throughput scenario' },
  'k6/sat-throughput.js': { source: 'k6/sat-throughput.js', classification: 'executable', suiteId: 'isolated.sat.k6.throughput', note: 'local-only open-arrival throughput scenario' },
  'k6/prod-exam-day.js': { source: 'k6/prod-exam-day.js', classification: 'executable', suiteId: 'prod.ielts.k6.exam-day', note: 'scenario' },
  'k6/prod-start-exam-200.js': { source: 'k6/prod-start-exam-200.js', classification: 'executable', suiteId: 'prod.ielts.k6.start-exam', note: 'scenario' },
  'k6/prod-section-transition-200.js': { source: 'k6/prod-section-transition-200.js', classification: 'executable', suiteId: 'prod.ielts.k6.section-transition', note: 'scenario' },
  'k6/prod-submit-storm-200.js': { source: 'k6/prod-submit-storm-200.js', classification: 'executable', suiteId: 'prod.ielts.k6.submit-storm', note: 'scenario with answer-diff summary' },
  'k6/prod-resume-100.js': { source: 'k6/prod-resume-100.js', classification: 'executable', suiteId: 'prod.ielts.k6.resume', note: 'scenario' },
  'k6/prod-auto-submit-200.js': { source: 'k6/prod-auto-submit-200.js', classification: 'executable', suiteId: 'prod.ielts.k6.auto-submit', note: 'scenario' },
  'k6/practice-entry.js': { source: 'k6/practice-entry.js', classification: 'helper', suiteId: null, note: 'scenario module used by SAT scenarios' },
  'k6/prod-load-helpers.js': { source: 'k6/prod-load-helpers.js', classification: 'helper', suiteId: null, note: 'shared helpers' },
  'k6/sat-exam-day.js': { source: 'k6/sat-exam-day.js', classification: 'executable', suiteId: 'staging.sat.k6.exam-day', note: 'staging scenario' },
  'k6/sat-recovery-lifecycle-2000.js': { source: 'k6/sat-recovery-lifecycle-2000.js', classification: 'executable', suiteId: 'staging.sat.k6.recovery-lifecycle', note: '2,000-candidate lifecycle projection scenario' },
  'k6/sat-recovery-close-2000.js': { source: 'k6/sat-recovery-close-2000.js', classification: 'executable', suiteId: 'staging.sat.k6.recovery-close', note: '2,000-candidate frozen-answer recovery scenario' },
  'k6/sat-device-transfer.js': { source: 'k6/sat-device-transfer.js', classification: 'executable', suiteId: 'staging.sat.k6.device-transfer', note: 'staging scenario' },
  'k6/sat-module-entry-2000.js': { source: 'k6/sat-module-entry-2000.js', classification: 'executable', suiteId: 'staging.sat.k6.module-entry', note: 'staging scenario' },
  'k6/sat-m1-m2-handoff.js': { source: 'k6/sat-m1-m2-handoff.js', classification: 'executable', suiteId: 'staging.sat.k6.m1-m2-handoff', note: 'staging scenario' },
  'k6/sat-response-contract.js': { source: 'k6/sat-response-contract.js', classification: 'executable', suiteId: 'staging.sat.k6.response-contract', note: 'staging scenario' },
  'k6/sat-response-contract.test.js': { source: 'k6/sat-response-contract.test.js', classification: 'helper', suiteId: null, note: 'in-k6 test module' },
  'k6/scale-proof/0_entry_wave.js': { source: 'k6/scale-proof/0_entry_wave.js', classification: 'executable', suiteId: 'staging.scale.entry-wave', note: 'native proof' },
  'k6/scale-proof/1_bootstrap_herd.js': { source: 'k6/scale-proof/1_bootstrap_herd.js', classification: 'executable', suiteId: 'staging.scale.bootstrap-herd', note: 'native proof' },
  'k6/scale-proof/2_bootstrap_staggered.js': { source: 'k6/scale-proof/2_bootstrap_staggered.js', classification: 'executable', suiteId: 'staging.scale.bootstrap-staggered', note: 'native proof' },
  'k6/scale-proof/2_contend.js': { source: 'k6/scale-proof/2_contend.js', classification: 'executable', suiteId: 'staging.scale.contend', note: 'native proof' },
  'k6/scale-proof/3_bootstrap_arrival.js': { source: 'k6/scale-proof/3_bootstrap_arrival.js', classification: 'executable', suiteId: 'staging.scale.bootstrap-arrival', note: 'native proof' },
  'k6/scale-proof/3_pollers.js': { source: 'k6/scale-proof/3_pollers.js', classification: 'executable', suiteId: 'staging.scale.pollers', note: 'native proof' },
  'k6/scale-proof/4_ws_staff_soak.js': { source: 'k6/scale-proof/4_ws_staff_soak.js', classification: 'executable', suiteId: 'staging.scale.ws-staff-soak', note: 'native proof' },
  'k6/scale-proof/rate_limit_contract.js': { source: 'k6/scale-proof/rate_limit_contract.js', classification: 'helper', suiteId: null, note: 'contract helper module' },
});

export const GO_TEST_FAMILY_COVERAGE: EntrypointCoverage = {
  source: 'backend/go',
  classification: 'executable',
  suiteId: 'backend.go',
  note: 'go test ./... plus integration and race packages',
};

export const STANDALONE_ONLY_COVERAGE: EntrypointCoverage = {
  source: 'load-runner/k6/prod-transition-reconciliation-200.js',
  classification: 'helper',
  suiteId: null,
  note: 'standalone-only transition reconciliation utility; requires a pre-admitted fixture and is not a web-runnable scenario',
};
