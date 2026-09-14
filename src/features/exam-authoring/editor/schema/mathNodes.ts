// Shared math node definitions.
//
// This file must stay free of DOM and React code: the Hocuspocus co-editing
// service imports it (via richTextSchema.ts) and converts prompt JSON to a
// Y.Doc in Node. The browser-only node VIEW lives in
// ../EditableMathExtension.tsx, which extends these same node names and
// attributes.
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";

export const mathOptions = { throwOnError: false, strict: false } as const;

/** Inline equation node (`inlineMath`, attr: `latex`). */
export const InlineMathNode = InlineMath.configure({ katexOptions: mathOptions });

/** Display equation node (`blockMath`, attr: `latex`). */
export const BlockMathNode = BlockMath.configure({ katexOptions: mathOptions });
