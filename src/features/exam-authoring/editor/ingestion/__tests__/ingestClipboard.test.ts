import { describe, expect, it, vi } from "vitest";
import { createPipelineContext } from "../application/pipelineContext";
import { ingestClipboard } from "../application/ingestClipboard";
import { SAT_IMAGE_POLICY } from "../domain/imagePolicy";

const ctx = createPipelineContext({ field: "prompt" });
const target = { inTable: false, inCodeBlock: false, inChoiceEditor: false };

function imageFile(index: number, size = 1): File {
  const file = new File(["x"], "image-" + String(index) + ".png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function sixValidImageFiles(): File[] {
  return Array.from({ length: 6 }, (_, index) => imageFile(index));
}

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_SIGNATURE_DATA_URL =
  "data:image/png;base64," + btoa(String.fromCharCode(...PNG_SIGNATURE));

function clipboardPng(bytes: Uint8Array = PNG_SIGNATURE): File {
  return new File([bytes], "copy.png", { type: "image/png" });
}

function imageNodesIn(document: { nodes: Array<{ kind: string }> }): Array<Record<string, unknown>> {
  const collected: Array<Record<string, unknown>> = [];
  const visit = (nodes: Array<Record<string, unknown>>): void => {
    for (const node of nodes) {
      if (node["kind"] === "image") collected.push(node);
      if (node["kind"] === "paragraph" || node["kind"] === "heading") {
        visit((node["children"] as Array<Record<string, unknown>>) ?? []);
      }
      if (node["kind"] === "bulletList" || node["kind"] === "orderedList") {
        for (const item of (node["items"] as Array<Record<string, unknown>>) ?? []) {
          visit((item["nodes"] as Array<Record<string, unknown>>) ?? []);
        }
      }
    }
  };
  visit(document.nodes as unknown as Array<Record<string, unknown>>);
  return collected;
}

function stubPngFetch(bytes: Uint8Array = PNG_SIGNATURE): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/png" }),
      blob: async () => new Blob([bytes], { type: "image/png" }),
    }))
  );
}

function filesTotalling(total: number): File[] {
  const base = Math.floor(total / 5);
  const remainder = total - base * 5;
  return Array.from({ length: 5 }, (_, index) => imageFile(index, base + (index === 0 ? remainder : 0)));
}

