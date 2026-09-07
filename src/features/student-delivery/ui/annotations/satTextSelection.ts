import type { SatTextAnchor } from '../../domain/satResponses';

export function captureSatTextSelection(root: HTMLElement, region: string, selection: Selection | null): SatTextAnchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const elementFor = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const startElement = elementFor(range.startContainer);
  const endElement = elementFor(range.endContainer);
  const block = startElement?.closest<HTMLElement>('[data-content-text-node]');
  if (!block || !root.contains(block) || endElement?.closest('[data-content-text-node]') !== block) return null;
  const forbidden = 'button, a, input, textarea, select, [contenteditable="true"], [role="math"]';
  if (startElement?.closest(forbidden) || endElement?.closest(forbidden)) return null;
  if ([...block.querySelectorAll(forbidden)].some((element) => range.intersectsNode(element))) return null;
  const preceding = range.cloneRange();
  preceding.selectNodeContents(block);
  preceding.setEnd(range.startContainer, range.startOffset);
  const startOffset = preceding.toString().length;
  const exact = range.toString();
  if (!exact.trim() || exact.length > 2000) return null;
  const text = block.textContent ?? '';
  const endOffset = startOffset + exact.length;
  if (text.slice(startOffset, endOffset) !== exact) return null;
  const nodeId = block.dataset['contentTextNode'];
  if (!nodeId) return null;
  return { nodeId: `${region}:${nodeId}`, startOffset, endOffset, exact,
    prefix: text.slice(Math.max(0, startOffset - 64), startOffset), suffix: text.slice(endOffset, endOffset + 64) };
}
