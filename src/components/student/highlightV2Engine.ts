import type { StudentHighlightColor } from './highlightPalette';

export interface HighlightRangeV2 {
  start: number;
  end: number;
  color: StudentHighlightColor;
}

export interface HighlightSelectionV2 {
  start: number;
  end: number;
  selectedText: string;
}

export interface CaptureSelectionOptions {
  disallowedSelectionSelector?: string | undefined;
  enforceSingleBlock?: boolean | undefined;
}

const DEFAULT_DISALLOWED_SELECTION_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [data-answer-control="true"]';

const BLOCK_BOUNDARY_TAGS = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'ASIDE',
  'MAIN',
  'NAV',
  'HEADER',
  'FOOTER',
  'UL',
  'OL',
  'LI',
  'DL',
  'DT',
  'DD',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'CAPTION',
  'FIGURE',
  'FIGCAPTION',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
]);

function normalizeSelectionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function getCanonicalSurfaceText(root: HTMLElement): string {
  return root.textContent ?? '';
}

function findNearestBlockBoundary(container: HTMLElement, node: Node): Node {
  const initialElement =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;

  let current: Element | null = initialElement;
  while (current && current !== container) {
    if (BLOCK_BOUNDARY_TAGS.has(current.tagName)) {
      return current;
    }
    current = current.parentElement;
  }

  return container;
}

function getSelectionTextSegments(
  container: HTMLElement,
  range: Range,
): Array<{ textNode: Text; startOffset: number; endOffset: number }> {
  const segments: Array<{ textNode: Text; startOffset: number; endOffset: number }> = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let currentNode = walker.nextNode();

  while (currentNode) {
    const textNode = currentNode as Text;
    const textLength = textNode.textContent?.length ?? 0;
    if (textLength > 0 && range.intersectsNode(textNode)) {
      const nodeRange = document.createRange();
      nodeRange.selectNodeContents(textNode);

      let startOffset = 0;
      let endOffset = textLength;

      if (range.compareBoundaryPoints(Range.START_TO_START, nodeRange) > 0) {
        const before = document.createRange();
        before.selectNodeContents(textNode);
        before.setEnd(range.startContainer, range.startOffset);
        startOffset = before.toString().length;
      }

      if (range.compareBoundaryPoints(Range.END_TO_END, nodeRange) < 0) {
        const before = document.createRange();
        before.selectNodeContents(textNode);
        before.setEnd(range.endContainer, range.endOffset);
        endOffset = before.toString().length;
      }

      const normalizedStart = Math.max(0, Math.min(startOffset, textLength));
      const normalizedEnd = Math.max(0, Math.min(endOffset, textLength));
      if (normalizedEnd > normalizedStart) {
        segments.push({
          textNode,
          startOffset: normalizedStart,
          endOffset: normalizedEnd,
        });
      }
    }

    currentNode = walker.nextNode();
  }

  return segments;
}

function selectionCrossesBlockBoundary(container: HTMLElement, range: Range): boolean {
  const segments = getSelectionTextSegments(container, range);
  if (segments.length === 0) {
    return false;
  }

  const firstBlock = findNearestBlockBoundary(container, segments[0]!.textNode);
  for (const segment of segments) {
    if (findNearestBlockBoundary(container, segment.textNode) !== firstBlock) {
      return true;
    }
  }

  return false;
}

function computeTextOffsetFromContainerStart(
  container: HTMLElement,
  node: Node,
  offset: number,
): number | null {
  const probeRange = document.createRange();
  probeRange.selectNodeContents(container);

  try {
    probeRange.setEnd(node, offset);
  } catch {
    return null;
  }

  return probeRange.toString().length;
}

function hasDisallowedSelectionTarget(
  startNode: Node,
  endNode: Node,
  selector: string,
): boolean {
  const startElement =
    startNode.nodeType === Node.ELEMENT_NODE ? (startNode as Element) : startNode.parentElement;
  const endElement =
    endNode.nodeType === Node.ELEMENT_NODE ? (endNode as Element) : endNode.parentElement;

  return Boolean(startElement?.closest(selector) || endElement?.closest(selector));
}

