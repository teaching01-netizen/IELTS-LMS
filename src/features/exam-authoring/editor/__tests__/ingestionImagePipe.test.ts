import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { EditableBlockMath, EditableInlineMath } from "../EditableMathExtension";
import { SatImage } from "../SatImageExtension";
import {
  __imagePipeQueueDepthForTests,
  __resetImagePipeForTests,
  destroyTransientUploads,
  findTransientPos,
  pasteClipboardImage,
  removeTransientImage,
  retryTransientUpload,
  stripTransientImagesFromEditor,
} from "../ingestionImagePipe";
import type { AssessmentMediaAsset } from "../../api/assessmentMediaApi";

const PNG_HEAD = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function pngFile(name = "photo.png"): File {
  return new File([PNG_HEAD as unknown as BlobPart], name, { type: "image/png" });
}

function asset(
  id = "asset-1",
  downloadUrl: string | null = "https://cdn.test/a.png"
): AssessmentMediaAsset {
  return {
    id,
    contentType: "image/png",
    fileName: "photo.png",
    uploadStatus: "ready",
    downloadUrl,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const editors: Editor[] = [];
const revoked: string[] = [];
let urlCounter = 0;

function makeEditor(content?: object): Editor {
  const editor = new Editor({
    extensions: [StarterKit, TableKit, EditableInlineMath, EditableBlockMath, SatImage],
    content: content ?? { type: "doc", content: [{ type: "paragraph" }] },
  });
  editors.push(editor);
  return editor;
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    loader: async () => ({ width: 100, height: 80 }),
    createObjectUrl: (_file: File) => {
      urlCounter += 1;
      return "blob:pipe-" + urlCounter;
    },
    revokeObjectUrl: (url: string) => {
      revoked.push(url);
    },
    makeUploadId: (() => {
      let n = 0;
      return () => "upload-" + (n += 1);
    })(),
    ...overrides,
  };
}

function imageAttrs(editor: Editor) {
  const json = editor.getJSON() as {
    content?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  };
  return (json.content ?? []).filter((n) => n.type === "image").map((n) => n.attrs ?? {});
}

function imageCount(editor: Editor): number {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") count += 1;
    return undefined;
  });
  return count;
}

async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  __resetImagePipeForTests();
  revoked.length = 0;
  urlCounter = 0;
  vi.restoreAllMocks();
});

