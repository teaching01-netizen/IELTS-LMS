import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorContextualSurfaces } from "../EditorContextualSurfaces";
import { composerBaseExtensions } from "../RichQuestionComposer";
import type { EditorFeedbackItem } from "../editorFeedbackCopy";
import type { OneTimeHintStore } from "../oneTimeHints";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

function make(content: object) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new Editor({ extensions: composerBaseExtensions(false), content, element: host });
  editors.push(editor);
  return { editor, host };
}

function fakeHintStore(seen = false): OneTimeHintStore & { keys: Set<string> } {
  const keys = new Set<string>(seen ? ["sat-authoring.editor.image-object-hint"] : []);
  return {
    keys,
    seen: (key: string) => keys.has(key),
    markSeen: (key: string) => {
      keys.add(key);
    },
  };
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

function Harness({
  content,
  hintStore = fakeHintStore(),
  onOpenImageDialog = vi.fn(),
}: {
  content: object;
  hintStore?: OneTimeHintStore;
  onOpenImageDialog?: () => void;
}) {
  const [{ editor, host }] = useState(() => make(content));
  const [feedback, setFeedback] = useState<EditorFeedbackItem | null>(null);
  return (
    <div data-editor-surface="rich">
      <EditorContextualSurfaces
        editor={editor}
        capabilities={{ blockStyles: true, lists: true, underline: true, equation: true, image: true, table: true, code: true, history: true }}
        feedback={feedback}
        onDismissFeedback={() => setFeedback(null)}
        hintStore={hintStore}
        onOpenImageDialog={onOpenImageDialog as never}
        onEditEquation={vi.fn()}
        onFeedback={() => {
          setFeedback({
            id: "f1",
            message: "Image deleted",
            actions: [{ id: "undo", label: "Undo", onSelect: () => { setFeedback(null); editor.commands.undo(); } }],
            undoable: true,
            timeoutMs: 6000,
          });
        }}
        resolveAsset={vi.fn(async () => ({ downloadUrl: null }))}
      />
      <span data-testid="host" data-editor-host={host.isConnected ? "true" : "false"} />
    </div>
  );
}

const textDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Solve for x quickly" }] }],
};

const imageDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Look at this" }] },
    { type: "image", attrs: { src: "https://example.test/graph.png", alt: "A graph", assetId: "asset-1" } },
  ],
};

describe("surfaces that follow the author's action", () => {
  it("offers text formatting next to the text and takes it away again", () => {
    render(<Harness content={textDoc} />);
    const editor = editors.at(-1)!;
    const host = editor.view.dom.parentElement!;
    expect(host.querySelector('[data-bubble="selection"]')).toBeNull();

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    const selectionBubble = host.querySelector('[data-bubble="selection"]');
    expect(selectionBubble).not.toBeNull();
    for (const name of ["Bold (⌘B)", "Italic (⌘I)", "Underline (⌘U)", "Superscript", "Subscript", "Bulleted list"]) {
      expect(within(selectionBubble as HTMLElement).getByRole("button", { name })).toBeInTheDocument();
    }

    act(() => {
      editor.commands.setTextSelection(3);
    });
    expect(host.querySelector('[data-bubble="selection"]')).toBeNull();
  });

  it("attaches object controls only while an object is selected", () => {
    render(<Harness content={imageDoc} />);
    const editor = editors.at(-1)!;
    const host = editor.view.dom.parentElement!;
    expect(host.querySelector('[data-bubble="object"]')).toBeNull();

    act(() => {
      editor.commands.setNodeSelection(nodePosition(editor, "image"));
    });
    const objectBubble = host.querySelector('[data-bubble="object"]');
    expect(objectBubble).not.toBeNull();
    expect(within(objectBubble as HTMLElement).getByRole("button", { name: "Replace image" })).toBeInTheDocument();

    act(() => {
      editor.commands.setTextSelection(1);
    });
    expect(host.querySelector('[data-bubble="object"]')).toBeNull();
  });

  it("shows the image hint once, then stops teaching", () => {
    const hintStore = fakeHintStore();
    const { unmount } = render(<Harness content={imageDoc} hintStore={hintStore} />);
    const editor = editors.at(-1)!;
    act(() => {
      editor.commands.setNodeSelection(nodePosition(editor, "image"));
    });
    const surface = editor.view.dom.parentElement!.querySelector('[data-bubble="object"]') as HTMLElement;
    expect(within(surface).getByText("Edit this image here")).toBeInTheDocument();
    fireEvent.pointerDown(surface);
    expect(hintStore.seen("sat-authoring.editor.image-object-hint")).toBe(true);
    expect(within(surface).queryByText("Edit this image here")).toBeNull();
    unmount();

    // A later session with the same store opens straight into the controls.
    const { editor: fresh } = make(imageDoc);
    render(<Harness content={imageDoc} hintStore={hintStore} />);
    act(() => {
      fresh.commands.setNodeSelection(nodePosition(fresh, "image"));
    });
    expect(screen.queryByText("Edit this image here")).toBeNull();
  });

  it("makes a delete cheap: the object goes, the way back is offered, and undo works", () => {
    render(<Harness content={imageDoc} />);
    const editor = editors.at(-1)!;
    const host = editor.view.dom.parentElement!;
    act(() => {
      editor.commands.setNodeSelection(nodePosition(editor, "image"));
    });
    const surface = host.querySelector('[data-bubble="object"]') as HTMLElement;
    fireEvent.click(within(surface).getByRole("button", { name: "Image options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete image" }));

    expect(nodePosition(editor, "image")).toBe(-1);
    expect(screen.getByRole("status")).toHaveTextContent("Image deleted");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(nodePosition(editor, "image")).toBeGreaterThanOrEqual(0);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
