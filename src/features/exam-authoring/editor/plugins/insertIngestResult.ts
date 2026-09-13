/**
 * Phase 07 — single-transaction insert for ingestion results.
 *
 * Converts ImportDocument -> TipTap JSON and routes image files through the
 * validated upload pipe. Image upload state swaps are deliberately excluded
 * from history; the initial paste/stage transactions remain undoable.
 */
import { Fragment, Slice } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import type { Editor } from "@tiptap/react";
import type { RichComposerCapabilities } from "../RichQuestionComposer";
import type { IngestClipboardResult } from "../ingestion/application/ingestClipboard";
import {
  convertForTableCell,
  importAstToRichDocument,
} from "../ingestion/conversion/importAstToRichDocument";
import { prepareClipboardImage, type PreparedClipboardImageResult } from "../ingestionImagePipe";
import type { SmartPasteTarget } from "./smartPastePlugin";

export interface InsertIngestOptions {
  capabilities: Readonly<RichComposerCapabilities>;
  assetOwnerId?: string | undefined;
}

export interface InsertIngestOutcome {
  handled: boolean;
  rejectedImages: number;
}

export async function insertIngestResult(
  editor: Editor,
  result: IngestClipboardResult,
  target: SmartPasteTarget,
  opts: InsertIngestOptions
): Promise<InsertIngestOutcome> {
  if (editor.isDestroyed) return { handled: false, rejectedImages: 0 };
  const { view } = editor;
  const preparedImages: Array<Extract<PreparedClipboardImageResult, { status: "accepted" }>> = [];
  let rejectedImages = 0;

  if (result.pendingImages.length > 0 && !opts.capabilities.image) {
    rejectedImages += result.pendingImages.length;
  }

  if (result.pendingImages.length > 0 && opts.capabilities.image && !target.inCodeBlock) {
    for (const [index, file] of result.pendingImages.entries()) {
      try {
        const staged = await prepareClipboardImage(
          editor,
          file,
          opts.assetOwnerId ?? "",
          undefined,
          result.pendingImageAlts[index] ?? ""
        );
        if (staged.status === "accepted") preparedImages.push(staged);
        else rejectedImages += 1;
      } catch {
        rejectedImages += 1;
      }
    }
  } else if (target.inCodeBlock) {
    rejectedImages += result.pendingImages.length;
  }

  if (target.inCodeBlock) {
    const text = result.document.nodes
      .flatMap((node) => (node.kind === "paragraph" ? node.children : []))
      .map((child) =>
        child.kind === "text"
          ? child.text
          : child.kind === "inlineMath" || child.kind === "blockMath"
            ? child.latex
            : ""
      )
      .join("");
    if (!text) return { handled: false, rejectedImages };
    view.dispatch(view.state.tr.insertText(text));
    return { handled: true, rejectedImages };
  }

  try {
    if (editor.isDestroyed) return { handled: false, rejectedImages };
    const converted = target.inTable
      ? convertForTableCell(result.document, opts.capabilities)
      : importAstToRichDocument(result.document, opts.capabilities);
    const content = result.document.nodes.length > 0 ? [...(converted.doc.content ?? [])] : [];
    const nodes = content.map((node) => view.state.schema.nodeFromJSON(node));
    nodes.push(...preparedImages.map((image) => view.state.schema.nodeFromJSON(image.node)));
    if (nodes.length === 0) return { handled: false, rejectedImages };

    // Insert a slice of content, not a nested doc or separate image/text
    // transactions that can overwrite each other's NodeSelection.
    const slice = Slice.maxOpen(Fragment.fromArray(nodes));
    const tr = closeHistory(view.state.tr).replaceSelection(slice);
    if (!tr.docChanged) return { handled: false, rejectedImages };
    view.dispatch(tr);
    for (const image of preparedImages) image.startUpload();
    preparedImages.length = 0;
    return { handled: true, rejectedImages };
  } catch {
    return { handled: false, rejectedImages: rejectedImages + preparedImages.length };
  } finally {
    for (const image of preparedImages) image.discard();
  }
}
