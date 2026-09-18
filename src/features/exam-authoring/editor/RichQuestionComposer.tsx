import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Extensions, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Sigma } from "lucide-react";
import type { RichTextDocument, StructuredContent } from "../contracts/assessment";
import {
  assetSource,
  documentFromStructuredContent,
  structuredContentFromDocument,
} from "./richContent";
import { SatImage } from "./SatImageExtension";
import { EditableBlockMath, EditableInlineMath } from "./EditableMathExtension";
import { getAssessmentMediaAsset, uploadAssessmentAsset } from "../api/assessmentMediaApi";
import { AuthoringDialog } from "../ui/authoringPrimitives";
import { authoringMotion } from "@/src/shared/motion";
import { RichContentIdentity } from "./RichContentIdentityExtension";
import { richTextSchemaExtensions } from "./schema/richTextSchema";
import { ComposerToolbar } from "./ComposerToolbar";
import { type ComposerContext, type ImageDialogMode } from "./composerContext";
import { EditorContextualSurfaces } from "./EditorContextualSurfaces";
import { defaultHintStore, type OneTimeHintStore } from "./oneTimeHints";
import { isDirectImageSource } from "./schema/imageNode";
import { SmartPastePlugin } from "./plugins/smartPastePlugin";
import { SmartDropPlugin } from "./plugins/smartDropPlugin";
import { LatexPasteRule } from "./plugins/latexPasteRule";
import { insertIngestResult } from "./plugins/insertIngestResult";
import { importImageSource, ImageSourceError } from "./ingestion/application/imageImport";
import { ingestClipboard } from "./ingestion/application/ingestClipboard";
import { createPipelineContext } from "./ingestion/application/pipelineContext";
import {
  buildActionFeedback,
  buildPasteFeedback,
  type EditorFeedbackInput,
  type EditorFeedbackItem,
  type EditorFeedbackPublisher,
} from "./editorFeedbackCopy";
import {
  stripTransientImages,
  validateSatImageFile,
  type ImageRejectCode,
} from "./ingestion/adapters/imageValidation";
import { SAT_IMAGE_POLICY, validateDurableImageSource } from "./ingestion/domain/imagePolicy";
import { isCollaborativeTransaction } from "../realtime/coedit";

// The node/mark vocabulary comes from ./schema/richTextSchema.ts, the exact
// same list the Hocuspocus co-editing service builds. The browser substitutes
// its node-view variants for math and images (same node names and attributes)
// and its identity extension (same attribute, plus the id-assignment plugin).
const baseExtensions = [
  RichContentIdentity,
  ...richTextSchemaExtensions({ identity: false, math: false, image: false }),
  EditableInlineMath,
  EditableBlockMath,
  SatImage,
];

// Collaborative variant: Yjs owns history once Collaboration is bound, so
// StarterKit's undo/redo must NOT be registered. Two independent history stacks
// corrupt each other's undo ("Frontend ownership", docs/sat-authoring-coedit.md).
const collaborativeBaseExtensions = [
  RichContentIdentity,
  ...richTextSchemaExtensions({ identity: false, math: false, image: false, history: false }),
  EditableInlineMath,
  EditableBlockMath,
  SatImage,
];

/**
 * The base extension list for a mode. Exported so a test can assert the
 * collaborative set really has no independent undo history, instead of trusting
 * the flag: two history stacks corrupt each other's undo under a CRDT.
 */
export function composerBaseExtensions(collaborative: boolean): Extensions {
  return collaborative ? collaborativeBaseExtensions : baseExtensions;
}

type Dialog = "math" | "image" | null;
type MathDialogTarget =
  | { mode: "insert"; display: boolean; latex: string }
  | { mode: "edit"; display: boolean; latex: string; pos: number };

export interface RichComposerCapabilities {
  blockStyles: boolean;
  lists: boolean;
  underline: boolean;
  equation: boolean;
  image: boolean;
  table: boolean;
  code: boolean;
  history: boolean;
}

export const SAT_RICH_COMPOSER_CAPABILITIES: Readonly<RichComposerCapabilities> = Object.freeze({
  blockStyles: true,
  lists: true,
  underline: true,
  equation: true,
  image: true,
  table: true,
  code: true,
  history: true,
});

export const SAT_CHOICE_COMPOSER_CAPABILITIES: Readonly<RichComposerCapabilities> = Object.freeze({
  blockStyles: false,
  lists: false,
  underline: true,
  equation: true,
  image: true,
  table: true,
  code: true,
  history: true,
});

export interface SmartPasteStatus {
  visible: boolean;
  source: string | null;
  imageCount: number;
  mathCount: number;
  needsAltText: boolean;
  canUndo?: boolean;
  rejectedImageCount?: number;
  /** Normalized canonical paste (Phase-08 analysis input). */
  document?: import("./ingestion/domain/importDocument").ImportDocument | undefined;
  /** Plain-text projection of the paste for detector convenience. */
  pastedPlainText?: string | undefined;
}

