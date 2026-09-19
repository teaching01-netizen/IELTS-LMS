import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One-shot acknowledgement state: holds `value` for `durationMs` after
 * `show(value)`, then clears it.
 *
 * Why a hook instead of a per-component `setTimeout`: acknowledgement timers
 * are the classic leak on this page — a stale "Copied" (or a pending label)
 * that outlives its control reads as a lie. This keeps one implementation so
 * that:
 *   - re-triggering restarts the window (last trigger wins),
 *   - unmounting clears the timer,
 *   - the neutral state is always `null`, never a stale string.
 *
 * Reduced motion never shortens or lengthens this window: the confirmation is
 * information, not decoration.
 */
export function useTransientValue<T>(durationMs = 1600) {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const show = useCallback(
    (next: T) => {
      clearTimer();
      setValue(next);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setValue(null);
      }, durationMs);
    },
    [clearTimer, durationMs],
  );

  const clear = useCallback(() => {
    clearTimer();
    setValue(null);
  }, [clearTimer]);

  return { value, show, clear };
}

/** Boolean form for a single control that confirms in place (share sheet copy). */
export function useTransientFlag(durationMs = 1600) {
  const { value, show, clear } = useTransientValue<true>(durationMs);
  const trigger = useCallback(() => show(true), [show]);
  return { active: value === true, trigger, clear };
}
