import { act, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectControls } from "../ObjectControls";
import { composerBaseExtensions } from "../RichQuestionComposer";
import type { EditorFeedbackInput } from "../editorFeedbackCopy";

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

const imageDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Look at this" }] },
    {
      type: "image",
      attrs: { src: "https://example.test/graph.png", alt: "A graph", assetId: "asset-1" },
    },
    { type: "paragraph", content: [{ type: "text", text: "After" }] },
  ],
};

function renderImageSurface(options?: { showHint?: boolean }) {
  const editor = make(imageDoc);
  const position = nodePosition(editor, "image");
  act(() => {
    editor.commands.setNodeSelection(position);
  });
  const onReplace = vi.fn();
  const onAltText = vi.fn();
  const onDownload = vi.fn();
  const onFeedback = vi.fn<(input: EditorFeedbackInput) => void>();
  const onHintSeen = vi.fn();
  render(
    <ObjectControls
      editor={editor}
      onReplace={onReplace}
      onAltText={onAltText}
      onDownload={onDownload}
      onEditEquation={vi.fn()}
      showHint={options?.showHint ?? false}
      onHintSeen={onHintSeen}
      onFeedback={onFeedback}
    />
  );
  return { editor, position, onReplace, onAltText, onDownload, onFeedback, onHintSeen };
}

describe("the controls of the object you touched", () => {
  it("offers replace and alt text as words, and hides destructive actions behind the menu", () => {
    renderImageSurface();
    expect(screen.getByRole("group", { name: "Image controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace image" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit alternative text" })).toBeInTheDocument();
    // Delete is not a peer of editing actions.
    expect(screen.queryByRole("button", { name: "Delete image" })).toBeNull();
  });

  it("targets the selected image rather than inserting another one", () => {
    const { onReplace, onAltText, position } = renderImageSurface();
    fireEvent.click(screen.getByRole("button", { name: "Replace image" }));
    expect(onReplace).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "image", pos: position, attrs: expect.objectContaining({ assetId: "asset-1" }) })
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit alternative text" }));
    expect(onAltText).toHaveBeenCalledWith(expect.objectContaining({ kind: "image", pos: position }));
  });

  it("states alignment and size as choices with the current one marked", () => {
    renderImageSurface();
    fireEvent.click(screen.getByRole("button", { name: "Image options" }));
    expect(screen.getByRole("menuitem", { name: "Align center" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("menuitem", { name: "Original size" })).toHaveAttribute("aria-current", "true");
    for (const name of ["Align left", "Align right", "Small", "Medium", "Large", "Original size", "Download original", "Delete image"]) {
      expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
    }
  });

  it("writes alignment and size onto the image, and treats centred as the default", () => {
    const { editor } = renderImageSurface();
    fireEvent.click(screen.getByRole("button", { name: "Image options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Align left" }));
    expect(nodePosition(editor, "image")).toBeGreaterThanOrEqual(0);
    expect(attrsOf(editor)).toMatchObject({ align: "left" });

    fireEvent.click(screen.getByRole("button", { name: "Image options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Small" }));
    expect(attrsOf(editor)).toMatchObject({ align: "left", size: "small" });

    // Choosing the default stores nothing, so untouched content keeps its shape.
    fireEvent.click(screen.getByRole("button", { name: "Image options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Align center" }));
    expect(attrsOf(editor)).toMatchObject({ align: null, size: "small" });
  });

  it("deletes the image, lands the caret after it, and offers the way back", () => {
    const { editor, onFeedback } = renderImageSurface();
    fireEvent.click(screen.getByRole("button", { name: "Image options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete image" }));
    expect(nodePosition(editor, "image")).toBe(-1);
    expect(editor.state.doc.textContent).toContain("After");
    // The caret is placed in the following block, not stranded on a dead node.
    expect(editor.state.selection.empty).toBe(true);
    expect(onFeedback).toHaveBeenCalledWith({ message: "Image deleted", undoable: true });
    editor.commands.undo();
    expect(nodePosition(editor, "image")).toBeGreaterThanOrEqual(0);
  });

  it("hands the original file to the author on request", () => {
    const { onDownload } = renderImageSurface();
    fireEvent.click(screen.getByRole("button", { name: "Image options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download original" }));
    expect(onDownload).toHaveBeenCalledWith(expect.objectContaining({ kind: "image" }));
  });

  it("shows the one-time hint, and reports the first interaction with it", () => {
    const { onHintSeen } = renderImageSurface({ showHint: true });
    expect(screen.getByText("Edit this image here")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("group", { name: "Image controls" }));
    expect(onHintSeen).toHaveBeenCalled();
  });

  it("shows no hint once the author has demonstrated understanding", () => {
    renderImageSurface();
    expect(screen.queryByText("Edit this image here")).toBeNull();
  });
});

describe("equation controls", () => {
  function renderEquation(display = true) {
    const editor = make({
      type: "doc",
      content: [{ type: display ? "blockMath" : "inlineMath", attrs: { latex: "x^2=16" } }],
    });
    const position = nodePosition(editor, display ? "blockMath" : "inlineMath");
    act(() => {
      editor.commands.setNodeSelection(position);
    });
    const onEditEquation = vi.fn();
    const onFeedback = vi.fn<(input: EditorFeedbackInput) => void>();
    render(
      <ObjectControls
        editor={editor}
        onReplace={vi.fn()}
        onAltText={vi.fn()}
        onDownload={vi.fn()}
        onEditEquation={onEditEquation}
        showHint={false}
        onHintSeen={vi.fn()}
        onFeedback={onFeedback}
      />
    );
    return { editor, position, onEditEquation, onFeedback };
  }

  it("states placement as a choice and preserves the expression when it changes", () => {
    const { editor } = renderEquation();
    expect(screen.getByRole("button", { name: "Block equation" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Inline equation" }));
    expect(JSON.stringify(editor.getJSON())).toContain("inlineMath");
    expect(JSON.stringify(editor.getJSON())).toContain("x^2=16");
  });

  it("edits the equation through the dialog and deletes it behind the menu", () => {
    const { editor, onEditEquation, onFeedback } = renderEquation();
    fireEvent.click(screen.getByRole("button", { name: "Edit equation" }));
    expect(onEditEquation).toHaveBeenCalledWith(expect.objectContaining({ kind: "equation", latex: "x^2=16" }));
    fireEvent.click(screen.getByRole("button", { name: "Equation options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete equation" }));
    expect(JSON.stringify(editor.getJSON())).not.toContain("x^2=16");
    expect(onFeedback).toHaveBeenCalledWith({ message: "Equation deleted", undoable: true });
  });
});

function attrsOf(editor: Editor): Record<string, unknown> {
  const position = nodePosition(editor, "image");
  return (editor.state.doc.nodeAt(position)?.attrs ?? {}) as Record<string, unknown>;
}
