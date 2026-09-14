// The single rich-text node/mark vocabulary shared by the browser editor and
// the Hocuspocus co-editing service.
//
// Invariant: `prompt JSON -> Y.Doc prompt fragment -> prompt JSON` preserves
// the canonical structured-content projection for every supported document
// (paragraphs, headings, marks, lists, code, inline and block math, images,
// tables). That only holds if both sides build the SAME ProseMirror schema, so
// both call `richTextSchemaExtensions()` from this module.
//
// This module must stay free of DOM and React imports: it is loaded in Node by
// the co-editing service. Browser-only extensions (node views, placeholder,
// paste plugins, collaboration bindings) are added by the caller.
import { Extension, getSchema, type Extensions } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { RICH_TEXT_BLOCK_TYPES } from "../richContentIdentity";
import { BlockMathNode, InlineMathNode } from "./mathNodes";
import { SatImageNode } from "./imageNode";

/**
 * Schema-only half of the browser's RichContentIdentity extension.
 *
 * The browser version adds a transaction plugin that assigns stable block ids
 * after every edit; the server never renders, so it needs only the attribute
 * definition (which is what keeps ids intact through a Y.Doc round trip).
 */
export const RichContentIdentitySchema = Extension.create({
  name: "richContentIdentity",
  addGlobalAttributes() {
    return [
      {
        types: [...RICH_TEXT_BLOCK_TYPES],
        attributes: {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-content-id"),
            renderHTML: (attributes) =>
              attributes["id"] ? { "data-content-id": attributes["id"] } : {},
          },
        },
      },
    ];
  },
});

export interface RichTextSchemaOptions {
  /**
   * Include StarterKit's undo/redo history. The collaborative editor MUST
   * disable it: Yjs owns history when collaboration is bound, and two
   * independent history stacks corrupt each other's undo.
   */
  history?: boolean;
  /**
   * Include the schema-only identity extension. The browser passes false and
   * registers its own RichContentIdentity (same name, adds the id-assignment
   * transaction plugin) instead.
   */
  identity?: boolean;
  /**
   * Include the math nodes. The browser passes false and registers the
   * editable variants (same node names, plus node views) instead, because two
   * extensions with the same name cannot coexist.
   */
  math?: boolean;
  /** Same as `math`, for the image node. */
  image?: boolean;
}

/** The shared extension list, in the order both runtimes build it. */
export function richTextSchemaExtensions(options: RichTextSchemaOptions = {}): Extensions {
  const extensions: Extensions = [];
  if (options.identity !== false) extensions.push(RichContentIdentitySchema);
  extensions.push(
    StarterKit.configure({
      blockquote: false,
      heading: { levels: [2, 3] },
      ...(options.history === false ? { undoRedo: false } : {}),
    })
  );
  if (options.math !== false) extensions.push(InlineMathNode, BlockMathNode);
  extensions.push(
    TableKit.configure({ table: { resizable: true, lastColumnResizable: false } }),
    Subscript,
    Superscript
  );
  if (options.image !== false) extensions.push(SatImageNode.configure({ inline: false, allowBase64: false }));
  return extensions;
}

/** Builds the shared ProseMirror schema (used by the co-editing service). */
export function getRichTextSchema(options: RichTextSchemaOptions = {}): Schema {
  return getSchema(richTextSchemaExtensions(options));
}

export { RICH_TEXT_BLOCK_TYPES };
