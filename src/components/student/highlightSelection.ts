export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function applySelectionHighlight(
  container: HTMLElement,
  selection: Selection,
  highlightClassName = 'rounded-sm bg-yellow-200/80 px-0.5 text-gray-900',
): string | null {
  if (selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const selectedText = selection.toString().trim();
  if (!selectedText) {
    return null;
  }

  if (!container.contains(range.commonAncestorContainer)) {
    return null;
  }

  const clonedContainer = container.cloneNode(true) as HTMLElement;
  const clonedRange = createClonedRange(container, clonedContainer, range);
  if (!clonedRange) {
    return null;
  }

  const wrapper = document.createElement('mark');
  wrapper.className = highlightClassName;
  wrapper.setAttribute('data-highlighted', 'true');

  try {
    clonedRange.surroundContents(wrapper);
  } catch {
    try {
      wrapper.appendChild(clonedRange.extractContents());
      clonedRange.insertNode(wrapper);
    } catch {
      return null;
    }
  }

  selection.removeAllRanges();

  return clonedContainer.innerHTML;
}

function createClonedRange(
  sourceContainer: HTMLElement,
  clonedContainer: HTMLElement,
  sourceRange: Range,
): Range | null {
  const startNodePath = getNodePath(sourceContainer, sourceRange.startContainer);
  const endNodePath = getNodePath(sourceContainer, sourceRange.endContainer);
  if (!startNodePath || !endNodePath) {
    return null;
  }

  const clonedStartNode = resolveNodePath(clonedContainer, startNodePath);
  const clonedEndNode = resolveNodePath(clonedContainer, endNodePath);
  if (!clonedStartNode || !clonedEndNode) {
    return null;
  }

  const clonedRange = document.createRange();
  try {
    clonedRange.setStart(clonedStartNode, sourceRange.startOffset);
    clonedRange.setEnd(clonedEndNode, sourceRange.endOffset);
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
