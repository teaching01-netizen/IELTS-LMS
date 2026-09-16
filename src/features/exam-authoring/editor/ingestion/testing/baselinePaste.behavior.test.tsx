/**
 * Phase 00 baseline regression tests — paste / drop / undo through the REAL composer.
 *
 * Each test drives the exact baseExtensions stack from RichQuestionComposer.tsx
 * (StarterKit blockquote:false + H2/H3, TableKit resizable, EditableInlineMath/
 * BlockMath, Sub/Superscript, SatImage allowBase64:false, RichContentIdentity)
 * via ProseMirror EditorView.pasteText/pasteHTML — the same doPaste path a real
 * browser paste takes (parseFromClipboard + replaceSelection). jsdom has no
 * Clipboard, so the ClipboardEvent arg is stubbed; per-browser flavor
 * differences (Chrome vs Safari) are UNKNOWN and recorded as such in the matrix.
 *
 * These tests pin the legacy base-extension behavior. The production composer
 * now routes user clipboard/drop input through the phase-07 ingestion boundary;
 * these lower-level fixtures intentionally keep exercising the unwrapped
 * ProseMirror path for comparison and schema safety.
 */
import { createElement, useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SatImage } from "../../SatImageExtension";
import { EditableBlockMath, EditableInlineMath } from "../../EditableMathExtension";
import { RichContentIdentity } from "../../RichContentIdentityExtension";

/** Exact copy of the composer assembly (RichQuestionComposer.tsx baseExtensions). */
const BASELINE_EXTENSIONS = [
  RichContentIdentity,
  StarterKit.configure({ blockquote: false, heading: { levels: [2, 3] } }),
  EditableInlineMath,
  EditableBlockMath,
  TableKit.configure({ table: { resizable: true, lastColumnResizable: false } }),
  Subscript,
  Superscript,
  SatImage.configure({ inline: false, allowBase64: false }),
];

const CLIPBOARD_EVENT = {} as unknown as ClipboardEvent;
/** Undo comparisons ignore volatile content-* ids (identity backfill is orthogonal to history). */
function docWithoutIds(doc: unknown): unknown {
  return JSON.parse(
    JSON.stringify(doc, (key, value: unknown) =>
      key === "id" && typeof value === "string" && value.startsWith("content-") ? undefined : value
    )
  );
}
function isEmptyBaselineDoc(doc: unknown): boolean {
  return (
    JSON.stringify(docWithoutIds(doc)) ===
    JSON.stringify({ type: "doc", content: [{ type: "paragraph", attrs: {} }] })
  );
}

function Harness({ onReady, content }: { onReady: (editor: Editor) => void; content?: object }) {
  const editor = useEditor({
    extensions: BASELINE_EXTENSIONS,
    content: (content ?? { type: "doc", content: [{ type: "paragraph" }] }) as never,
    immediatelyRender: false,
  });
  useEffect(() => {
    if (editor) onReady(editor);
  }, [editor, onReady]);
  return createElement(EditorContent, { editor });
}

const liveEditors: Editor[] = [];
afterEach(() => {
  liveEditors.splice(0).forEach((editor) => editor.destroy());
});

async function makeBaselineEditor(content?: object): Promise<Editor> {
  let current: Editor | null = null;
  const onReady = vi.fn((editor: Editor) => {
    current = editor;
  });
  render(createElement(Harness, { onReady, content }));
  await waitFor(() => expect(onReady).toHaveBeenCalled());
  if (!current) throw new Error("Baseline editor did not initialize");
  const editor: Editor = current;
  liveEditors.push(editor);
  return editor;
}

/** Strip volatile content-* ids before snapshot (per phase-00 plan). */
export function normalizeBaselineDoc(doc: unknown): unknown {
  return JSON.parse(
    JSON.stringify(doc, (key, value: unknown) =>
      key === "id" && typeof value === "string" && value.startsWith("content-")
        ? "content-<stable>"
        : value
    )
  );
}

function docTypes(doc: ReturnType<Editor["getJSON"]>): string[] {
  return (doc.content ?? []).map((node) => node.type ?? "?");
}

