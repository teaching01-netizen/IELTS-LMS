export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface HighlightSelectionSnapshot {
  startNodePath: number[];
  startOffset: number;
  endNodePath: number[];
  endOffset: number;
  selectedText: string;
  signature: string;
}

export type HighlightPolicyReason =
  | 'cross_block_selection'
  | 'no_snapshot'
  | 'clone_range_failed'
  | 'text_mismatch_guard'
  | 'empty_selection';

export interface HighlightApplyResult {
  html: string | null;
  reason: HighlightPolicyReason | null;
}

const HIGHLIGHT_SELECTOR = 'mark[data-highlighted="true"]';

const isHighlightDebugEnabled =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env !== 'undefined' &&
  Boolean(import.meta.env.DEV);

function debugHighlight(reason: string, details?: Record<string, unknown>): void {
  if (!isHighlightDebugEnabled) {
    return;
  }
  console.debug('[highlight]', reason, details ?? {});
}

function normalizeSelectionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function applySelectionHighlight(
  container: HTMLElement,
  selection: Selection,
  highlightClassName = 'rounded-sm bg-yellow-200/80 text-gray-900',
): string | null {
  return applySelectionHighlightWithPolicy(container, selection, highlightClassName).html;
}

export function applySelectionHighlightWithPolicy(
  container: HTMLElement,
  selection: Selection,
  highlightClassName = 'rounded-sm bg-yellow-200/80 text-gray-900',
): HighlightApplyResult {
  const snapshot = createHighlightSelectionSnapshot(container, selection);
  if (!snapshot) {
    debugHighlight('applySelectionHighlight:no_snapshot');
    return { html: null, reason: 'no_snapshot' };
  }

  const clonedContainer = container.cloneNode(true) as HTMLElement;
  const clonedRange = createClonedRangeFromSnapshot(clonedContainer, snapshot);
  if (!clonedRange) {
    debugHighlight('applySelectionHighlight:clone_range_failed');
    return { html: null, reason: 'clone_range_failed' };
  }

  const normalizedSnapshotText = normalizeSelectionText(snapshot.selectedText);
  const normalizedRangeText = normalizeSelectionText(clonedRange.toString());
  if (!normalizedSnapshotText || normalizedSnapshotText !== normalizedRangeText) {
    debugHighlight('applySelectionHighlight:text_mismatch_guard', {
      snapshot: normalizedSnapshotText,
      range: normalizedRangeText,
    });
    return { html: null, reason: 'text_mismatch_guard' };
  }

  const highlightedResult = applyHighlightToClonedRange(
    clonedContainer,
    clonedRange,
    highlightClassName,
  );
  if (!highlightedResult.html) {
    return highlightedResult;
  }

  return highlightedResult;
}

export function applyHighlightFromSnapshot(
  container: HTMLElement,
  snapshot: HighlightSelectionSnapshot,
  highlightClassName = 'rounded-sm bg-yellow-200/80 text-gray-900',
): string | null {
  return applyHighlightFromSnapshotWithPolicy(container, snapshot, highlightClassName).html;
}

export function applyHighlightFromSnapshotWithPolicy(
  container: HTMLElement,
  snapshot: HighlightSelectionSnapshot,
  highlightClassName = 'rounded-sm bg-yellow-200/80 text-gray-900',
): HighlightApplyResult {
  const clonedContainer = container.cloneNode(true) as HTMLElement;
  const clonedRange = createClonedRangeFromSnapshot(clonedContainer, snapshot);
  if (!clonedRange) {
    debugHighlight('applyHighlightFromSnapshot:clone_range_failed');
    return { html: null, reason: 'clone_range_failed' };
  }

  const normalizedSnapshotText = normalizeSelectionText(snapshot.selectedText);
  const normalizedRangeText = normalizeSelectionText(clonedRange.toString());
  if (!normalizedSnapshotText || normalizedSnapshotText !== normalizedRangeText) {
    debugHighlight('applyHighlightFromSnapshot:text_mismatch_guard', {
      snapshot: normalizedSnapshotText,
      range: normalizedRangeText,
    });
    return { html: null, reason: 'text_mismatch_guard' };
  }

  return applyHighlightToClonedRange(
    clonedContainer,
    clonedRange,
    highlightClassName,
  );
}

export function removeHighlightAtIndex(container: HTMLElement, highlightIndex: number): string | null {
  if (highlightIndex < 0) {
    return null;
  }

  const clonedContainer = container.cloneNode(true) as HTMLElement;
  const highlightedNodes = clonedContainer.querySelectorAll('mark[data-highlighted="true"]');
  const highlightedNode = highlightedNodes.item(highlightIndex);
  if (!highlightedNode || !highlightedNode.parentNode) {
    return null;
  }

  const parent = highlightedNode.parentNode;
  while (highlightedNode.firstChild) {
    parent.insertBefore(highlightedNode.firstChild, highlightedNode);
  }
  parent.removeChild(highlightedNode);

  return clonedContainer.innerHTML;
}

