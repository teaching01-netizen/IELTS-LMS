import type { ProdTarget } from './prodData';

export type ViolationType = 'TAB_SWITCH' | 'CLIPBOARD_BLOCKED' | 'CONTEXT_MENU_BLOCKED';

export interface ProdRunContext {
  runId: string;
  shardIndex: number;
  shardCount: number;
}

export function resolveProdRunContext(target: ProdTarget): ProdRunContext {
  const shardIndex = Number(process.env['E2E_PROD_SHARD_INDEX'] ?? '0');
  const shardCount = Number(process.env['E2E_PROD_SHARD_COUNT'] ?? `${target.scenario.shardCount}`);
  const runId =
    process.env['E2E_PROD_RUN_ID'] ??
    process.env['CI_JOB_ID'] ??
    'prod-load';

  if (!Number.isFinite(shardIndex) || shardIndex < 0) {
    throw new Error(`Invalid E2E_PROD_SHARD_INDEX: ${process.env['E2E_PROD_SHARD_INDEX'] ?? ''}`);
  }
  if (!Number.isFinite(shardCount) || shardCount <= 0) {
    throw new Error(`Invalid E2E_PROD_SHARD_COUNT: ${process.env['E2E_PROD_SHARD_COUNT'] ?? ''}`);
  }
  if (shardIndex >= shardCount) {
    throw new Error(`E2E_PROD_SHARD_INDEX (${shardIndex}) must be < shardCount (${shardCount})`);
  }

  return { runId, shardIndex, shardCount };
}

export function stableHash32(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function computeArrivalJitterMs(runId: string, wcode: string, rampSeconds: number): number {
  if (rampSeconds <= 0) return 0;
  const hash = stableHash32(`${runId}:${wcode}`);
  return (hash % (rampSeconds * 1000)) | 0;
}

export function selectShardStudents(target: ProdTarget, shardIndex: number, shardCount: number) {
  return target.students.filter((_, index) => index % shardCount === shardIndex);
}

export function sliceFirstN<T>(values: T[], count: number): T[] {
  return values.slice(0, Math.max(0, count));
}

export function computeScenarioAssignments(target: ProdTarget) {
  const students = target.students;
  const {
    invalidCheckInCount,
    offlineToggleStudentCount,
    violations,
    interventions,
  } = target.scenario;

  const invalidCheckIn = new Set(sliceFirstN(students, invalidCheckInCount).map((s) => s.wcode));

  const tabSwitch = new Set(
    sliceFirstN(students.slice(invalidCheckInCount), violations.tabSwitchCount).map((s) => s.wcode),
  );
  const clipboardBlocked = new Set(
    sliceFirstN(
      students.slice(invalidCheckInCount + violations.tabSwitchCount),
      violations.clipboardBlockedCount,
    ).map((s) => s.wcode),
  );
  const contextMenuBlocked = new Set(
    sliceFirstN(
      students.slice(
        invalidCheckInCount + violations.tabSwitchCount + violations.clipboardBlockedCount,
      ),
      violations.contextMenuBlockedCount,
    ).map((s) => s.wcode),
  );

  const offlineToggle = new Set(
    sliceFirstN(
      students.slice(
        invalidCheckInCount +
          violations.tabSwitchCount +
          violations.clipboardBlockedCount +
          violations.contextMenuBlockedCount,
      ),
      offlineToggleStudentCount,
    ).map((s) => s.wcode),
  );

  const terminate = new Set(sliceFirstN(students, interventions.terminateCount).map((s) => s.wcode));
  const warn = new Set(
    sliceFirstN(students.slice(interventions.terminateCount), interventions.warnCount).map((s) => s.wcode),
  );
  const pauseResume = new Set(
    sliceFirstN(
      students.slice(interventions.terminateCount + interventions.warnCount),
      interventions.pauseResumeCount,
    ).map((s) => s.wcode),
  );

  return {
    invalidCheckIn,
    offlineToggle,
    terminate,
    warn,
    pauseResume,
    violations: {
      tabSwitch,
      clipboardBlocked,
      contextMenuBlocked,
    },
  };
}

export function violationTypeForWcode(assignments: ReturnType<typeof computeScenarioAssignments>, wcode: string): ViolationType | null {
  if (assignments.violations.tabSwitch.has(wcode)) return 'TAB_SWITCH';
  if (assignments.violations.clipboardBlocked.has(wcode)) return 'CLIPBOARD_BLOCKED';
  if (assignments.violations.contextMenuBlocked.has(wcode)) return 'CONTEXT_MENU_BLOCKED';
  return null;
}

export async function pollUntil<T>(
  fn: () => Promise<T>,
  opts: { timeoutMs: number; intervalMs?: number; description?: string },
): Promise<T> {
  const startedAt = Date.now();
  const intervalMs = opts.intervalMs ?? 1000;
  let lastError: unknown;

  while (Date.now() - startedAt < opts.timeoutMs) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const suffix = opts.description ? ` (${opts.description})` : '';
  throw new Error(
    `Timed out after ${opts.timeoutMs}ms${suffix}.${lastError ? ` Last error: ${String(lastError)}` : ''}`,
  );
}

