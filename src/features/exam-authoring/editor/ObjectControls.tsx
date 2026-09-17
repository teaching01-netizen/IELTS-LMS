import { useEditorState, type Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Download,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { SatMenu, type SatMenuItem } from "@/src/products/sat/ui/Menu";
import { EditorControl } from "./EditorControl";
import { resolveObjectBubble, type ComposerContext } from "./composerContext";
import type { EditorFeedbackPublisher } from "./editorFeedbackCopy";
import {
  IMAGE_ALIGN_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  imageAlignFromAttrs,
  imageSizeFromAttrs,
  type SatImageAlign,
  type SatImageSize,
} from "./imageObjectActions";
import { convertEquationAt, deleteObjectAt } from "./objectOps";

type ImageContext = Extract<ComposerContext, { kind: "image" }>;
type EquationContext = Extract<ComposerContext, { kind: "equation" }>;

export interface ObjectControlsProps {
  editor: Editor;
  onReplace: (context: ImageContext) => void;
  onAltText: (context: ImageContext) => void;
  onDownload: (context: ImageContext) => void;
  onEditEquation: (context: EquationContext) => void;
  /** True until the author has been shown that an image can be edited here. */
  showHint: boolean;
  onHintSeen: () => void;
  onFeedback: EditorFeedbackPublisher;
}

/**
 * The controls of the thing the author touched.
 *
 * An object carries its own controls instead of borrowing the toolbar, so the
 * causal link needs no explanation: I clicked this, these are for this. Nothing
 * destructive sits beside normal editing actions — Delete lives behind the
 * `···` — and no confirmation dialog is needed for it, because the editor has
 * history and offers the way back in the feedback surface.
 */
export function ObjectControls({
  editor,
  onReplace,
  onAltText,
  onDownload,
  onEditEquation,
  showHint,
  onHintSeen,
  onFeedback,
}: ObjectControlsProps) {
  const context = useEditorState({
    editor,
    selector: ({ editor: e }) => resolveObjectBubble(e.state),
  });
  if (!context) return null;
  if (context.kind === "equation") {
    return (
      <EquationControls
        editor={editor}
        context={context}
        onEdit={onEditEquation}
        onFeedback={onFeedback}
        onInteract={onHintSeen}
      />
    );
  }
  return (
    <ImageControls
      editor={editor}
      context={context}
      onReplace={onReplace}
      onAltText={onAltText}
      onDownload={onDownload}
      showHint={showHint}
      onHintSeen={onHintSeen}
      onFeedback={onFeedback}
    />
  );
}

function ImageControls({
  editor,
  context,
  onReplace,
  onAltText,
  onDownload,
  showHint,
  onHintSeen,
  onFeedback,
}: {
  editor: Editor;
  context: ImageContext;
  onReplace: ObjectControlsProps["onReplace"];
  onAltText: ObjectControlsProps["onAltText"];
  onDownload: ObjectControlsProps["onDownload"];
  showHint: boolean;
  onHintSeen: () => void;
  onFeedback: EditorFeedbackPublisher;
}) {
  // Attributes are read live: a replace or an upload completing must move the
  // menu's check marks without the surface remounting.
  const attrs = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      ...(e.state.doc.nodeAt(context.pos)?.attrs ?? context.attrs),
    }),
  });
  const align = imageAlignFromAttrs(attrs);
  const size = imageSizeFromAttrs(attrs);
  // Centred is the default, so "Align center" is the current choice whenever no
  // alignment is stored, and choosing it stores nothing (documents untouched by
  // this feature keep their exact shape).
  const effectiveAlign: SatImageAlign = align ?? "center";
  const setAlign = (value: SatImageAlign) => {
    editor
      .chain()
      .focus()
      .setNodeSelection(context.pos)
      .updateAttributes("image", { align: value === "center" ? null : value })
      .run();
    onHintSeen();
  };
  const setSize = (value: SatImageSize) => {
    editor.chain().focus().setNodeSelection(context.pos).updateAttributes("image", { size: value }).run();
    onHintSeen();
  };
  const items: SatMenuItem[] = [
    ...IMAGE_ALIGN_OPTIONS.map((option) => ({
      id: `align-${option.value}`,
      label: option.label,
      icon: option.value === "left" ? AlignLeft : option.value === "right" ? AlignRight : AlignCenter,
      current: effectiveAlign === option.value,
      onSelect: () => setAlign(option.value),
    })),
    ...IMAGE_SIZE_OPTIONS.map((option, index) => ({
      id: `size-${option.value}`,
      label: option.label,
      current: size === option.value,
      ...(index === 0 ? { separatorBefore: true } : {}),
      onSelect: () => setSize(option.value),
    })),
    {
      id: "size-original",
      label: "Original size",
      current: size === null,
      onSelect: () => {
        editor.chain().focus().setNodeSelection(context.pos).updateAttributes("image", { size: null }).run();
        onHintSeen();
      },
    },
    { id: "download", label: "Download original", icon: Download, separatorBefore: true, onSelect: () => { onHintSeen(); onDownload(context); } },
    {
      id: "delete",
      label: "Delete image",
      icon: Trash2,
      destructive: true,
      separatorBefore: true,
      onSelect: () => {
        onHintSeen();
        if (deleteObjectAt(editor, context.pos)) onFeedback({ message: "Image deleted", undoable: true });
      },
    },
  ];
  return (
    <div
      className="sat-rich-editor__bubble-row"
      role="group"
      aria-label="Image controls"
      data-bubble="object"
      data-object="image"
      onPointerDown={onHintSeen}
    >
      <EditorControl label="Replace image" className="sat-rich-editor__bubble-label" onSelect={() => { onHintSeen(); onReplace(context); }}>
        Replace
      </EditorControl>
      <EditorControl label="Edit alternative text" className="sat-rich-editor__bubble-label" onSelect={() => { onHintSeen(); onAltText(context); }}>
        Alt text
      </EditorControl>
      <div className="sat-spine__menu">
        <SatMenu label="Image options" compact icon={MoreHorizontal} align="end" width={196} items={items} />
      </div>
      {showHint ? (
        <span className="sat-rich-editor__bubble-hint" data-editor-hint="image-object">
          Edit this image here
        </span>
      ) : null}
    </div>
  );
}

