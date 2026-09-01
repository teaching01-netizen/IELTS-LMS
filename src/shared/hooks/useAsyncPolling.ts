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
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    let nextDelay = intervalMs;
    let waitingForInFlight = false;

    const scheduleNext = (delay: number) => {
      if (cancelled || timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void poll();
      }, delay);
    };

    const waitForInFlight = () => {
      const inFlight = inFlightRef.current;
      if (!inFlight || waitingForInFlight) return;
      waitingForInFlight = true;
      const resume = () => {
        waitingForInFlight = false;
        if (!cancelled) scheduleNext(nextDelay);
      };
      void inFlight.then(resume, resume);
    };

    const poll = async () => {
      if (cancelled) return;
      if (inFlightRef.current) {
        waitForInFlight();
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
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, intervalMs, maxIntervalMs, runImmediately]);
}
