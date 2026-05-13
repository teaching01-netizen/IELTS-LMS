import type { StudentHighlightColor } from '../highlightPalette';
import {
  renderHighlightedHtml,
  type HighlightRangeV2,
} from '../highlightV2Engine';

export function renderSurfaceHighlights(
  baseHtml: string,
  ranges: HighlightRangeV2[],
  getHighlightClassName: (color: StudentHighlightColor) => string,
): string {
  return renderHighlightedHtml(baseHtml, ranges, getHighlightClassName);
}
