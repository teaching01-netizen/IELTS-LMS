import { useCallback, useEffect, useState } from "react";
import {
  createSatReadingPreferences,
  normalizeSatReadingPreferences,
  type SatReadingPreferences,
} from "../domain/satReadingPreferences";
import {
  loadSatReadingPreferences,
  saveSatReadingPreferences,
} from "../infrastructure/satReadingPreferencesStore";

type ReadingPreferenceUpdater =
  SatReadingPreferences | ((current: SatReadingPreferences) => SatReadingPreferences);

export function useSatReadingPreferences(scheduleId: string, attemptId: string) {
  const [preferences, setPreferencesState] = useState<SatReadingPreferences>(() =>
    loadSatReadingPreferences(scheduleId, attemptId)
  );

  useEffect(() => {
    setPreferencesState(loadSatReadingPreferences(scheduleId, attemptId));
  }, [attemptId, scheduleId]);

  const setPreferences = useCallback(
    (updater: ReadingPreferenceUpdater) => {
      setPreferencesState((current) => {
        const candidate = typeof updater === "function" ? updater(current) : updater;
        const next = normalizeSatReadingPreferences(candidate);
        saveSatReadingPreferences(scheduleId, attemptId, next);
        return next;
      });
    },
    [attemptId, scheduleId]
  );

  const reset = useCallback(() => {
    const next = createSatReadingPreferences();
    saveSatReadingPreferences(scheduleId, attemptId, next);
    setPreferencesState(next);
  }, [attemptId, scheduleId]);

  return { preferences, setPreferences, reset };
}
