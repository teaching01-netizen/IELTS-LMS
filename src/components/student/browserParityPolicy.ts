import { isAppleMobileDevice } from './appleMobileDevice';

export interface SplitPaneBoundsPolicy {
  minMaterialWidthPx: number;
  minAnswerWidthPx: number;
  dividerWidthPx: number;
  dividerConsumesSpace: boolean;
}

const TABLET_MIN_MATERIAL_WIDTH = 48;
const TABLET_MIN_ANSWER_WIDTH = 48;
const DESKTOP_MIN_MATERIAL_WIDTH = 48;
const DESKTOP_MIN_ANSWER_WIDTH = 48;

export function shouldLockViewportForExamSession(tabletMode: boolean): boolean {
  return tabletMode || isAppleMobileDevice();
}

export function getSplitPaneBoundsPolicy(
  isTabletMode: boolean,
  dividerWidthPx: number,
  dividerConsumesSpace: boolean,
): SplitPaneBoundsPolicy {
  return {
    minMaterialWidthPx: isTabletMode ? TABLET_MIN_MATERIAL_WIDTH : DESKTOP_MIN_MATERIAL_WIDTH,
    minAnswerWidthPx: isTabletMode ? TABLET_MIN_ANSWER_WIDTH : DESKTOP_MIN_ANSWER_WIDTH,
    dividerWidthPx,
    dividerConsumesSpace,
  };
}
