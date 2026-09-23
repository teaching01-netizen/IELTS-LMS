import { useEffect, useState } from "react";
import { SAT_ENTRY_RECOVERY_SURFACE_MS } from "../application/satStudentSurface";

/** Keep a prior exam frame visible for a bounded, keyed module handoff. */
export function useSatEntryTransitionHold(
  transitionKey: string | null,
  durationMs = SAT_ENTRY_RECOVERY_SURFACE_MS,
): boolean {
  const [expiredKey, setExpiredKey] = useState<string | null>(null);

  useEffect(() => {
    if (transitionKey === null) {
      if (expiredKey !== null) setExpiredKey(null);
      return;
    }
    if (expiredKey === transitionKey) return;

    const timeout = window.setTimeout(() => setExpiredKey(transitionKey), durationMs);
    return () => window.clearTimeout(timeout);
  }, [durationMs, expiredKey, transitionKey]);

  return transitionKey !== null && expiredKey === transitionKey;
}