export interface RichQuestionComposerProps {
  value: StructuredContent;
  onChange: (value: StructuredContent) => void;
  /** Called only for an author-originated transaction in a collaborative editor. */
  onLocalChange?: ((value: StructuredContent) => void) | undefined;
  label: string;
  placeholder?: string;
  compact?: boolean;
  minHeightClassName?: string;
  assetOwnerId?: string;
  capabilities?: Readonly<RichComposerCapabilities>;
  smartPaste?: boolean;
  onSmartPaste?: ((info: SmartPasteStatus) => void) | undefined;
  /**
   * Where "you have already seen this" is remembered. Injected so the composer
   * never reaches for browser storage itself and tests can use a fake; the
   * default is a lazily created localStorage-backed store.
   */
  hintStore?: OneTimeHintStore | undefined;
  /**
   * Prompt co-editing binding, supplied by the co-edit package (the only
   * package that knows about Yjs and Hocuspocus). When present the composer:
   *
   *   - binds the shared `prompt` field to the collaborative document;
   *   - adds the caret extension for remote collaborators;
   *   - mounts only AFTER the provider reports initial sync, so an empty Yjs
   *     document is never rendered as an editable prompt;
   *   - drops the legacy `value -> setContent` effect (the Y.Doc is the
   *     source of truth);
   *   - still emits a structured projection for preview/validation, but that
   *     projection no longer schedules whole-question autosave.
   *
   * Absent => byte-for-byte the pre-co-editing behavior.
   */
  collaboration?: RichComposerCollaboration | undefined;
}

function firstImageWithoutAlt(editor: Editor): number | null {
  let position: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (position !== null) return false;
    if (node.type.name === "image" && !String(node.attrs["alt"] ?? "").trim()) {
      position = pos;
      return false;
    }
    return undefined;
  });
  return position;
}

/** Domain-facing collaboration binding handed to the composer. */
export interface RichComposerCollaboration {
  /** Collaboration + caret extensions built by the co-edit package. */
  extensions: Extensions;
  /** True once the provider has completed initial sync with the service. */
  ready: boolean;
  /** Read-only collaborators (observers, frozen rooms) cannot type. */
  readOnly?: boolean;
}

