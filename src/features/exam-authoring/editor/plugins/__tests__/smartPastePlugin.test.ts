import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { EditableBlockMath, EditableInlineMath } from "../../EditableMathExtension";
import { SatImage } from "../../SatImageExtension";
import { RichContentIdentity } from "../../RichContentIdentityExtension";
import {
  SAT_CHOICE_COMPOSER_CAPABILITIES,
  SAT_RICH_COMPOSER_CAPABILITIES,
} from "../../RichQuestionComposer";
import { createPipelineContext } from "../../ingestion/application/pipelineContext";
import { ingestClipboard } from "../../ingestion/application/ingestClipboard";
import { importAstToRichDocument } from "../../ingestion/conversion/importAstToRichDocument";
import { SmartPastePlugin, readClipboardPayload } from "../smartPastePlugin";
import { insertIngestResult } from "../insertIngestResult";

const smartPasteKey = "smartPaste-test";
function makeEditor(capabilities = SAT_RICH_COMPOSER_CAPABILITIES): Editor {
  return new Editor({
    extensions: [
      RichContentIdentity,
      StarterKit.configure({ blockquote: false, heading: { levels: [2, 3] } }),
      EditableInlineMath,
      EditableBlockMath,
      TableKit.configure({ table: { resizable: true, lastColumnResizable: false } }),
      SatImage.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: "Type", emptyEditorClass: "is-editor-empty" }),
      SmartPastePlugin.configure({
        capabilities,
        ingest: (req) => ingestClipboard(req, createPipelineContext({ field: "prompt" })),
        insert: (editor, result, target) =>
          insertIngestResult(editor, result, target, { capabilities }),
      }),
    ],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "start" }] }],
    },
  });
}
function smartPlugin(view: {
  state: {
    plugins: Array<{ spec: { props?: Record<string, unknown> }; props: Record<string, unknown> }>;
  };
}): { props: { handlePaste?: (...args: never[]) => boolean } } {
  const withKey = view.state.plugins.filter((p) => typeof p.props.handlePaste === "function");
  const scored = withKey.map((p) => ({
    plugin: p,
    score: [String(p.spec?.props?.handlePaste ?? ""), String(p.props.handlePaste)]
      .join("\n")
      .includes("readClipboardPayload")
      ? 1
      : 0,
  }));
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0]?.plugin ?? withKey[0];
  if (!winner) throw new Error("no handlePaste plugin found");
  return winner as unknown as { props: { handlePaste?: (...args: never[]) => boolean } };
}
void smartPasteKey;

function pasteEvent(
  files: File[],
  html: string | null,
  text: string | null,
  shiftKey = false
): ClipboardEvent {
  const dt = {
    files,
    getData: (kind: string) => (kind === "text/html" ? (html ?? "") : (text ?? "")),
  };
  return { clipboardData: dt, shiftKey, preventDefault: vi.fn() } as unknown as ClipboardEvent;
}