export function captureSurfaceSelection(
  container: HTMLElement,
  selection: Selection,
  options?: CaptureSelectionOptions,
): HighlightSelectionV2 | null {
  const disallowedSelectionSelector =
    options?.disallowedSelectionSelector ?? DEFAULT_DISALLOWED_SELECTION_SELECTOR;
  const enforceSingleBlock = options?.enforceSingleBlock ?? true;

  if (selection.rangeCount === 0) {
    return null;
  }

  let range: Range;
  try {
    range = selection.getRangeAt(0);
  } catch {
    return null;
  }

  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }

  if (
    disallowedSelectionSelector &&
    hasDisallowedSelectionTarget(range.startContainer, range.endContainer, disallowedSelectionSelector)
  ) {
    return null;
  }

  if (enforceSingleBlock && selectionCrossesBlockBoundary(container, range)) {
    return null;
  }

  const segments = getSelectionTextSegments(container, range);
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];
  if (!firstSegment || !lastSegment) {
    return null;
  }

  const selectedText = normalizeSelectionText(range.toString());
  if (!selectedText) {
    return null;
  }

  const start = computeTextOffsetFromContainerStart(
    container,
    firstSegment.textNode,
    firstSegment.startOffset,
  );
  const end = computeTextOffsetFromContainerStart(
    container,
    lastSegment.textNode,
    lastSegment.endOffset,
  );

  if (start === null || end === null || end <= start) {
    return null;
  }

  return {
    start,
    end,
    selectedText,
  };
}

function normalizeHighlightRanges(ranges: HighlightRangeV2[]): HighlightRangeV2[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .map((range) => ({
      start: Math.max(0, Math.floor(range.start)),
      end: Math.max(0, Math.floor(range.end)),
      color: range.color,
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => {
      if (a.start !== b.start) {
        return a.start - b.start;
      }
      return a.end - b.end;
    });

  if (sorted.length === 0) {
    return [];
  }

  const merged: HighlightRangeV2[] = [sorted[0]!];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    const previous = merged[merged.length - 1]!;

    if (current.start <= previous.end && current.color === previous.color) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }

    if (current.start === previous.end && current.color === previous.color) {
      previous.end = current.end;
      continue;
    }

    merged.push(current);
  }

  return merged;
}

export function addHighlightRange(
  existingRanges: HighlightRangeV2[],
  selection: HighlightSelectionV2,
  color: StudentHighlightColor,
  maxRanges: number,
): { ranges: HighlightRangeV2[]; limitReached: boolean } {
  if (selection.end <= selection.start) {
    return { ranges: existingRanges, limitReached: false };
  }

  const nextRanges: HighlightRangeV2[] = [];

  for (const range of existingRanges) {
    if (range.end <= selection.start || range.start >= selection.end) {
      nextRanges.push(range);
      continue;
    }

    if (range.start < selection.start) {
      nextRanges.push({
        start: range.start,
        end: selection.start,
        color: range.color,
      });
    }

    if (range.end > selection.end) {
      nextRanges.push({
        start: selection.end,
        end: range.end,
        color: range.color,
      });
    }
  }

  nextRanges.push({
    start: selection.start,
    end: selection.end,
    color,
  });

  const normalized = normalizeHighlightRanges(nextRanges);
  if (normalized.length > maxRanges) {
    return { ranges: existingRanges, limitReached: true };
  }

  return {
    ranges: normalized,
    limitReached: false,
  };
}

