/**
 * Phase 07 — SmartDropPlugin (drop parity with paste).
 *
 * Internal ProseMirror drags (moved=true) pass through. External drops
 * reuse the same ingest+insert path at the DROP position (posAtCoords +
 * TextSelection.near), one transaction. Dragover toggles a tint class on
 * the closest [data-editor-surface="rich"] (fallback: view.dom).
 */
import { Extension, type Editor } from "@tiptap/react";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { RichComposerCapabilities } from "../RichQuestionComposer";
import type { IngestClipboardResult } from "../ingestion/application/ingestClipboard";
import { targetFromView } from "./smartPastePlugin";
import type { SmartPasteInsertOutcome, SmartPasteTarget } from "./smartPastePlugin";

export const DROP_TINT_CLASS = "sat-rich-editor--drop-target";

export interface SmartDropPluginOptions {
  capabilities: Readonly<RichComposerCapabilities>;
  assetOwnerId?: string | undefined;
  dropTintClass?: string | undefined;
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
  onSmartPaste?:
    | ((info: {
        source: string;
        imageCount: number;
        rejectedImageCount: number;
        canUndo: boolean;
      }) => void)
    | undefined;
}

function tintTarget(view: EditorView, on: boolean, tintClass: string): void {
  const host = view.dom.closest?.('[data-editor-surface="rich"]') ?? view.dom;
  if (on) host.classList.add(tintClass);
  else host.classList.remove(tintClass);
}

export const SmartDropPlugin = Extension.create<SmartDropPluginOptions>({
  name: "smartDrop",
  addProseMirrorPlugins() {
    const opts = this.options;
    const editor = this.editor;
    const tintClass = opts.dropTintClass ?? DROP_TINT_CLASS;
    return [
      new Plugin({
        props: {
          handleDrop: (view: EditorView, event: DragEvent, _slice, moved: boolean) => {
            if (moved) return false;
            const dt = event.dataTransfer;
            if (!dt) return false;
            const files = Array.from(dt.files ?? []).filter((f) => f instanceof File);
            const html = dt.getData("text/html") || null;
            const text = dt.getData("text/plain") || null;
            if (files.length === 0 && !html && !text) return false;
            event.preventDefault();
            tintTarget(view, false, tintClass);
            const target = targetFromView(view, opts.capabilities);
            let coords: { pos: number } | null = null;
            try {
              coords =
                typeof event.clientX === "number" && typeof event.clientY === "number"
                  ? view.posAtCoords({ left: event.clientX, top: event.clientY })
                  : null;
            } catch {
              coords = null;
            }
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
                if (coords && coords.pos >= 0) {
                  try {
                    view.dispatch(
                      view.state.tr.setSelection(
                        TextSelection.near(view.state.doc.resolve(coords.pos))
                      )
                    );
                  } catch {
                    /* keep selection */
                  }
                }
                const insertion = await opts.insert(editor, result, target);
                const outcome =
                  typeof insertion === "boolean"
                    ? { handled: insertion, rejectedImages: 0 }
                    : insertion;
                const rejectedImageCount = result.rejectedImages + outcome.rejectedImages;
                if (outcome.handled || rejectedImageCount > 0)
                  opts.onSmartPaste?.({
                    source: result.source,
                    imageCount: Math.max(0, result.stats.imageCount - outcome.rejectedImages),
                    rejectedImageCount,
                    canUndo: outcome.handled,
                  });
              } catch {
                /* leave doc untouched */
              }
            })();
            return true;
          },
          handleDOMEvents: {
            dragover: (view: EditorView, event: DragEvent) => {
              if (!event.dataTransfer) return;
              tintTarget(view, true, tintClass);
            },
            dragleave: (view: EditorView) => {
              tintTarget(view, false, tintClass);
            },
            drop: (view: EditorView) => {
              tintTarget(view, false, tintClass);
            },
          },
        },
      }),
    ];
  },
});
