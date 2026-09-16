/**
 * Phase 07 — SmartPastePlugin (thin ProseMirror interception).
 *
 * No parsing here: reads the DataTransfer ONCE (files/html/text),
 * delegates to ingestClipboard(), converts via importAstToRichDocument(),
 * inserts with ONE replaceSelection transaction. shiftKey returns false
 * BEFORE preventDefault (Cmd/Ctrl-Shift-V escape hatch). Async image
 * staging patches use addToHistory:false and never move the cursor.
 */
import { Extension, type Editor } from "@tiptap/react";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { RichComposerCapabilities } from "../RichQuestionComposer";
import type {
  IngestClipboardResult,
  IngestSource,
  IngestWarning,
} from "../ingestion/application/ingestClipboard";
import type { ImportDocument } from "../ingestion/domain/importDocument";
import { destroyTransientUploads } from "../ingestionImagePipe";

export interface SmartPasteTarget {
  inTable: boolean;
  inCodeBlock: boolean;
  inChoiceEditor: boolean;
}

export interface SmartPasteInsertOutcome {
  handled: boolean;
  rejectedImages: number;
}

export interface SmartPasteInfo {
  source: IngestSource;
  mathCount: number;
  imageCount: number;
  tableCount: number;
  needsAltText: boolean;
  canUndo: boolean;
  rejectedImageCount?: number;
  warnings: IngestWarning[];
  /** Normalized canonical paste (Phase-08 analysis input). Omitted only on legacy call sites. */
  document?: ImportDocument | undefined;
  /** Plain-text projection of the paste for detector convenience. */
  pastedPlainText?: string | undefined;
}

export interface SmartPastePluginOptions {
  capabilities: Readonly<RichComposerCapabilities>;
  assetOwnerId?: string | undefined;
  ingest: (req: {
    files: File[];
    html: string | null;
    text: string | null;
    ownerId: string | null;
    target: SmartPasteTarget;
  }) => Promise<IngestClipboardResult>;
  insert: (
    editor: Editor,
    result: IngestClipboardResult,
    target: SmartPasteTarget
  ) => boolean | SmartPasteInsertOutcome | Promise<boolean | SmartPasteInsertOutcome>;
  onSmartPaste?: ((info: SmartPasteInfo) => void) | undefined;
}

export function targetFromView(
  view: EditorView,
  capabilities: Readonly<RichComposerCapabilities>
): SmartPasteTarget {
  const { $from } = view.state.selection;
  let inTable = false;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === "table" || name === "tableRow" || name === "tableCell" || name === "tableHeader") {
      inTable = true;
      break;
    }
  }
  return {
    inTable,
    inCodeBlock: $from.parent.type.name === "codeBlock",
    inChoiceEditor: !capabilities.lists,
  };
}

export function readClipboardPayload(event: ClipboardEvent): {
  files: File[];
  html: string | null;
  text: string | null;
} {
  const dt = event.clipboardData;
  if (!dt) return { files: [], html: null, text: null };
  const files = Array.from(dt.files ?? []).filter(
    (f) => typeof File === "undefined" || f instanceof File
  );
  const readData = (format: string): string | null => {
    try {
      return dt.getData(format) || null;
    } catch {
      return null;
    }
  };
  const html = readData("text/html");
  const text = readData("text/plain");
  return { files, html, text };
}

export const SmartPastePlugin = Extension.create<SmartPastePluginOptions>({
  name: "smartPaste",
  onDestroy() {
    destroyTransientUploads(this.editor);
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste: (view: EditorView, event: ClipboardEvent) => {
            if ((event as ClipboardEvent & { shiftKey?: boolean }).shiftKey === true) return false;
            const { files, html, text } = readClipboardPayload(event);
            if (files.length === 0 && !html && !text) return false;
            event.preventDefault();
            const target = targetFromView(view, opts.capabilities);
            void (async () => {
              if (view.isDestroyed) return;
              try {
                const result = await opts.ingest({
                  files,
                  html,
                  text,
                  ownerId: opts.assetOwnerId ?? null,
                  target,
                });
                if (view.isDestroyed) return;
                if (
                  (result.source === "empty" || result.document.nodes.length === 0) &&
                  result.pendingImages.length === 0 &&
                  result.rejectedImages === 0
                )
                  return;
                const insertion = await opts.insert(editor, result, target);
                const outcome =
                  typeof insertion === "boolean"
                    ? { handled: insertion, rejectedImages: 0 }
                    : insertion;
                const rejectedImageCount = result.rejectedImages + outcome.rejectedImages;
                const acceptedImageCount = Math.max(
                  0,
                  result.stats.imageCount - outcome.rejectedImages
                );
                if (!outcome.handled && rejectedImageCount === 0) return;
                opts.onSmartPaste?.({
                  source: result.source,
                  mathCount: result.stats.mathCount,
                  imageCount: acceptedImageCount,
                  tableCount: result.stats.tableCount,
                  needsAltText: acceptedImageCount > 0,
                  canUndo: outcome.handled,
                  rejectedImageCount,
                  warnings: result.warnings,
                  document: result.document,
                  pastedPlainText: text ?? undefined,
                });
              } catch {
                if (!view.isDestroyed && text) view.dispatch(view.state.tr.insertText(text));
              }
            })();
            return true;
          },
        },
      }),
    ];
  },
});

export function setSelectionAfterInsert(view: EditorView, insertEnd: number): void {
  try {
    const resolved = view.state.doc.resolve(Math.min(insertEnd, view.state.doc.content.size));
    view.dispatch(view.state.tr.setSelection(TextSelection.near(resolved)));
  } catch {
    /* keep editor selection */
  }
}

export type { Slice };