describe("baseline paste behavior (B1-B12, observed)", () => {
  it("B1: typed plain text becomes one identified paragraph", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteText("Solve for x typed", CLIPBOARD_EVENT);
    const doc = editor.getJSON();
    expect(doc.content).toHaveLength(1);
    expect(doc.content?.[0]?.type).toBe("paragraph");
    expect(doc.content?.[0]?.content).toEqual([{ type: "text", text: "Solve for x typed" }]);
    expect(typeof doc.content?.[0]?.attrs?.["id"]).toBe("string");
  });

  it("B2: pasted plain text replaces the selection verbatim", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteText("Solve for x: 2x + 3 = 11", CLIPBOARD_EVENT);
    expect(normalizeBaselineDoc(editor.getJSON())).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "content-<stable>" },
          content: [{ type: "text", text: "Solve for x: 2x + 3 = 11" }],
        },
      ],
    });
  });

  it("B3: inline marks survive (bold/italic/underline/strike/code/sup/sub)", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteHTML(
      "<p>Hello <strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s> <code>code</code> x<sup>2</sup> H<sub>2</sub>O</p>",
      CLIPBOARD_EVENT
    );
    const paragraph = editor.getJSON().content?.[0];
    const texts = (paragraph?.content ?? []).map((node) => ({
      text: node.text,
      marks: (node.marks ?? []).map((mark) => mark.type),
    }));
    expect(texts).toContainEqual({ text: "bold", marks: ["bold"] });
    expect(texts).toContainEqual({ text: "italic", marks: ["italic"] });
    expect(texts).toContainEqual({ text: "under", marks: ["underline"] });
    expect(texts).toContainEqual({ text: "strike", marks: ["strike"] });
    expect(texts).toContainEqual({ text: "code", marks: ["code"] });
    expect(texts).toContainEqual({ text: "2", marks: ["superscript"] });
    expect(texts).toContainEqual({ text: "2", marks: ["subscript"] });
  });

  it("B3-headings: h1/h4 clamp to paragraph, h2/h3 kept, blockquote unwrapped, hr + codeBlock kept", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteHTML(
      "<h1>H1</h1><h2>H2</h2><h3>Sub</h3><h4>H4</h4><blockquote>quoted</blockquote><hr><pre><code>const x = 1;</code></pre>",
      CLIPBOARD_EVENT
    );
    // Trailing empty paragraph is appended by the replaceSelection wiring.
    expect(docTypes(editor.getJSON())).toEqual([
      "paragraph",
      "heading",
      "heading",
      "paragraph",
      "paragraph",
      "horizontalRule",
      "codeBlock",
      "paragraph",
    ]);
    const json = JSON.stringify(editor.getJSON());
    expect(json).not.toContain("blockquote");
    expect(editor.getJSON().content?.[1]).toMatchObject({
      attrs: expect.objectContaining({ level: 2 }),
    });
    expect(editor.getJSON().content?.[2]).toMatchObject({
      attrs: expect.objectContaining({ level: 3 }),
    });
  });

  it("B3-lists: bullet/ordered/nested lists preserved (incl. choice-targeted paste — see B10)", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteHTML(
      "<ul><li>a<ul><li>nested</li></ul></li><li>b</li></ul><ol><li>one</li></ol>",
      CLIPBOARD_EVENT
    );
    const top = docTypes(editor.getJSON());
    expect(top).toContain("bulletList");
    expect(top).toContain("orderedList");
    expect(JSON.stringify(editor.getJSON())).toContain("nested");
  });

  it("B3-links: anchors survive as link marks (no SAT link policy)", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteHTML('<p><a href="https://example.test">link text</a></p>', CLIPBOARD_EVENT);
    const text = editor.getJSON().content?.[0]?.content?.[0];
    expect(text?.marks?.[0]?.type).toBe("link");
    expect(text?.marks?.[0]?.attrs?.["href"]).toBe("https://example.test");
  });

  it("B3-cruft: vendor styles/meta/o:p collapse, script + handlers dropped (parser-level, no sanitizer yet)", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteHTML(
      '<meta charset="utf-8"><b style="font-weight:normal;"><span style="font-size:11pt;font-family:Arial">Docs <b>bold</b> text</span></b><p class="MsoNormal">Word<o:p></o:p></p><p><script>alert(1)</script><span onclick="evil()">hi</span></p>',
      CLIPBOARD_EVENT
    );
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain("Docs ");
    expect(json).toContain("Word");
    expect(json).toContain("hi");
    expect(json).not.toContain("alert(1)");
    expect(json).not.toContain("onclick");
    expect(json).not.toContain("MsoNormal");
  });

  it("B4: pasted 3x3 table keeps header row + cell paragraphs with ids; no caps", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteHTML(
      "<table><tbody><tr><th>H1</th><th>H2</th><th>H3</th></tr><tr><td>r1c1</td><td>r1c2</td><td>r1c3</td></tr><tr><td>r2c1</td><td>r2c2</td><td>r2c3</td></tr></tbody></table>",
      CLIPBOARD_EVENT
    );
    const table = editor.getJSON().content?.[0];
    expect(table?.type).toBe("table");
    expect(table?.content).toHaveLength(3);
    expect(table?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(table?.content?.[1]?.content?.[0]?.type).toBe("tableCell");
    expect(JSON.stringify(editor.getJSON())).toContain("r2c3");
  });

  it("B5a: TipTap-native math markup pastes to inlineMath/blockMath nodes", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteHTML(
      '<p><span data-type="inline-math" data-latex="x^2"></span> and <div data-type="block-math" data-latex="\\frac{a}{b}"></div></p>',
      CLIPBOARD_EVENT
    );
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('"type":"inlineMath"');
    expect(json).toContain('"latex":"x^2"');
    expect(json).toContain('"type":"blockMath"');
  });

  it("B5b: LaTeX delimiters stay literal text; MathML content vanishes (phase-03 rescue cases)", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteHTML(
      "<p>Solve \\(x^2\\) and $$\\frac{a}{b}$$ and <math><mi>x</mi></math></p>",
      CLIPBOARD_EVENT
    );
    const json = JSON.stringify(editor.getJSON());
    expect(json).not.toContain("inlineMath");
    expect(json).not.toContain("blockMath");
    // Delimiters are literal text — no detection exists today.
    expect(json).toContain("x^2");
    // MathML has no parser — its content is lost (documents the silent-loss gap).
    expect(json).not.toContain('"text":"x","marks"');
  });

  it("B6a: https image pastes to an image node with src+alt", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteHTML(
      '<p>see <img src="https://example.test/graph.png" alt="Graph"></p>',
      CLIPBOARD_EVENT
    );
    const json = editor.getJSON();
    expect(JSON.stringify(json)).toContain('"type":"image"');
    const image = json.content?.find((node) => node.type === "image");
    expect(image?.attrs?.["src"]).toBe("https://example.test/graph.png");
    expect(image?.attrs?.["alt"]).toBe("Graph");
  });

  it("B6b: data: image is silently dropped at parse (allowBase64:false) — record the loss", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteHTML(
      '<p>see <img src="data:image/png;base64,iVBORw0KGgo="></p>',
      CLIPBOARD_EVENT
    );
    const json = JSON.stringify(editor.getJSON());
    // The wart: no image node at all, surrounding text kept, no upload offered.
    expect(json).not.toContain('"type":"image"');
    expect(json).toContain("see");
  });

  it("B6c: blob: image is NOT filtered — broken node persists (phase-06 must stage-upload instead)", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteHTML('<p>x <img src="blob:https://example.test/uuid"></p>', CLIPBOARD_EVENT);
    const image = editor.getJSON().content?.find((node) => node.type === "image");
    expect(image?.type).toBe("image");
    expect(image?.attrs?.["src"]).toBe("blob:https://example.test/uuid");
  });

  it("B7: image upload gates — type + 10MB (unit-level pin of assessmentMediaApi contracts)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/features/exam-authoring/api/assessmentMediaApi.ts", "utf8");
    // Pinned gate strings: phase-06 builds the staged-upload path on top of these.
    expect(source).toContain("Use PNG, JPEG, WebP, or GIF images.");
    expect(source).toContain("Images must be 10 MiB or smaller.");
    expect(source).toContain("Secure browser cryptography is required for image uploads.");
    expect(source).toContain("ownerKind,");
    // Smart interception is now plugin-owned rather than composer-owned.
    const composer = readFileSync(
      "src/features/exam-authoring/editor/RichQuestionComposer.tsx",
      "utf8"
    );
    expect(composer).toContain("SmartPastePlugin");
    expect(composer).toContain("SmartDropPlugin");
    expect(composer).not.toContain("handlePaste:");
    expect(composer).not.toContain("handleDrop:");
    // Upload staging remains behind the editor-owned ingestion image pipe.
    expect(source).toContain("uploadAssessmentImportAsset");
    const usages = readFileSync(
      "src/features/exam-authoring/editor/RichQuestionComposer.tsx",
      "utf8"
    );
    expect(usages).not.toContain("uploadAssessmentImportAsset");
  });

  it("B8: multi-node paste reverts in ONE undo step (single-undo already holds for single pastes)", async () => {
    const editor = await makeBaselineEditor();
    editor.view.pasteHTML("<p>one</p><p>two</p><h2>three</h2>", CLIPBOARD_EVENT);
    expect(docTypes(editor.getJSON())).toEqual(["paragraph", "paragraph", "heading", "paragraph"]);
    let steps = 0;
    while (!isEmptyBaselineDoc(editor.getJSON()) && editor.can().undo() && steps < 20) {
      editor.commands.undo();
      steps += 1;
    }
    expect(steps).toBe(1);
    expect(isEmptyBaselineDoc(editor.getJSON())).toBe(true);
  });

  it("B9: paste flows through onUpdate -> StructuredContent v2 + identities (autosave input shape)", async () => {
    const { structuredContentFromDocument } = await import("../../richContent");
    const editor = await makeBaselineEditor();
    editor.view.pasteText("autosaved wording", CLIPBOARD_EVENT);
    const content = structuredContentFromDocument(editor.getJSON());
    expect(content.version).toBe(2);
    expect(content.nodes).toEqual([]);
    expect(content.document?.type).toBe("doc");
    expect(content.document?.content?.[0]?.attrs?.["id"]).toEqual(expect.any(String));
    // Autosave lifecycle pins (code-read contracts; hook behavior covered by existing
    // useQuestionAutosave offline/durability suites — debounce 800ms, offline/conflict paths).
    const { readFileSync } = await import("node:fs");
    const autosave = readFileSync(
      "src/features/exam-authoring/hooks/useQuestionAutosave.ts",
      "utf8"
    );
    expect(autosave).toContain("debounceMs ?? 800");
    expect(autosave).toContain('"offline"');
    expect(autosave).toContain('"conflict"');
    expect(autosave).toContain("flushNow");
    expect(autosave).toContain("scheduleAutosave");
  });

  it("B10: choice composer paste is UNFILTERED — headings/lists land despite blockStyles:false lists:false (phase-07 gap)", async () => {
    const { SAT_CHOICE_COMPOSER_CAPABILITIES } = await import("../../RichQuestionComposer");
    expect(SAT_CHOICE_COMPOSER_CAPABILITIES.blockStyles).toBe(false);
    expect(SAT_CHOICE_COMPOSER_CAPABILITIES.lists).toBe(false);
    // Capabilities only gate the toolbar; the schema/parse path is shared, so a
    // choice-targeted paste of block styles is accepted verbatim today.
    const editor = await makeBaselineEditor();
    editor.commands.insertContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Pasted H2" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "li" }] }],
            },
          ],
        },
      ],
    } as never);
    const types = docTypes(editor.getJSON());
    expect(types).toContain("heading");
    expect(types).toContain("bulletList");
  });

  it("B11: broken latex node mounts without throwing (throwOnError:false runtime; dialog gate is throwOnError:true)", async () => {
    const editor = await makeBaselineEditor();
    expect(() =>
      editor.commands.insertContent({
        type: "inlineMath",
        attrs: { latex: "\\frac{unclosed" },
      } as never)
    ).not.toThrow();
    expect(JSON.stringify(editor.getJSON())).toContain("inlineMath");
    const { readFileSync } = await import("node:fs");
    // The runtime math options moved into the shared schema module when the
    // node vocabulary was split for the co-editing service (the browser and
    // the Hocuspocus service must build the same schema). The pinned intent is
    // unchanged: the RUNTIME renders with throwOnError:false while the dialog
    // validates with throwOnError:true.
    const runtime = readFileSync(
      "src/features/exam-authoring/editor/schema/mathNodes.ts",
      "utf8"
    );
    expect(runtime).toContain("throwOnError: false");
    const dialog = readFileSync(
      "src/features/exam-authoring/editor/RichQuestionComposer.tsx",
      "utf8"
    );
    expect(dialog).toContain("throwOnError: true");
  });

  it("B12: paste over a range selection REPLACES it; collapsed caret inserts", async () => {
    const editor = await makeBaselineEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    });
    editor.commands.setTextSelection({ from: 7, to: 12 });
    editor.view.pasteText("there", CLIPBOARD_EVENT);
    expect(editor.getJSON().content?.[0]?.content).toEqual([{ type: "text", text: "Hello there" }]);
  });
});
