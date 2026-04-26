import { useEffect, useState } from 'react';

export interface StudentTabletModeSnapshot {
  width: number;
  height: number;
  hasCoarsePointer: boolean;
  hasTouchSupport: boolean;
}

function hasTouchLikeInput(snapshot: StudentTabletModeSnapshot) {
  return snapshot.hasCoarsePointer || snapshot.hasTouchSupport;
}

export function isStudentTabletMode(snapshot: StudentTabletModeSnapshot) {
  const minSide = Math.min(snapshot.width, snapshot.height);
  const maxSide = Math.max(snapshot.width, snapshot.height);

  return hasTouchLikeInput(snapshot) && minSide >= 700 && maxSide <= 1400;
}

function getEnvironmentSnapshot(targetWindow: Window): StudentTabletModeSnapshot {
  const coarsePointer =
    targetWindow.matchMedia?.('(pointer: coarse)')?.matches ||
    targetWindow.matchMedia?.('(any-pointer: coarse)')?.matches ||
    false;
  const touchSupport = Boolean((targetWindow.navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints);

  return {
    width: targetWindow.innerWidth,
    height: targetWindow.innerHeight,
    hasCoarsePointer: coarsePointer,
    hasTouchSupport: touchSupport,
  };
}

export function getStudentTabletModeFromWindow(
  targetWindow: Window | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  if (!targetWindow) {
    return false;
  }

  return isStudentTabletMode(getEnvironmentSnapshot(targetWindow));
}

export function useStudentTabletMode() {
  const [tabletMode, setTabletMode] = useState(() => getStudentTabletModeFromWindow());

  useEffect(() => {
    const updateTabletMode = () => {
      setTabletMode(getStudentTabletModeFromWindow(window));
    };

    updateTabletMode();
    window.addEventListener('resize', updateTabletMode);
    window.addEventListener('orientationchange', updateTabletMode);

    return () => {
      window.removeEventListener('resize', updateTabletMode);
      window.removeEventListener('orientationchange', updateTabletMode);
    };
  }, []);

  return tabletMode;
}