function EquationControls({
  editor,
  context,
  onEdit,
  onFeedback,
  onInteract,
}: {
  editor: Editor;
  context: EquationContext;
  onEdit: ObjectControlsProps["onEditEquation"];
  onFeedback: EditorFeedbackPublisher;
  onInteract: () => void;
}) {
  return (
    <div
      className="sat-rich-editor__bubble-row"
      role="group"
      aria-label="Equation controls"
      data-bubble="object"
      data-object="equation"
      onPointerDown={onInteract}
    >
      <EditorControl
        label="Inline equation"
        className="sat-rich-editor__bubble-label"
        active={!context.display}
        onSelect={() => { convertEquationAt(editor, context.pos, false); onInteract(); }}
      >
        Inline
      </EditorControl>
      <EditorControl
        label="Block equation"
        className="sat-rich-editor__bubble-label"
        active={context.display}
        onSelect={() => { convertEquationAt(editor, context.pos, true); onInteract(); }}
      >
        Block
      </EditorControl>
      <EditorControl label="Edit equation" className="sat-rich-editor__bubble-label" onSelect={() => { onInteract(); onEdit(context); }}>
        <Pencil size={13} aria-hidden="true" />
        Edit
      </EditorControl>
      <div className="sat-spine__menu">
        <SatMenu
          label="Equation options"
          compact
          icon={MoreHorizontal}
          align="end"
          width={184}
          items={[
            {
              id: "delete",
              label: "Delete equation",
              icon: Trash2,
              destructive: true,
              onSelect: () => {
                onInteract();
                if (deleteObjectAt(editor, context.pos)) onFeedback({ message: "Equation deleted", undoable: true });
              },
            },
          ]}
        />
      </div>
    </div>
  );
}
