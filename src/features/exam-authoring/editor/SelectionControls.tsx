import { useEditorState, type Editor } from "@tiptap/react";
import { Bold, Italic, List, Subscript, Superscript, Underline } from "lucide-react";
import { EditorControl } from "./EditorControl";
import type { RichComposerCapabilities } from "./RichQuestionComposer";

/**
 * Formatting for the text the author just selected.
 *
 * It appears next to the selection, holds only what applies to text marks, and
 * disappears when the selection does — the interface exposed exactly the
 * controls relevant to that moment. The persistent toolbar remains the reliable
 * path for the same commands, so nothing here is the only way to do anything.
 */
export function SelectionControls({
  editor,
  capabilities: c,
}: {
  editor: Editor;
  capabilities: Readonly<RichComposerCapabilities>;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      superscript: e.isActive("superscript"),
      subscript: e.isActive("subscript"),
      bullet: e.isActive("bulletList"),
    }),
  });
  return (
    <div
      className="sat-rich-editor__bubble-row"
      role="group"
      aria-label="Format selected text"
      data-bubble="selection"
    >
      <EditorControl label="Bold (⌘B)" shortcut="⌘B" active={state.bold} onSelect={() => { editor.chain().focus().toggleBold().run(); }}>
        <Bold size={15} />
      </EditorControl>
      <EditorControl label="Italic (⌘I)" shortcut="⌘I" active={state.italic} onSelect={() => { editor.chain().focus().toggleItalic().run(); }}>
        <Italic size={15} />
      </EditorControl>
      {c.underline ? (
        <EditorControl label="Underline (⌘U)" shortcut="⌘U" active={state.underline} onSelect={() => { editor.chain().focus().toggleUnderline().run(); }}>
          <Underline size={15} />
        </EditorControl>
      ) : null}
      <EditorControl label="Superscript" active={state.superscript} onSelect={() => { editor.chain().focus().toggleSuperscript().run(); }}>
        <Superscript size={15} />
      </EditorControl>
      <EditorControl label="Subscript" active={state.subscript} onSelect={() => { editor.chain().focus().toggleSubscript().run(); }}>
        <Subscript size={15} />
      </EditorControl>
      {c.lists ? (
        <EditorControl label="Bulleted list" active={state.bullet} onSelect={() => { editor.chain().focus().toggleBulletList().run(); }}>
          <List size={15} />
        </EditorControl>
      ) : null}
    </div>
  );
}
