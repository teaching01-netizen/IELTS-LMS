import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Placeholder from "@tiptap/extension-placeholder";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  Bold,
  Code2,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Sigma,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table2,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import type { StructuredContent } from "../contracts/assessment";
import {
  assetSource,
  documentFromStructuredContent,
  structuredContentFromDocument,
} from "./richContent";
import { SatImage } from "./SatImageExtension";
import { EditableBlockMath, EditableInlineMath } from "./EditableMathExtension";
import { uploadAssessmentAsset } from "../api/assessmentMediaApi";
import { AuthoringDialog } from "../ui/authoringPrimitives";
import { authoringMotion } from "../ui/authoringMotion";
import { RichContentIdentity } from './RichContentIdentityExtension';

const baseExtensions = [
  RichContentIdentity,
  StarterKit.configure({
    blockquote: false,
    heading: { levels: [2, 3] },
  }),
  EditableInlineMath,
  EditableBlockMath,
  TableKit.configure({ table: { resizable: true, lastColumnResizable: false } }),
  Subscript,
  Superscript,
  SatImage.configure({ inline: false, allowBase64: false }),
];

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

export interface RichQuestionComposerProps {
  value: StructuredContent;
  onChange: (value: StructuredContent) => void;
  label: string;
  placeholder?: string;
  compact?: boolean;
  minHeightClassName?: string;
  assetOwnerId?: string;
  capabilities?: Readonly<RichComposerCapabilities>;
}

