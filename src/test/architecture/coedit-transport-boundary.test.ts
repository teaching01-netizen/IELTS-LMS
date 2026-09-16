import { describe, expect, it } from 'vitest';
import {
  collectCoeditTransportBoundaryViolations,
  findNewArchitectureViolations,
  formatArchitectureViolations,
  isCollaborativeTransportPackage,
  loadArchitectureBaseline,
  readProductionSourceFiles,
} from './architectureTestUtils';

/**
 * The CRDT/transport stack is owned by
 * `src/features/exam-authoring/realtime/coedit` and nothing else.
 *
 * The boundary is what makes the rest of the app testable without a document
 * server, and it is what keeps "is this a collaborator's edit?" a question the
 * editor asks the co-edit package instead of a question it answers by importing
 * Yjs. It was aspirational until now: `RichQuestionComposer` read
 * `ySyncPluginKey` out of `y-prosemirror` to filter remote transactions, which
 * is one `import` away from re-owning the transport in the editor.
 */
describe('coedit transport boundary', () => {
  it('does not import the collaborative transport outside the coedit package', () => {
    const violations = findNewArchitectureViolations(
      collectCoeditTransportBoundaryViolations(readProductionSourceFiles()),
      loadArchitectureBaseline(),
    );

    expect(violations, formatArchitectureViolations(violations)).toEqual([]);
  });

  it('recognizes the packages the boundary is about', () => {
    // Guards the guard: a prefix list that matched nothing would let the rule
    // above pass over an import it never looked at.
    for (const specifier of [
      'yjs',
      'yjs/yjs',
      'y-prosemirror',
      'y-indexeddb',
      'y-protocols/awareness',
      '@hocuspocus/provider',
      '@hocuspocus/server',
      '@tiptap/extension-collaboration',
      '@tiptap/extension-collaboration-caret',
    ]) {
      expect(isCollaborativeTransportPackage(specifier), specifier).toBe(true);
    }
    for (const specifier of [
      'react',
      '@tiptap/core',
      '@tiptap/starter-kit',
      '@tiptap/extension-image',
      'yjs-observable',
      './local-module',
    ]) {
      expect(isCollaborativeTransportPackage(specifier), specifier).toBe(false);
    }
  });
});
