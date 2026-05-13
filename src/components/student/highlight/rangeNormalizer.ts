import type { HighlightSelectionV2 } from '../highlightV2Engine';

function normalizeSelectionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

interface TextSegment {
  textNode: Text;
  startOffset: number;
  endOffset: number;
}

function getSelectionTextSegments(
  container: HTMLElement,
  range: Range,
): TextSegment[] {
  const segments: TextSegment[] = [];
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

export function normalizeRangeToSurfaceSelection(
  container: HTMLElement,
  range: Range,
): HighlightSelectionV2 | null {
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
