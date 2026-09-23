import { useCallback, useEffect, useRef, useState } from "react";
import {
  canAttemptEntry,
  settleEntry,
  type SatEntryAttempt,
  type SatEntryOutcome,
} from "../application/satEntry";

export interface SatModuleEntrySurface {
  /**
   * Auto-entry has tried for the current target and did not deliver the module
   * (a failure, or a response that did not open it). The manual start button is
   * recovery from this state — never the required path.
   */
  recoverable: boolean;
  /** Re-arm the current entry target immediately after the student retries. */
  retry: () => void;
}

export interface UseSatModuleEntryOptions {
  /** Changes on schedule/attempt/candidate rotation; resets the attempt record. */
  identity: string;
  /** The pure decision from deriveSatEntryDecision. */
  enabled: boolean;
  /** Dedupe key for this entry (attempt + module), or null when there is none. */
  entryKey: string | null;
  /** The runner's clock tick: drives the bounded retry without a payload change. */
  now: number;
  /** Starts the pending module (the controller's startPendingModule). */
  startModule: () => Promise<SatEntryOutcome>;
}

/**
 * One owner for module entry (Phase 2).
 *
 * Both the first module (the proctor's Start) and every later section (the end
 * of the authoritative break) run through this one path, so the retry and
 * dedupe rules cannot drift between them again. The attempt record is only
 * settled terminal when startModule reports the module actually opened; a
 * failure or an inert response stays retryable on the SAT_ENTRY_RETRY_WINDOW_MS
 * window that the `now` tick re-drives.
 */
export function useSatModuleEntry({
  identity,
  enabled,
  entryKey,
  now,
  startModule,
}: UseSatModuleEntryOptions): SatModuleEntrySurface {
  const attemptRef = useRef<SatEntryAttempt | null>(null);
  const [recoverable, setRecoverable] = useState(false);
  const [retrySequence, setRetrySequence] = useState(0);

  // Identity rotation invalidates the whole attempt record: a new identity must
  // never inherit the previous one's retry or recovery state.
  useEffect(() => {
    attemptRef.current = null;
    setRecoverable(false);
  }, [identity]);

  useEffect(() => {
    if (!enabled || entryKey === null) return;
    const requestedAt = now;
    if (!canAttemptEntry(attemptRef.current, entryKey, requestedAt)) return;
    // A different target re-arms recovery from scratch; a retry of the same
    // target keeps the button available while it is in flight.
    const sameTarget = attemptRef.current?.key === entryKey;
    attemptRef.current = {
      key: entryKey,
      inFlight: true,
      attemptedAt: requestedAt,
      succeededAt: null,
    };
    if (!sameTarget) setRecoverable(false);
    void startModule().then((outcome) => {
      const record = attemptRef.current;
      if (!record || record.key !== entryKey) return;
      attemptRef.current = settleEntry(record, outcome, Date.now());
      setRecoverable(outcome !== "opened");
    });
  }, [enabled, entryKey, now, retrySequence, startModule]);

  const retry = useCallback(() => {
    if (attemptRef.current?.inFlight) return;
    attemptRef.current = null;
    setRecoverable(false);
    setRetrySequence((sequence) => sequence + 1);
  }, []);

  return { recoverable, retry };
}
