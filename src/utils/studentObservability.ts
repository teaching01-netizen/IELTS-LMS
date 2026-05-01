export type StudentObservabilityField = string | number | boolean | null | undefined;

interface StudentObservabilityDimensions {
  attemptId?: StudentObservabilityField;
  endpoint?: StudentObservabilityField;
  reason?: StudentObservabilityField;
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
