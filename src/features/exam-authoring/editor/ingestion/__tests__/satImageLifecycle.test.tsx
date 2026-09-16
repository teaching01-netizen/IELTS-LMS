import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import type { StructuredContent } from "../../../contracts/assessment";
import type { AssessmentMediaAsset } from "../../../api/assessmentMediaApi";
import { FastQuestionComposer } from "../../FastQuestionComposer";
import { SAT_RICH_COMPOSER_CAPABILITIES } from "../../RichQuestionComposer";
import { plainContentFromText } from "../../richContent";
import {
  __imagePipeQueueDepthForTests,
  __resetImagePipeForTests,
  destroyTransientUploads,
} from "../../ingestionImagePipe";
import { SAT_IMAGE_POLICY } from "../domain/imagePolicy";

const uploadAssessmentAsset = vi.hoisted(() => vi.fn());
const importAssessmentImageUrl = vi.hoisted(() => vi.fn());
const getAssessmentMediaAsset = vi.hoisted(() => vi.fn());

vi.mock("../../../api/assessmentMediaApi", () => ({
  uploadAssessmentAsset,
  importAssessmentImageUrl,
  getAssessmentMediaAsset,
}));

const NativeURL = globalThis.URL;
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const GIF_BYTES = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
const WEBP_BYTES = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

const managedAsset: AssessmentMediaAsset = {
  id: "550e8400-e29b-41d4-a716-446655440010",
  fileName: "diagram.png",
  contentType: "image/png",
  uploadStatus: "finalized",
  downloadUrl: "/api/v1/media/550e8400-e29b-41d4-a716-446655440010/content",
};

function imageFile(
  bytes: Uint8Array,
  name: string,
  type: string,
  sizeOverride?: number
): File {
  const file = new File([bytes as unknown as BlobPart], name, { type });
  if (sizeOverride !== undefined) {
    Object.defineProperty(file, "size", { configurable: true, value: sizeOverride });
  }
  return file;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const editors: Editor[] = [];
let bitmapSize = { width: 4, height: 4 };
let objectUrlIndex = 0;

async function mountComposer() {
  const changed = vi.fn<(value: StructuredContent) => void>();
  const notice = vi.fn();

  function ControlledComposer() {
    const [value, setValue] = useState(() => plainContentFromText(""));
    return (
      <FastQuestionComposer
        label="SAT image lifecycle"
        value={value}
        capabilities={SAT_RICH_COMPOSER_CAPABILITIES}
        assetOwnerId="question-lifecycle"
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
        onSmartPaste={notice}
      />
    );
  }

  const rendered = render(<ControlledComposer />);
  const textbox = await screen.findByRole("textbox", { name: "SAT image lifecycle" });
  const editor = (textbox as HTMLElement & { editor: Editor }).editor;
  editors.push(editor);
  act(() => editor.view.focus());
  return { ...rendered, textbox, editor, changed, notice };
}

function paste(
  textbox: HTMLElement,
  payload: { files?: File[]; html?: string; text?: string }
): void {
  const getData = vi.fn((format: string) =>
    format === "text/html" ? payload.html ?? "" : format === "text/plain" ? payload.text ?? "" : ""
  );
  fireEvent.paste(textbox, { clipboardData: { files: payload.files ?? [], getData } });
}

function drop(textbox: HTMLElement, file: File): void {
  fireEvent.drop(textbox, {
    dataTransfer: { files: [file], getData: () => "" },
    clientX: 0,
    clientY: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  bitmapSize = { width: 4, height: 4 };
  objectUrlIndex = 0;
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ ...bitmapSize, close: vi.fn() }))
  );
  const createObjectURL = vi.fn(() => "blob:lifecycle-" + String(++objectUrlIndex));
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
  );
  vi.mocked(uploadAssessmentAsset).mockResolvedValue(managedAsset);
  vi.mocked(importAssessmentImageUrl).mockResolvedValue(managedAsset);
  vi.mocked(getAssessmentMediaAsset).mockResolvedValue(managedAsset);
});

