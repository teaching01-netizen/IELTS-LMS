import type { StudentHighlightColor } from '../highlightPalette';
import {
  addHighlightRange,
  eraseHighlightRange,
  selectionIntersectsRanges,
  type HighlightRangeV2,
  type HighlightSelectionV2,
} from '../highlightV2Engine';

export interface HighlightCommandResult {
  ranges: HighlightRangeV2[];
  limitReached: boolean;
}

export function createHighlight(
  ranges: HighlightRangeV2[],
  selection: HighlightSelectionV2,
  color: StudentHighlightColor,
  maxRanges: number,
): HighlightCommandResult {
  return addHighlightRange(ranges, selection, color, maxRanges);
}

export function eraseHighlight(
  ranges: HighlightRangeV2[],
  selection: HighlightSelectionV2,
): HighlightRangeV2[] {
  return eraseHighlightRange(ranges, selection);
}

export function canEraseHighlight(
  ranges: HighlightRangeV2[],
  selection: HighlightSelectionV2,
): boolean {
  return selectionIntersectsRanges(ranges, selection);
}
