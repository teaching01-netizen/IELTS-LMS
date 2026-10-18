import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Wire and persistence contracts for the production test portal.
 *
 * The portal owns its own /api/v1 namespace. Unknown request fields are
 * rejected (every object schema is strict) so a caller can never smuggle
 * shell text, filesystem paths, environment overrides, or raw schedule IDs
 * into a run.
 */

export const PORTAL_SCHEMA_VERSION = 1;
export const RUN_CREATE_SCHEMA_VERSION = 1;

export const EXECUTION_ENVIRONMENTS = ['isolated', 'staging', 'production'] as const;
export type ExecutionEnvironment = (typeof EXECUTION_ENVIRONMENTS)[number];

export const CONTROL_OWNERS = ['suite', 'k6', 'portal'] as const;
export type ControlOwner = (typeof CONTROL_OWNERS)[number];

export const RUN_STATUSES = [
  'queued',
  'preparing',
  'running',
  'finalizing',
  'stopping',
  'passed',
  'failed',
  'cancelled',
  'interrupted',
  'blocked',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const SUITE_STATUSES = [
  'pending',
  'preparing',
  'running',
  'finalizing',
  'passed',
  'failed',
  'cancelled',
  'interrupted',
  'blocked',
  'not_run',
] as const;
export type SuiteStatus = (typeof SUITE_STATUSES)[number];

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'passed',
  'failed',
  'cancelled',
  'interrupted',
  'blocked',
];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

export type FailureKind = 'assertion' | 'infrastructure' | 'capacity' | 'precondition' | null;

export interface NormalizedResult {
  outcome: 'passed' | 'failed' | 'cancelled' | 'interrupted';
  failureKind: FailureKind;
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
  requestedCandidates: number | null;
  configuredCandidates: number | null;
  achievedCandidates: number | null;
  evidenceComplete: boolean;
  thresholdFailures: string[];
}

export function emptyResult(outcome: NormalizedResult['outcome'] = 'failed'): NormalizedResult {
  return {
    outcome,
    failureKind: outcome === 'passed' ? null : 'infrastructure',
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    requestedCandidates: null,
    configuredCandidates: null,
    achievedCandidates: null,
    evidenceComplete: false,
    thresholdFailures: [],
  };
}

// ---------------------------------------------------------------------------
// Run parameters
// ---------------------------------------------------------------------------

/**
 * Server-side caps. These are intentionally constants, not request values:
 * changing a production cap is a reviewed code change.
 */
export const CAPS = {
  productionApiCandidates: 400,
  productionBrowserCandidates: 20,
  stagingDefaultCandidates: 400,
  maxQueuedRuns: 20,
} as const;

const boundedInt = (min: number, max: number) => z.number().int().min(min).max(max);

export const runParametersSchema = z
  .object({
    apiCandidates: boundedInt(1, CAPS.productionApiCandidates).optional(),
    browserCandidates: boundedInt(0, CAPS.productionBrowserCandidates).optional(),
    browserConcurrency: boundedInt(1, CAPS.productionBrowserCandidates).optional(),
    students: boundedInt(1, 5000).optional(),
    userOffset: boundedInt(0, 100_000).optional(),
  })
  .strict();

export type RunParameters = z.infer<typeof runParametersSchema>;

export const selectionSchema = z
  .object({
    mode: z.enum(['selected', 'all']),
    suiteIds: z.array(z.string().min(1).max(120)).max(200).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'selected' && value.suiteIds.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Select at least one suite.' });
    }
  });

export type Selection = z.infer<typeof selectionSchema>;

export const targetBindingsSchema = z
  .object({
    isolated: z.string().min(1).max(120).optional(),
    staging: z.string().min(1).max(120).optional(),
    production: z.string().min(1).max(120).optional(),
  })
  .strict();

export type TargetBindings = z.infer<typeof targetBindingsSchema>;

const preflightBaseShape = {
  selection: selectionSchema,
  targetBindings: targetBindingsSchema.default({}),
  parameters: runParametersSchema.default({}),
};

export const preflightRequestSchema = z.object(preflightBaseShape).strict();
export type PreflightRequest = z.infer<typeof preflightRequestSchema>;

export const approvalSchema = z
  .object({
    preflightDigest: z.string().min(16).max(128),
    confirmProduction: z.boolean().default(false),
    confirmSyntheticFixtures: z.boolean().default(false),
  })
  .strict();

export type Approval = z.infer<typeof approvalSchema>;

export const createRunRequestSchema = z
  .object({
    ...preflightBaseShape,
    approval: approvalSchema,
  })
  .strict();

export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const cancelRunRequestSchema = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .strict();

