import { useCallback, useRef, useState } from 'react';

/**
 * A fetch callback that applies its own panel state. It receives:
 * - `isStale()` — returns true when a newer reload has superseded this one, in
 *   which case the callback must not apply its results.
 * - `background` — true when the reload is a silent refresh (no loading state).
 *
 * The callback is responsible for reporting its own errors (e.g. setting an
 * error banner); errors propagate to the returned promise otherwise.
 */
export type CoalescedReloadFetch = (
  isStale: () => boolean,
  background: boolean,
) => Promise<void>;

export interface CoalescedReloadOptions {
  /**
   * A background reload never shows the loading state. Background refreshes
   * also share an already in-flight reload instead of starting a new fetch,
   * so a burst of update notifications collapses into one request.
   */
  background?: boolean;
  /**
   * Bypasses the share so the reload always starts a fresh fetch, even when
   * another reload is in flight. Use it after a mutation to guarantee the
   * reload reflects the new server state.
   */
  force?: boolean;
}

/**
 * Manages a load/reload cycle with three properties:
 *
 * - Staleness: only the most recently started reload may apply its results
 *   (the `isStale` guard) or settle the loading state; superseded reloads
 *   silently discard.
 * - Coalescing: a background reload shares an already in-flight one, so a
 *   burst of update notifications performs a single fetch.
 * - Loading: full reloads show the loading state, which settles when the
 *   reload that started it finishes.
 *
 * `inFlight` exposes the in-flight reload promise so callers can detect when
 * they are sharing a reload that began before their own data changed.
 */
export function useCoalescedReload(initialLoading = false) {
  const [loading, setLoading] = useState(initialLoading);
  const requestId = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const reload = useCallback(
    (fetch: CoalescedReloadFetch, options: CoalescedReloadOptions = {}): Promise<void> => {
      const { background = false, force = false } = options;
      if (background && !force && inFlight.current) {
        return inFlight.current;
      }
      const id = requestId.current + 1;
      requestId.current = id;
      if (!background) {
        setLoading(true);
      }
      const run = (async () => {
        try {
          await fetch(() => requestId.current !== id, background);
        } finally {
          // Only the latest reload may clear the in-flight marker or the
          // loading state; a superseded reload leaves both alone.
          if (requestId.current === id) {
            inFlight.current = null;
            setLoading(false);
          }
        }
      })();
      inFlight.current = run;
      return run;
    },
    [],
  );

  return { loading, inFlight, reload };
}
