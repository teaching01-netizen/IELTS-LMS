import { describe, expect, it } from "vitest";
import { createPipelineContext } from "../application/pipelineContext";
import { ingestClipboard } from "../application/ingestClipboard";

const ctx = createPipelineContext({ field: "prompt" });
const target = { inTable: false, inCodeBlock: false, inChoiceEditor: false };

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
    expect(res.pendingImageAlts).toEqual(["", "table diagram"]);
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
    expect(res.pendingImageAlts).toEqual(["", "sheet image"]);
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
    expect(res.pendingImageAlts).toEqual(["diagram"]);
    expect(res.rejectedImages).toBe(0);
    expect(res.transformations).toContain("html.image-extracted:1");
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
