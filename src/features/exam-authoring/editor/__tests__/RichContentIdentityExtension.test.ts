import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { RichContentIdentity } from '../RichContentIdentityExtension';

describe('rich content editing identities', () => {
  it('gives a split paragraph a distinct ID that survives subsequent typing', () => {
    const editor = new Editor({
      extensions: [StarterKit, RichContentIdentity],
      content: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'original' }, content: [{ type: 'text', text: 'First second' }] }] },
    });
    try {
      editor.commands.setTextSelection(7);
      editor.commands.splitBlock();
      const blocks = editor.getJSON().content!;
      const nextId = blocks[1]?.attrs?.['id'];
      expect(nextId).toEqual(expect.any(String));
      expect(nextId).not.toBe('original');
      expect(blocks[0]?.attrs?.['id']).toBe('original');
      editor.commands.insertContent('another ');
      expect(editor.getJSON().content?.[1]?.attrs?.['id']).toBe(nextId);
    } finally {
      editor.destroy();
    }
  });
});
