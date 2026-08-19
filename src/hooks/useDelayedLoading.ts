import { useEffect, useState } from 'react';

/**
 * Returns `true` only after `delayMs` of continuous loading. Gates that resolve
 * quickly (e.g. from a warm cache) therefore never paint a skeleton, which
 * eliminates the flash of empty bones on every open. The value resets to
 * `false` whenever `isLoading` goes false, so a later slow reload still shows
 * the skeleton.
 */
export function useDelayedLoading(isLoading: boolean, delayMs = 150): boolean {
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowLoading(false);
      return undefined;
    }

    const timer = window.setTimeout(() => setShowLoading(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [isLoading, delayMs]);

  return isLoading && showLoading;
}
