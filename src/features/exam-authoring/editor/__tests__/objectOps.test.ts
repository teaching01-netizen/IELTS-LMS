import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composerBaseExtensions } from "../RichQuestionComposer";
import { deleteObjectAt } from "../objectOps";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

function make(content: object) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new Editor({ extensions: composerBaseExtensions(false), content, element: host });
  editors.push(editor);
  return editor;
}

function nodePosition(editor: Editor, name: string): number {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === name) {
      position = pos;
      return false;
    }
    return true;
  });
  return position;
}

const image = (attrs: Record<string, unknown> = {}) => ({
  type: "image",
  attrs: { src: "https://example.test/graph.png", alt: "A graph", ...attrs },
});

describe("deleting an object", () => {
  it("removes it in one step and leaves the caret in text, not on a dead selection", () => {
    const editor = make({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before" }] },
        image(),
        { type: "paragraph", content: [{ type: "text", text: "After" }] },
      ],
    });
    const history = editor.state.doc.content.size;
    expect(deleteObjectAt(editor, nodePosition(editor, "image"))).toBe(true);

    expect(nodePosition(editor, "image")).toBe(-1);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.$from.parent.inlineContent).toBe(true);
    expect(editor.state.doc.content.size).toBeLessThan(history);
  });

  it("leaves a valid caret when the object sat inside a list item", () => {
    // The authoring editor allows a block visual inside a list item, so this is
    // reachable content — and the caret after deleting it must still be text.
    // ProseMirror warns (once per module) when a TextSelection endpoint lands in
    // something that holds no inline content, which is the symptom to prevent.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editor = make({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Step one" }] },
                image(),
              ],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Step two" }] }],
            },
          ],
        },
      ],
    });
    expect(deleteObjectAt(editor, nodePosition(editor, "image"))).toBe(true);

    expect(editor.state.selection.$from.parent.inlineContent).toBe(true);
    expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain(
      "not pointing into a node with inline content",
    );
    warn.mockRestore();
  });
});
