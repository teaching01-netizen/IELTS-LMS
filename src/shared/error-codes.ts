/**
 * Stable backend-code taxonomy (plan 84, 100). Lives in shared because both
 * feature domain modules and the shared API client depend on it; layer
 * direction is shared <- features, never the reverse.
 */

export type ConflictKind =
  | 'lease-fenced'
  | 'stale-control'
  | 'version-collision'
  | 'deadline'
  | 'proctor-blocked'
  | 'terminal'
  | 'write-id-reuse'
  | 'not-writable'
  | 'question-not-in-attempt'
  | 'validation'
  | 'rate-limit'
  | 'network'
  | 'server'
  | 'unknown';

export interface ClassifiedError {
  kind: ConflictKind;
  code: string;
  requestId?: string | undefined;
  retryable: boolean;
  recovery: string;
}

const CODE_MAP: Record<string, Omit<ClassifiedError, 'requestId'> & { code: string }> = {
  LEASE_FENCED: { kind: 'lease-fenced', code: 'LEASE_FENCED', retryable: false, recovery: 'takeover-or-recover' },
  CONTROL_EPOCH_STALE: { kind: 'stale-control', code: 'CONTROL_EPOCH_STALE', retryable: false, recovery: 're-snapshot-and-retry' },
  VERSION_COLLISION: { kind: 'version-collision', code: 'VERSION_COLLISION', retryable: false, recovery: 're-snapshot-and-retry' },
  DEADLINE_EXPIRED: { kind: 'deadline', code: 'DEADLINE_EXPIRED', retryable: false, recovery: 'terminal' },
  ATTEMPT_PROCTOR_BLOCKED: { kind: 'proctor-blocked', code: 'ATTEMPT_PROCTOR_BLOCKED', retryable: false, recovery: 'await-proctor' },
  TERMINALIZATION_CONFLICT: { kind: 'terminal', code: 'TERMINALIZATION_CONFLICT', retryable: false, recovery: 'terminal' },
  IDEMPOTENCY_KEY_REUSED: { kind: 'write-id-reuse', code: 'IDEMPOTENCY_KEY_REUSED', retryable: false, recovery: 'new-write-id' },
  ATTEMPT_NOT_WRITABLE: { kind: 'not-writable', code: 'ATTEMPT_NOT_WRITABLE', retryable: false, recovery: 'terminal-or-refresh' },
  QUESTION_NOT_IN_ATTEMPT: { kind: 'question-not-in-attempt', code: 'QUESTION_NOT_IN_ATTEMPT', retryable: false, recovery: 'refresh' },
  INVALID_RESPONSE: { kind: 'validation', code: 'INVALID_RESPONSE', retryable: false, recovery: 'fix-payload' },
  PROTOCOL_VERSION_UNSUPPORTED: { kind: 'validation', code: 'PROTOCOL_VERSION_UNSUPPORTED', retryable: false, recovery: 'refresh' },
  RATE_LIMIT_EXCEEDED: { kind: 'rate-limit', code: 'RATE_LIMIT_EXCEEDED', retryable: true, recovery: 'backoff-retry' },
};

export function classifyBackendCode(code: string, requestId?: string): ClassifiedError {
  const hit = CODE_MAP[code];
  if (hit) return { ...hit, requestId };
  return { kind: 'unknown', code, requestId, retryable: false, recovery: 'report-with-request-id' };
}

export function isTerminalConflict(kind: ConflictKind): boolean {
  return kind === 'terminal' || kind === 'deadline' || kind === 'proctor-blocked';
}

export function isFenced(kind: ConflictKind): boolean {
  return kind === 'lease-fenced';
}
