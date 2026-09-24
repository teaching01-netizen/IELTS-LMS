import { useCallback, useEffect, useRef, useState } from "react";
import {
  canAttemptEntry,
  SAT_ENTRY_RETRY_WINDOW_MS,
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
 * failure or an inert response stays retryable after one scheduled wakeup.
 */
export function useSatModuleEntry({
  identity,
  enabled,
  entryKey,
  startModule,
}: UseSatModuleEntryOptions): SatModuleEntrySurface {
  const attemptRef = useRef<SatEntryAttempt | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const [recoverable, setRecoverable] = useState(false);
  const [retrySequence, setRetrySequence] = useState(0);

  // Identity rotation invalidates the whole attempt record: a new identity must
  // never inherit the previous one's retry or recovery state.
  useEffect(() => {
    generationRef.current += 1;
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    attemptRef.current = null;
    setRecoverable(false);
    return () => {
      generationRef.current += 1;
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    };
  }, [identity]);

  useEffect(() => {
    if (!enabled || entryKey === null) return;
    const requestedAt = Date.now();
    if (!canAttemptEntry(attemptRef.current, entryKey, requestedAt)) return;
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    // A different target re-arms recovery from scratch; a retry of the same
    // target keeps the button available while it is in flight.
    const sameTarget = attemptRef.current?.key === entryKey;
    attemptRef.current = {
      key: entryKey,
      inFlight: true,
      attemptedAt: requestedAt,
      succeededAt: null,
    };
    const generation = generationRef.current;
    if (!sameTarget) setRecoverable(false);
    void startModule().catch(() => "failed" as const).then((outcome) => {
      if (generationRef.current !== generation) return;
      const record = attemptRef.current;
      if (!record || record.key !== entryKey) return;
      attemptRef.current = settleEntry(record, outcome, Date.now());
      setRecoverable(outcome !== "opened");
      // The response may have selected a different pending module while this
      // entry was in flight. Recheck that target after the record settles.
      setRetrySequence((sequence) => sequence + 1);
      if (outcome !== "opened") {
        const delay = Math.max(0, record.attemptedAt + SAT_ENTRY_RETRY_WINDOW_MS - Date.now());
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          setRetrySequence((sequence) => sequence + 1);
        }, delay);
      }
    });
  }, [enabled, entryKey, retrySequence, startModule]);

  const retry = useCallback(() => {
    if (attemptRef.current?.inFlight) return;
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    attemptRef.current = null;
    setRecoverable(false);
    setRetrySequence((sequence) => sequence + 1);
  }, []);

  return { recoverable, retry };
}
