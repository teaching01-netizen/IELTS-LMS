import { useCallback, useEffect, useState } from "react";
import {
  loadSatEliminatorMode,
  saveSatEliminatorMode,
} from "../infrastructure/satEliminatorModeStore";

export interface SatEliminatorModeController {
  /** Whether the eliminator is on — one switch for every question of the attempt. */
  on: boolean;
  /** Turn the eliminator on, or off if it is already on. */
  toggle: () => void;
}

/**
 * The eliminator's on/off switch, per attempt, surviving navigation and reload.
 *
 * Same discipline as the reading-preference hook: load in a lazy initializer so
 * the first paint already knows, re-load when the attempt identity changes, and
 * write on the action rather than in an effect — one writer, no write on mount,
 * and no window in which a navigation could persist the previous attempt's
 * switch under the next attempt's key.
 */
export function useSatEliminatorMode(
  scheduleId: string,
  attemptId: string,
): SatEliminatorModeController {
  const [on, setOn] = useState(() => loadSatEliminatorMode(scheduleId, attemptId));

  useEffect(() => {
    setOn(loadSatEliminatorMode(scheduleId, attemptId));
  }, [attemptId, scheduleId]);

  const toggle = useCallback(() => {
    setOn((current) => {
      const next = !current;
      saveSatEliminatorMode(scheduleId, attemptId, next);
      return next;
    });
  }, [attemptId, scheduleId]);

  return { on, toggle };
}
