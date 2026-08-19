import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExamState } from '../../../types';
import {
  createLatestOnlyAsyncRunner,
  type LatestOnlyAsyncRunner,
} from '../../../utils/latestOnlyAsync';

export type BuilderSaveStatus = 'unsaved' | 'saving' | 'saved' | 'error';

export interface UseBuilderAutosaveOptions {
  /** Persists a full exam state snapshot. Serialized by a latest-wins runner. */
  save: (state: ExamState) => Promise<void>;
  /** Debounce window for scheduleAutosave (default 350ms). */
  debounceMs?: number;
  /**
   * Invoked only when the failing save is the latest scheduled request.
   * Superseded failures are intentionally silent.
   */
  onError?: (error: Error) => void;
}

export interface FlushResult {
  /** Whether the persisted save completed without error. */
  ok: boolean;
  /**
   * Whether the flushed request is still the newest one. Pages use this to
   * suppress success feedback when a newer autosave superseded the flush.
   */
  isLatest: boolean;
}

export interface UseBuilderAutosaveResult {
  status: BuilderSaveStatus;
  scheduleAutosave: (nextState: ExamState) => void;
  flushNow: (state: ExamState) => Promise<FlushResult>;
  /** Re-enqueues a state under a fresh request id (used by error retry actions). */
  retry: (state: ExamState) => void;
}

/**
 * Debounced, latest-wins draft autosave with flush-before-navigation semantics.
 *
 * Contract:
 * - `scheduleAutosave` marks the state unsaved and debounces persistence.
 * - Rapid schedules coalesce into one save carrying the newest state.
 * - A save failure only surfaces (status 'error' + onError) when the failing
 *   request is the newest one at the time it fails; superseded failures are
 *   suppressed so a newer successful save keeps the UI "saved".
 * - `flushNow` persists immediately and resolves when the queue drains, so
 *   navigation can be gated on `ok`.
 */
export function useBuilderAutosave(options: UseBuilderAutosaveOptions): UseBuilderAutosaveResult {
  const { save, debounceMs = 350, onError } = options;

  const [status, setStatus] = useState<BuilderSaveStatus>('saved');

  const saveRef = useRef(save);
  const onErrorRef = useRef(onError);
  const latestRequestIdRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  const pendingStateRef = useRef<ExamState | null>(null);
  const pendingRequestIdRef = useRef<number | null>(null);
  const runnerRef = useRef<LatestOnlyAsyncRunner<{ state: ExamState; requestId: number }> | null>(
    null,
  );

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  if (!runnerRef.current) {
    runnerRef.current = createLatestOnlyAsyncRunner(async ({ state: nextState, requestId }) => {
      setStatus('saving');
      try {
        await saveRef.current(nextState);
        if (requestId === latestRequestIdRef.current) {
          setStatus('saved');
        }
      } catch (error) {
        if (requestId === latestRequestIdRef.current) {
          setStatus('error');
          onErrorRef.current?.(
            error instanceof Error ? error : new Error('Unknown save error'),
          );
        }
        throw error;
      }
    });
  }

  const scheduleAutosave = useCallback(
    (nextState: ExamState) => {
      const requestId = ++latestRequestIdRef.current;
      pendingStateRef.current = nextState;
      pendingRequestIdRef.current = requestId;
      setStatus('unsaved');

      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }

      debounceRef.current = window.setTimeout(() => {
        const pending = pendingStateRef.current;
        const pendingRequestId = pendingRequestIdRef.current;
        if (!pending || pendingRequestId === null) {
          return;
        }

        runnerRef.current?.enqueue({ state: pending, requestId: pendingRequestId });
        pendingStateRef.current = null;
        pendingRequestIdRef.current = null;
        debounceRef.current = null;
      }, debounceMs);
    },
    [debounceMs],
  );

  const flushNow = useCallback(async (state: ExamState): Promise<FlushResult> => {
    const requestId = ++latestRequestIdRef.current;

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    pendingStateRef.current = null;
    pendingRequestIdRef.current = null;

    runnerRef.current?.enqueue({ state, requestId });
    await runnerRef.current?.idle();

    return { ok: !runnerRef.current?.lastError, isLatest: requestId === latestRequestIdRef.current };
  }, []);

  const retry = useCallback((state: ExamState) => {
    const requestId = ++latestRequestIdRef.current;
    runnerRef.current?.enqueue({ state, requestId });
  }, []);

  return {
    status,
    scheduleAutosave,
    flushNow,
    retry,
  };
}
