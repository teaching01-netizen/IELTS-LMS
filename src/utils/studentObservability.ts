export type StudentObservabilityField = string | number | boolean | null | undefined;

interface StudentObservabilityDimensions {
  attemptId?: StudentObservabilityField;
  browserEngine?: StudentObservabilityField;
  durablePersistResult?: StudentObservabilityField;
  deviceClass?: StudentObservabilityField;
  endpoint?: StudentObservabilityField;
  lifecycleEventSource?: StudentObservabilityField;
  pendingMutationAgeMs?: StudentObservabilityField;
  pendingMutationCount?: StudentObservabilityField;
  platform?: StudentObservabilityField;
  reason?: StudentObservabilityField;
  // Realtime rollout dimensions (Phase 3). `realtimeTransport` is the client's
  // resolved mode, `latencyMs` a measured delay (e.g. server commit -> client
  // frame), and `revisionGap` how many runtime revisions a reconnect snapshot
  // closed. All low-cardinality.
  realtimeTransport?: StudentObservabilityField;
  latencyMs?: StudentObservabilityField;
  revisionGap?: StudentObservabilityField;
  scheduleId?: StudentObservabilityField;
  statusCode?: StudentObservabilityField;
  syncState?: StudentObservabilityField;
  version?: StudentObservabilityField;
}

const OBSERVABILITY_VERSION_KEYS = ['VITE_APP_VERSION', 'VITE_COMMIT_SHA', 'VITE_BUILD_ID'] as const;

function normalizeStringField(value: StudentObservabilityField): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStatusCodeField(value: StudentObservabilityField): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeNumberField(value: StudentObservabilityField): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolveStudentObservabilityVersion(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  for (const key of OBSERVABILITY_VERSION_KEYS) {
    const candidate = normalizeStringField(env[key]);
    if (candidate) {
      return candidate;
    }
  }

  return normalizeStringField(env.MODE) ?? 'unknown';
}

const STUDENT_OBSERVABILITY_VERSION = resolveStudentObservabilityVersion();

export function withStudentObservabilityDimensions(
  fields: Record<string, StudentObservabilityField> & StudentObservabilityDimensions = {},
): Record<string, StudentObservabilityField> {
  return {
    ...fields,
    version: normalizeStringField(fields.version) ?? STUDENT_OBSERVABILITY_VERSION,
    scheduleId: normalizeStringField(fields.scheduleId) ?? null,
    attemptId: normalizeStringField(fields.attemptId) ?? null,
    endpoint: normalizeStringField(fields.endpoint) ?? null,
    statusCode: normalizeStatusCodeField(fields.statusCode),
    reason: normalizeStringField(fields.reason) ?? null,
    syncState: normalizeStringField(fields.syncState) ?? null,
    browserEngine: normalizeStringField(fields.browserEngine) ?? null,
    platform: normalizeStringField(fields.platform) ?? null,
    deviceClass: normalizeStringField(fields.deviceClass) ?? null,
    lifecycleEventSource: normalizeStringField(fields.lifecycleEventSource) ?? null,
    durablePersistResult: normalizeStringField(fields.durablePersistResult) ?? null,
    pendingMutationAgeMs: normalizeNumberField(fields.pendingMutationAgeMs),
    pendingMutationCount: normalizeNumberField(fields.pendingMutationCount),
    realtimeTransport: normalizeStringField(fields.realtimeTransport) ?? null,
    latencyMs: normalizeNumberField(fields.latencyMs),
    revisionGap: normalizeNumberField(fields.revisionGap),
  };
}

export function emitStudentObservabilityMetric(
  name: string,
  fields: Record<string, StudentObservabilityField> = {},
): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }

  try {
    window.dispatchEvent(
      new CustomEvent('student-observability-metric', {
        detail: {
          name,
          ...fields,
        },
      }),
    );
  } catch {
    // Best-effort only.
  }
}