describe("ingestClipboard orchestration", () => {
  it("routes html tables to spreadsheet BEFORE the text path", async () => {
    const res = await ingestClipboard(
      {
        files: [],
        html: "<table><tr><td>a</td><td>b</td></tr></table>",
        text: "a\tb",
        ownerId: null,
        target,
      },
      ctx
    );
    expect(res.source).toBe("spreadsheet");
    expect(res.document.nodes[0]?.kind).toBe("table");
  });
  it("keeps file and HTML images when spreadsheet parsing wins", async () => {
    const file = new File(["x"], "shot.png", { type: "image/png" });
    const res = await ingestClipboard(
      {
        files: [file],
        html: '<table><tr><td><img src="data:image/png;base64,iVBORw0KGgo=" alt="table diagram"></td></tr></table>',
        text: "a\tb",
        ownerId: "q1",
        target,
      },
      ctx
    );
    expect(res.source).toBe("spreadsheet");
    expect(res.pendingImages).toHaveLength(2);
    expect(res.pendingImages.map((item) => item.alt)).toEqual(["", "table diagram"]);
  });
  it("upgrades math after html normalization (single parse)", async () => {
    const res = await ingestClipboard(
      {
        files: [],
        html: "<p>See \\(x^2\\) here</p>",
        text: "See \\(x^2\\) here",
        ownerId: null,
        target,
      },
      ctx
    );
    expect(res.source).toBe("html+text");
    expect(res.stats.mathCount).toBe(1);
  });
  it("sends image files to the pending staging path", async () => {
    const file = new File(["x"], "shot.png", { type: "image/png" });
    const res = await ingestClipboard(
      { files: [file], html: null, text: null, ownerId: "q1", target },
      ctx
    );
    expect(res.source).toBe("files");
    expect(res.pendingImages).toHaveLength(1);
  });

  it("accepts at most five images per paste", async () => {
    const result = await ingestClipboard(
      { files: sixValidImageFiles(), html: null, text: null, ownerId: "q1", target },
      ctx
    );

    expect(result.pendingImages).toHaveLength(5);
    expect(result.rejectedImages).toBe(1);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ message: "Only 5 images can be inserted at once.", count: 1 })
    );
  });

  it("counts direct files and HTML images against one paste limit", async () => {
    const result = await ingestClipboard(
      {
        files: [imageFile(0), imageFile(1), imageFile(2), imageFile(3)],
        html:
          '<img src="data:image/png;base64,iVBORw0KGgo=" alt="html-one">' +
          '<img src="data:image/png;base64,BBBB" alt="html-two">',
        text: null,
        ownerId: "q1",
        target,
      },
      ctx
    );

    expect(result.pendingImages).toHaveLength(5);
    expect(result.rejectedImages).toBe(1);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ message: "Only 5 images can be inserted at once." })
    );
  });

  it("rejects aggregate paste bytes above the bounded budget", async () => {
    const result = await ingestClipboard(
      {
        files: filesTotalling(SAT_IMAGE_POLICY.maxPasteBytes + 1),
        html: null,
        text: null,
        ownerId: "q1",
        target,
      },
      ctx
    );

    expect(result.pendingImages).toHaveLength(0);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        message: "The pasted images are too large as a group.",
        reason: "aggregate-size",
      })
    );
  });
  it("does not treat non-image files as image rejections before validation", async () => {
    const file = new File(["plain text"], "notes.txt", { type: "text/plain" });
    const res = await ingestClipboard(
      { files: [file], html: null, text: null, ownerId: "q1", target },
      ctx
    );
    expect(res.pendingImages).toEqual([]);
    expect(res.rejectedImages).toBe(0);
  });
  it("retains file and HTML images when an oversized spreadsheet is rejected", async () => {
    const file = new File(["x"], "shot.png", { type: "image/png" });
    const rows = Array.from({ length: 51 }, (_, index) => "<tr><td>" + index + "</td></tr>").join(
      ""
    );
    const html =
      "<table>" +
      rows +
      '<tr><td><img src="data:image/png;base64,iVBORw0KGgo=" alt="sheet image"></td></tr></table>';
    const res = await ingestClipboard(
      { files: [file], html, text: "", ownerId: "q1", target },
      ctx
    );
    expect(res.source).toBe("spreadsheet");
    expect(res.pendingImages).toHaveLength(2);
    expect(res.pendingImages.map((item) => item.alt)).toEqual(["", "sheet image"]);
  });

  it("extracts a valid HTML data image before HTML sanitization", async () => {
    const res = await ingestClipboard(
      {
        files: [],
        html: '<p>before<img src="data:image/png;base64,iVBORw0KGgo=" alt="diagram">after</p>',
        text: null,
        ownerId: "q1",
        target,
      },
      ctx
    );
    expect(res.pendingImages).toHaveLength(1);
    expect(res.pendingImages.map((item) => item.alt)).toEqual(["diagram"]);
    expect(res.rejectedImages).toBe(0);
    expect(res.transformations).toContain("html.image-extracted:1");
  });

  it("preserves surrounding text when an HTML image fails", async () => {
    const res = await ingestClipboard(
      {
        files: [],
        html: '<p>before<img src="blob:unsafe" alt="fallback">after</p>',
        text: null,
        ownerId: "q1",
        target,
      },
      ctx
    );

    expect(JSON.stringify(res.document)).toContain("before");
    expect(JSON.stringify(res.document)).toContain("fallback");
    expect(JSON.stringify(res.document)).toContain("after");
    expect(res.rejectedImages).toBe(1);
    expect(res.warnings).toContainEqual(
      expect.objectContaining({ reason: "scheme", count: 1 })
    );
  });
  it("keeps HTML images between surrounding blocks", async () => {
    const res = await ingestClipboard(
      {
        files: [],
        html: '<p>before</p><img src="data:image/png;base64,iVBORw0KGgo=" alt="diagram"><p>after</p>',
        text: "",
        ownerId: "q1",
        target,
      },
      ctx
    );
    expect(res.document.nodes.map((node) => node.kind)).toEqual([
      "paragraph",
      "image",
      "paragraph",
    ]);
    expect(res.document.nodes[1]).toMatchObject({ kind: "image", alt: "diagram" });
    expect(res.document.nodes[1]).toMatchObject({
      blobRef: { id: res.pendingImages[0]?.refId },
    });
  });
  it("keeps multiple HTML images in source order", async () => {
    const res = await ingestClipboard(
      {
        files: [],
        html:
          '<p>one</p><img src="data:image/png;base64,AAAA" alt="first"><p>two</p>' +
          '<img src="data:image/png;base64,BBBB" alt="second"><p>three</p>',
        text: "",
        ownerId: "q1",
        target,
      },
      ctx
    );
    expect(res.document.nodes.map((node) => node.kind)).toEqual([
      "paragraph",
      "image",
      "paragraph",
      "image",
      "paragraph",
    ]);
    expect(
      res.document.nodes.filter((node) => node.kind === "image").map((node) => node.alt)
    ).toEqual(["first", "second"]);
  });
  it("gives repeated HTML sources separate AST and upload references", async () => {
    const res = await ingestClipboard(
      {
        files: [],
        html:
          '<p>one</p><img src="data:image/png;base64,AAAA" alt="first"><p>two</p>' +
          '<img src="data:image/png;base64,AAAA" alt="second">',
        text: "",
        ownerId: "q1",
        target,
      },
      ctx
    );
    const images = res.document.nodes.filter((node) => node.kind === "image");
    expect(images).toHaveLength(2);
    expect(images.map((node) => node.blobRef?.id)).toEqual([
      res.pendingImages[0]?.refId,
      res.pendingImages[1]?.refId,
    ]);
    expect(new Set(res.pendingImages.map((item) => item.refId)).size).toBe(2);
    expect(images.map((node) => node.alt)).toEqual(["first", "second"]);
  });
  it("represents file-only paste images explicitly in the import AST", async () => {
    const file = new File(["bytes"], "shot.png", { type: "image/png" });
    const res = await ingestClipboard(
      { files: [file], html: null, text: null, ownerId: "q1", target },
      ctx
    );
    expect(res.document.nodes).toHaveLength(1);
    expect(res.document.nodes[0]).toMatchObject({
      kind: "image",
      blobRef: { id: "clipboard-image-0", mimeType: "image/png", sizeBytes: file.size },
    });
  });
  it("folds a data: HTML image that repeats a direct clipboard file into one node", async () => {
    const file = clipboardPng();
    const res = await ingestClipboard(
      {
        files: [file],
        html: '<p>See <img src="' + PNG_SIGNATURE_DATA_URL + '" alt="Copied visual"></p>',
        text: "https://example.test/copy.png",
        ownerId: "q1",
        target,
      },
      ctx
    );

    const images = imageNodesIn(res.document);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      alt: "Copied visual",
      blobRef: { id: "clipboard-image-0", mimeType: "image/png", sizeBytes: file.size },
    });
    expect(res.pendingImages.map((item) => item.refId)).toEqual(["clipboard-image-0"]);
    // The direct file owns the bytes: no second fetch/decode, one upload.
    expect(res.pendingImages[0]?.file).toBe(file);
    expect(res.pendingImages[0]?.alt).toBe("Copied visual");
    expect(res.stats.imageCount).toBe(1);
    expect(res.rejectedImages).toBe(0);
    expect(res.warnings).toEqual([]);
    expect(res.transformations).toContain("image.representation-reconciled:1");
  });

  it("folds an https HTML image that repeats a direct clipboard file into one node", async () => {
    const file = clipboardPng();
    stubPngFetch();
    try {
      const res = await ingestClipboard(
        {
          files: [file],
          html: '<p>See <img src="https://cdn.test/copy.png" alt="Copied visual"></p>',
          text: "https://cdn.test/copy.png",
          ownerId: "q1",
          target,
        },
        ctx
      );

      expect(imageNodesIn(res.document)).toHaveLength(1);
      expect(res.pendingImages.map((item) => item.refId)).toEqual(["clipboard-image-0"]);
      expect(res.pendingImages[0]?.file).toBe(file);
      expect(res.pendingImages[0]?.alt).toBe("Copied visual");
      expect(res.rejectedImages).toBe(0);
      expect(res.transformations).toContain("image.representation-reconciled:1");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("folds a re-encoded HTML representation through the visual fingerprint", async () => {
    const file = clipboardPng();
    // Different bytes on purpose: the fetched JPEG-flavored representation.
    const otherBytes = Uint8Array.from([...PNG_SIGNATURE, 0x2a]);
    stubPngFetch(otherBytes);
    const fingerprint = async (candidate: File) => ({
      width: 800,
      height: 600,
      luminance: Array.from({ length: 16 * 16 }, (_, index) =>
        (index % 9) * 12 + (index % 5) * 7 + (candidate.type === "image/png" ? 0 : 3)
      ),
    });
    try {
      const res = await ingestClipboard(
        {
          files: [file],
          html: '<p>See <img src="https://cdn.test/re-encoded.png" alt="Copied visual"></p>',
          text: "See https://cdn.test/re-encoded.png",
          ownerId: "q1",
          target,
        },
        ctx,
        { fingerprint }
      );

      expect(imageNodesIn(res.document)).toHaveLength(1);
      expect(res.pendingImages.map((item) => item.refId)).toEqual(["clipboard-image-0"]);
      expect(res.pendingImages[0]?.alt).toBe("Copied visual");
      expect(res.stats.imageCount).toBe(1);
      expect(res.rejectedImages).toBe(0);
      expect(res.transformations).toContain("image.representation-reconciled:1");
      // The fold rested on the heuristic level, not on the bytes.
      expect(res.transformations).toContain("image.representation-reconciled-visual:1");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps two images when the HTML representation is not byte-identical", async () => {
    const file = clipboardPng();
    const otherBytes = Uint8Array.from([...PNG_SIGNATURE, 0x2a]);
    stubPngFetch(otherBytes);
    try {
      const res = await ingestClipboard(
        {
          files: [file],
          html: '<p>See <img src="https://cdn.test/re-encoded.png" alt="Copied visual"></p>',
          text: null,
          ownerId: "q1",
          target,
        },
        ctx
      );

      expect(imageNodesIn(res.document)).toHaveLength(2);
      expect(res.pendingImages.map((item) => item.refId)).toEqual([
        "clipboard-image-0",
        "html-image-0",
      ]);
      // No canvas in this environment, so only byte identity decided — and it
      // did not fold a pair whose bytes differ.
      expect(res.transformations).not.toContain("image.representation-reconciled:1");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("joins display math split across HTML block elements", async () => {
    const html =
      "<p>Before the estimate.</p><p>\\[</p>" +
      "<p>\\|g\\|_{L^1([0,1])} \\le \\|f\\|_{L^1(\\mathbb R)}.</p>" +
      "<p>\\]</p><p>After the estimate.</p>";
    const text =
      "Before the estimate.\n\n\\[\n\\|g\\|_{L^1([0,1])} \\le \\|f\\|_{L^1(\\mathbb R)}.\n\\]\n\nAfter the estimate.";
    const res = await ingestClipboard({ files: [], html, text, ownerId: null, target }, ctx);
    expect(res.stats.mathCount).toBe(1);
    expect(res.warnings).toEqual([]);
    expect(JSON.stringify(res.document)).not.toContain("\\[");
    expect(JSON.stringify(res.document)).not.toContain("\\]");
  });
  it("routes wrapped plain text through the pdf pre-pass", async () => {
    const res = await ingestClipboard(
      {
        files: [],
        html: null,
        text: "The function f is defined\nby f(x) = 2x + 3\nwith values shown\nbelow the line",
        ownerId: null,
        target,
      },
      ctx
    );
    expect(res.source).toBe("pdf-text");
    expect(res.document.nodes.length).toBeGreaterThan(0);
  });
  it("smartPaste:false returns empty", async () => {
    const res = await ingestClipboard(
      {
        files: [],
        html: "<p>x</p>",
        text: "x",
        ownerId: null,
        target,
        flags: { smartPaste: false },
      },
      ctx
    );
    expect(res.source).toBe("empty");
  });
  it("latex:false leaves delimiters as text", async () => {
    const res = await ingestClipboard(
      {
        files: [],
        html: null,
        text: "See \\(x^2\\) here",
        ownerId: null,
        target,
        flags: { latex: false },
      },
      ctx
    );
    expect(JSON.stringify(res.document)).toContain("\\(");
    expect(res.stats.mathCount).toBe(0);
  });
  it.each([
    ["HTML plus plain text", "**Advanced Real Analysis Problem**"],
    ["HTML only", null],
  ])("formats Markdown carried by %s", async (_name, text) => {
    const res = await ingestClipboard(
      {
        files: [],
        html: "<p><span>**Advanced Real Analysis Problem**</span></p>",
        text,
        ownerId: null,
        target,
      },
      ctx
    );
    const paragraph = res.document.nodes[0];
    expect(paragraph).toMatchObject({
      kind: "paragraph",
      children: [{ kind: "text", text: "Advanced Real Analysis Problem", marks: ["bold"] }],
    });
    expect(res.transformations).toContain("text.markdown-inline");
  });

  it("keeps HTML structure, existing marks, code, and math when formatting Markdown", async () => {
    const res = await ingestClipboard(
      {
        files: [],
        html: String.raw`<h2>**Title**</h2><p><strong>Already bold</strong> <code>**literal**</code></p><pre>**code block**</pre><p>**Outside** \(x_{**n**}\)</p>`,
        text: null,
        ownerId: null,
        target,
      },
      ctx
    );
    expect(res.document.nodes[0]).toMatchObject({
      kind: "heading",
      children: [{ kind: "text", text: "Title", marks: ["bold"] }],
    });
    expect(res.document.nodes[1]).toMatchObject({
      kind: "paragraph",
      children: expect.arrayContaining([
        expect.objectContaining({ kind: "text", text: "Already bold", marks: ["bold"] }),
        expect.objectContaining({ kind: "text", text: "**literal**", marks: ["code"] }),
      ]),
    });
    expect(res.document.nodes[2]).toMatchObject({ kind: "codeBlock", text: "**code block**" });
    expect(res.document.nodes[3]).toMatchObject({
      kind: "paragraph",
      children: expect.arrayContaining([
        expect.objectContaining({ kind: "text", text: "Outside", marks: ["bold"] }),
        expect.objectContaining({ kind: "inlineMath", latex: "x_{**n**}" }),
      ]),
    });
  });

  it("normalizes markdown inline marks before math upgrade", async () => {
    const res = await ingestClipboard(
      {
        files: [],
        html: null,
        text: "**Advanced Real Analysis Problem** and `\\(x^2\\)`",
        ownerId: null,
        target,
      },
      ctx
    );
    const paragraph = res.document.nodes[0];
    expect(paragraph?.kind).toBe("paragraph");
    if (!paragraph || paragraph.kind !== "paragraph") return;
    expect(paragraph.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "text",
          text: "Advanced Real Analysis Problem",
          marks: ["bold"],
        }),
        expect.objectContaining({ kind: "text", text: "\\(x^2\\)", marks: ["code"] }),
      ])
    );
    expect(res.transformations).toContain("text.markdown-inline");
    expect(res.stats.mathCount).toBe(0);
  });
});