export function createHighlightSelectionSnapshot(
  container: HTMLElement,
  selection: Selection,
): HighlightSelectionSnapshot | null {
  if (selection.rangeCount === 0) {
    debugHighlight('createSnapshot:no_range');
    return null;
  }

  let range: Range;
  try {
    range = selection.getRangeAt(0);
  } catch {
    debugHighlight('createSnapshot:get_range_failed');
    return null;
  }
  const clippedRange = clipRangeToContainer(container, range);
  if (!clippedRange) {
    debugHighlight('createSnapshot:outside_container');
    return null;
  }
  // Use the exact captured range text, not selection.toString(), because some
  // browsers can report stale selection text at mouseup/touchend.
  const selectedText = clippedRange.toString().trim();
  if (!selectedText) {
    debugHighlight('createSnapshot:collapsed_or_empty');
    return null;
  }

  const startNodePath = getNodePath(container, clippedRange.startContainer);
  const endNodePath = getNodePath(container, clippedRange.endContainer);
  if (!startNodePath || !endNodePath) {
    debugHighlight('createSnapshot:path_resolution_failed');
    return null;
  }

  return {
    startNodePath,
    startOffset: clippedRange.startOffset,
    endNodePath,
    endOffset: clippedRange.endOffset,
    selectedText,
    signature: `${startNodePath.join('.')}:${clippedRange.startOffset}|${endNodePath.join('.')}:${clippedRange.endOffset}|${selectedText}`,
  };
}

function clipRangeToContainer(container: HTMLElement, range: Range): Range | null {
  const startInside = container.contains(range.startContainer);
  const endInside = container.contains(range.endContainer);
  if (!startInside || !endInside) {
    return null;
  }

  const ancestor = range.commonAncestorContainer;
  if (ancestor !== container && !container.contains(ancestor)) {
    return null;
  }

  return range;
}

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

