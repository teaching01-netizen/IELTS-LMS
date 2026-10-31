/**
 * The unsynced-warning decision, kept pure so the escalation and dismissal
 * contract is testable without mounting the exam route.
 *
 * The key includes the window start AND the severity: dismissing "still
 * saving" must not hide the later "only on this device" escalation, and a new
 * unsynced window must reopen the banner after the previous one synced.
 */
export type SatUnsyncedSeverity = "slow" | "offline";

export function satUnsyncedSeverity(
  ageMs: number,
  slowAfterMs: number,
  offlineAfterMs: number,
): SatUnsyncedSeverity | null {
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  if (ageMs >= offlineAfterMs) return "offline";
  if (ageMs >= slowAfterMs) return "slow";
  return null;
}

export function satUnsyncedDismissKey(
  unsyncedSince: number | null,
  severity: SatUnsyncedSeverity | null,
): string | null {
  return unsyncedSince !== null && severity !== null ? `${unsyncedSince}:${severity}` : null;
}
