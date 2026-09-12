import {
  STUDENT_MIN_ANSWER_PANE_WIDTH_PX,
  STUDENT_MIN_MATERIAL_PANE_WIDTH_PX,
  STUDENT_SPLIT_RAIL_WIDTH_PX,
  getStudentLayoutMode,
  resolveStudentLayoutMode,
  type StudentLayoutMode,
} from './studentLayoutMode';

export interface StudentCapabilitySnapshot {
  readonly width: number;
  readonly height: number;
  readonly hasCoarsePointer: boolean;
  readonly hasTouchSupport: boolean;
  readonly hasHover: boolean;
}

export interface StudentInteractionCapabilities {
  readonly layoutMode: StudentLayoutMode;
  readonly primaryPointer: 'coarse' | 'fine';
  readonly hasTouch: boolean;
  readonly hasHover: boolean;
  readonly orientation: 'portrait' | 'landscape';
}

export function getStudentInteractionCapabilities(
  snapshot: StudentCapabilitySnapshot,
): StudentInteractionCapabilities {
  return {
    // P2.1: mode is a policy over shell geometry, not width alone. The
    // window's inner height IS the outer stable shell in the browser (safe
    // areas are subtracted by the exam height policy), so it feeds the
    // height gate directly. Invalid/unmeasured geometry still resolves
    // through the same policy's safe fallbacks.
    layoutMode: resolveStudentLayoutMode({
      containerWidth: snapshot.width,
      stableShellHeight: Number.isFinite(snapshot.height) && snapshot.height > 0 ? snapshot.height : null,
      workspaceHeight: null,
      minMaterialWidth: STUDENT_MIN_MATERIAL_PANE_WIDTH_PX,
      minAnswerWidth: STUDENT_MIN_ANSWER_PANE_WIDTH_PX,
      railWidth: STUDENT_SPLIT_RAIL_WIDTH_PX,
    }).layoutMode,
    primaryPointer: snapshot.hasCoarsePointer ? 'coarse' : 'fine',
    hasTouch: snapshot.hasTouchSupport,
    hasHover: snapshot.hasHover,
    orientation: snapshot.width >= snapshot.height ? 'landscape' : 'portrait',
  };
}

export function getStudentCapabilitySnapshot(targetWindow: Window): StudentCapabilitySnapshot {
  const navigatorWithTouch = targetWindow.navigator as Navigator & { maxTouchPoints?: number };
  const hasCoarsePointer = Boolean(
    targetWindow.matchMedia?.('(pointer: coarse)')?.matches ||
      targetWindow.matchMedia?.('(any-pointer: coarse)')?.matches,
  );

  return {
    width: targetWindow.innerWidth,
    height: targetWindow.innerHeight,
    hasCoarsePointer,
    hasTouchSupport: (navigatorWithTouch.maxTouchPoints ?? 0) > 0,
    hasHover: targetWindow.matchMedia?.('(hover: hover)')?.matches ?? false,
  };
}
