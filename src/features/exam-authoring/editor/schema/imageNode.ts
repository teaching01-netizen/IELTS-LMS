// Shared image node definition.
//
// DOM-free and React-free on purpose: the Hocuspocus co-editing service
// imports it to convert prompt JSON to a Y.Doc in Node. The browser-only node
// view (asset resolution, upload placeholders) lives in
// ../SatImageExtension.tsx, which extends this same node.
import Image from "@tiptap/extension-image";
import { validateDurableImageSource } from "../ingestion/domain/imagePolicy";

// Renderable without the media service: http(s) and app-relative paths only.
// data:/blob: URLs are never rendered directly — pasted images must go through
// the upload pipeline (allowBase64:false) so unverified bytes cannot become
// publishable content and so no object-URL lifetime leaks into drafts.
export function isDirectImageSource(value: string): boolean {
  const validation = validateDurableImageSource(value);
  return validation.ok && (validation.kind === "https" || validation.kind === "relative");
}

export const SatImageNode = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: { default: null },
      caption: { default: null },
      // Transient upload state for clipboard image paste. The pipe inserts a
      // temp node with uploadId/uploading set, then swaps attrs with
      // addToHistory:false so the paste stays one undo step. Undeclared attrs
      // are dropped by the schema, so these must be declared or the transient
      // state vanishes silently.
      uploadId: { default: null },
      uploading: { default: false },
      uploadError: { default: null },
    };
  },
});
