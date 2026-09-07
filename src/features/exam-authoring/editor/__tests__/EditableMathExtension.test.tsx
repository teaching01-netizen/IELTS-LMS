import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EditableInlineMath } from "../EditableMathExtension";

vi.mock("mathlive", () => {
  class FakeMathfieldElement extends HTMLElement {
    private latex = "";
    position = 0;
    lastOffset = 0;

    constructor() {
      super();
      this.tabIndex = 0;
    }

    get value(): string {
      return this.latex;
    }

    set value(next: string) {
      this.latex = next;
      this.lastOffset = next.length;
      this.position = Math.min(this.position, this.lastOffset);
    }
  }

  if (!customElements.get("math-field")) {
    customElements.define("math-field", FakeMathfieldElement);
  }

  return { MathfieldElement: FakeMathfieldElement };
});

beforeAll(() => {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  }
});

type TestMathfield = HTMLElement & {
  value: string;
  position: number;
  lastOffset: number;
};

const documentContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Before " },
        { type: "inlineMath", attrs: { latex: "x^2" } },
        { type: "text", text: " after" },
      ],
    },
  ],
} as const;

function EditorHarness({ onReady }: { onReady: (editor: Editor) => void }) {
  const editor = useEditor({
    extensions: [StarterKit, EditableInlineMath],
    content: documentContent,
    immediatelyRender: false,
  });

  useEffect(() => {
    if (editor) onReady(editor);
  }, [editor, onReady]);

  return <EditorContent editor={editor} />;
}

async function openMathEditor(): Promise<TestMathfield> {
  fireEvent.click(screen.getByRole("button", { name: "Edit inline equation: x^2" }));
  await waitFor(() => expect(document.querySelector("math-field")).not.toBeNull());
  return document.querySelector("math-field") as TestMathfield;
}

function dispatchMoveOut(field: TestMathfield, direction: "forward" | "backward" | "upward") {
  act(() => {
    field.dispatchEvent(
      new CustomEvent("move-out", {
        bubbles: true,
        composed: true,
        detail: { direction },
      })
    );
  });
}

function findInlineMathLatex(editor: Editor): string | null {
  const paragraph = editor.getJSON().content?.[0];
  const math = paragraph?.content?.find((node) => node.type === "inlineMath");
  const value = math?.attrs?.["latex"];
  return typeof value === "string" ? value : null;
}

function renderEditor(): { getEditor: () => Editor } {
  let editor: Editor | null = null;
  const onReady = vi.fn((nextEditor: Editor) => {
    editor = nextEditor;
  });
  render(<EditorHarness onReady={onReady} />);
  return {
    getEditor: () => {
      if (!editor) throw new Error("Editor did not initialize");
      return editor;
    },
  };
}

describe("EditableInlineMath keyboard exit behavior", () => {
  it("moves the document caret after the equation on a forward move-out", async () => {
    const { getEditor } = renderEditor();
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit inline equation/ })).toBeVisible());
    const field = await openMathEditor();

    dispatchMoveOut(field, "forward");

    await waitFor(() => expect(document.querySelector("math-field")).toBeNull());
    await waitFor(() => expect(getEditor().state.selection.$from.nodeBefore?.type.name).toBe("inlineMath"));
    expect(getEditor().view.dom).toHaveFocus();
  });

  it("moves the document caret before the equation on a backward move-out", async () => {
    const { getEditor } = renderEditor();
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit inline equation/ })).toBeVisible());
    const field = await openMathEditor();

    dispatchMoveOut(field, "backward");

    await waitFor(() => expect(document.querySelector("math-field")).toBeNull());
    await waitFor(() => expect(getEditor().state.selection.$from.nodeAfter?.type.name).toBe("inlineMath"));
  });

  it("cancels edits with Escape and returns focus to the document", async () => {
    const { getEditor } = renderEditor();
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit inline equation/ })).toBeVisible());
    const field = await openMathEditor();
    field.value = "y^3";

    fireEvent.keyDown(field, { key: "Escape" });

    await waitFor(() => expect(document.querySelector("math-field")).toBeNull());
    expect(findInlineMathLatex(getEditor())).toBe("x^2");
    await waitFor(() => expect(getEditor().state.selection.$from.nodeBefore?.type.name).toBe("inlineMath"));
    expect(getEditor().view.dom).toHaveFocus();
  });

  it("commits edits with Enter and exits forward", async () => {
    const { getEditor } = renderEditor();
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit inline equation/ })).toBeVisible());
    const field = await openMathEditor();
    field.value = "y^3";

    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(document.querySelector("math-field")).toBeNull());
    await waitFor(() => expect(findInlineMathLatex(getEditor())).toBe("y^3"));
    await waitFor(() => expect(getEditor().state.selection.$from.nodeBefore?.type.name).toBe("inlineMath"));
  });

  it("does not exit on vertical move-out events", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit inline equation/ })).toBeVisible());
    const field = await openMathEditor();

    dispatchMoveOut(field, "upward");

    expect(document.querySelector("math-field")).toBe(field);
  });
});