describe("pasteClipboardImage temp insert", () => {
  it("preserves supplied alt text on the transient node", async () => {
    const editor = makeEditor();
    const gate = deferred<AssessmentMediaAsset>();
    const out = await pasteClipboardImage(
      editor,
      pngFile(),
      "owner-1",
      { ...deps(), upload: vi.fn(() => gate.promise) },
      "diagram"
    );
    expect(out.status).toBe("accepted");
    expect(imageAttrs(editor)[0]?.alt).toBe("diagram");
    if (out.status === "accepted") removeTransientImage(editor, out.handle.uploadId);
  });

  it("inserts a temp node with uploading attrs on accept", async () => {
    const editor = makeEditor();
    const gate = deferred<AssessmentMediaAsset>();
    const upload = vi.fn(() => gate.promise);
    const out = await pasteClipboardImage(editor, pngFile(), "owner-1", { ...deps(), upload });
    expect(out.status).toBe("accepted");
    if (out.status !== "accepted") throw new Error("expected accepted");
    expect(out.handle.objectUrl).toBe("blob:pipe-1");
    const attrs = imageAttrs(editor);
    expect(attrs).toHaveLength(1);
    expect(attrs[0]).toMatchObject({
      uploadId: out.handle.uploadId,
      uploading: true,
      uploadError: null,
      src: "blob:pipe-1",
      alt: "",
      assetId: null,
    });
    gate.resolve(asset());
    await gate.promise;
    await flushMicrotasks(20);
  });

  it("rejects unsupported files with the exact plan message and inserts nothing", async () => {
    const editor = makeEditor();
    const upload = vi.fn(async () => asset());
    const bad = new File(["hello" as unknown as BlobPart], "note.txt", { type: "text/plain" });
    const out = await pasteClipboardImage(editor, bad, "owner-1", { ...deps(), upload });
    expect(out).toEqual({
      status: "rejected",
      code: "type",
      message: "That file is not a supported image (PNG, JPEG, WebP, GIF).",
    });
    expect(imageCount(editor)).toBe(0);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("success swap keeps single undo", () => {
  it("resolves assetId+src and one undo removes the image entirely", async () => {
    const editor = makeEditor();
    const gate = deferred<AssessmentMediaAsset>();
    const upload = vi.fn(() => gate.promise);
    const out = await pasteClipboardImage(editor, pngFile(), "owner-1", { ...deps(), upload });
    if (out.status !== "accepted") throw new Error("expected accepted");
    expect(imageCount(editor)).toBe(1);
    gate.resolve(asset("asset-7", "https://cdn.test/final.png"));
    await gate.promise;
    await flushMicrotasks(20);
    const attrs = imageAttrs(editor);
    expect(attrs).toHaveLength(1);
    expect(attrs[0]).toMatchObject({
      assetId: "asset-7",
      src: "https://cdn.test/final.png",
      uploading: false,
      uploadError: null,
      uploadId: null,
    });
    // Single-undo: the swap used addToHistory:false, so ONE undo removes the paste.
    editor.commands.undo();
    expect(imageCount(editor)).toBe(0);
    // Exactly one revoke for the transient URL.
    expect(revoked).toEqual(["blob:pipe-1"]);
  });

  it("revokes and no-ops when the node is gone (deleted mid-upload)", async () => {
    const editor = makeEditor();
    const gate = deferred<AssessmentMediaAsset>();
    const upload = vi.fn(() => gate.promise);
    const out = await pasteClipboardImage(editor, pngFile(), "owner-1", { ...deps(), upload });
    if (out.status !== "accepted") throw new Error("expected accepted");
    removeTransientImage(editor, out.handle.uploadId);
    expect(imageCount(editor)).toBe(0);
    gate.resolve(asset());
    await gate.promise;
    await flushMicrotasks(20);
    expect(imageCount(editor)).toBe(0);
    expect(revoked).toEqual(["blob:pipe-1"]);
  });

  it("releases a removed image after a late upload rejection", async () => {
    const editor = makeEditor();
    const gate = deferred<AssessmentMediaAsset>();
    const upload = vi.fn(() => gate.promise);
    const out = await pasteClipboardImage(editor, pngFile(), "owner-1", { ...deps(), upload });
    if (out.status !== "accepted") throw new Error("expected accepted");

    editor.commands.undo();
    expect(imageCount(editor)).toBe(0);
    gate.reject(new Error("network down"));
    await gate.promise.catch(() => {});
    await flushMicrotasks(20);

    expect(__imagePipeQueueDepthForTests().tracked).toBe(0);
    expect(revoked).toEqual(["blob:pipe-1"]);
  });
});

describe("failure sets inline error; retry re-attempts; remove deletes + revokes", () => {
  it("failure path", async () => {
    const editor = makeEditor();
    const first = deferred<AssessmentMediaAsset>();
    const upload = vi.fn(() => first.promise);
    const local = deps({ upload });
    const out = await pasteClipboardImage(editor, pngFile(), "owner-1", local);
    if (out.status !== "accepted") throw new Error("expected accepted");
    first.reject(new Error("Image upload failed (500)."));
    await first.promise.catch(() => {});
    await flushMicrotasks(20);
    let attrs = imageAttrs(editor);
    expect(attrs).toHaveLength(1);
    expect(attrs[0]).toMatchObject({ uploading: false });
    expect(String(attrs[0]?.["uploadError"] ?? "")).toContain("Image upload failed (500).");
    // Retry re-attempts the SAME file and resolves.
    const second = deferred<AssessmentMediaAsset>();
    upload.mockImplementationOnce(() => second.promise);
    await retryTransientUpload(editor, out.handle.uploadId, "owner-1");
    attrs = imageAttrs(editor);
    expect(attrs[0]).toMatchObject({ uploading: true, uploadError: null });
    second.resolve(asset("asset-2", "https://cdn.test/retry.png"));
    await second.promise;
    await flushMicrotasks(20);
    attrs = imageAttrs(editor);
    expect(attrs[0]).toMatchObject({ assetId: "asset-2", src: "https://cdn.test/retry.png" });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1]?.[0]).toBe(upload.mock.calls[0]?.[0]);
    expect(revoked).toEqual(["blob:pipe-1"]);
  });

  it("remove deletes the node and revokes exactly once", async () => {
    const editor = makeEditor();
    const gate = deferred<AssessmentMediaAsset>();
    const upload = vi.fn(() => gate.promise);
    const out = await pasteClipboardImage(editor, pngFile(), "owner-1", { ...deps(), upload });
    if (out.status !== "accepted") throw new Error("expected accepted");
    removeTransientImage(editor, out.handle.uploadId);
    expect(imageCount(editor)).toBe(0);
    expect(revoked).toEqual(["blob:pipe-1"]);
    // Queue settles silently: resolving late must not throw or re-insert.
    gate.resolve(asset());
    await gate.promise;
    await flushMicrotasks(20);
    expect(imageCount(editor)).toBe(0);
    expect(revoked).toEqual(["blob:pipe-1"]);
  });
});

describe("concurrency order with 5 stubbed uploads", () => {
  it("caps at 3 active and drains FIFO", async () => {
    const editor = makeEditor();
    const gates = [
      deferred<AssessmentMediaAsset>(),
      deferred<AssessmentMediaAsset>(),
      deferred<AssessmentMediaAsset>(),
      deferred<AssessmentMediaAsset>(),
      deferred<AssessmentMediaAsset>(),
    ];
    const started: string[] = [];
    const upload = vi.fn((file: File) => {
      started.push(file.name);
      const gate = gates[started.length - 1];
      if (!gate) throw new Error("too many uploads");
      return gate.promise;
    });
    let n = 0;
    const local = deps({
      upload,
      makeUploadId: () => "upload-" + (n += 1),
    });
    const files = ["a.png", "b.png", "c.png", "d.png", "e.png"].map((name) => pngFile(name));
    for (const file of files) {
      await pasteClipboardImage(editor, file, "owner-1", local);
    }
    await flushMicrotasks();
    expect(started).toEqual(["a.png", "b.png", "c.png"]);
    expect(__imagePipeQueueDepthForTests().pending).toBe(2);
    gates[0]?.resolve(asset("asset-a"));
    await gates[0]?.promise;
    await flushMicrotasks(20);
    expect(started).toEqual(["a.png", "b.png", "c.png", "d.png"]);
    gates[1]?.resolve(asset("asset-b"));
    gates[2]?.resolve(asset("asset-c"));
    await Promise.all([gates[1]?.promise, gates[2]?.promise]);
    await flushMicrotasks(20);
    expect(started).toEqual(["a.png", "b.png", "c.png", "d.png", "e.png"]);
    for (const gate of gates.slice(3)) gate.resolve(asset("asset-x"));
    await Promise.all([gates[3]?.promise, gates[4]?.promise]);
    await flushMicrotasks(20);
    expect(imageCount(editor)).toBe(5);
    expect(revoked).toHaveLength(5);
  });
});

describe("strip-from-editor pre-save", () => {
  it("strips transient nodes and returns the dropped count", async () => {
    const editor = makeEditor();
    const gate = deferred<AssessmentMediaAsset>();
    const upload = vi.fn(() => gate.promise);
    await pasteClipboardImage(editor, pngFile(), "owner-1", { ...deps(), upload });
    expect(imageCount(editor)).toBe(1);
    const dropped = stripTransientImagesFromEditor(editor);
    expect(dropped).toBe(1);
    expect(imageCount(editor)).toBe(0);
    const serialized = JSON.stringify(editor.getJSON());
    expect(serialized).not.toContain("blob:pipe-1");
  });

  it("keeps resolved nodes", async () => {
    const editor = makeEditor();
    const upload = vi.fn(async () => asset("asset-keep", "https://cdn.test/keep.png"));
    await pasteClipboardImage(editor, pngFile(), "owner-1", { ...deps(), upload });
    await flushMicrotasks(20);
    expect(imageCount(editor)).toBe(1);
    expect(stripTransientImagesFromEditor(editor)).toBe(0);
    expect(imageCount(editor)).toBe(1);
  });
});

describe("findTransientPos", () => {
  it("resolves by uploadId and returns null when absent", async () => {
    const editor = makeEditor();
    const gate = deferred<AssessmentMediaAsset>();
    const upload = vi.fn(() => gate.promise);
    const out = await pasteClipboardImage(editor, pngFile(), "owner-1", { ...deps(), upload });
    if (out.status !== "accepted") throw new Error("expected accepted");
    expect(findTransientPos(editor.state.doc, out.handle.uploadId)).not.toBeNull();
    expect(findTransientPos(editor.state.doc, "nope")).toBeNull();
    gate.resolve(asset());
    await gate.promise;
    await flushMicrotasks(20);
  });
});

describe("destroy hook", () => {
  it("revokes live urls without touching a destroyed editor", async () => {
    const editor = makeEditor();
    const gate = deferred<AssessmentMediaAsset>();
    const upload = vi.fn(() => gate.promise);
    const out = await pasteClipboardImage(editor, pngFile(), "owner-1", { ...deps(), upload });
    if (out.status !== "accepted") throw new Error("expected accepted");
    destroyTransientUploads(editor);
    expect(revoked).toEqual(["blob:pipe-1"]);
    gate.resolve(asset());
    await gate.promise;
    await flushMicrotasks(20);
    // No crash, no re-insert, no double revoke.
    expect(revoked).toEqual(["blob:pipe-1"]);
  });
});
