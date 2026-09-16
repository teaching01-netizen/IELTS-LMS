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
  type ImportImageResolver,
  importAstToRichDocument,
  type TipTapJson,
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
  const preparedImages: Array<{
    refId: string;
    prepared: Extract<PreparedClipboardImageResult, { status: "accepted" }>;
  }> = [];
  const preparedByRef = new Map<
    string,
    Extract<PreparedClipboardImageResult, { status: "accepted" }>
  >();
  let rejectedImages = 0;

  const canStageImages = opts.capabilities.image && !target.inCodeBlock && !target.inTable;
  if (result.pendingImages.length > 0 && !canStageImages) {
    rejectedImages += result.pendingImages.length;
  } else if (result.pendingImages.length > 0) {
    for (const pending of result.pendingImages) {
      try {
        const staged = await prepareClipboardImage(
          editor,
          pending.file,
          opts.assetOwnerId ?? "",
          undefined,
          pending.alt
        );
        if (staged.status === "accepted") {
          preparedImages.push({ refId: pending.refId, prepared: staged });
          preparedByRef.set(pending.refId, staged);
        } else rejectedImages += 1;
      } catch {
        rejectedImages += 1;
      }
    }
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
    const usedPreparedRefs = new Set<string>();
    const imageResolver: ImportImageResolver = {
      resolve: (node): TipTapJson | null => {
        const refId = node.blobRef?.id;
        if (!refId) return null;
        const prepared = preparedByRef.get(refId);
        if (!prepared) return null;
        usedPreparedRefs.add(refId);
        return prepared.node as TipTapJson;
      },
    };
    const converted = target.inTable
      ? convertForTableCell(result.document, opts.capabilities, imageResolver)
      : importAstToRichDocument(result.document, opts.capabilities, imageResolver);
    const content = result.document.nodes.length > 0 ? [...(converted.doc.content ?? [])] : [];
    const nodes = content.map((node) => view.state.schema.nodeFromJSON(node));
    // File-only pastes are represented in the AST by ingestClipboard. Keep a
    // defensive tail fallback for legacy callers that still send only files.
    for (const image of preparedImages) {
      if (!usedPreparedRefs.has(image.refId)) {
        nodes.push(view.state.schema.nodeFromJSON(image.prepared.node));
      }
    }
    if (nodes.length === 0) return { handled: false, rejectedImages };

    // Insert a slice of content, not a nested doc or separate image/text
    // transactions that can overwrite each other's NodeSelection.
    const slice = Slice.maxOpen(Fragment.fromArray(nodes));
    const tr = closeHistory(view.state.tr).replaceSelection(slice);
    if (!tr.docChanged) return { handled: false, rejectedImages };
    view.dispatch(tr);
    for (const image of preparedImages) image.prepared.startUpload();
    preparedImages.length = 0;
    return { handled: true, rejectedImages };
  } catch {
    return { handled: false, rejectedImages: rejectedImages + preparedImages.length };
  } finally {
    for (const image of preparedImages) image.prepared.discard();
  }
}
