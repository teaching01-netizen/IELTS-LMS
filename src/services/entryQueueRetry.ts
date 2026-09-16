// Entry admission retry (plan C3/D3): the check-in wave is bounded retry,
// not a server-owned queue. ENTRY_GATE over-limit check-ins get 429 +
// {tier: student-entry, retryAfterSeconds} + Retry-After header. Clients
// retry at that floor with jitter — never tight-retry.

export interface EntryQueueState {
  queued: boolean;
  retryAfterSecs: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function headerRetryAfter(error: unknown): number | null {
  const rec = asRecord(error);
  const headers = asRecord(rec?.['headers']);
  const raw =
    headers?.['retry-after'] ?? headers?.['Retry-After'] ?? headers?.['retryAfter'];
  if (typeof raw === 'string' || typeof raw === 'number') {
    return finiteNumber(raw);
  }
  return null;
}

// parseEntryQueueError maps a failed studentEntry call to bounded retry state.
// queued=false means surface the error immediately (not a retry signal).
// Only HTTP 429 (or RATE_LIMIT_EXCEEDED codes) enter retry; everything else
// passes through as a hard error.
export function parseEntryQueueError(error: unknown): EntryQueueState {
  const idle: EntryQueueState = { queued: false, retryAfterSecs: 0 };
  const rec = asRecord(error);
  if (!rec) {
    return idle;
  }
  const status = finiteNumber(rec['status']);
  const code = typeof rec['code'] === 'string' ? (rec['code'] as string) : '';
  const isRateLimit =
    status === 429 || code === 'RATE_LIMIT_EXCEEDED' || code === 'RATE_LIMITED';
  if (!isRateLimit) {
    return idle;
  }
  const details = asRecord(rec['details']) ?? {};
  const fromDetails =
    finiteNumber(details['retryAfterSecs']) ?? finiteNumber(details['retryAfterSeconds']);
  const retryAfterSecs = fromDetails ?? headerRetryAfter(error) ?? 5;
  return {
    queued: true,
    retryAfterSecs: Math.max(1, Math.floor(retryAfterSecs)),
  };
}

// entryQueueDelayMs converts retryAfterSecs to a wait with jitter: the
// server's Retry-After is a FLOOR (never retry before it — that recreates
// the storm the gate absorbed). Jitter only adds 0–25% against
// thundering-herd alignment. Absolute floor 1s (never tight-retry), cap 65s
// (never unbounded). random is injectable for tests.
export function entryQueueDelayMs(
  retryAfterSecs: number,
  random: () => number = Math.random,
): number {
  const base = Math.max(1, Math.floor(retryAfterSecs)) * 1000;
  const jitter = base * 0.25 * random();
  return Math.min(65_000, Math.max(1000, Math.floor(base + jitter)));
}
