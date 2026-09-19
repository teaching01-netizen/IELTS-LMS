import type { TextPoint } from '@shared/ui/touch-selection/touchSelectionPoint';
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
 * True when a pointer target belongs to annotation chrome (the selection
 * toolbar, a mark's edit controls, a note card) rather than to the passage. The
 * content's document-level gesture listener uses this to ignore its own
 * controls.
 *
 * The chrome earns its own markers rather than being recognized by structure:
 * a surface that is mounted but hidden deliberately omits them (see the
 * selection panel), and a bare `[role="toolbar"]` would have claimed the
 * interaction hooks of a surface nobody can see.
 */
export function isSatSelectionInsideAnnotationUi(target: Node): boolean {
  const element = target.nodeType === Node.ELEMENT_NODE ? (target as Element) : target.parentElement;
  return element?.closest(
    '[data-sat-selection-toolbar="true"], [data-sat-annotation-edit-controls="true"], [data-sat-note-card="true"]',
  ) != null;
}

/**
 * The text block a press landed in, for the owned touch gesture.
 *
 * An anchor names ONE block, so a touch selection has to be confined to one
 * too — this is that boundary, resolved from where the press landed rather than
 * from wherever the finger ended up. Without it a drag across a paragraph break
 * would resolve to no anchor at all and the student would see nothing happen.
 */
export function satAnnotationBlockForPoint(point: TextPoint): Element | null {
  return point.node.parentElement?.closest('[data-content-text-node]') ?? null;
}

/**
 * The anchor for a span of rendered text, where the span arrives as a `Range`.
 *
 * This is the core, and it takes a range rather than a `Selection` because the
 * exam now produces ranges two ways. On a mouse the browser makes the selection
 * and `captureSatTextSelection` passes its range through; on a touch device the
 * exam's own gesture makes the range (see `@shared/ui/touch-selection`), because
 * letting a browser selection exist is what raises the platform's Copy / Look Up
 * / Share menu over the passage. Neither path is privileged: an anchor is a
 * character span, and it does not matter who measured it.
 */
export function captureSatTextRange(root: HTMLElement, region: string, range: Range, options: SatTextSelectionOptions = {}): SatTextAnchor | null {
  if (range.collapsed) return null;
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

/**
 * The same, for a browser selection. The desktop adapter: it validates the
 * shape only the platform's own selection can have (exactly one live range) and
 * hands the span to the core.
 */
export function captureSatTextSelection(root: HTMLElement, region: string, selection: Selection | null, options: SatTextSelectionOptions = {}): SatTextAnchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  return captureSatTextRange(root, region, selection.getRangeAt(0), options);
}