export function eraseHighlightRange(
  existingRanges: HighlightRangeV2[],
  selection: HighlightSelectionV2,
): HighlightRangeV2[] {
  if (selection.end <= selection.start) {
    return existingRanges;
  }

  const nextRanges: HighlightRangeV2[] = [];

  for (const range of existingRanges) {
    if (range.end <= selection.start || range.start >= selection.end) {
      nextRanges.push(range);
      continue;
    }

    if (range.start < selection.start) {
      nextRanges.push({
        start: range.start,
        end: selection.start,
        color: range.color,
      });
    }

    if (range.end > selection.end) {
      nextRanges.push({
        start: selection.end,
        end: range.end,
        color: range.color,
      });
    }
  }

  return normalizeHighlightRanges(nextRanges);
}

function resolvePointFromOffset(root: HTMLElement, offset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentNode = walker.nextNode();
  let seen = 0;
  let lastTextNode: Text | null = null;

  while (currentNode) {
    const textNode = currentNode as Text;
    const textLength = textNode.textContent?.length ?? 0;

    if (offset <= seen + textLength) {
      return {
        node: textNode,
        offset: Math.max(0, Math.min(textLength, offset - seen)),
      };
    }

    seen += textLength;
    lastTextNode = textNode;
    currentNode = walker.nextNode();
  }

  if (lastTextNode) {
    const textLength = lastTextNode.textContent?.length ?? 0;
    return {
      node: lastTextNode,
      offset: textLength,
    };
  }

  return null;
}

function wrapTextNodeSegment(
  textNode: Text,
  startOffset: number,
  endOffset: number,
  highlightClassName: string,
  color: StudentHighlightColor,
): boolean {
  const fullText = textNode.textContent ?? '';
  const selectedText = fullText.slice(startOffset, endOffset);
  if (!selectedText) {
    return false;
  }

  const beforeText = fullText.slice(0, startOffset);
  const afterText = fullText.slice(endOffset);
  const doc = textNode.ownerDocument;
  const fragment = doc.createDocumentFragment();

  if (beforeText) {
    fragment.appendChild(doc.createTextNode(beforeText));
  }

  const wrapper = doc.createElement('mark');
  wrapper.className = highlightClassName;
  wrapper.setAttribute('data-highlighted', 'true');
  wrapper.setAttribute('data-highlight-color', color);
  wrapper.textContent = selectedText;
  fragment.appendChild(wrapper);

  if (afterText) {
    fragment.appendChild(doc.createTextNode(afterText));
  }

  if (!textNode.parentNode) {
    return false;
  }

  textNode.parentNode.replaceChild(fragment, textNode);
  return true;
}

function applySplitRangeHighlight(
  root: HTMLElement,
  range: Range,
  highlightClassName: string,
  color: StudentHighlightColor,
): void {
  const segments = getSelectionTextSegments(root, range);
  for (const segment of segments) {
    wrapTextNodeSegment(
      segment.textNode,
      segment.startOffset,
      segment.endOffset,
      highlightClassName,
      color,
    );
  }
}

export function renderHighlightedHtml(
  baseHtml: string,
  ranges: HighlightRangeV2[],
  getHighlightClassName: (color: StudentHighlightColor) => string,
): string {
  if (ranges.length === 0) {
    return baseHtml;
  }

  const container = document.createElement('div');
  container.innerHTML = baseHtml;

  const normalized = normalizeHighlightRanges(ranges);
  const reversed = [...normalized].reverse();

  for (const range of reversed) {
    const startPoint = resolvePointFromOffset(container, range.start);
    const endPoint = resolvePointFromOffset(container, range.end);
    if (!startPoint || !endPoint) {
      continue;
    }

    const selectionRange = document.createRange();
    try {
      selectionRange.setStart(startPoint.node, startPoint.offset);
      selectionRange.setEnd(endPoint.node, endPoint.offset);
    } catch {
      continue;
    }

    if (!selectionRange.toString()) {
      continue;
    }

    applySplitRangeHighlight(container, selectionRange, getHighlightClassName(range.color), range.color);
  }

  return container.innerHTML;
}

export function selectionIntersectsRanges(
  ranges: HighlightRangeV2[],
  selection: HighlightSelectionV2,
): boolean {
  return ranges.some((range) => range.start < selection.end && range.end > selection.start);
}
