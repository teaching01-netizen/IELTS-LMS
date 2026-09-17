import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { composerBaseExtensions } from "../RichQuestionComposer";
import { bubbleAppendTarget, hasLiveEditorView, objectAnchorFor } from "../anchoredSurfaces";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

const doc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Look at this" }] },
    { type: "image", attrs: { src: "https://example.test/graph.png", alt: "A graph" } },
  ],
};

function mounted() {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new Editor({ extensions: composerBaseExtensions(false), content: doc, element: host });
  editors.push(editor);
  return { editor, host };
}

describe("anchored surfaces outlive their trigger, not their editor", () => {
  it("reports a live view only while the editor owns one", () => {
    const { editor } = mounted();
    expect(hasLiveEditorView(editor)).toBe(true);

    editor.destroy();
    expect(hasLiveEditorView(editor)).toBe(false);
  });

  it("guards on destruction, not on attachment", () => {
    // Tiptap builds the view eagerly, so an editor that was never given an
    // element still owns one. The guard must not confuse the two: it exists to
    // stop a destroyed editor's view proxy from throwing, nothing more.
    const detached = new Editor({ extensions: composerBaseExtensions(false), content: doc });
    editors.push(detached);
    expect(hasLiveEditorView(detached)).toBe(true);

    detached.destroy();
    expect(hasLiveEditorView(detached)).toBe(false);
  });

  it("appends next to the editor while mounted and answers null instead of throwing after destruction", () => {
    const { editor, host } = mounted();
    expect(bubbleAppendTarget(editor)).toBe(host);

    // A bubble plugin re-runs its update on a timer, so this is reached in
    // practice after the field is gone — it must be a value, not a throw.
    editor.destroy();
    expect(() => bubbleAppendTarget(editor)).not.toThrow();
    expect(bubbleAppendTarget(editor)).toBeNull();
  });

  it("declines to anchor an object whose editor is gone", () => {
    const { editor } = mounted();
    editor.destroy();
    expect(() => objectAnchorFor(editor)).not.toThrow();
    expect(objectAnchorFor(editor)).toBeNull();
  });
});
