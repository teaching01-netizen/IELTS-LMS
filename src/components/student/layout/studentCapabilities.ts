import {
  STUDENT_MIN_ANSWER_PANE_WIDTH_PX,
  STUDENT_MIN_MATERIAL_PANE_WIDTH_PX,
  STUDENT_SPLIT_RAIL_WIDTH_PX,
  getStudentLayoutMode,
  resolveStudentLayoutMode,
  scalePaneMinimumsForFontScale,
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

/**
 * What the exam renders at: the shell's CSS `zoom` and the combined text
 * scale (text-size preference × system Text Size).
 */
export interface StudentContentScale {
  readonly zoom: number;
  readonly textScale: number;
}

const UNSCALED: StudentContentScale = { zoom: 1, textScale: 1 };

function positiveOr1(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function getStudentInteractionCapabilities(
  snapshot: StudentCapabilitySnapshot,
  contentScale: StudentContentScale = UNSCALED,
): StudentInteractionCapabilities {
  // Zoom shrinks the CSS width the shell lays out in (1180px at 150% is
  // ~787px of content), and larger text needs wider readable panes, so both
  // feed the policy. Enlarged text therefore collapses a cramped split into
  // one full-width pane instead of squeezing two.
  const zoom = positiveOr1(contentScale.zoom);
  const textScale = positiveOr1(contentScale.textScale);
  return {
    // P2.1: mode is a policy over shell geometry, not width alone. The
    // window's inner height IS the outer stable shell in the browser (safe
    // areas are subtracted by the exam height policy), so it feeds the
    // height gate directly. Invalid/unmeasured geometry still resolves
    // through the same policy's safe fallbacks.
    layoutMode: resolveStudentLayoutMode({
      containerWidth: snapshot.width / zoom,
      stableShellHeight:
        Number.isFinite(snapshot.height) && snapshot.height > 0 ? snapshot.height / zoom : null,
      workspaceHeight: null,
      minMaterialWidth: scalePaneMinimumsForFontScale(STUDENT_MIN_MATERIAL_PANE_WIDTH_PX, textScale),
      minAnswerWidth: scalePaneMinimumsForFontScale(STUDENT_MIN_ANSWER_PANE_WIDTH_PX, textScale),
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