export function RichQuestionComposer({
  value,
  onChange,
  label,
  placeholder = "Start typing…",
  compact = false,
  minHeightClassName = "min-h-[132px]",
  assetOwnerId,
  capabilities = SAT_RICH_COMPOSER_CAPABILITIES,
}: RichQuestionComposerProps) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tableFeedback, setTableFeedback] = useState(false);
  const [initialContent] = useState(() => documentFromStructuredContent(value));
  const editorExtensions = useMemo(
    () => [
      ...baseExtensions,
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
    ],
    [placeholder]
  );
  const editor = useEditor({
    extensions: editorExtensions,
    content: initialContent as JSONContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": label,
        "data-placeholder": placeholder,
        class: `${minHeightClassName} sat-rich-editor__input`,
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange(structuredContentFromDocument(current.getJSON()));
    },
  });

  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const next = documentFromStructuredContent(value);
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) {
      editor.commands.setContent(next as JSONContent, { emitUpdate: false });
    }
  }, [editor, value]);

  const flashTableFeedback = () => {
    setTableFeedback(false);
    window.requestAnimationFrame(() => {
      setTableFeedback(true);
      window.setTimeout(() => setTableFeedback(false), 240);
    });
  };

  if (!editor) {
    return <div className={`${minHeightClassName} animate-pulse rounded-xl bg-au-fill`} />;
  }

  return (
    <div
      data-editor-surface="rich"
      data-compact={compact ? "true" : undefined}
      data-table-feedback={tableFeedback ? "true" : undefined}
      className="sat-rich-editor"
    >
      <ComposerToolbar
        editor={editor}
        compact={compact}
        capabilities={capabilities}
        onOpenDialog={setDialog}
        onTableMutation={flashTableFeedback}
      />
      <EditorContent
        editor={editor}
        className="sat-rich-editor__content"
      />
      <AnimatePresence>
        {dialog === "math" ? (
          <MathDialog
            editor={editor}
            target={{ mode: "insert", display: false, latex: "" }}
            onClose={() => setDialog(null)}
          />
        ) : null}
        {dialog === "image" ? (
          <ImageDialog
            editor={editor}
            {...(assetOwnerId ? { ownerId: assetOwnerId } : {})}
            onClose={() => setDialog(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ComposerToolbar({
  editor,
  compact,
  capabilities,
  onOpenDialog,
  onTableMutation,
}: {
  editor: Editor;
  compact: boolean;
  capabilities: Readonly<RichComposerCapabilities>;
  onOpenDialog: (dialog: Dialog) => void;
  onTableMutation: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      underline: current?.isActive("underline") ?? false,
      superscript: current?.isActive("superscript") ?? false,
      subscript: current?.isActive("subscript") ?? false,
      bulletList: current?.isActive("bulletList") ?? false,
      orderedList: current?.isActive("orderedList") ?? false,
      table: current?.isActive("table") ?? false,
      codeBlock: current?.isActive("codeBlock") ?? false,
      blockStyle: current?.isActive("heading", { level: 2 })
        ? "heading2"
        : current?.isActive("heading", { level: 3 })
          ? "heading3"
          : "paragraph",
      canUndo: current?.can().undo() ?? false,
      canRedo: current?.can().redo() ?? false,
    }),
  });

  const mutateTable = (command: () => void) => {
    command();
    onTableMutation();
  };

  const setBlockStyle = (style: string) => {
    const chain = editor.chain().focus();
    if (style === "heading2") chain.setHeading({ level: 2 }).run();
    else if (style === "heading3") chain.setHeading({ level: 3 }).run();
    else chain.setParagraph().run();
  };

  return (
    <div className="sat-rich-editor__toolbar" role="toolbar" aria-label="Formatting tools">
      <div className="sat-rich-editor__toolbar-row">
        {!compact && (capabilities.blockStyles || capabilities.lists) ? (
          <div className="sat-rich-editor__toolbar-group" role="group" aria-label="Block formatting">
            {capabilities.blockStyles ? (
              <select
                aria-label="Text style"
                value={state?.blockStyle ?? "paragraph"}
                onChange={(event) => setBlockStyle(event.target.value)}
                className="sat-rich-editor__style-select"
              >
                <option value="paragraph">Body</option>
                <option value="heading2">Heading</option>
                <option value="heading3">Subheading</option>
              </select>
            ) : null}
            {capabilities.lists ? (
              <>
                <ToolbarButton
                  title="Bulleted list (⇧⌘8)"
                  active={state?.bulletList}
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                >
                  <List size={16} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  title="Numbered list (⇧⌘7)"
                  active={state?.orderedList}
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                >
                  <ListOrdered size={16} aria-hidden="true" />
                </ToolbarButton>
              </>
            ) : null}
            <ToolbarDivider />
          </div>
        ) : null}

        <div className="sat-rich-editor__toolbar-group" role="group" aria-label="Text formatting">
          <ToolbarButton
            title="Bold (⌘B)"
            active={state?.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold size={16} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            title="Italic (⌘I)"
            active={state?.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic size={16} aria-hidden="true" />
          </ToolbarButton>
          {capabilities.underline ? (
            <ToolbarButton
              title="Underline (⌘U)"
              active={state?.underline}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <UnderlineIcon size={16} aria-hidden="true" />
            </ToolbarButton>
          ) : null}
          <ToolbarButton
            title="Superscript"
            active={state?.superscript}
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
          >
            <SuperscriptIcon size={16} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            title="Subscript"
            active={state?.subscript}
            onClick={() => editor.chain().focus().toggleSubscript().run()}
          >
            <SubscriptIcon size={16} aria-hidden="true" />
          </ToolbarButton>
        </div>

        {capabilities.equation || capabilities.image || capabilities.table || capabilities.code ? (
          <ToolbarDivider />
        ) : null}
        <div className="sat-rich-editor__toolbar-group" role="group" aria-label="Insert content">
          {capabilities.equation ? (
            <ToolbarButton title="Insert equation" onClick={() => onOpenDialog("math")}>
              <Sigma size={16} aria-hidden="true" />
            </ToolbarButton>
          ) : null}
          {capabilities.image ? (
            <ToolbarButton title="Insert image or graph" onClick={() => onOpenDialog("image")}>
              <ImagePlus size={16} aria-hidden="true" />
            </ToolbarButton>
          ) : null}
          {capabilities.code ? (
            <ToolbarButton
              title="Code block"
              active={state?.codeBlock}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            >
              <Code2 size={16} aria-hidden="true" />
            </ToolbarButton>
          ) : null}
          {capabilities.table ? (
            <ToolbarButton
              title="Insert table"
              active={state?.table}
              onClick={() =>
                mutateTable(() => {
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                    .run();
                })
              }
            >
              <Table2 size={16} aria-hidden="true" />
            </ToolbarButton>
          ) : null}
        </div>

        {capabilities.history ? (
          <div className="sat-rich-editor__toolbar-group sat-rich-editor__toolbar-group--history" role="group" aria-label="History">
            <ToolbarButton
              title="Undo (⌘Z)"
              disabled={!state?.canUndo}
              onClick={() => editor.chain().focus().undo().run()}
            >
              <Undo2 size={16} aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              title="Redo (⇧⌘Z)"
              disabled={!state?.canRedo}
              onClick={() => editor.chain().focus().redo().run()}
            >
              <Redo2 size={16} aria-hidden="true" />
            </ToolbarButton>
          </div>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {capabilities.table && state?.table ? (
          <motion.div
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            transition={reduceMotion ? { duration: 0.01 } : authoringMotion.state}
            className="sat-rich-editor__table-toolbar"
          >
            <div className="sat-rich-editor__table-toolbar-row">
              <span className="sat-rich-editor__table-label">Table</span>
              <TableAction
                label="Add row"
                onClick={() => mutateTable(() => void editor.chain().focus().addRowAfter().run())}
              />
              <TableAction
                label="Delete row"
                onClick={() => mutateTable(() => void editor.chain().focus().deleteRow().run())}
              />
              <TableAction
                label="Add column"
                onClick={() =>
                  mutateTable(() => void editor.chain().focus().addColumnAfter().run())
                }
              />
              <TableAction
                label="Delete column"
                onClick={() => mutateTable(() => void editor.chain().focus().deleteColumn().run())}
              />
              <span className="sat-rich-editor__table-divider" aria-hidden="true" />
              <TableAction
                danger
                label="Delete table"
                onClick={() => mutateTable(() => void editor.chain().focus().deleteTable().run())}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ToolbarDivider() {
  return <span className="sat-rich-editor__toolbar-divider" aria-hidden="true" />;
}

function TableAction({
  label,
  danger = false,
  onClick,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`sat-rich-editor__table-action${danger ? " sat-rich-editor__table-action--danger" : ""}`}
    >
      {label}
    </button>
  );
}

function ToolbarButton({
  title,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      whileTap={reduceMotion ? {} : authoringMotion.press}
      transition={reduceMotion ? { duration: 0.01 } : authoringMotion.fast}
      onClick={onClick}
      className={`sat-rich-editor__toolbar-button${active ? " is-active" : ""}`}
    >
      <span className="relative z-10">{children}</span>
    </motion.button>
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
        active
          ? "bg-au-surface text-slate-950 shadow-sm"
          : "text-slate-500 hover:text-slate-900"
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
  onClose,
}: {
  editor: Editor;
  ownerId?: string;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [assetId, setAssetId] = useState("");
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleUpload = async (file: File) => {
    if (!ownerId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const asset = await uploadAssessmentAsset(file, ownerId);
      setAssetId(asset.id);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const chooseFile = (file: File) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    void handleUpload(file);
  };

  return (
    <DialogFrame title="Insert image or graph" onClose={onClose}>
      {ownerId ? (
        <label
          htmlFor="sat-visual-upload"
          className="authoring-interactive mb-4 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-au-separator-strong bg-au-fill px-4 py-4 text-xs font-semibold text-slate-600 hover:border-au-accent/35 hover:bg-au-fill-strong"
        >
          <input
            id="sat-visual-upload"
            aria-label="Upload image or graph"
            type="file"
            accept="image/*"
            className="sr-only"
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
                    transition={reduceMotion ? { duration: 0.01 } : { duration: 1.05, ease: "easeInOut", repeat: Infinity }}
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
        <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-au-danger-tint px-3 py-2 text-xs font-medium text-au-danger-text">
          <span>{uploadError}</span>
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
              data-dialog-initial-focus
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
          onClick={() => {
            editor
              .chain()
              .focus()
              .insertContent({
                type: "image",
                attrs: {
                  src: assetSource(assetId.trim()),
                  alt: alt.trim(),
                  assetId: assetId.trim(),
                  caption: caption.trim() || null,
                },
              })
              .run();
            onClose();
          }}
          className="rounded-lg bg-au-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          Insert visual
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
