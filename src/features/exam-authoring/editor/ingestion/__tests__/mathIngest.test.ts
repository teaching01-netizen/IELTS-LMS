import { describe, expect, it } from "vitest";
import { scanExplicitDelimiters } from "../mathDelimiters";
import { parseMathText, upgradeInlineList, upgradeMathInDocument } from "../mathIngest";
import type { ImportDocument, InlineNode } from "../domain/importDocument";

function textInline(text: string, marks: [] = []): InlineNode {
  return { kind: "text", text, marks, meta: { source: "text", confidence: 2, transformations: [] } };
}
function docOf(inlines: InlineNode[]): ImportDocument {
  const meta = { source: "text" as const, confidence: 2 as const, transformations: [] as string[] };
  return { version: 1, nodes: [{ kind: "paragraph", children: inlines, meta }], sourceMeta: meta };
}

describe("scanExplicitDelimiters", () => {
  it("finds all three kinds with offsets", () => {
    const matches = scanExplicitDelimiters("a \\(x^2\\) b $$\\frac{a}{b}$$ c \\[y\\]");
    expect(matches.map((m) => [m.kind, m.latex, m.display])).toEqual([
      ["inline-paren", "x^2", false],
      ["display-dollar", "\\frac{a}{b}", true],
      ["display-bracket", "y", true],
    ]);
    expect(matches[0]?.start).toBeGreaterThanOrEqual(0);
  });
  it("ignores empty delimiters, escaped dollars, unclosed openers", () => {
    expect(scanExplicitDelimiters("a $$  $$ b")).toEqual([]);
    expect(scanExplicitDelimiters("cost \\$5 and $$x$$ done").map((m) => m.latex)).toEqual(["x"]);
    expect(scanExplicitDelimiters("open \\(never closed here")).toEqual([]);
  });
  it("never treats single dollars as delimiters", () => {
    expect(scanExplicitDelimiters("Pay $5 or $19.99 today")).toEqual([]);
  });
});

describe("upgradeInlineList", () => {
  it("yields text/math/text segments in one paragraph", () => {
    const { inlines } = upgradeInlineList([textInline("The value is \\(x+1\\) when x=2")], "rich", "text");
    expect(inlines.map((n) => n.kind)).toEqual(["text", "inlineMath", "text"]);
    expect(inlines[1]?.kind === "inlineMath" && inlines[1].latex).toBe("x+1");
  });
  it("keeps invalid latex as text with a diagnostic", () => {
    const { inlines, warnings } = upgradeInlineList([textInline("See \\(\\frac{1}{2}\\) here")], "rich", "text");
    expect(inlines.some((n) => n.kind === "inlineMath")).toBe(true);
    expect(warnings.some((w) => w.code === "import.latex.invalid")).toBe(false);
    const bad = upgradeInlineList([textInline("See $$\\frac{1\\invalid}$$ here")], "rich", "text");
    expect(bad.inlines.every((n) => n.kind === "text")).toBe(true);
    expect(bad.warnings.some((w) => w.code === "import.latex.invalid")).toBe(true);
  });
  it("skips code-mark spans and downgrades display in choice", () => {
    const code: InlineNode = { kind: "text", text: "\\(x^2\\)", marks: ["code"], meta: { source: "text", confidence: 2, transformations: [] } };
    expect(upgradeInlineList([code], "rich", "text").inlines[0]?.kind).toBe("text");
    const { inlines } = upgradeInlineList([textInline("$$x^2$$")], "choice", "text");
    expect(inlines[0]?.kind).toBe("inlineMath");
  });
  it("leaves currency paragraphs untouched", () => {
    const { inlines, warnings } = upgradeInlineList([textInline("Prices: $5, $19.99, US$10")], "rich", "text");
    expect(inlines.every((n) => n.kind === "text")).toBe(true);
    expect(warnings.length).toBe(0);
  });
});

describe("upgradeMathInDocument", () => {
  it("isolates paragraphs (no cross-block match) and skips codeBlocks", () => {
    const meta = { source: "text" as const, confidence: 2 as const, transformations: [] as string[] };
    const doc: ImportDocument = {
      version: 1,
      sourceMeta: meta,
      nodes: [
        { kind: "paragraph", children: [textInline("start $$x")], meta },
        { kind: "paragraph", children: [textInline("y$$ end")], meta },
        { kind: "codeBlock", text: "\\(x^2\\)", meta },
      ],
    };
    const out = upgradeMathInDocument(doc);
    expect(JSON.stringify(out.document)).not.toContain('"inlineMath"');
    expect(JSON.stringify(out.document)).not.toContain('"blockMath"');
  });
  it("stitches bracket display math across compatible paragraphs", () => {
    const meta = { source: "html" as const, confidence: 2 as const, transformations: [] as string[] };
    const doc: ImportDocument = {
      version: 1,
      sourceMeta: meta,
      nodes: [
        { kind: "paragraph", children: [textInline("Before")], meta },
        { kind: "paragraph", children: [textInline("\\[")], meta },
        { kind: "paragraph", children: [textInline("x^2.")], meta },
        { kind: "paragraph", children: [textInline("\\]")], meta },
        { kind: "paragraph", children: [textInline("After")], meta },
      ],
    };
    const out = upgradeMathInDocument(doc);
    const math = out.document.nodes.flatMap((node) =>
      node.kind === "paragraph" ? node.children.filter((child) => child.kind === "blockMath") : [],
    );
    expect(math).toHaveLength(1);
    expect(math[0]?.kind === "blockMath" && math[0].latex).toBe("x^2.");
  });
  it("standalone parseMathText works without Phase 02", () => {
    const out = parseMathText("If \\(f(x)=2x+3\\), find \\(f(4)\\).");
    const kinds = out.document.nodes.flatMap((n) => (n.kind === "paragraph" ? n.children.map((c) => c.kind) : []));
    expect(kinds).toEqual(["text", "inlineMath", "text", "inlineMath", "text"]);
  });
  it("is idempotent", () => {
    const once = parseMathText("Mix \\(x^2\\) and $$y$$ done.");
    const twice = upgradeMathInDocument(once.document);
    expect(twice.document).toEqual(once.document);
  });
});

describe("footnote-adjacent math", () => {
  it("keeps trailing footnote refs as text", () => {
    const { inlines } = upgradeInlineList([textInline("$$x^2$$[1] follows")], "rich", "text");
    expect(inlines[0]?.kind).toBe("blockMath");
    expect(JSON.stringify(inlines)).toContain("[1]");
  });
});
