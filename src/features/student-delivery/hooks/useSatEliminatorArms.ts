import { useCallback, useEffect, useState } from "react";
import {
  loadSatEliminatorArms,
  saveSatEliminatorArms,
} from "../infrastructure/satEliminatorArmStore";

export interface SatEliminatorArmsController {
  /**
   * Question keys (`moduleAttemptId:examQuestionId`) whose eliminator is open —
   * the same keys the caller derives its display state from.
   */
  armedKeys: ReadonlySet<string>;
  /** Open a question's eliminator, or close it if it is already open. */
  toggle: (questionKey: string) => void;
}

/**
 * The eliminator's open/closed state, per attempt and per question, surviving a
 * reload.
 *
 * Same discipline as the reading-preference hook: load in a lazy initializer so
 * the first paint already knows, re-load when the attempt identity changes, and
 * write on the action rather than in an effect — one writer, no write on mount,
 * and no window in which a navigation could persist the previous attempt's arms
 * under the next attempt's key.
 *
 * Anything the store cannot read is forgotten, never repaired into a value: a
 * broken record costs the student the arms they left open, not their exam.
 */
export function useSatEliminatorArms(
  scheduleId: string,
  attemptId: string,
): SatEliminatorArmsController {
  const [armedKeys, setArmedKeys] = useState<ReadonlySet<string>>(() =>
    loadSatEliminatorArms(scheduleId, attemptId),
  );

  useEffect(() => {
    setArmedKeys(loadSatEliminatorArms(scheduleId, attemptId));
  }, [attemptId, scheduleId]);

  const toggle = useCallback(
    (questionKey: string) => {
      setArmedKeys((current) => {
        const next = new Set(current);
        if (next.has(questionKey)) next.delete(questionKey);
        else next.add(questionKey);
        saveSatEliminatorArms(scheduleId, attemptId, next);
        return next;
      });
    },
    [attemptId, scheduleId],
  );

  return { armedKeys, toggle };
}
