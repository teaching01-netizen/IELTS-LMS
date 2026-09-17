import { render } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { composerBaseExtensions } from "../RichQuestionComposer";
import { structuredContentFromDocument } from "../richContent";
import { RichStructuredContentRenderer } from "../../../exam-rendering/RichStructuredContentRenderer";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

function mountedFixture() {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new Editor({
    extensions: composerBaseExtensions(false),
    // Direct source: renders synchronously, no asset fetch (jsdom cannot fetch).
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Stem" }] },
        { type: "image", attrs: { src: "https://example.test/graph.png", alt: "A graph" } },
      ],
    },
    element: host,
  });
  editors.push(editor);
  return editor;
}

function imagePos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "image") {
      pos = position;
      return false;
    }
    return true;
  });
  return pos;
}

function report(editor: Editor, label: string) {
  const figure = editor.view.dom.querySelector("figure");
  const img = editor.view.dom.querySelector("figure img");
  process.stderr.write(
    `PROBE ${label} editorFigure=${JSON.stringify(figure?.getAttribute("style"))} editorImg=${JSON.stringify(img?.getAttribute("style"))} editorClasses=${JSON.stringify(img?.className)}\n`,
  );
}

describe("audit probe: does alignment survive to the student surface, and do the two views agree", () => {
  it("align only, no size", () => {
    const editor = mountedFixture();
    const pos = imagePos(editor);
    editor.chain().focus().setNodeSelection(pos).updateAttributes("image", { align: "left" }).run();
    report(editor, "alignLeft");

    const saved = structuredContentFromDocument(editor.getJSON());
    const { container } = render(<RichStructuredContentRenderer content={saved} />);
    const figure = container.querySelector("figure");
    const wrapper = figure?.firstElementChild;
    const img = container.querySelector("figure img");
    process.stderr.write(
      `PROBE alignLeft studentFigure=${JSON.stringify(figure?.getAttribute("style"))} studentWrapper=${JSON.stringify(wrapper?.getAttribute("style"))} studentWrapperClasses=${JSON.stringify(wrapper?.className)} studentImg=${JSON.stringify(img?.getAttribute("style"))} studentImgClasses=${JSON.stringify(img?.className)}\n`,
    );
    expect(true).toBe(true);
  });

  it("size without align", () => {
    const editor = mountedFixture();
    const pos = imagePos(editor);
    editor.chain().focus().setNodeSelection(pos).updateAttributes("image", { size: "small" }).run();
    report(editor, "sizeOnly");

    const saved = structuredContentFromDocument(editor.getJSON());
    const { container } = render(<RichStructuredContentRenderer content={saved} />);
    const figure = container.querySelector("figure");
    process.stderr.write(
      `PROBE sizeOnly studentFigure=${JSON.stringify(figure?.getAttribute("style"))}\n`,
    );
    expect(true).toBe(true);
  });
});