function selectionCrossesBlockBoundary(container: HTMLElement, range: Range): boolean {
  const segments = collectIntersectingTextSegments(container, range);
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

function applyHighlightToClonedRange(
  clonedContainer: HTMLElement,
  clonedRange: Range,
  highlightClassName: string,
): HighlightApplyResult {
  if (!clonedRange.toString().trim()) {
    return { html: null, reason: 'empty_selection' };
  }

  const crossesBlockBoundary = selectionCrossesBlockBoundary(clonedContainer, clonedRange);
  if (crossesBlockBoundary) {
    return { html: null, reason: 'cross_block_selection' };
  }

  const didApplyHighlight = applySplitRangeHighlight(
    clonedContainer,
    clonedRange,
    highlightClassName,
  );
  if (!didApplyHighlight) {
    return { html: null, reason: crossesBlockBoundary ? 'cross_block_selection' : 'empty_selection' };
  }

  flattenNestedHighlightedMarks(clonedContainer);
  return { html: clonedContainer.innerHTML, reason: null };
}

function applySplitRangeHighlight(
  container: HTMLElement,
  range: Range,
  highlightClassName: string,
): boolean {
  const segments = collectIntersectingTextSegments(container, range);
  let didApplyHighlight = false;
  for (const segment of segments) {
    if (wrapTextNodeSegment(segment.textNode, segment.startOffset, segment.endOffset, highlightClassName)) {
      didApplyHighlight = true;
    }
  }

  return didApplyHighlight;
}

function collectIntersectingTextSegments(
  container: HTMLElement,
  range: Range,
): Array<{ textNode: Text; startOffset: number; endOffset: number }> {
  const segments: Array<{ textNode: Text; startOffset: number; endOffset: number }> = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let currentNode = walker.nextNode();
  while (currentNode) {
    const textNode = currentNode as Text;
    if (
      textNode.textContent &&
      textNode.textContent.length > 0 &&
      range.intersectsNode(textNode)
    ) {
      const offsets = getTextNodeSelectionOffsetsFromOverlap(range, textNode);
      if (offsets) {
        segments.push({
          textNode,
          startOffset: offsets.startOffset,
          endOffset: offsets.endOffset,
        });
      }
    }
    currentNode = walker.nextNode();
  }

  return segments;
}

function getTextNodeSelectionOffsetsFromOverlap(
  range: Range,
  textNode: Text,
): { startOffset: number; endOffset: number } | null {
  const textLength = textNode.textContent?.length ?? 0;
  if (textLength === 0) {
    return null;
  }

  const nodeRange = document.createRange();
  nodeRange.selectNodeContents(textNode);
  const overlapRange = getRangeOverlap(range, nodeRange);
  if (!overlapRange) {
    return null;
  }

  const beforeOverlap = document.createRange();
  beforeOverlap.selectNodeContents(textNode);
  beforeOverlap.setEnd(overlapRange.startContainer, overlapRange.startOffset);
  const startOffset = beforeOverlap.toString().length;
  const endOffset = startOffset + overlapRange.toString().length;

  const normalizedStart = Math.max(0, Math.min(startOffset, textLength));
  const normalizedEnd = Math.max(0, Math.min(endOffset, textLength));
  if (normalizedEnd <= normalizedStart) {
    return null;
  }

  return {
    startOffset: normalizedStart,
    endOffset: normalizedEnd,
  };
}

function getRangeOverlap(
  sourceRange: Range,
  targetRange: Range,
): Range | null {
  if (!sourceRange.intersectsNode(targetRange.startContainer)) {
    return null;
  }

  const overlap = document.createRange();
  if (sourceRange.compareBoundaryPoints(Range.START_TO_START, targetRange) <= 0) {
    overlap.setStart(targetRange.startContainer, targetRange.startOffset);
  } else {
    overlap.setStart(sourceRange.startContainer, sourceRange.startOffset);
  }

  if (sourceRange.compareBoundaryPoints(Range.END_TO_END, targetRange) >= 0) {
    overlap.setEnd(targetRange.endContainer, targetRange.endOffset);
  } else {
    overlap.setEnd(sourceRange.endContainer, sourceRange.endOffset);
  }

  if (overlap.toString().length === 0) {
    return null;
  }

  return overlap;
}

function wrapTextNodeSegment(
  textNode: Text,
  startOffset: number,
  endOffset: number,
  highlightClassName: string,
): boolean {
  if (isInsideHighlightedMark(textNode)) {
    return false;
  }

  const fullText = textNode.textContent ?? '';
  const selectedText = fullText.slice(startOffset, endOffset);
  if (!selectedText || selectedText.trim().length === 0) {
    return false;
  }

  const beforeText = fullText.slice(0, startOffset);
  const afterText = fullText.slice(endOffset);
  const fragment = document.createDocumentFragment();

  if (beforeText) {
    fragment.appendChild(document.createTextNode(beforeText));
  }

  const wrapper = document.createElement('mark');
  wrapper.className = highlightClassName;
  wrapper.setAttribute('data-highlighted', 'true');
  wrapper.textContent = selectedText;
  fragment.appendChild(wrapper);

  if (afterText) {
    fragment.appendChild(document.createTextNode(afterText));
  }

  if (!textNode.parentNode) {
    return false;
  }

  textNode.parentNode.replaceChild(fragment, textNode);
  return true;
}

function isInsideHighlightedMark(node: Node): boolean {
  const parentElement =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  if (!parentElement) {
    return false;
  }
  return Boolean(parentElement.closest(HIGHLIGHT_SELECTOR));
}

function flattenNestedHighlightedMarks(root: ParentNode): void {
  const nestedMarks = Array.from(root.querySelectorAll(`${HIGHLIGHT_SELECTOR} ${HIGHLIGHT_SELECTOR}`));
  for (const nestedMark of nestedMarks) {
    const parent = nestedMark.parentNode;
    if (!parent) {
      continue;
    }
    while (nestedMark.firstChild) {
      parent.insertBefore(nestedMark.firstChild, nestedMark);
    }
    parent.removeChild(nestedMark);
  }
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

function createClonedRangeFromSnapshot(
  clonedContainer: HTMLElement,
  snapshot: HighlightSelectionSnapshot,
): Range | null {
  const clonedStartNode = resolveNodePath(clonedContainer, snapshot.startNodePath);
  const clonedEndNode = resolveNodePath(clonedContainer, snapshot.endNodePath);
  if (!clonedStartNode || !clonedEndNode) {
    return null;
  }

  const clonedRange = document.createRange();
  try {
    clonedRange.setStart(clonedStartNode, snapshot.startOffset);
    clonedRange.setEnd(clonedEndNode, snapshot.endOffset);
  } catch {
    return null;
  }

  return clonedRange;
}

function getNodePath(root: Node, node: Node): number[] | null {
  const path: number[] = [];
  let current: Node | null = node;

  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) {
      return null;
    }

    const index = Array.from(parent.childNodes).indexOf(current as ChildNode);
    if (index < 0) {
      return null;
    }

    path.unshift(index);
    current = parent;
  }

  return current === root ? path : null;
}

function resolveNodePath(root: Node, path: number[]): Node | null {
  let current: Node | null = root;

  for (const index of path) {
    current = (current?.childNodes.item(index) as ChildNode | null) ?? null;
    if (!current) {
      return null;
    }
  }

  return current;
}
