/** Optional observation only. No gesture policy or browser selection belongs here. */
export type TouchSelectionDiagnosticRecord = (stage: string, details?: Record<string, unknown>) => void;

export interface TouchSelectionDiagnostics {
  record: TouchSelectionDiagnosticRecord;
  listener: (root: HTMLElement | null) => void;
}

export function describeTouchSelectionNode(node: Node | null): string | null {
  if (!node) return null;
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return node.nodeName;
  // Do not collect input values, candidate IDs, or the surrounding exam text.
  return `${node.nodeName.toLowerCase()} in ${element.tagName.toLowerCase()}${element.hasAttribute('data-student-highlightable') ? '[data-student-highlightable]' : ''}${element.hasAttribute('data-sat-annotation-region') ? '[data-sat-annotation-region]' : ''}`;
}
