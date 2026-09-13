import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { SatImage } from "../../SatImageExtension";
import { SAT_RICH_COMPOSER_CAPABILITIES } from "../../RichQuestionComposer";
import { insertIngestResult } from "../insertIngestResult";
import { prepareClipboardImage } from "../../ingestionImagePipe";

vi.mock("../../ingestionImagePipe", () => ({
  prepareClipboardImage: vi.fn(async () => ({
    status: "accepted",
    handle: { uploadId: "upload-test", objectUrl: "blob:test" },
    node: {
      type: "image",
      attrs: { uploadId: "upload-test", src: "blob:test", uploading: true, alt: "diagram" },
    },
    startUpload: vi.fn(),
    discard: vi.fn(),
  })),
}));

const target = { inTable: false, inCodeBlock: false, inChoiceEditor: false };
const result = {
  document: {
    version: 1 as const,
    nodes: [],
    sourceMeta: { source: "text" as const, confidence: 0 as const, transformations: [] },
  },
  source: "files" as const,
  pendingImages: [new File(["bytes"], "diagram.png", { type: "image/png" })],
  pendingImageAlts: ["diagram"],
  rejectedImages: 0,
  warnings: [],
  transformations: [],
  stats: { blockCount: 0, imageCount: 1, mathCount: 0, tableCount: 0 },
};

describe("insertIngestResult image staging", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it("stages each pending image exactly once and preserves its alt", async () => {
    editor = new Editor({
      extensions: [StarterKit, SatImage.configure({ inline: false, allowBase64: false })],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const outcome = await insertIngestResult(editor, result, target, {
      capabilities: SAT_RICH_COMPOSER_CAPABILITIES,
    });
    expect(outcome.handled).toBe(true);
    expect(outcome.rejectedImages).toBe(0);
    expect(vi.mocked(prepareClipboardImage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prepareClipboardImage).mock.calls[0]?.[0]).toBe(editor);
    expect(vi.mocked(prepareClipboardImage).mock.calls[0]?.[4]).toBe("diagram");
  });
});
