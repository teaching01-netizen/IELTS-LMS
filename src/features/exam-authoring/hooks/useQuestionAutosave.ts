import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLatestOnlyAsyncRunner,
  type LatestOnlyAsyncRunner,
} from "../../../utils/latestOnlyAsync";
import type { QuestionRevision } from "../contracts/assessment";

export type QuestionSaveStatus = "saved" | "unsaved" | "saving" | "error";

export interface UseQuestionAutosaveOptions {
  save: (revision: QuestionRevision) => Promise<QuestionRevision | void>;
  debounceMs?: number;
  onError?: (error: Error) => void;
}

export interface QuestionFlushResult {
  ok: boolean;
  isLatest: boolean;
}

export interface UseQuestionAutosaveResult {
  status: QuestionSaveStatus;
  lastSavedAt: Date | null;
  scheduleAutosave: (revision: QuestionRevision) => void;
  flushNow: (revision: QuestionRevision) => Promise<QuestionFlushResult>;
  retry: (revision: QuestionRevision) => void;
}

export function useQuestionAutosave(
  options: UseQuestionAutosaveOptions
): UseQuestionAutosaveResult {
  const { save, debounceMs = 800, onError } = options;
  const [status, setStatus] = useState<QuestionSaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveRef = useRef(save);
  const onErrorRef = useRef(onError);
  const latestRequestIdRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  const pendingRevisionRef = useRef<QuestionRevision | null>(null);
  const pendingRequestIdRef = useRef<number | null>(null);
  const runnerRef = useRef<LatestOnlyAsyncRunner<{
    revision: QuestionRevision;
    requestId: number;
  }> | null>(null);

  useEffect(() => {
    saveRef.current = save;
    onErrorRef.current = onError;
  }, [onError, save]);

  if (!runnerRef.current) {
    runnerRef.current = createLatestOnlyAsyncRunner(async ({ revision, requestId }) => {
      setStatus("saving");
      try {
        await saveRef.current(revision);
        if (requestId === latestRequestIdRef.current) {
          setStatus("saved");
          setLastSavedAt(new Date());
        }
      } catch (error) {
        if (requestId === latestRequestIdRef.current) {
          setStatus("error");
          onErrorRef.current?.(error instanceof Error ? error : new Error("Question save failed"));
        }
        throw error;
      }
    });
  }

  const enqueuePending = useCallback(() => {
    const revision = pendingRevisionRef.current;
    const requestId = pendingRequestIdRef.current;
    if (!revision || requestId === null) {
      return;
    }

    runnerRef.current?.enqueue({ revision, requestId });
    pendingRevisionRef.current = null;
    pendingRequestIdRef.current = null;
    debounceRef.current = null;
  }, []);

  const scheduleAutosave = useCallback(
    (revision: QuestionRevision) => {
      const requestId = ++latestRequestIdRef.current;
      pendingRevisionRef.current = revision;
      pendingRequestIdRef.current = requestId;
      setStatus("unsaved");

      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(enqueuePending, debounceMs);
    },
    [debounceMs, enqueuePending]
  );

  const flushNow = useCallback(async (revision: QuestionRevision): Promise<QuestionFlushResult> => {
    const requestId = ++latestRequestIdRef.current;
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    pendingRevisionRef.current = null;
    pendingRequestIdRef.current = null;
    runnerRef.current?.enqueue({ revision, requestId });
    await runnerRef.current?.idle();
    return {
      ok: !runnerRef.current?.lastError,
      isLatest: requestId === latestRequestIdRef.current,
    };
  }, []);

  const retry = useCallback((revision: QuestionRevision) => {
    const requestId = ++latestRequestIdRef.current;
    runnerRef.current?.enqueue({ revision, requestId });
  }, []);

  return { status, lastSavedAt, scheduleAutosave, flushNow, retry };
}