export const releaseQueueRequestSchema = z
  .object({
    runIds: z.array(z.string().min(1).max(64)).max(CAPS.maxQueuedRuns).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Preflight response
// ---------------------------------------------------------------------------

export type PrerequisiteStatus = 'ready' | 'missing';

export interface PrerequisiteCheck {
  requirement: string;
  status: PrerequisiteStatus;
  detail: string;
}

export interface PlannedSuite {
  suiteId: string;
  title: string;
  environment: ExecutionEnvironment;
  controlOwner: ControlOwner;
  adapter: string;
  deadlineMinutes: number;
  requestedApiCandidates: number | null;
  requestedBrowserCandidates: number | null;
  effects: string[];
  requiredOutputs: string[];
  targetId: string | null;
}

export interface PreflightResult {
  digest: string;
  catalogRevision: string;
  createdAt: string;
  expiresAt: string;
  mode: Selection['mode'];
  suites: PlannedSuite[];
  blockers: PrerequisiteCheck[];
  effects: string[];
  estimatedMaximumMinutes: number;
  warnings: string[];
  confirmation: {
    production: boolean;
    syntheticFixtures: boolean;
  };
}

// ---------------------------------------------------------------------------
// Durable records
// ---------------------------------------------------------------------------

export type FixtureOperationStatus =
  | 'planned'
  | 'requested'
  | 'confirmed'
  | 'unknown'
  | 'failed';

export interface FixtureOperation {
  operationId: string;
  kind: string;
  correlation: string;
  status: FixtureOperationStatus;
  targetId: string | null;
  resourceIds: Record<string, string>;
  startedAt: string | null;
  completedAt: string | null;
  detail: string | null;
}

export interface LoadEvidence {
  requestedCandidates: number | null;
  configuredCandidates: number | null;
  achievedCandidates: number | null;
  staffOrControlVus: number;
  sustained: boolean;
}

export interface ArtifactRecord {
  artifactId: string;
  executionId: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  expiresAt: string;
}

export interface SuiteExecution {
  executionId: string;
  suiteId: string;
  targetId: string | null;
  environment: ExecutionEnvironment;
  status: SuiteStatus;
  startedAt: string | null;
  endedAt: string | null;
  deadlineAt: string | null;
  cancelRequestedAt: string | null;
  failureReason: string | null;
  processIds: number[];
  load: LoadEvidence;
  fixtures: FixtureOperation[];
  artifacts: ArtifactRecord[];
  result: NormalizedResult | null;
  logPath: string | null;
}

export interface RunRecord {
  schemaVersion: number;
  runId: string;
  idempotencyKey: string;
  payloadDigest: string;
  admissionSequence: number;
  operatorId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  status: RunStatus;
  catalogRevision: string;
  imageRevision: string;
  selection: Selection;
  parameters: RunParameters;
  targets: Record<string, { id: string; environment: ExecutionEnvironment; origin: string; revision: string }>;
  approval: {
    preflightDigest: string;
    confirmProduction: boolean;
    confirmSyntheticFixtures: boolean;
  };
  cancelRequestedAt: string | null;
  hold: { reason: string; since: string } | null;
  executions: SuiteExecution[];
  result: NormalizedResult | null;
  reconciliationNotes: string[];
  artifactsExpireAt: string;
}

export interface RunSummary {
  runId: string;
  status: RunStatus;
  admissionSequence: number;
  operatorId: string;
  createdAt: string;
  updatedAt: string;
  selection: Selection;
  suiteIds: string[];
  holdReason: string | null;
  result: NormalizedResult | null;
}

export function toRunSummary(record: RunRecord): RunSummary {
  return {
    runId: record.runId,
    status: record.status,
    admissionSequence: record.admissionSequence,
    operatorId: record.operatorId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    selection: record.selection,
    suiteIds: record.executions.map((execution) => execution.suiteId),
    holdReason: record.hold?.reason ?? null,
    result: record.result,
  };
}

// ---------------------------------------------------------------------------
// Error envelope and hashing helpers
// ---------------------------------------------------------------------------

export type PortalErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'GONE'
  | 'PREREQUISITES_MISSING'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'LEGACY_ROUTE_RETIRED'
  | 'INTERNAL';

export interface PortalErrorBody {
  error: {
    code: PortalErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export class PortalError extends Error {
  readonly status: number;
  readonly code: PortalErrorCode;
  readonly details: unknown;

  constructor(status: number, code: PortalErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'PortalError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Canonical JSON: object keys sorted at every level. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function approvalDigest(input: {
  catalogRevision: string;
  selection: Selection;
  parameters: RunParameters;
  targetBindings: TargetBindings;
}): string {
  return sha256Hex(
    canonicalJson({
      schema: RUN_CREATE_SCHEMA_VERSION,
      catalogRevision: input.catalogRevision,
      selection: input.selection,
      parameters: input.parameters,
      targetBindings: input.targetBindings,
    }),
  );
}

export function parseJson<T>(schema: z.ZodType<T>, raw: string, what: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${what} is not valid JSON.`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${what} is invalid: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  return result.data;
}
