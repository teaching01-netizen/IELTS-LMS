import React, { useEffect, useRef } from 'react';
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

export function PreCheck({
  config,
  examTitle = 'Exam',
  candidateName,
  candidateId,
  onComplete,
}: PreCheckProps) {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    const result = runPreCheckChecks(config);

    const persist = async () => {
      try {
        await onCompleteRef.current(result);
      } catch {
        if (cancelled) {
          return;
        }
        retryTimer = window.setTimeout(() => {
          void persist();
        }, RETRY_DELAY_MS);
      }
    };

    void persist();

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
    />
  );
}
