import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
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
  X,
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
import { authoringMotion } from "../ui/authoringMotion";

const baseExtensions = [
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
        class: `${minHeightClassName} caret-[#007aff] outline-none selection:bg-[#0a84ff]/15 text-[15px] leading-[1.75] text-slate-900 [&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-slate-300 [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_p]:my-2.5 [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-[20px] [&_h2]:font-semibold [&_h2]:tracking-[-0.015em] [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-[16px] [&_h3]:font-semibold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_li]:pl-1 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-black/10 [&_td]:p-2.5 [&_th]:border [&_th]:border-black/10 [&_th]:bg-[#f5f5f7] [&_th]:p-2.5 [&_img]:my-4 [&_img]:max-h-80 [&_img]:max-w-full [&_img]:rounded-xl [&_img]:object-contain [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-[#f5f5f7] [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:leading-6 [&_pre]:text-slate-900`,
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
    return <div className={`${minHeightClassName} animate-pulse rounded-xl bg-slate-50`} />;
  }

  return (
    <div
      data-table-feedback={tableFeedback ? "true" : undefined}
      className="group rounded-[15px] border border-black/[0.10] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.035)] transition-[border-color,box-shadow] duration-150 focus-within:border-[#0a84ff]/60 focus-within:shadow-[0_3px_14px_rgba(0,0,0,0.06)] focus-within:ring-[3px] focus-within:ring-[#0a84ff]/10"
    >
      <div
        className={
          compact
            ? "max-h-0 overflow-hidden opacity-0 transition-all duration-150 group-focus-within:max-h-12 group-focus-within:opacity-100"
            : undefined
        }
      >
        <ComposerToolbar
          editor={editor}
          compact={compact}
          capabilities={capabilities}
          onOpenDialog={setDialog}
          onTableMutation={flashTableFeedback}
        />
      </div>
      <EditorContent
        editor={editor}
        className={compact ? "px-3.5 py-3" : "px-5 py-4 sm:px-6 sm:py-5"}
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
    <div className="authoring-editor-toolbar sticky top-[105px] z-20 rounded-t-[14px] border-b border-black/[0.06] bg-white/95 backdrop-blur-xl">
      <div className="flex min-h-11 flex-wrap items-center gap-1 px-2 py-1.5">
        {!compact && (capabilities.blockStyles || capabilities.lists) ? (
          <div className="flex items-center gap-1">
            {capabilities.blockStyles ? (
              <select
                aria-label="Text style"
                value={state?.blockStyle ?? "paragraph"}
                onChange={(event) => setBlockStyle(event.target.value)}
                className="h-8 rounded-lg border-0 bg-black/[0.045] px-2.5 pr-7 text-[12px] font-medium text-slate-700 outline-none transition hover:bg-black/[0.07] focus-visible:ring-2 focus-visible:ring-[#0a84ff]/35"
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
                  <List size={15} />
                </ToolbarButton>
                <ToolbarButton
                  title="Numbered list (⇧⌘7)"
                  active={state?.orderedList}
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                >
                  <ListOrdered size={15} />
                </ToolbarButton>
              </>
            ) : null}
            <ToolbarDivider />
          </div>
        ) : null}

        <div className="flex items-center gap-0.5">
          <ToolbarButton
            title="Bold (⌘B)"
            active={state?.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold size={15} />
          </ToolbarButton>
          <ToolbarButton
            title="Italic (⌘I)"
            active={state?.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic size={15} />
          </ToolbarButton>
          {capabilities.underline ? (
            <ToolbarButton
              title="Underline (⌘U)"
              active={state?.underline}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <UnderlineIcon size={15} />
            </ToolbarButton>
          ) : null}
          <ToolbarButton
            title="Superscript"
            active={state?.superscript}
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
          >
            <SuperscriptIcon size={15} />
          </ToolbarButton>
          <ToolbarButton
            title="Subscript"
            active={state?.subscript}
            onClick={() => editor.chain().focus().toggleSubscript().run()}
          >
            <SubscriptIcon size={15} />
          </ToolbarButton>
        </div>

        {capabilities.equation || capabilities.image || capabilities.table || capabilities.code ? (
          <ToolbarDivider />
        ) : null}
        <div className="flex items-center gap-0.5">
          {capabilities.equation ? (
            <ToolbarButton title="Insert equation" onClick={() => onOpenDialog("math")}>
              <Sigma size={15} />
            </ToolbarButton>
          ) : null}
          {capabilities.image ? (
            <ToolbarButton title="Insert image or graph" onClick={() => onOpenDialog("image")}>
              <ImagePlus size={15} />
            </ToolbarButton>
          ) : null}
          {capabilities.code ? (
            <ToolbarButton
              title="Code block"
              active={state?.codeBlock}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            >
              <Code2 size={15} />
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
              <Table2 size={15} />
            </ToolbarButton>
          ) : null}
        </div>

        {capabilities.history ? (
          <div className="ml-auto flex items-center gap-0.5 pl-1">
            <ToolbarButton
              title="Undo (⌘Z)"
              disabled={!state?.canUndo}
              onClick={() => editor.chain().focus().undo().run()}
            >
              <Undo2 size={15} />
            </ToolbarButton>
            <ToolbarButton
              title="Redo (⇧⌘Z)"
              disabled={!state?.canRedo}
              onClick={() => editor.chain().focus().redo().run()}
            >
              <Redo2 size={15} />
            </ToolbarButton>
          </div>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {capabilities.table && state?.table ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={authoringMotion.state}
            className="overflow-hidden border-t border-black/[0.05] bg-[#f7f7f8]"
          >
            <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 text-[11px]">
              <span className="mr-1 px-1 font-semibold text-slate-500">Table</span>
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
              <span className="mx-1 h-4 w-px bg-black/10" />
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
  return <span className="mx-0.5 h-5 w-px bg-black/10" aria-hidden="true" />;
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
      className={`rounded-md px-2 py-1.5 font-medium transition ${
        danger
          ? "text-red-600 hover:bg-red-50"
          : "text-slate-600 hover:bg-white hover:text-slate-950"
      }`}
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
  return (
    <motion.button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active || undefined}
      disabled={disabled}
      whileTap={authoringMotion.press}
      transition={authoringMotion.fast}
      onClick={onClick}
      className={`authoring-interactive relative flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-lg px-2 disabled:cursor-default disabled:opacity-25 ${
        active
          ? "bg-[#0a84ff]/10 text-[#0066cc]"
          : "text-slate-500 hover:bg-black/[0.055] hover:text-slate-950"
      }`}
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
            <span className="mx-0.5 h-8 w-px bg-black/10" aria-hidden="true" />
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
            className={`w-full resize-y rounded-[13px] border bg-[#f5f5f7] px-3.5 py-3 font-mono text-[14px] leading-6 text-slate-950 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 ${
              equation.error
                ? "border-red-300 focus:border-red-400 focus:ring-red-100"
                : "border-transparent focus:border-[#0a84ff]/35 focus:ring-[#0a84ff]/10"
            }`}
          />
          <div className="mt-1.5 min-h-5" aria-live="polite">
            {equation.error ? (
              <p id="sat-equation-error" className="text-[11px] leading-5 text-red-600">
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
            layout
            transition={authoringMotion.state}
            className={`flex min-h-28 overflow-x-auto rounded-[15px] border border-black/[0.06] bg-[#fafafa] p-5 ${
              display ? "items-center justify-center text-center" : "items-center justify-start"
            }`}
          >
            {equation.html ? (
              <motion.div
                key={`${display}-${latex}`}
                initial={{ opacity: 0.45, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                transition={authoringMotion.state}
                className="max-w-full text-slate-950"
                dangerouslySetInnerHTML={{ __html: equation.html }}
              />
            ) : (
              <div className="mx-auto flex flex-col items-center gap-2 text-center text-slate-400">
                <Sigma size={20} strokeWidth={1.7} />
                <span className="text-[11px]">
                  {latex.trim()
                    ? "Complete the expression to preview"
                    : "Your equation will appear here"}
                </span>
              </div>
            )}
          </motion.div>
        </div>

        <div className="flex items-center justify-between border-t border-black/[0.06] pt-4">
          <span className="hidden text-[11px] text-slate-400 sm:inline">
            Esc to cancel · ⌘Return to {isEditing ? "update" : "insert"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="authoring-interactive h-10 rounded-full px-4 text-[12px] font-semibold text-slate-600 hover:bg-black/[0.05]"
            >
              Cancel
            </button>
            <motion.button
              type="button"
              whileTap={authoringMotion.press}
              transition={authoringMotion.fast}
              disabled={!canCommit}
              onClick={commitEquation}
              className="authoring-interactive h-10 rounded-full bg-[#0071e3] px-4 text-[12px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-[#0077ed] disabled:cursor-default disabled:opacity-35"
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
          ? "bg-white text-slate-950 shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
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
      className={`authoring-interactive h-8 rounded-lg bg-black/[0.045] px-2.5 text-[11px] font-medium text-slate-600 hover:bg-black/[0.075] hover:text-slate-950 ${
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
          className="authoring-interactive mb-4 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:bg-slate-100"
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
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={authoringMotion.surface}
            className="relative mb-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
          >
            <img
              src={previewUrl}
              alt="Local upload preview"
              className="max-h-52 w-full object-contain"
            />
            <AnimatePresence>
              {uploading ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-slate-200/80"
                >
                  <motion.span
                    initial={{ x: "-100%" }}
                    animate={{ x: "260%" }}
                    transition={{ duration: 1.05, ease: "easeInOut", repeat: Infinity }}
                    className="block h-full w-1/3 bg-slate-900"
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
            {!uploading && assetId && !uploadError ? (
              <motion.span
                initial={{ opacity: 0, scale: 0.82 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={authoringMotion.spring}
                className="absolute right-2 top-2 rounded-full bg-white/95 px-2 py-1 text-[10px] font-semibold text-emerald-700 shadow-sm"
              >
                Secured ✓
              </motion.span>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {uploadError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
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
        <details className="mb-3 rounded-xl border border-black/[0.06] bg-[#fafafa] px-3 py-2">
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
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
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
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
              placeholder="https://…"
            />
          </div>
        </>
      )}
      <span id="sat-visual-alt-label" className="mt-3 block text-xs font-semibold text-slate-700">
        Alternative text <span className="text-red-500">*</span>
      </span>
      <input
        id="sat-visual-alt"
        aria-labelledby="sat-visual-alt-label"
        value={alt}
        onChange={(event) => setAlt(event.target.value)}
        className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
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
        className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
        placeholder="Optional"
      />
      <div className="mt-4 flex justify-end">
        <motion.button
          type="button"
          whileTap={authoringMotion.press}
          transition={authoringMotion.fast}
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
          className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
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
  const surfaceRef = useRef<HTMLDivElement>(null);
  const previousActive = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousActive.current = document.activeElement as HTMLElement | null;
    const surface = surfaceRef.current;
    const focusables = () =>
      Array.from(
        surface?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    const frame = window.requestAnimationFrame(() => {
      const preferred = surface?.querySelector<HTMLElement>("[data-dialog-initial-focus]");
      (preferred ?? focusables()[0])?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previousActive.current?.focus();
    };
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={authoringMotion.surface}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <motion.div
        ref={surfaceRef}
        initial={{ opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.99 }}
        transition={authoringMotion.surface}
        className={`w-full ${widthClassName} rounded-2xl border border-black/10 bg-white p-5 shadow-[0_20px_70px_rgba(15,23,42,0.2)]`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          <motion.button
            type="button"
            whileTap={authoringMotion.press}
            transition={authoringMotion.fast}
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close dialog"
          >
            <X size={16} />
          </motion.button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
