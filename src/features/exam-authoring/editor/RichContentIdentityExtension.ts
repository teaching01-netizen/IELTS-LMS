import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { RichTextDocument, RichTextNode } from '../contracts/assessment';
import { isRichTextBlock, RICH_TEXT_BLOCK_TYPES, withRichContentIdentities } from './richContentIdentity';

export const RichContentIdentity = Extension.create({
  name: 'richContentIdentity',
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        const normalized = withRichContentIdentities(state.doc.toJSON() as RichTextDocument);
        const ids: string[] = [];
        const collect = (nodes: readonly RichTextNode[]) => {
          for (const node of nodes) {
            if (isRichTextBlock(node)) ids.push(node.attrs!['id'] as string);
            collect(node.content ?? []);
          }
        };
        collect(normalized.content ?? []);
        let index = 0;
        const transaction = state.tr;
        state.doc.descendants((node, position) => {
          if (!RICH_TEXT_BLOCK_TYPES.some((type) => type === node.type.name)) return;
          const id = ids[index++];
          if (node.attrs['id'] !== id) transaction.setNodeMarkup(position, undefined, { ...node.attrs, id });
        });
        return transaction.docChanged ? transaction : null;
      },
    })];
  },
  addGlobalAttributes() {
    return [{
      types: [...RICH_TEXT_BLOCK_TYPES],
      attributes: {
        id: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-content-id'),
          renderHTML: (attributes) => attributes['id'] ? { 'data-content-id': attributes['id'] } : {},
        },
      },
    }];
  },
});
