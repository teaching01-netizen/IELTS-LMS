import React, { useEffect, useRef, useState } from 'react';
import type { ExamConfig } from '../../types';
import type { StudentPreCheckResult } from '../../types/studentAttempt';
import { ExamEntryCard } from './ExamEntryCard';
import { runPreCheckChecks } from './preCheckChecks';

interface PreCheckProps {
  config?: ExamConfig | undefined;
  examTitle?: string | undefined;
  candidateName?: string | null | undefined;
  candidateId?: string | null | undefined;
  onComplete: (result: StudentPreCheckResult) => Promise<void> | void;
}

const RETRY_DELAY_MS = 2_000;

interface PreCheckPersistState {
  config: ExamConfig | undefined;
  result: StudentPreCheckResult;
  inFlight: boolean;
  succeeded: boolean;
}

export function PreCheck({
  config,
  examTitle = 'Exam',
  candidateName,
  candidateId,
  onComplete,
}: PreCheckProps) {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const [hadTrouble, setHadTrouble] = useState(false);
  // Single-flight guard for the SILENT persist (FEX-002): the device-check
  // result and its persistence state live in a ref that survives StrictMode's
  // dev double-mount (mount -> cleanup -> mount), so a duplicate effect run
  // never starts a second persist with a second result. Retries keep reusing
  // the SAME result (same completedAt), which keeps the backend idempotency
  // identity stable. The ref is keyed by config so a genuinely new config
  // still starts a fresh check.
  const persistStateRef = useRef<PreCheckPersistState | null>(null);
  // Effect-run generation: lets a superseded effect run (StrictMode's
  // simulated cleanup) hand retry responsibility to the live run instead of
  // swallowing a rejection, while a REAL unmount (no newer run) still bails.
  const effectGenerationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const effectGeneration = ++effectGenerationRef.current;

    const previous = persistStateRef.current;
    const result =
      previous && previous.config === config
        ? previous.result
        : runPreCheckChecks(config);
    if (!previous || previous.config !== config) {
      persistStateRef.current = { config, result, inFlight: false, succeeded: false };
    }
    const persistState = persistStateRef.current;

    const persist = async () => {
      try {
        await onCompleteRef.current(result);
        persistState.succeeded = true;
        persistState.inFlight = false;
      } catch {
        persistState.inFlight = false;
        // Bail only on a REAL unmount. Under StrictMode's dev double-mount the
        // cleanup from the simulated unmount runs before the rejection lands,
        // but a newer effect run is alive and must own the retry (otherwise
        // the student is stuck on "Preparing your connection…" with no retry).
        if (cancelled && effectGeneration === effectGenerationRef.current) {
          return;
        }
        setHadTrouble(true);
        retryTimer = window.setTimeout(() => {
          void persist();
        }, RETRY_DELAY_MS);
      }
    };

    if (!persistState.inFlight && !persistState.succeeded) {
      persistState.inFlight = true;
      void persist();
    }

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [config]);

  return (
    <ExamEntryCard
      config={config}
      examTitle={examTitle}
      candidateName={candidateName}
      candidateId={candidateId}
      status="connecting"
      statusDetail={
        hadTrouble
          ? "We're having trouble reaching the server. Stay on this page — your place is saved and we'll keep trying."
          : undefined
      }
    />
  );
}