describe("SmartPastePlugin", () => {
  it("pastes html+text once: math native, no duplication, single undo", async () => {
    const editor = makeEditor();
    try {
      const before = editor.getJSON();
      const view = editor.view;
      const plugin = smartPlugin(view);
      expect(plugin.props.handlePaste).toBeDefined();
      const handled = plugin.props.handlePaste?.(
        view as never,
        pasteEvent([], "<p>See \\(x^2\\) here</p>", "See \\(x^2\\) here") as never,
        null as never
      );
      expect(handled).toBe(true);
      await new Promise((r) => setTimeout(r, 50));
      const json = JSON.stringify(editor.getJSON());
      expect(json).toContain("inlineMath");
      expect(json.match(/See/g)?.length).toBe(1);
      editor.commands.undo();
      const stripIds = (doc: unknown): unknown =>
        JSON.parse(JSON.stringify(doc), (key, value: unknown) => (key === "id" ? null : value));
      expect(stripIds(editor.getJSON())).toEqual(stripIds(before));
      editor.commands.redo();
      expect(JSON.stringify(editor.getJSON())).toContain("inlineMath");
    } finally {
      editor.destroy();
    }
  });
  it("shiftKey returns false before preventDefault", () => {
    const editor = makeEditor();
    try {
      const view = editor.view;
      const plugin = smartPlugin(view);
      const event = pasteEvent([], null, "plain", true);
      const handled = plugin.props.handlePaste?.(view as never, event as never, null as never);
      expect(handled).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    } finally {
      editor.destroy();
    }
  });
  it("choice editor flattens headings+lists (B10 closure)", async () => {
    const editor = makeEditor(SAT_CHOICE_COMPOSER_CAPABILITIES);
    try {
      const view = editor.view;
      const plugin = smartPlugin(view);
      plugin.props.handlePaste?.(
        view as never,
        pasteEvent([], "<h2>H</h2><ul><li>a</li></ul>", "H a") as never,
        null as never
      );
      await new Promise((r) => setTimeout(r, 50));
      const json = JSON.stringify(editor.getJSON());
      expect(json).not.toContain('"heading"');
      expect(json).not.toContain('"bulletList"');
      expect(json).toContain("a");
    } finally {
      editor.destroy();
    }
  });
  it("screenshot paragraph converts every delimiter with zero warnings", async () => {
    const pasted =
      "Let \\(f \\in L^1(\\mathbb{R})\\). Prove that for almost every \\(x \\in [0,1]\\), the series\n\n" +
      "\\[\\sum_{n\\in \\mathbb Z} f(x+n)\\]";
    const result = await ingestClipboard(
      {
        files: [],
        html: null,
        text: pasted,
        ownerId: null,
        target: { inTable: false, inCodeBlock: false, inChoiceEditor: false },
      },
      createPipelineContext({ field: "prompt" })
    );
    expect(result.warnings).toEqual([]);
    const converted = importAstToRichDocument(result.document, SAT_RICH_COMPOSER_CAPABILITIES);
    const json = JSON.stringify(converted.doc);
    expect(json).toContain("inlineMath");
    expect(json).toContain("blockMath");
    expect(json).not.toContain("\\(");
  });
  it("paste over selection replaces exactly the range", async () => {
    const editor = makeEditor();
    try {
      editor.commands.setContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }],
      });
      editor.commands.setTextSelection({ from: 1, to: 6 });
      const view = editor.view;
      const plugin = smartPlugin(view);
      plugin.props.handlePaste?.(
        view as never,
        pasteEvent([], "<p>NEW</p>", "NEW") as never,
        null as never
      );
      await new Promise((r) => setTimeout(r, 50));
      const json = JSON.stringify(editor.getJSON());
      expect(json).toContain("NEW");
      expect(json).not.toContain("hello");
    } finally {
      editor.destroy();
    }
  });
  it("readClipboardPayload reads once", () => {
    const event = pasteEvent([], "<p>x</p>", "x");
    const payload = readClipboardPayload(event);
    expect(payload.html).toBe("<p>x</p>");
    expect(payload.text).toBe("x");
  });
  it("reports rejected-only image pastes without adding an undo step", async () => {
    const notices: Array<{ rejectedImageCount?: number; canUndo?: boolean }> = [];
    const editor = new Editor({
      extensions: [
        RichContentIdentity,
        StarterKit.configure({ blockquote: false, heading: { levels: [2, 3] } }),
        SmartPastePlugin.configure({
          capabilities: SAT_RICH_COMPOSER_CAPABILITIES,
          ingest: async () => ({
            document: {
              version: 1 as const,
              nodes: [],
              sourceMeta: { source: "text" as const, confidence: 0 as const, transformations: [] },
            },
            source: "empty" as const,
            pendingImages: [],
            rejectedImages: 1,
            warnings: [
              {
                code: "import.image.count-limit",
                message: "Only 5 images can be inserted at once.",
                count: 1,
                reason: "count",
              },
            ],
            transformations: ["html.image-rejected:1"],
            stats: { blockCount: 0, imageCount: 0, mathCount: 0, tableCount: 0 },
          }),
          insert: async () => ({ handled: false, rejectedImages: 0 }),
          onSmartPaste: (info) => notices.push(info),
        }),
      ],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    try {
      const plugin = smartPlugin(editor.view);
      const event = pasteEvent([], '<img src="blob:unsafe">', null);
      expect(plugin.props.handlePaste?.(editor.view as never, event as never, null as never)).toBe(
        true
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(notices[0]).toMatchObject({ rejectedImageCount: 1, canUndo: false });
      expect(notices[0]).toMatchObject({
        warnings: [expect.objectContaining({ reason: "count", count: 1 })],
      });
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    } finally {
      editor.destroy();
    }
  });
});
