import { getStudentLayoutMode, type StudentLayoutMode } from './studentLayoutMode';

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
    layoutMode: getStudentLayoutMode(snapshot.width),
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