afterEach(() => {
  for (const editor of editors.splice(0)) {
    destroyTransientUploads(editor);
    if (!editor.isDestroyed) act(() => editor.destroy());
  }
  __resetImagePipeForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SAT public image lifecycle matrix", () => {
  it("accepts the clipboard file at the byte, side, and pixel boundaries", async () => {
    bitmapSize = { width: SAT_IMAGE_POLICY.maxDimension, height: 3_051 };
    const file = imageFile(
      PNG_BYTES,
      "boundary.png",
      "image/png",
      SAT_IMAGE_POLICY.maxBytes
    );
    const { textbox, editor, changed } = await mountComposer();

    paste(textbox, { files: [file] });

    await waitFor(() => expect(uploadAssessmentAsset).toHaveBeenCalledWith(file, "question-lifecycle"));
    await waitFor(() =>
      expect(editor.getJSON().content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "image",
            attrs: expect.objectContaining({ assetId: managedAsset.id, uploading: false }),
          }),
        ])
      )
    );
    expect(JSON.stringify(changed.mock.calls)).not.toContain("blob:");
    expect(JSON.stringify(changed.mock.calls)).toContain(managedAsset.id);
  });

  it.each([
    ["one byte over the source cap", SAT_IMAGE_POLICY.maxBytes + 1, { width: 4, height: 4 }],
    ["one pixel over the side cap", undefined, { width: SAT_IMAGE_POLICY.maxDimension + 1, height: 1 }],
    ["one pixel over the area cap", undefined, { width: 5_000, height: 5_001 }],
  ] as const)("rejects %s before an upload request", async (_label, size, dimensions) => {
    bitmapSize = dimensions;
    const file = imageFile(PNG_BYTES, "boundary.png", "image/png", size);
    const { textbox, notice } = await mountComposer();

    paste(textbox, { files: [file] });

    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(
        expect.objectContaining({ rejectedImageCount: 1, canUndo: false })
      )
    );
    expect(uploadAssessmentAsset).not.toHaveBeenCalled();
  });

  it("keeps a valid HTTPS HTML image in place and stages the fetched bytes", async () => {
    const responseBody = PNG_BYTES.slice().buffer;
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(responseBody as ArrayBuffer, {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    );
    vi.stubGlobal("fetch", fetchFn);
    const { textbox, editor, notice } = await mountComposer();

    paste(textbox, {
      html:
        '<p>before</p><img src="https://cdn.example.test/diagram.png" alt="diagram"><p>after</p>',
    });

    await waitFor(() => expect(uploadAssessmentAsset).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
        "paragraph",
        "image",
        "paragraph",
      ])
    );
    expect(fetchFn).toHaveBeenCalledWith(
      "https://cdn.example.test/diagram.png",
      expect.objectContaining({ credentials: "same-origin" })
    );
    expect(uploadAssessmentAsset.mock.calls[0]?.[0]).toMatchObject({
      type: "image/png",
      name: "pasted-image.png",
    });
    expect(editor.getJSON().content?.[1]).toMatchObject({
      type: "image",
      attrs: expect.objectContaining({ assetId: managedAsset.id }),
    });
  });

  it.each([
    ["wrong MIME", new Response("not an image", { status: 200, headers: { "content-type": "text/html" } })],
    [
      "body over the cap",
      new Response("small body", {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(SAT_IMAGE_POLICY.maxBytes + 1),
        },
      }),
    ],
  ] as const)("keeps text when an HTML image is rejected for %s", async (_label, response) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => response));
    const { textbox, editor, notice } = await mountComposer();

    paste(textbox, {
      html: '<p>before</p><img src="https://cdn.example.test/diagram.png" alt="fallback"><p>after</p>',
    });

    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(expect.objectContaining({ rejectedImageCount: 1 }))
    );
    expect(uploadAssessmentAsset).not.toHaveBeenCalled();
    expect(editor.getText()).toContain("before");
    expect(editor.getText()).toContain("after");
  });

  it.each([
    ["JPEG", JPEG_BYTES, "image/jpeg", "photo.jpg"],
    ["WebP", WEBP_BYTES, "image/webp", "graph.webp"],
    ["GIF", GIF_BYTES, "image/gif", "animation.gif"],
  ] as const)("drops a valid %s through one managed upload request", async (_label, bytes, mime, name) => {
    const file = imageFile(bytes, name, mime);
    const { textbox, editor } = await mountComposer();
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: 1, inside: -1 });

    drop(textbox, file);

    await waitFor(() => expect(uploadAssessmentAsset).toHaveBeenCalledTimes(1));
    expect(uploadAssessmentAsset).toHaveBeenCalledWith(file, "question-lifecycle");
  });

  it("rejects a drop whose magic bytes do not match its declared MIME", async () => {
    const file = imageFile(JPEG_BYTES, "spoofed.png", "image/png");
    const { textbox, editor, notice } = await mountComposer();
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: 1, inside: -1 });

    drop(textbox, file);

    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(
        expect.objectContaining({ rejectedImageCount: 1, canUndo: false })
      )
    );
    expect(uploadAssessmentAsset).not.toHaveBeenCalled();
    expect(editor.getJSON().content?.some((node) => node.type === "image")).toBe(false);
  });

  it("exposes Retry and Remove for a failed upload", async () => {
    vi.mocked(uploadAssessmentAsset).mockRejectedValueOnce(new Error("network down"));
    const { textbox, editor } = await mountComposer();

    paste(textbox, { files: [imageFile(PNG_BYTES, "failed.png", "image/png")] });

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry image upload" })).toBeVisible());
    expect(screen.getByRole("button", { name: "Remove image" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    await waitFor(() =>
      expect(editor.getJSON().content?.some((node) => node.type === "image")).toBe(false)
    );
    expect(__imagePipeQueueDepthForTests().tracked).toBe(0);
  });

  it("releases a pending upload after undo before a late rejection", async () => {
    const pending = deferred<AssessmentMediaAsset>();
    vi.mocked(uploadAssessmentAsset).mockReturnValueOnce(pending.promise);
    const { textbox, editor } = await mountComposer();

    paste(textbox, { files: [imageFile(PNG_BYTES, "late.png", "image/png")] });
    await waitFor(() => expect(uploadAssessmentAsset).toHaveBeenCalledTimes(1));
    act(() => editor.commands.undo());
    pending.reject(new Error("late failure"));
    await pending.promise.catch(() => undefined);

    await waitFor(() => expect(__imagePipeQueueDepthForTests().tracked).toBe(0));
    expect(editor.getJSON().content?.some((node) => node.type === "image")).toBe(false);
  });
});
