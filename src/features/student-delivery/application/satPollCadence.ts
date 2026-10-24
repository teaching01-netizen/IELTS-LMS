/**
 * Recovery-poll cadence policy.
 *
 * Every SAT client polls the same server, so the cadence is exam infrastructure
 * rather than a screen detail: a live socket allows the steady cadence, an
 * outage backs off exponentially, and full jitter spreads the cohort's
 * reconnect herd instead of letting it arrive in lockstep.
 *
 * Pure: the hook owns the timer, the online/offline listener, and the failure
 * counter; this owns only how long to wait.
 */

/** Maximum retry window and healthy-socket cadence ceiling. */
export const SAT_POLL_LIVE_CADENCE_MS = 60_000;
/**
 * Cadence without the live socket. The lifecycle read is mutable-only, so keep
 * the recovery path bounded while still checking reachable HTTP more often
 * than the healthy-socket fallback. Writes and explicit transitions remain
 * event-driven and do not wait for this timer.
 */
export const SAT_POLL_OFFLINE_CADENCE_MS = 20_000;

export function satPollDelayMs(input: {
  liveSocketConnected: boolean;
  failures: number;
  random: number;
  retryAfterMs?: number;
}): number {
  const baseMs = input.liveSocketConnected
    ? SAT_POLL_LIVE_CADENCE_MS
    : SAT_POLL_OFFLINE_CADENCE_MS;
  const backoffMs = Math.min(
    baseMs * 2 ** Math.min(Math.max(input.failures, 0), 3),
    SAT_POLL_LIVE_CADENCE_MS,
  );
  // Full jitter: half fixed, half random across the window. Retry-After is a
  // lower bound from the server, capped by the policy's 60-second ceiling.
  const jitteredMs = backoffMs / 2 + input.random * (backoffMs / 2);
  const retryAfterMs = Number.isFinite(input.retryAfterMs)
    ? Math.max(0, Math.min(input.retryAfterMs ?? 0, SAT_POLL_LIVE_CADENCE_MS))
    : 0;
  return Math.max(jitteredMs, retryAfterMs);
}
