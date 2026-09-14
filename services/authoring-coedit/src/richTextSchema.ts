/**
 * The rich-text schema, imported from the SAME module the browser editor uses.
 *
 * This is the load-bearing shared-file boundary: if the service built its own
 * node list, `prompt JSON -> Y.Doc -> prompt JSON` would silently drop or
 * malform content the browser can produce (marks, math, tables, images), and
 * the failure would only appear as a materialization mismatch at publish time.
 *
 * The shared module is DOM-free and React-free by construction (see
 * src/features/exam-authoring/editor/schema/richTextSchema.ts).
 */
export {
  richTextSchemaExtensions,
  getRichTextSchema,
  RichContentIdentitySchema,
  type RichTextSchemaOptions,
} from "../../../src/features/exam-authoring/editor/schema/richTextSchema.js";

export { RICH_TEXT_BLOCK_TYPES } from "../../../src/features/exam-authoring/editor/richContentIdentity.js";

export {
  documentFromStructuredContent,
  structuredContentFromDocument,
  plainTextFromContent,
  hasStructuredContent,
} from "../../../src/features/exam-authoring/editor/richContent.js";
