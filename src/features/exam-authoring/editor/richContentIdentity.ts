import type { RichTextDocument, RichTextNode } from '../contracts/assessment';

export const RICH_TEXT_BLOCK_TYPES = ['paragraph', 'heading', 'codeBlock'] as const;

export function isRichTextBlock(node: RichTextNode): boolean {
  return RICH_TEXT_BLOCK_TYPES.some((type) => node.type === type);
}

function fingerprint(node: RichTextNode): string {
  let hash = 2166136261;
  const source = JSON.stringify(node);
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Assign once at the content boundary, then retain IDs through edits and serialization. */
export function withRichContentIdentities(document: RichTextDocument): RichTextDocument {
  const reserved = new Set<string>();
  const collect = (nodes: readonly RichTextNode[]) => {
    for (const node of nodes) {
      const id = node.attrs?.['id'];
      if (typeof id === 'string' && id) reserved.add(id);
      collect(node.content ?? []);
    }
  };
  collect(document.content ?? []);
  const claimed = new Set<string>();
  const visit = (node: RichTextNode): RichTextNode => {
    let attrs = node.attrs;
    if (isRichTextBlock(node)) {
      let id = attrs?.['id'];
      if (typeof id !== 'string' || !id || claimed.has(id)) {
        const base = `content-${fingerprint(node)}`;
        let candidate = base;
        let suffix = 1;
        while (reserved.has(candidate)) candidate = `${base}-${suffix++}`;
        id = candidate;
        reserved.add(candidate);
        attrs = { ...attrs, id };
      }
      claimed.add(id as string);
    }
    return { ...node, ...(attrs ? { attrs } : {}), ...(node.content ? { content: node.content.map(visit) } : {}) };
  };
  return { ...document, ...(document.content ? { content: document.content.map(visit) } : {}) };
}
