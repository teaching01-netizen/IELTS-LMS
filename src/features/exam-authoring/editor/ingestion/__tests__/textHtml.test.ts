import { describe, expect, it } from "vitest";
import { parseTextHtml } from "../adapters/textHtml";
import type { ImportNode } from "../domain/importDocument";

const rich = { target: "rich" as const };

function kinds(nodes: ImportNode[]): string[] {
  return nodes.map((n) => n.kind);
}

describe("parseTextHtml plain text", () => {
  it("splits blank-line runs into paragraphs, single newlines to spaces", () => {
    const out = parseTextHtml({ kind: "text", text: "a\nb\n\nc" }, rich);
    expect(kinds(out.document.nodes)).toEqual(["paragraph", "paragraph"]);
    expect(JSON.stringify(out.document.nodes)).toContain("a b");
  });
  it("handles CRLF and empty input", () => {
    const crlf = parseTextHtml({ kind: "text", text: "a\r\n\r\nb" }, rich);
    expect(kinds(crlf.document.nodes)).toEqual(["paragraph", "paragraph"]);
    expect(parseTextHtml({ kind: "text", text: "   " }, rich).document.nodes).toEqual([]);
  });
});

describe("parseTextHtml html", () => {
  it("clamps h1->2 and h4->3 with a diagnostic", () => {
    const out = parseTextHtml({ kind: "html", html: "<h1>A</h1><h4>B</h4>" }, rich);
    expect(out.document.nodes.map((n) => (n.kind === "heading" ? n.level : null))).toEqual([2, 3]);
    expect(out.warnings.some((w) => w.code === "import.heading.clamped")).toBe(true);
  });
  it("keeps nested marks, nested lists, header rows, code blocks", () => {
    const out = parseTextHtml(
      {
        kind: "html",
        html: "<p><strong><em>x</em></strong></p><ul><li>a<ul><li>b</li></ul></li></ul><table><tr><th>H</th></tr><tr><td>c</td></tr></table><pre>code</pre>",
      },
      rich
    );
    expect(kinds(out.document.nodes)).toEqual(["paragraph", "bulletList", "table", "codeBlock"]);
    const table = out.document.nodes[2];
    expect(table.kind === "table" && table.headerRow).toBe(true);
  });
  it("flattens links to text and degrades unknowns with diagnostics", () => {
    const out = parseTextHtml(
      { kind: "html", html: '<p><a href="https://x">click</a></p><foo>kept</foo>' },
      rich
    );
    expect(JSON.stringify(out.document)).toContain("click");
    expect(JSON.stringify(out.document)).toContain("kept");
    expect(out.warnings.some((w) => w.code === "import.block.degraded")).toBe(true);
  });
  it("preserves math-looking text byte-identical", () => {
    const latex = "$$\\frac{a}{b}$$ and \\(x^2\\) and $5";
    const out = parseTextHtml({ kind: "html", html: "<p>" + latex + "</p>" }, rich);
    const para = out.document.nodes[0];
    const text =
      para.kind === "paragraph"
        ? para.children.map((c) => (c.kind === "text" ? c.text : "")).join("")
        : "";
    expect(text).toBe(latex);
  });
  it("normalizes Word and Docs chrome to the same semantics", () => {
    const word = parseTextHtml(
      { kind: "html", html: '<p class="MsoNormal">Hi<o:p></o:p></p>' },
      rich
    );
    const docs = parseTextHtml(
      { kind: "html", html: '<b id="docs-internal-guid"><span class="c1">Hi</span></b>' },
      rich
    );
    expect(JSON.stringify(word.document)).toContain("Hi");
    expect(JSON.stringify(docs.document)).toContain("Hi");
  });
  it("keeps a resolved image marker between inline text blocks", () => {
    const out = parseTextHtml(
      { kind: "html", html: '<p>before<span data-sat-image-ref="ref-1"></span>after</p>' },
      rich,
      undefined,
      {
        imageRefs: new Map([
          [
            "ref-1",
            {
              refId: "ref-1",
              blobRef: { id: "ref-1", mimeType: "image/png", sizeBytes: 4 },
              alt: "diagram",
            },
          ],
        ]),
      }
    );
    expect(kinds(out.document.nodes)).toEqual(["paragraph", "image", "paragraph"]);
    expect(out.document.nodes[1]).toMatchObject({ kind: "image", blobRef: { id: "ref-1" } });
  });

  it("keeps image alt text when a table cell cannot contain a block image", () => {
    const out = parseTextHtml(
      {
        kind: "html",
        html: '<table><tr><td><span data-sat-image-ref="ref-1"></span></td></tr></table>',
      },
      rich,
      undefined,
      {
        imageRefs: new Map([
          [
            "ref-1",
            {
              refId: "ref-1",
              blobRef: { id: "ref-1", mimeType: "image/png", sizeBytes: 4 },
              alt: "diagram",
            },
          ],
        ]),
      }
    );
    const table = out.document.nodes[0];
    expect(table).toMatchObject({ kind: "table", rows: [[{ children: [{ text: "diagram" }] }]] });
    expect(out.warnings).toContainEqual(expect.objectContaining({ code: "import.image.rejected" }));
  });
});
