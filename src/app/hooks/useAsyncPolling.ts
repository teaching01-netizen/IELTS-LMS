import { useEffect, useEffectEvent, useRef } from 'react';

interface UseAsyncPollingOptions {
  enabled?: boolean;
  intervalMs?: number;
  maxIntervalMs?: number;
  runImmediately?: boolean;
  jitterMs?: number;
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
    jitterMs = 0,
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
    const effectiveJitterMs = Math.max(0, jitterMs);

    const scheduleNext = (delay: number) => {
      const jitter = effectiveJitterMs > 0 ? Math.floor(Math.random() * effectiveJitterMs) : 0;
      timeoutId = window.setTimeout(() => {
        void poll();
      }, delay + jitter);
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
