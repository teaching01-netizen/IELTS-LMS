const ANSWER_INVARIANT_ENV_ENABLED = 'VITE_FEATURE_STUDENT_LOCAL_WRITER_ANSWER_INVARIANT_ENABLED';
const ANSWER_INVARIANT_ENV_KILL_SWITCH = 'VITE_FEATURE_STUDENT_LOCAL_WRITER_ANSWER_INVARIANT_KILL_SWITCH';

export const LIVE_SESSION_STATUS_CODE = 200;

export interface StudentAnswerInvariantRollout {
  enabled: boolean;
  killSwitch: boolean;
  cohort: string | null;
  configFingerprint: string | null;
  source: 'default' | 'runtime';
}

export function getEnvBoolean(name: string): boolean | null {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const value = env[name];
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return null;
}

export function buildDefaultAnswerInvariantRollout(): StudentAnswerInvariantRollout {
  return {
    enabled: getEnvBoolean(ANSWER_INVARIANT_ENV_ENABLED) ?? true,
    killSwitch: getEnvBoolean(ANSWER_INVARIANT_ENV_KILL_SWITCH) ?? false,
    cohort: null,
    configFingerprint: null,
    source: 'default',
  };
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function parseFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseIsoTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function parseNullableBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return null;
}

export function parseNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function extractAttemptSyncState(live: unknown): string {
  const record = asRecord(live);
  const attempt = record ? asRecord(record['attempt']) : null;
  const recovery = attempt ? asRecord(attempt['recovery']) : null;
  const syncState = recovery ? recovery['syncState'] : null;
  return typeof syncState === 'string' && syncState.trim().length > 0 ? syncState : 'idle';
}

export function resolveAnswerInvariantRollout(live: unknown): StudentAnswerInvariantRollout {
  const runtime = asRecord(asRecord(live)?.['runtime']);
  if (!runtime) {
    return buildDefaultAnswerInvariantRollout();
  }

  const enabled = parseNullableBoolean(runtime['localWriterAnswerInvariantEnabled']);
  const killSwitch = parseNullableBoolean(runtime['localWriterAnswerInvariantKillSwitch']);
  const cohort = parseNullableString(runtime['localWriterAnswerInvariantCohort']);
  const configFingerprint = parseNullableString(runtime['localWriterAnswerInvariantConfigFingerprint']);

  if (enabled === null && killSwitch === null && cohort === null && configFingerprint === null) {
    return buildDefaultAnswerInvariantRollout();
  }

  return {
    enabled: enabled ?? (getEnvBoolean(ANSWER_INVARIANT_ENV_ENABLED) ?? true),
    killSwitch: killSwitch ?? (getEnvBoolean(ANSWER_INVARIANT_ENV_KILL_SWITCH) ?? false),
    cohort,
    configFingerprint,
    source: 'runtime',
  };
}

export function buildLiveMetricEndpoint(scheduleId: string): string {
  return `/v1/student/sessions/${scheduleId}/live`;
}
