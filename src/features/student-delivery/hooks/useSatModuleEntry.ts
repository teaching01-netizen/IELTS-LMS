import { useEffect, useRef } from "react";
import type { SatEntryOutcome } from "../application/satEntry";

export interface SatModuleEntrySurface {
  /** Kept for backward-compatible callers; the waiting room owns retries. */
  recoverable: boolean;
  retry: () => void;
}

export interface UseSatModuleEntryOptions {
  /** Changes on schedule/attempt/candidate rotation; resets the attempt record. */
  identity: string;
  /** The pure decision from deriveSatEntryDecision. */
  enabled: boolean;
  /** Dedupe key for this entry (attempt + module), or null when there is none. */
  entryKey: string | null;
  /**
   * Starts the pending module (the controller's startPendingModule).
   * Single-operation and idempotent: not_started→activate, active→resume.
   * Transient failures keep the waiting room mounted and retry automatically
   * with jitter behind it — never a separate recovery screen.
   */
  startModule: (options?: { recover?: boolean }) => Promise<SatEntryOutcome>;
}

/**
 * One owner for initial Module 1 entry (the proctor's Start).
 *
 * Later progression (M1→M2, break→next-M1) is server-driven: the server
 * activates the next module atomically and the client renders authoritative
 * state, so this hook never runs for those. A lost StartModule response is
 * safe to retry because StartModule itself is idempotent (already-active
 * returns the authoritative state).
 */
export function useSatModuleEntry({
  identity,
  enabled,
  entryKey,
  startModule,
}: UseSatModuleEntryOptions): SatModuleEntrySurface {
  const generationRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  const prevIdentityRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevIdentityRef.current === identity) return;
    prevIdentityRef.current = identity;
    generationRef.current += 1;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    inFlightRef.current = false;
    return () => {
      // Identity cleanup only: entry-effect StrictMode remounts must not bump
      // the generation or clear the in-flight guard (single-flight).
    };
  }, [identity]);

  const prevKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || entryKey === null) return;
    if (entryKey !== prevKeyRef.current) {
      prevKeyRef.current = entryKey;
      inFlightRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (inFlightRef.current) return;
    const generation = generationRef.current;
    inFlightRef.current = true;
    let cancelled = false;
    let attempts = 0;

    const attempt = () => {
      if (cancelled || generationRef.current !== generation) return;
      void startModule()
        .catch(() => "failed" as const)
        .then((outcome) => {
          if (cancelled || generationRef.current !== generation) return;
          if (outcome === "opened") {
            inFlightRef.current = false;
            return;
          }
          // Transient failure: keep the waiting room mounted, retry with
          // jitter behind it. No recovery screen, no manual button.
          attempts += 1;
          const delay = Math.min(8000, 400 * 2 ** Math.min(attempts, 4)) + Math.floor(Math.random() * 400);
          timerRef.current = window.setTimeout(attempt, delay);
        });
    };
    attempt();
    return () => {
      // StrictMode double-invoke re-runs this effect with the same refs: keep
      // inFlight true so the second run does not fire a duplicate StartModule.
      // Identity rotation (above) is what resets it for a new target.
      cancelled = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, entryKey, startModule]);

  return { recoverable: false, retry: () => undefined };
}
