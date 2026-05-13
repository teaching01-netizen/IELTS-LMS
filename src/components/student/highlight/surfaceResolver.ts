const DEFAULT_HIGHLIGHT_SURFACE_SELECTOR = '[data-student-highlightable="true"]';

export const DEFAULT_DISALLOWED_SELECTION_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]',
  '[data-answer-control]'
].join(', ');

export interface SurfaceResolverOptions {
  disallowedSelectionSelector?: string | undefined;
  highlightSurfaceSelector?: string | undefined;
}

export interface ResolvedSurfaceSelection {
  range: Range;
  surfaceElement: HTMLElement;
  surfaceId: string;
}

function resolveElement(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function resolveSurfaceElement(node: Node, selector: string): HTMLElement | null {
  return resolveElement(node)?.closest(selector) as HTMLElement | null;
}

function rangeTouchesDisallowedTargets(range: Range, scope: HTMLElement, selector: string): boolean {
  const startElement = resolveElement(range.startContainer);
  const endElement = resolveElement(range.endContainer);
  if (startElement?.closest(selector) || endElement?.closest(selector)) {
    return true;
  }

  const disallowedNodes = scope.querySelectorAll(selector);
  for (const node of disallowedNodes) {
    try {
      if (range.intersectsNode(node)) {
        return true;
      }
    } catch {
      // Ignore browsers that throw for detached nodes.
    }
  }

  return false;
}

export function resolveSurfaceSelection(
  container: HTMLElement,
  selection: Selection,
  options?: SurfaceResolverOptions,
): ResolvedSurfaceSelection | null {
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

  const surfaceSelector = options?.highlightSurfaceSelector ?? DEFAULT_HIGHLIGHT_SURFACE_SELECTOR;
  const startSurface = resolveSurfaceElement(range.startContainer, surfaceSelector) ?? container;
  const endSurface = resolveSurfaceElement(range.endContainer, surfaceSelector) ?? container;

  if (!startSurface || !endSurface || startSurface !== endSurface || startSurface !== container) {
    return null;
  }

  const disallowedSelector =
    options?.disallowedSelectionSelector ?? DEFAULT_DISALLOWED_SELECTION_SELECTOR;
  if (disallowedSelector && rangeTouchesDisallowedTargets(range, container, disallowedSelector)) {
    return null;
  }

  return {
    range,
    surfaceElement: startSurface,
    surfaceId: startSurface.dataset['highlightSurfaceId'] ?? '',
  };
}
