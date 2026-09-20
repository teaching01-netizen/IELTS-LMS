import { useEffect, useEffectEvent, useRef } from 'react';

interface UseAsyncPollingOptions {
  enabled?: boolean;
  intervalMs?: number;
  maxIntervalMs?: number;
  runImmediately?: boolean;
  /**
   * Per-run delay resolver: when provided, the task's own owner decides the
   * next wait (it is consulted after every run, success or failure) and the
   * intervalMs / maxIntervalMs backoff above is not used. This hook stays the
   * single timer, the caller stays the single timing policy — the split that
   * matters when a server hands back an adaptive cadence.
   */
  resolveIntervalMs?: () => number;
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
    resolveIntervalMs,
  }: UseAsyncPollingOptions = {},
) {
  const runTask = useEffectEvent(task);
  const resolveIntervalMsEvent = useEffectEvent(() => resolveIntervalMs?.());
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
      let failed = false;
      try {
        promise = Promise.resolve().then(() => runTask());
        inFlightRef.current = promise;
        await promise;
        nextDelay = intervalMs;
      } catch {
        failed = true;
        nextDelay = Math.min(nextDelay * 2, maxIntervalMs);
      } finally {
        if (promise && inFlightRef.current === promise) {
          inFlightRef.current = null;
        }
      }

      // The task's owner (the runtime poll loop) owns timing when it says so:
      // its delay already accounts for the server cadence, the transport
      // bounds, and its own backoff, so applying it verbatim keeps exactly one
      // owner instead of averaging two approximations.
      const resolved = resolveIntervalMsEvent();
      if (typeof resolved === 'number' && Number.isFinite(resolved) && resolved > 0) {
        nextDelay = resolved;
      } else if (failed && resolveIntervalMs) {
        // Resolver present but unusable: keep the generic backoff result.
        nextDelay = Math.min(Math.max(nextDelay, 1_000), Math.max(maxIntervalMs, 1_000));
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