export function RichQuestionComposer({
  value,
  onChange,
  onLocalChange,
  label,
  // Transient, and only as long as it needs to be: as soon as the author types
  // or pastes, the instruction is gone. No permanent helper paragraph.
  placeholder = "Write or paste…",
  compact = false,
  minHeightClassName = "min-h-[132px]",
  assetOwnerId,
  capabilities = SAT_RICH_COMPOSER_CAPABILITIES,
  smartPaste = true,
  onSmartPaste,
  hintStore,
  collaboration,
}: RichQuestionComposerProps) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogContext, setDialogContext] = useState<ComposerContext>({ kind: "text" });
  const [tableFeedback, setTableFeedback] = useState(false);
  const [feedback, setFeedback] = useState<EditorFeedbackItem | null>(null);
  const feedbackSequence = useRef(0);
  const editorRef = useRef<Editor | null>(null);
  // The hint store is created once, at the composition boundary: the editor
  // never reaches for browser storage on its own.
  const hintStoreRef = useRef<OneTimeHintStore | null>(null);
  if (!hintStoreRef.current) hintStoreRef.current = hintStore ?? defaultHintStore();
  const openAltTextRef = useRef<(() => void) | null>(null);
  const nextFeedbackId = () => `feedback-${(feedbackSequence.current += 1)}`;
  const undoLastChange = () => {
    setFeedback(null);
    editorRef.current?.chain().focus().undo().run();
  };
  /** Raises one acknowledgement, replacing whatever was showing. */
  const publishFeedback = (input: EditorFeedbackInput) => {
    setFeedback(buildActionFeedback(input, nextFeedbackId(), undoLastChange));
  };
  // The paste plugins are frozen at construction, so their acknowledgement goes
  // through a ref that always points at the newest render's publisher.
  const publishFeedbackRef = useRef<EditorFeedbackPublisher>(() => {});
  publishFeedbackRef.current = publishFeedback;
  const publishPasteFeedbackRef = useRef<(status: SmartPasteStatus) => void>(() => {});
  publishPasteFeedbackRef.current = (status: SmartPasteStatus) => {
    const item = buildPasteFeedback(
      status,
      { onUndo: undoLastChange, onAddAltText: () => openAltTextRef.current?.() },
      nextFeedbackId()
    );
    if (item) setFeedback(item);
  };
  const [initialContent] = useState(() => documentFromStructuredContent(value));
  const ingestRef = useRef(ingestClipboard);
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  const assetOwnerRef = useRef(assetOwnerId);
  assetOwnerRef.current = assetOwnerId;
  const smartPasteRef = useRef(smartPaste);
  smartPasteRef.current = smartPaste;
  const onSmartPasteRef = useRef(onSmartPaste);
  onSmartPasteRef.current = onSmartPaste;
  const onLocalChangeRef = useRef(onLocalChange);
  onLocalChangeRef.current = onLocalChange;
  // Identity of the collaboration extension list, not of the binding object:
  // rebuilding extensions on every save-state change would destroy and recreate
  // the editor on each acknowledgement.
  const collaborationExtensions = collaboration?.extensions;
  const collaborative = collaboration !== undefined;
  const collaborationReady = collaboration?.ready ?? false;
  const collaborationReadOnly = Boolean(collaboration?.readOnly);
  // A collaborative editor is EMPTY until the room's document is applied, and
  // Tiptap emits an update for the initial CRDT apply as well as for
  // `setEditable`. Emitting those would replace the author's prompt projection
  // with nothing (and schedule a legacy save of it), so the projection is
  // withheld until the room reports initial sync.
  const mayProjectRef = useRef(!collaboration || collaboration.ready);
  mayProjectRef.current = !collaboration || collaboration.ready;
  const editorExtensions = useMemo(
    () => [
      ...composerBaseExtensions(collaborative),
      ...(collaborationExtensions ?? []),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
      SmartPastePlugin.configure({
        capabilities,
        ...(assetOwnerId ? { assetOwnerId } : {}),
        ingest: (req) =>
          smartPasteRef.current
            ? ingestRef.current(
                req,
                createPipelineContext({
                  field: capabilitiesRef.current.lists ? "prompt" : "choice",
                  capabilities: { ...capabilitiesRef.current },
                })
              )
            : Promise.resolve({
                document: {
                  version: 1 as const,
                  nodes: [],
                  sourceMeta: {
                    source: "text" as const,
                    confidence: 0 as const,
                    transformations: [],
                  },
                },
                source: "empty" as const,
                pendingImages: [],
                warnings: [],
                transformations: [],
                rejectedImages: 0,
                stats: { blockCount: 0, imageCount: 0, mathCount: 0, tableCount: 0 },
              }),
        insert: (editor, result, target) =>
          insertIngestResult(editor, result, target, {
            capabilities: capabilitiesRef.current,
            ...(assetOwnerRef.current ? { assetOwnerId: assetOwnerRef.current } : {}),
          }),
        onSmartPaste: (info) => {
          const status: SmartPasteStatus = {
            visible: true,
            source: info.source,
            imageCount: info.imageCount,
            mathCount: info.mathCount,
            needsAltText: info.needsAltText,
            canUndo: info.canUndo,
            ...(info.rejectedImageCount !== undefined
              ? { rejectedImageCount: info.rejectedImageCount }
              : {}),
            ...(info.document ? { document: info.document } : {}),
            ...(info.pastedPlainText ? { pastedPlainText: info.pastedPlainText } : {}),
          };
          publishPasteFeedbackRef.current(status);
          onSmartPasteRef.current?.(status);
        },
      }),
      SmartDropPlugin.configure({
        capabilities,
        ...(assetOwnerId ? { assetOwnerId } : {}),
        ingest: (req) =>
          ingestRef.current(
            req,
            createPipelineContext({
              field: capabilitiesRef.current.lists ? "prompt" : "choice",
              capabilities: { ...capabilitiesRef.current },
            })
          ),
        insert: (editor, result, target) =>
          insertIngestResult(editor, result, target, {
            capabilities: capabilitiesRef.current,
            ...(assetOwnerRef.current ? { assetOwnerId: assetOwnerRef.current } : {}),
          }),
        onSmartPaste: (info) => {
          const status: SmartPasteStatus = {
            visible: true,
            source: info.source,
            imageCount: info.imageCount,
            mathCount: 0,
            needsAltText: info.imageCount > 0,
            canUndo: info.canUndo,
            ...(info.rejectedImageCount > 0 ? { rejectedImageCount: info.rejectedImageCount } : {}),
          };
          publishPasteFeedbackRef.current(status);
          onSmartPasteRef.current?.(status);
        },
      }),
      // Typed LaTeX (`\(x^2\)`, `$$y=mx+b$$`) converts in place; the author is
      // told once, quietly, with the way back — that is the whole tutorial.
      LatexPasteRule.configure({
        enabled: capabilities.equation,
        onConvert: () => publishFeedbackRef.current({ message: "Converted to equation", undoable: true }),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable plugin identity; runtime opts flow via refs
    [collaborative, placeholder, collaborationExtensions]
  );
  const editor = useEditor(
    {
      extensions: editorExtensions,
      // Collaborative mode never seeds from props: the Y.Doc (seeded by the
      // service when the room first opens) is the single source of truth, and
      // passing `content` would race the initial sync.
      ...(collaboration ? {} : { content: initialContent as JSONContent }),
      immediatelyRender: false,
      editable: !collaborationReadOnly,
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": label,
          "data-placeholder": placeholder,
          class: `${minHeightClassName} sat-rich-editor__input`,
        },
      },
      onUpdate: ({ editor: current, transaction }) => {
        if (!mayProjectRef.current) return;
        // Keep upload placeholders in the live editor, never in autosave data.
        const { doc } = stripTransientImages(current.getJSON() as RichTextDocument);
        const next = structuredContentFromDocument(doc);
        onChange(next);
        if (collaboration) {
          // A collaborator's edit arrives as a transaction the author did not
          // make, and must not be persisted as one. Undo/redo also arrives
          // marked, but IS an author action. Which transactions carry that mark
          // is the co-editing package's business — this file stays free of the
          // transport, and the architecture rule keeps it that way.
          if (!isCollaborativeTransaction(transaction)) onLocalChangeRef.current?.(next);
        } else {
          onLocalChangeRef.current?.(next);
        }
      },
    },
    // Tiptap only rebuilds its extensions via `setOptions` for a MINOR subset of
    // options; the schema and plugins are fixed at construction. A provider is
    // created asynchronously (the token round-trip precedes it), so the editor
    // routinely mounts before the binding exists, and a retry after a rejected
    // session creates a NEW room with a NEW Y.Doc. Without these deps the editor
    // would keep the first (unbound) extension list forever and no remote edit
    // would ever appear. Identity is per room, so acknowledgement updates do not
    // recreate the editor.
    [collaborative, collaborationExtensions]
  );

  useEffect(() => {
    // Non-collaborative only. In collaborative mode the projection is emitted
    // for preview/validation but the legacy prop-driven setContent is disabled:
    // writing props back into the doc would fight the CRDT.
    if (collaboration) return;
    if (!editor || editor.isFocused) return;
    const next = documentFromStructuredContent(value);
    const { doc } = stripTransientImages(editor.getJSON() as RichTextDocument);
    if (JSON.stringify(doc) !== JSON.stringify(next)) {
      editor.commands.setContent(next as JSONContent, { emitUpdate: false });
    }
  }, [collaboration, editor, value]);

  useEffect(() => {
    if (!editor || !collaborative || !collaborationReady) return;
    // The pre-sync surface is a skeleton: nothing is editable yet, and the
    // call would emit an update for the still-empty collaborative document.
    // The binding object is recreated when presence/save state changes, so
    // depend only on the state that can actually change editor editability.
    if (editor.isEditable !== !collaborationReadOnly) {
      editor.setEditable(!collaborationReadOnly, false);
    }
  }, [collaborationReadOnly, collaborationReady, collaborative, editor]);

  const flashTableFeedback = () => {
    setTableFeedback(false);
    window.requestAnimationFrame(() => {
      setTableFeedback(true);
      window.setTimeout(() => setTableFeedback(false), 240);
    });
  };

  // An empty Yjs document is never rendered as an editable prompt while seed
  // status is unresolved: the composer shows the loading surface until the
  // provider reports initial sync.
  if (collaboration && !collaboration.ready) {
    return (
      <div
        data-editor-surface="rich"
        data-coedit-pending="true"
        aria-busy="true"
        className={`${minHeightClassName} animate-pulse rounded-xl bg-au-fill`}
      />
    );
  }

  if (!editor) {
    return <div className={`${minHeightClassName} animate-pulse rounded-xl bg-au-fill`} />;
  }

  editorRef.current = editor;

  const openImageDialog = (context: Extract<ComposerContext, { kind: "image" }>, mode: ImageDialogMode) => {
    setDialogContext({ ...context, mode });
    setDialog("image");
  };

  const openAltTextForFirstMissingImage = () => {
    const position = firstImageWithoutAlt(editor);
    if (position === null) return;
    const node = editor.state.doc.nodeAt(position);
    if (!node || node.type.name !== "image") return;
    editor.chain().focus().setNodeSelection(position).run();
    setFeedback(null);
    openImageDialog({ kind: "image", pos: position, attrs: { ...(node.attrs as Record<string, unknown>) } }, "alt");
  };
  openAltTextRef.current = openAltTextForFirstMissingImage;

  return (
    <div
      data-editor-surface="rich"
      data-compact={compact ? "true" : undefined}
      data-table-feedback={tableFeedback ? "true" : undefined}
      className="sat-rich-editor"
    >
      <ComposerToolbar
        editor={editor}
        capabilities={capabilities}
        onOpenDialog={(next, context) => {
          setDialogContext(context ?? { kind: "text" });
          setDialog(next);
        }}
        onTableMutation={flashTableFeedback}
        onFeedback={publishFeedback}
      />
      <EditorContent editor={editor} className="sat-rich-editor__content" />
      {/*
       * The contextual surfaces of the interaction model: text formatting next
       * to the text, object controls attached to the object. Neither joins the
       * toolbar, which is what keeps Bold where the author learned it, and the
       * persistent toolbar stays the fallback — core formatting never depends
       * on a floating surface.
       */}
      <EditorContextualSurfaces
        editor={editor}
        capabilities={capabilities}
        feedback={feedback}
        onDismissFeedback={() => setFeedback(null)}
        hintStore={hintStoreRef.current ?? defaultHintStore()}
        onOpenImageDialog={openImageDialog}
        onEditEquation={(context) => {
          setDialogContext(context);
          setDialog("math");
        }}
        onFeedback={publishFeedback}
        resolveAsset={getAssessmentMediaAsset}
      />
      <AnimatePresence>
        {dialog === "math" ? (
          <MathDialog
            editor={editor}
            target={
              dialogContext.kind === "equation"
                ? {
                    mode: "edit",
                    display: dialogContext.display,
                    latex: dialogContext.latex,
                    pos: dialogContext.pos,
                  }
                : { mode: "insert", display: false, latex: "" }
            }
            onClose={() => setDialog(null)}
          />
        ) : null}
        {dialog === "image" ? (
          <ImageDialog
            editor={editor}
            target={dialogContext.kind === "image" ? dialogContext : undefined}
            {...(assetOwnerId ? { ownerId: assetOwnerId } : {})}
            onFeedback={publishFeedback}
            onClose={() => setDialog(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const equationStructures = [
  { label: "Fraction", latex: "\\frac{a}{b}", select: "a" },
  { label: "Exponent", latex: "x^{n}", select: "n" },
  { label: "Square root", latex: "\\sqrt{x}", select: "x" },
  { label: "Subscript", latex: "x_{1}", select: "1" },
  { label: "Absolute", latex: "\\lvert x \\rvert", select: "x" },
] as const;

const equationSymbols = [
  { label: "π", latex: "\\pi " },
  { label: "≤", latex: "\\le " },
  { label: "≥", latex: "\\ge " },
  { label: "≠", latex: "\\ne " },
  { label: "±", latex: "\\pm " },
  { label: "°", latex: "^{\\circ}" },
] as const;

function MathDialog({
  editor,
  target,
  onClose,
}: {
  editor: Editor;
  target: MathDialogTarget;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [latex, setLatex] = useState(target.latex);
  const [display, setDisplay] = useState(target.display);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const equation = useMemo(() => {
    const expression = latex.trim();
    if (!expression) return { html: null, error: null };
    try {
      return {
        html: katex.renderToString(expression, {
          throwOnError: true,
          displayMode: display,
          strict: false,
        }),
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Check the equation syntax.";
      return {
        html: null,
        error: message.replace(/^KaTeX parse error:\s*/i, ""),
      };
    }
  }, [display, latex]);
  const canCommit = Boolean(equation.html && latex.trim());
  const isEditing = target.mode === "edit";

  const insertSnippet = (snippet: string, selectToken?: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? latex.length;
    const end = input?.selectionEnd ?? latex.length;
    const next = `${latex.slice(0, start)}${snippet}${latex.slice(end)}`;
    setLatex(next);
    window.requestAnimationFrame(() => {
      const nextInput = inputRef.current;
      if (!nextInput) return;
      nextInput.focus();
      const tokenIndex = selectToken ? snippet.indexOf(selectToken) : -1;
      if (selectToken && tokenIndex >= 0) {
        nextInput.setSelectionRange(start + tokenIndex, start + tokenIndex + selectToken.length);
      } else {
        const cursor = start + snippet.length;
        nextInput.setSelectionRange(cursor, cursor);
      }
    });
  };

  const commitEquation = () => {
    if (!canCommit) return;
    const expression = latex.trim();
    const chain = editor.chain().focus();
    if (target.mode === "edit") {
      if (target.display) chain.updateBlockMath({ latex: expression, pos: target.pos }).run();
      else chain.updateInlineMath({ latex: expression, pos: target.pos }).run();
    } else if (display) {
      chain.insertBlockMath({ latex: expression }).run();
    } else {
      chain.insertInlineMath({ latex: expression }).run();
    }
    onClose();
  };

  const placementDescription = display
    ? "Places the equation on its own line for larger or important expressions."
    : "Keeps the equation in the flow of a sentence.";

  return (
    <DialogFrame
      title={isEditing ? "Edit equation" : "Insert equation"}
      onClose={onClose}
      dismissOnBackdrop={false}
      widthClassName="max-w-xl"
    >
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[12px] font-semibold text-slate-700">Placement</span>
            {isEditing ? (
              <span className="text-[11px] text-slate-400">
                Placement stays fixed while editing
              </span>
            ) : null}
          </div>
          <div
            className="authoring-segmented inline-flex rounded-full p-1"
            aria-label="Equation placement"
          >
            <EquationPlacementButton
              active={!display}
              disabled={isEditing && target.display}
              onClick={() => setDisplay(false)}
            >
              Inline
            </EquationPlacementButton>
            <EquationPlacementButton
              active={display}
              disabled={isEditing && !target.display}
              onClick={() => setDisplay(true)}
            >
              Display
            </EquationPlacementButton>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-slate-500">{placementDescription}</p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[12px] font-semibold text-slate-700">Quick build</span>
            <span className="text-[11px] text-slate-400">Optional</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {equationStructures.map((item) => (
              <EquationChip
                key={item.label}
                label={item.label}
                onClick={() => insertSnippet(item.latex, item.select)}
              />
            ))}
            <span className="mx-0.5 h-8 w-px bg-au-separator" aria-hidden="true" />
            {equationSymbols.map((item) => (
              <EquationChip
                key={item.label}
                label={item.label}
                symbol
                onClick={() => insertSnippet(item.latex)}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span
              id="sat-equation-latex-label"
              className="text-[12px] font-semibold text-slate-700"
            >
              Equation
            </span>
            <span className="text-[11px] text-slate-400">LaTeX · no $ delimiters</span>
          </div>
          <textarea
            ref={inputRef}
            id="sat-equation-latex"
            aria-labelledby="sat-equation-latex-label"
            data-dialog-initial-focus
            value={latex}
            onChange={(event) => setLatex(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                commitEquation();
              }
            }}
            rows={3}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={Boolean(equation.error)}
            aria-describedby={equation.error ? "sat-equation-error" : "sat-equation-help"}
            placeholder="Example: \\frac{x+1}{2}=8"
            className={`w-full resize-y rounded-[13px] border bg-au-fill px-3.5 py-3 font-mono text-[14px] leading-6 text-slate-950 outline-none transition placeholder:text-slate-400 focus:bg-au-surface focus:ring-4 ${
              equation.error
                ? "border-au-danger/40 focus:border-au-danger focus:ring-au-danger-tint"
                : "border-transparent focus:border-au-accent/35 focus:ring-au-accent/10"
            }`}
          />
          <div className="mt-1.5 min-h-5" aria-live="polite">
            {equation.error ? (
              <p id="sat-equation-error" className="text-[11px] leading-5 text-au-danger-text">
                {equation.error}
              </p>
            ) : (
              <p id="sat-equation-help" className="text-[11px] leading-5 text-slate-400">
                Use the quick controls or type LaTeX directly. Press ⌘Return to{" "}
                {isEditing ? "update" : "insert"}.
              </p>
            )}
          </div>
        </div>

        <div>
          <span className="mb-2 block text-[12px] font-semibold text-slate-700">Preview</span>
          <motion.div
            layout={!reduceMotion}
            transition={reduceMotion ? { duration: 0.01 } : authoringMotion.state}
            className={`flex min-h-28 overflow-x-auto rounded-[15px] border border-au-separator bg-au-fill p-5 ${
              display ? "items-center justify-center text-center" : "items-center justify-start"
            }`}
          >
            {equation.html ? (
              <motion.div
                key={`${display}-${latex}`}
                initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0.45, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                transition={reduceMotion ? { duration: 0.01 } : authoringMotion.state}
                className="max-w-full text-slate-950"
                dangerouslySetInnerHTML={{ __html: equation.html }}
              />
            ) : (
              <div className="mx-auto flex flex-col items-center gap-2 text-center text-slate-400">
                <Sigma size={20} strokeWidth={1.7} aria-hidden="true" />
                <span className="text-[11px]">
                  {latex.trim()
                    ? "Complete the expression to preview"
                    : "Your equation will appear here"}
                </span>
              </div>
            )}
          </motion.div>
        </div>

        <div className="flex items-center justify-between border-t border-au-separator pt-4">
          <span className="hidden text-[11px] text-slate-400 sm:inline">
            Esc to cancel · ⌘Return to {isEditing ? "update" : "insert"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="authoring-interactive h-10 rounded-full px-4 text-[12px] font-semibold text-slate-600 hover:bg-au-fill"
            >
              Cancel
            </button>
            <motion.button
              type="button"
              whileTap={reduceMotion ? {} : authoringMotion.press}
              transition={reduceMotion ? { duration: 0.01 } : authoringMotion.fast}
              disabled={!canCommit}
              onClick={commitEquation}
              className="authoring-interactive h-10 rounded-full bg-au-accent px-4 text-[12px] font-semibold text-white shadow-sm hover:bg-au-accent-hover disabled:cursor-default disabled:opacity-35"
            >
              {isEditing ? "Update equation" : "Insert equation"}
            </motion.button>
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}

function EquationPlacementButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-8 rounded-full px-3.5 text-[12px] font-semibold transition disabled:cursor-default disabled:opacity-30 ${
        active ? "bg-au-surface text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

function EquationChip({
  label,
  symbol = false,
  onClick,
}: {
  label: string;
  symbol?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`authoring-interactive h-8 rounded-lg bg-au-fill px-2.5 text-[11px] font-medium text-slate-600 hover:bg-au-fill hover:text-slate-950 ${
        symbol ? "min-w-8 font-serif text-[14px]" : ""
      }`}
      title={symbol ? `Insert ${label}` : `Insert ${label.toLowerCase()} structure`}
    >
      {label}
    </button>
  );
}

function ImageDialog({
  editor,
  ownerId,
  target,
  onFeedback,
  onClose,
}: {
  editor: Editor;
  ownerId?: string;
  target?: Extract<ComposerContext, { kind: "image" }> | undefined;
  onFeedback?: EditorFeedbackPublisher | undefined;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const initialTargetAssetId = String(target?.attrs["assetId"] ?? "");
  const initialTargetSource = String(target?.attrs["src"] ?? "");
  const initialAssetId =
    initialTargetAssetId ||
    (isDirectImageSource(initialTargetSource) ? initialTargetSource : "");
  const [assetId, setAssetId] = useState(initialAssetId);
  const [alt, setAlt] = useState(String(target?.attrs["alt"] ?? ""));
  const [caption, setCaption] = useState(String(target?.attrs["caption"] ?? ""));
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<
    { code: ImageRejectCode | "upload" | "source" | "import"; message: string } | null
  >(null);

  const liveTargetAssetId = target
    ? String(editor.state.doc.nodeAt(target.pos)?.attrs["assetId"] ?? "")
    : "";

  useEffect(() => {
    // Pasted images upload in the background. Keep the dialog actionable while
    // the author types alt text, then adopt the real asset ID once the upload
    // resolves instead of ever persisting a transient blob URL.
    if (liveTargetAssetId && liveTargetAssetId !== assetId) setAssetId(liveTargetAssetId);
  }, [assetId, liveTargetAssetId, target?.pos]);

  useEffect(() => {
    return () => {
      const current = previewUrlRef.current;
      if (current) URL.revokeObjectURL(current);
      previewUrlRef.current = null;
    };
  }, []);

  const releasePreview = () => {
    const current = previewUrlRef.current;
    if (current) URL.revokeObjectURL(current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
  };

  const handleUpload = async (file: File) => {
    if (!ownerId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const validation = await validateSatImageFile(file);
      if (!validation.ok) {
        releasePreview();
        setUploadError({ code: validation.code, message: validation.message });
        return;
      }
      const asset = await uploadAssessmentAsset(file, ownerId);
      setAssetId(asset.id);
      releasePreview();
    } catch (error) {
      releasePreview();
      setUploadError({
        code: "upload",
        message: error instanceof Error ? error.message : "Image upload failed.",
      });
    } finally {
      setUploading(false);
    }
  };

  const chooseFile = (file: File) => {
    releasePreview();
    setSelectedFile(file);
    const nextPreviewUrl = URL.createObjectURL(file);
    previewUrlRef.current = nextPreviewUrl;
    setPreviewUrl(nextPreviewUrl);
    void handleUpload(file);
  };

  // The dialog is one component with three intents: inserting a visual,
  // replacing the one that is selected, and describing it. The title and where
  // focus lands follow the intent, so "Replace" does not open a form about alt
  // text, and the whole thing still shares one implementation.
  const mode: ImageDialogMode = target?.mode ?? (target ? "alt" : "insert");
  const dialogTitle =
    mode === "replace" ? "Replace visual" : mode === "alt" ? "Describe this visual" : "Insert image or graph";

  const handleInsert = async () => {
    const source = assetId.trim();
    const alternativeText = alt.trim();
    if (!source || !alternativeText || uploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      let durableAssetId = source;
      if (ownerId) {
        const asset = await importImageSource({ source, ownerId });
        durableAssetId = asset.id;
        setAssetId(asset.id);
      } else if (!validateDurableImageSource(source).ok) {
        throw new ImageSourceError("source", "Use an existing asset ID or an HTTPS image URL.");
      }
      const attrs = {
        ...target?.attrs,
        src: assetSource(durableAssetId),
        alt: alternativeText,
        assetId: durableAssetId,
        caption: caption.trim() || null,
      };
      if (!attrs.src) {
        throw new ImageSourceError("source", "Use an existing asset ID or an HTTPS image URL.");
      }
      if (target && editor.state.doc.nodeAt(target.pos)?.type.name === "image") {
        editor
          .chain()
          .focus()
          .setNodeSelection(target.pos)
          .updateAttributes("image", attrs)
          .run();
        onFeedback?.({ message: "Image replaced", undoable: true });
      } else if (!target) {
        // The placeholder already reserved the object's space; the document now
        // holds it, and the acknowledgement says so quietly.
        editor.chain().focus().insertContent({ type: "image", attrs }).run();
        onFeedback?.({ message: "Image added", undoable: true });
      }
      onClose();
    } catch (error) {
      setUploadError({
        code: error instanceof ImageSourceError ? error.code : "import",
        message: error instanceof Error ? error.message : "The image could not be inserted.",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <DialogFrame title={dialogTitle} onClose={onClose}>
      {ownerId ? (
        <label
          htmlFor="sat-visual-upload"
          className="authoring-interactive mb-4 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-au-separator-strong bg-au-fill px-4 py-4 text-xs font-semibold text-slate-600 hover:border-au-accent/35 hover:bg-au-fill-strong"
        >
          <input
            id="sat-visual-upload"
            aria-label="Upload image or graph"
            type="file"
            accept={SAT_IMAGE_POLICY.allowedMime.join(",")}
            className="sr-only"
            data-dialog-initial-focus={mode === "replace" ? true : undefined}
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) chooseFile(file);
              event.currentTarget.value = "";
            }}
          />
          {uploading
            ? "Uploading visual…"
            : selectedFile
              ? "Choose another visual"
              : "Upload image / graph"}
        </label>
      ) : null}

      <AnimatePresence initial={false}>
        {previewUrl ? (
          <motion.div
            initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -4 }}
            transition={reduceMotion ? { duration: 0.01 } : authoringMotion.surface}
            className="relative mb-4 overflow-hidden rounded-xl border border-au-separator bg-au-fill"
          >
            <img
              src={previewUrl}
              alt="Local upload preview"
              className="max-h-52 w-full object-contain"
            />
            <AnimatePresence>
              {uploading ? (
                <motion.div
                  initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
                  className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-au-fill-strong"
                >
                  <motion.span
                    initial={{ x: "-100%" }}
                    animate={reduceMotion ? { x: "0%" } : { x: "260%" }}
                    transition={
                      reduceMotion
                        ? { duration: 0.01 }
                        : { duration: 1.05, ease: "easeInOut", repeat: Infinity }
                    }
                    className="block h-full w-1/3 bg-au-accent"
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
            {!uploading && assetId && !uploadError ? (
              <motion.span
                initial={reduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.82 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={reduceMotion ? { duration: 0.01 } : authoringMotion.spring}
                className="absolute right-2 top-2 rounded-full bg-au-surface px-2 py-1 text-[10px] font-semibold text-au-success-text shadow-sm"
              >
                Secured ✓
              </motion.span>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {uploadError ? (
        <div
          role="alert"
          className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-au-danger-tint px-3 py-2 text-xs font-medium text-au-danger-text"
        >
          <span data-image-error-code={uploadError.code}>{uploadError.message}</span>
          {selectedFile ? (
            <button
              type="button"
              onClick={() => void handleUpload(selectedFile)}
              className="font-semibold underline underline-offset-2"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {ownerId ? (
        <details className="mb-3 rounded-xl border border-au-separator bg-au-fill px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-slate-500">
            Use existing asset…
          </summary>
          <div className="mt-3 block">
            <span className="block text-[11px] font-semibold text-slate-600">
              Asset ID or image URL
            </span>
            <input
              id="sat-visual-asset"
              aria-label="Asset ID or image URL"
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-au-separator px-3 py-2 text-sm outline-none transition focus:border-au-accent/35 focus:ring-4 focus:ring-au-accent/10"
              placeholder="Existing asset ID or https://…"
            />
          </div>
        </details>
      ) : (
        <>
          <div className="block">
            <span className="text-xs font-semibold text-slate-700">Image URL or asset ID</span>
            <input
              id="sat-visual-asset"
              aria-label="Image URL or asset ID"
              data-dialog-initial-focus={mode === "insert" ? true : undefined}
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-au-separator px-3 py-2 text-sm outline-none transition focus:border-au-accent/35 focus:ring-4 focus:ring-au-accent/10"
              placeholder="https://…"
            />
          </div>
        </>
      )}
      <span id="sat-visual-alt-label" className="mt-3 block text-xs font-semibold text-slate-700">
        Alternative text <span className="text-au-danger-text">*</span>
      </span>
      <input
        id="sat-visual-alt"
        aria-labelledby="sat-visual-alt-label"
        aria-required="true"
        data-dialog-initial-focus={mode === "alt" && !alt.trim() ? true : undefined}
        value={alt}
        onChange={(event) => setAlt(event.target.value)}
        className="mt-2 w-full rounded-xl border border-au-separator px-3 py-2 text-sm outline-none transition focus:border-au-accent/35 focus:ring-4 focus:ring-au-accent/10"
        placeholder="Describe the information a student needs from this visual"
      />
      <p className="mt-1.5 text-[10px] leading-5 text-slate-400">
        Describe the visual information needed to answer the question; do not use the file name as
        alt text.
      </p>
      <span
        id="sat-visual-caption-label"
        className="mt-3 block text-xs font-semibold text-slate-700"
      >
        Caption
      </span>
      <input
        id="sat-visual-caption"
        aria-labelledby="sat-visual-caption-label"
        value={caption}
        onChange={(event) => setCaption(event.target.value)}
        className="mt-2 w-full rounded-xl border border-au-separator px-3 py-2 text-sm outline-none transition focus:border-au-accent/35 focus:ring-4 focus:ring-au-accent/10"
        placeholder="Optional"
      />
      <div className="mt-4 flex justify-end">
        <motion.button
          type="button"
          whileTap={reduceMotion ? {} : authoringMotion.press}
          transition={reduceMotion ? { duration: 0.01 } : authoringMotion.fast}
          disabled={uploading || !assetId.trim() || !alt.trim()}
          onClick={() => void handleInsert()}
          className="rounded-lg bg-au-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {uploading ? "Securing visual…" : target ? "Update visual" : "Insert visual"}
        </motion.button>
      </div>
    </DialogFrame>
  );
}

function DialogFrame({
  title,
  onClose,
  children,
  dismissOnBackdrop = true,
  widthClassName = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  dismissOnBackdrop?: boolean;
  widthClassName?: string;
}) {
  return (
    <AuthoringDialog
      open
      title={title}
      onClose={onClose}
      dismissOnBackdrop={dismissOnBackdrop}
      contentClassName={widthClassName}
    >
      <div className="px-5 pb-5">{children}</div>
    </AuthoringDialog>
  );
}
