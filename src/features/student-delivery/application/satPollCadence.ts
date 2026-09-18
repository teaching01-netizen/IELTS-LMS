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

/** Steady cadence while the live socket is connected. */
export const SAT_POLL_LIVE_CADENCE_MS = 20_000;
/** Faster cadence without the live socket — the poll is the only signal. */
export const SAT_POLL_OFFLINE_CADENCE_MS = 2_000;

export function satPollDelayMs(input: {
  liveSocketConnected: boolean;
  failures: number;
  random: number;
}): number {
  const baseMs = input.liveSocketConnected
    ? SAT_POLL_LIVE_CADENCE_MS
    : SAT_POLL_OFFLINE_CADENCE_MS;
  const backoffMs = Math.min(
    baseMs * 2 ** Math.min(Math.max(input.failures, 0), 3),
    SAT_POLL_LIVE_CADENCE_MS,
  );
  // Full jitter: half fixed, half random across the window.
  return backoffMs / 2 + input.random * (backoffMs / 2);
}
