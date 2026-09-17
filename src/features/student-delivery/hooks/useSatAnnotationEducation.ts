import { useCallback, useMemo, useState } from 'react';
import {
  createDefaultSatAnnotationEducationState,
  type SatAnnotationEducationState,
} from '../domain/satAnnotationEducation';
import { loadSatAnnotationEducation, saveSatAnnotationEducation } from '../infrastructure/satAnnotationEducationStore';
import type { SatHighlightColor } from '../domain/satResponses';

export interface SatAnnotationEducation {
  state: SatAnnotationEducationState;
  /**
   * The passive hint is spent for this attempt.
   *
   * Written when the student demonstrates the gesture (or annotates anything),
   * never when a timer elapses — see `shouldShowSatAnnotationHint`.
   */
  markHintSeen: () => void;
  /** A highlight landed: remember the ink and retire the confirmation. */
  markFirstHighlight: (color: SatHighlightColor) => void;
  /** Remember the ink without teaching anything (recolor / later highlights). */
  rememberColor: (color: SatHighlightColor) => void;
  markFirstNote: () => void;
}

/**
 * Loads the education state for one attempt scope.
 *
 * `scopeKey` is optional: preview and harness mounts pass a preview key, real
 * attempts pass the attempt key, and a missing key degrades to in-memory state
 * (teaching still works, it just is not remembered across reloads).
 *
 * The hook owns nothing else — no annotation data, no visibility decisions.
 * `shouldShowSatAnnotationHint` in the domain decides what to show from this
 * state, which keeps the teaching policy testable on its own.
 */
export function useSatAnnotationEducation(scopeKey: string | null): SatAnnotationEducation {
  const [state, setState] = useState<SatAnnotationEducationState>(() =>
    scopeKey ? loadSatAnnotationEducation(scopeKey) : createDefaultSatAnnotationEducationState(),
  );

  const update = useCallback(
    (next: (current: SatAnnotationEducationState) => SatAnnotationEducationState) => {
      setState((current) => {
        const value = next(current);
        if (scopeKey) saveSatAnnotationEducation(scopeKey, value);
        return value;
      });
    },
    [scopeKey],
  );

  const markHintSeen = useCallback(() => {
    update((current) => (current.sawHighlightHint ? current : { ...current, sawHighlightHint: true }));
  }, [update]);

  const rememberColor = useCallback(
    (color: SatHighlightColor) => {
      update((current) => (current.lastHighlightColor === color ? current : { ...current, lastHighlightColor: color }));
    },
    [update],
  );

  const markFirstHighlight = useCallback(
    (color: SatHighlightColor) => {
      update((current) =>
        current.createdFirstHighlight && current.lastHighlightColor === color
          ? current
          : { ...current, createdFirstHighlight: true, lastHighlightColor: color },
      );
    },
    [update],
  );

  const markFirstNote = useCallback(() => {
    update((current) => (current.createdFirstNote ? current : { ...current, createdFirstNote: true }));
  }, [update]);

  return useMemo(
    () => ({ state, markHintSeen, rememberColor, markFirstHighlight, markFirstNote }),
    [state, markHintSeen, rememberColor, markFirstHighlight, markFirstNote],
  );
}
