export interface LatestOnlyAsyncRunner<T> {
  enqueue: (value: T) => void;
  idle: () => Promise<void>;
  /**
   * Monotonic count of completed `run` invocations. Lets callers distinguish
   * "idle because our value ran" from "idle because a concurrent enqueue
   * superseded us" without racing on `lastError` resets.
   */
  generation: number;
  lastError: Error | null;
}

export function createLatestOnlyAsyncRunner<T>(
  run: (value: T) => Promise<void>,
): LatestOnlyAsyncRunner<T> {
  let running = false;
  let queued: { value: T; hasValue: boolean } = { value: undefined as T, hasValue: false };
  let idlePromise: Promise<void> | null = null;
  let resolveIdle: (() => void) | null = null;
  // Waiters attached via idle() BEFORE the current burst started must not
  // resolve early when an intermediate drain finds no queued value while a
  // concurrent enqueue lands between the check and the settle. The loop below
  // re-checks the queue after yielding a microtask before settling.
  let generation = 0;

  const runner: LatestOnlyAsyncRunner<T> = {
    lastError: null,
    get generation() {
      return generation;
    },
    enqueue(value) {
      if (!running) {
        running = true;
        idlePromise =
          idlePromise ??
          new Promise<void>((resolve) => {
            resolveIdle = resolve;
          });

        void (async () => {
          let current: T = value;
          try {
            while (true) {
              try {
                await run(current);
                runner.lastError = null;
              } catch (error) {
                runner.lastError = error instanceof Error ? error : new Error('Unknown error');
              } finally {
                generation += 1;
              }

              if (!queued.hasValue) {
                // Yield before settling: an enqueue landing in this window is
                // picked up instead of stranding the value until the next
                // burst (which would leave idle() resolved too early).
                await Promise.resolve();
                if (!queued.hasValue) {
                  return;
                }
              }

              current = queued.value;
              queued = { value: undefined as T, hasValue: false };
            }
          } finally {
            running = false;
            resolveIdle?.();
            resolveIdle = null;
            idlePromise = null;
          }
        })();

        return;
      }

      queued = { value, hasValue: true };
    },
    idle() {
      return idlePromise ?? Promise.resolve();
    },
  };

  return runner;
}
