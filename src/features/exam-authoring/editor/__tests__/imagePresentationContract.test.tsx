import { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { SatImage } from "../SatImageExtension";
import { structuredContentFromDocument } from "../richContent";
import { RichStructuredContentRenderer } from "../../../exam-rendering/RichStructuredContentRenderer";

/**
 * The authoring editor and the student surface render the same structured
 * content, so they must agree on where a visual sits. They once did not:
 * alignment was applied to the editor's image but to a full-width wrapper for
 * students, which made "Align left" do nothing for the reader. This test holds
 * the two surfaces together — a change to one that the other does not follow
 * fails here rather than in production.
 *
 * The authoring side mounts through `useEditor`, because that is what gives the
 * editor its React content component: an editor built with `new Editor(...)`
 * renders a placeholder instead of the node view, which would make this test
 * assert against markup the product never produces.
 */

const imageDoc = (attrs: Record<string, unknown>) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Look at this" }] },
    { type: "image", attrs: { src: "https://example.test/graph.png", alt: "A graph", ...attrs } },
  ],
});

function AuthoringSurface({
  content,
  onReady,
}: {
  content: object;
  onReady: (editor: Editor) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit, SatImage],
    content,
    immediatelyRender: false,
  });

  useEffect(() => {
    if (editor) onReady(editor);
  }, [editor, onReady]);

  return <EditorContent editor={editor} />;
}

function stylesOf(scope: ParentNode) {
  const figure = scope.querySelector("figure");
  const image = figure?.querySelector("img") ?? null;
  return {
    figureMaxWidth: (figure as HTMLElement | null)?.style.maxWidth ?? "",
    figureMarginInline: (figure as HTMLElement | null)?.style.marginInline ?? "",
    imageMarginInline: (image as HTMLElement | null)?.style.marginInline ?? "",
    hasImage: image !== null,
  };
}

async function presented(attrs: Record<string, unknown>) {
  let editor: Editor | null = null;
  const authoring = render(
    <AuthoringSurface content={imageDoc(attrs)} onReady={(next) => (editor = next)} />
  );
  await waitFor(() => expect(editor).not.toBeNull());
  await waitFor(() => expect(authoring.container.querySelector("figure")).not.toBeNull());

  const student = render(
    <RichStructuredContentRenderer content={structuredContentFromDocument(editor!.getJSON())} />
  );
  await waitFor(() => expect(student.container.querySelector("figure")).not.toBeNull());

  const snapshot = {
    authoring: stylesOf(authoring.container),
    student: stylesOf(student.container),
  };
  authoring.unmount();
  student.unmount();
  return snapshot;
}

describe("the authoring and student surfaces agree on an image", () => {
  it("renders the visual itself on both sides, so an alignment has something to move", async () => {
    const { authoring, student } = await presented({});
    // Guards the assumption the rule rests on: both surfaces render an <img>
    // the presentation style can act on.
    expect(authoring.hasImage).toBe(true);
    expect(student.hasImage).toBe(true);
    // Untouched visuals carry no inline styles at all.
    expect(authoring).toEqual({
      figureMaxWidth: "",
      figureMarginInline: "",
      imageMarginInline: "",
      hasImage: true,
    });
    expect(student).toEqual(authoring);
  });

  it("moves the visual the same way on both sides when only an alignment is chosen", async () => {
    for (const [align, marginInline] of [
      ["left", "0 auto"],
      ["right", "auto 0"],
    ] as const) {
      const { authoring, student } = await presented({ align });
      expect(authoring.imageMarginInline).toBe(marginInline);
      expect(student).toEqual(authoring);
    }
  });

  it("says which object is selected on the object itself, not around the editor", async () => {
    let editor: Editor | null = null;
    const authoring = render(
      <AuthoringSurface content={imageDoc({})} onReady={(next) => (editor = next)} />
    );
    await waitFor(() => expect(editor).not.toBeNull());
    await waitFor(() => expect(authoring.container.querySelector("figure")).not.toBeNull());

    const figure = () => authoring.container.querySelector("figure");
    expect(figure()).not.toHaveAttribute("data-image-selected");

    let position = -1;
    (editor as unknown as Editor).state.doc.descendants((node, pos) => {
      if (node.type.name !== "image") return true;
      position = pos;
      return false;
    });
    act(() => {
      (editor as unknown as Editor).commands.setNodeSelection(position);
    });
    // The node view re-renders through React, so the attribute arrives a tick
    // after the selection does.
    await waitFor(() => expect(figure()).toHaveAttribute("data-image-selected", "true"));

    authoring.unmount();
  });

  it("widths the box the same way on both sides, and moves it with the alignment", async () => {
    for (const attrs of [
      { size: "small" },
      { size: "medium", align: "right" },
      { size: "large", align: "left" },
    ]) {
      const { authoring, student } = await presented(attrs);
      expect(student).toEqual(authoring);
      expect(student.figureMaxWidth).not.toBe("");
      expect(student.figureMarginInline).not.toBe("");
    }
  });
});
