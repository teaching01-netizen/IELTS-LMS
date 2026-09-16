import type { SatTextAnchor } from '../../domain/satResponses';

export interface SatTextSelectionOptions {
  /**
   * Allow the gesture to select through an existing mark. True for the
   * selection-first flow: a student extending a selection across an earlier
   * highlight is expressing a new intent, not tapping that highlight.
   */
  allowAnnotationControls?: boolean;
}

/**
 * True when a pointer target belongs to annotation chrome (contextual toolbar,
 * touch dock, edit dock, note card) rather than to the passage. The content's
 * document-level gesture listener uses this to ignore its own controls.
 */
export function isSatSelectionInsideAnnotationUi(target: Node): boolean {
  const element = target.nodeType === Node.ELEMENT_NODE ? (target as Element) : target.parentElement;
  return element?.closest(
    '[data-sat-selection-toolbar="true"], [data-sat-touch-dock="true"], [data-sat-annotation-edit-dock="true"], [data-sat-note-card="true"]',
  ) != null;
}

export function captureSatTextSelection(root: HTMLElement, region: string, selection: Selection | null, options: SatTextSelectionOptions = {}): SatTextAnchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const elementFor = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const startElement = elementFor(range.startContainer);
  const endElement = elementFor(range.endContainer);
  const block = startElement?.closest<HTMLElement>('[data-content-text-node]');
  if (!block || !root.contains(block) || endElement?.closest('[data-content-text-node]') !== block) return null;
  const forbidden = 'button, a, input, textarea, select, [contenteditable="true"], [role="math"]';
  const forbiddenWithControls = options.allowAnnotationControls
    ? forbidden
    : `${forbidden}, [data-sat-annotation-control="true"]`;
  if (startElement?.closest(forbiddenWithControls) || endElement?.closest(forbiddenWithControls)) return null;
  if ([...block.querySelectorAll(forbiddenWithControls)].some((element) => range.intersectsNode(element))) return null;
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
