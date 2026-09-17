import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { EditableBlockMath, EditableInlineMath } from "../EditableMathExtension";
import { SatImage } from "../SatImageExtension";
import {
  resolveComposerContext,
  resolveObjectBubble,
  resolveTextBubble,
  selectionKindOf,
} from "../composerContext";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

function make(content: object) {
  const editor = new Editor({
    extensions: [StarterKit, TableKit, EditableInlineMath, EditableBlockMath, SatImage],
    content,
  });
  editors.push(editor);
  return editor;
}

const paragraph = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Solve for x" }] }],
};

function imagePosition(editor: Editor): number {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image") {
      position = pos;
      return false;
    }
    return true;
  });
  return position;
}

describe("the editor's three states", () => {
  it("reads typing, object selection, and table editing as distinct states", () => {
    const editor = make(paragraph);
    expect(selectionKindOf(editor.state)).toBe("text");
    editor.commands.setTextSelection({ from: 1, to: 5 });
    expect(selectionKindOf(editor.state)).toBe("text");
    // A collapsed caret is typing, not selecting.
    editor.commands.setTextSelection(2);
    expect(resolveTextBubble({ state: editor.state, editable: true })).toBe(false);
    editor.commands.setTextSelection({ from: 2, to: 3 });
    editor.commands.insertTable({ rows: 2, cols: 2 });
    expect(selectionKindOf(editor.state)).toBe("table");
    expect(resolveComposerContext(editor.state).kind).toBe("table");
  });

  it("offers the selection bubble only for a real, non-empty text range", () => {
    const editor = make(paragraph);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(resolveTextBubble({ state: editor.state, editable: true })).toBe(true);
    expect(resolveTextBubble({ state: editor.state, editable: false })).toBe(false);
    editor.commands.setTextSelection({ from: 3, to: 3 });
    expect(resolveTextBubble({ state: editor.state, editable: true })).toBe(false);
  });

  it("treats a node selection as an object, never as text", () => {
    const editor = make({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        { type: "image", attrs: { src: "https://example.test/i.png", alt: "Graph", assetId: "a1" } },
      ],
    });
    const imagePos = imagePosition(editor);
    editor.commands.setNodeSelection(imagePos);
    expect(selectionKindOf(editor.state)).toBe("node");
    expect(resolveTextBubble({ state: editor.state, editable: true })).toBe(false);
    const context = resolveObjectBubble(editor.state);
    expect(context).toMatchObject({ kind: "image", pos: imagePos, attrs: expect.objectContaining({ assetId: "a1" }) });
  });

  it("resolves an equation object with its placement and expression intact", () => {
    const editor = make({ type: "doc", content: [{ type: "blockMath", attrs: { latex: "x^2=16" } }] });
    editor.commands.setNodeSelection(0);
    expect(resolveObjectBubble(editor.state)).toEqual({
      kind: "equation",
      pos: 0,
      display: true,
      latex: "x^2=16",
    });
  });

  it("returns no object surface for plain text or for a table", () => {
    const editor = make(paragraph);
    expect(resolveObjectBubble(editor.state)).toBeNull();
    editor.commands.insertTable({ rows: 2, cols: 2 });
    expect(resolveObjectBubble(editor.state)).toBeNull();
  });
});
