import { useEffect, useEffectEvent, useRef } from 'react';

interface UseAsyncPollingOptions {
  enabled?: boolean;
  intervalMs?: number;
  maxIntervalMs?: number;
  runImmediately?: boolean;
}

/**
 * Polls an async task with simple exponential backoff after failures.
 * This keeps polling logic in one place instead of scattering timers across routes.
 */
export function useAsyncPolling(
  task: () => Promise<void>,
  {
    enabled = true,
    intervalMs = 1_000,
    maxIntervalMs = intervalMs * 4,
    runImmediately = true,
  }: UseAsyncPollingOptions = {},
) {
  const runTask = useEffectEvent(task);
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;
    let nextDelay = intervalMs;

    const scheduleNext = (delay: number) => {
      timeoutId = window.setTimeout(() => {
        void poll();
      }, delay);
    };

    const poll = async () => {
      if (inFlightRef.current) {
        scheduleNext(intervalMs);
        return;
      }

      let promise: Promise<void> | null = null;
      try {
        promise = Promise.resolve().then(() => runTask());
        inFlightRef.current = promise;
        await promise;
        nextDelay = intervalMs;
      } catch {
        nextDelay = Math.min(nextDelay * 2, maxIntervalMs);
      } finally {
        if (promise && inFlightRef.current === promise) {
          inFlightRef.current = null;
        }
      }

      if (!cancelled) {
        scheduleNext(nextDelay);
      }
    };

    if (runImmediately) {
      void poll();
    } else {
      scheduleNext(intervalMs);
    }

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [enabled, intervalMs, maxIntervalMs, runImmediately]);
}
