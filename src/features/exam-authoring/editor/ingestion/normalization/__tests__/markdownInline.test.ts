import { describe, expect, it } from "vitest";
import type { ImportMetadata, InlineNode } from "../../domain/importDocument";
import { applyMarkdownInlineToInlines } from "../markdownInline";

const meta: ImportMetadata = { source: "text", confidence: 2, transformations: [] };
const text = (value: string, marks: InlineNode extends never ? never : []) => ({
  kind: "text" as const,
  text: value,
  marks,
  meta,
});

describe("applyMarkdownInlineToInlines", () => {
  it("normalizes bold, italic, and code", () => {
    const out = applyMarkdownInlineToInlines([text("**bold** *italic* `code`", [])]);
    expect(out.applied).toBeGreaterThan(0);
    expect(out.inlines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "text", text: "bold", marks: ["bold"] }),
        expect.objectContaining({ kind: "text", text: "italic", marks: ["italic"] }),
        expect.objectContaining({ kind: "text", text: "code", marks: ["code"] }),
      ])
    );
  });

  it("keeps nested or ambiguous markers conservative", () => {
    const out = applyMarkdownInlineToInlines([text("**bold *and italic***", [])]);
    expect(out.inlines.map((node) => (node.kind === "text" ? node.text : "")).join("")).toBe(
      "bold *and italic*"
    );
    expect(out.inlines.some((node) => node.kind === "text" && node.marks.includes("bold"))).toBe(
      true
    );
  });

  it("does not mark escaped delimiters, unclosed markers, or single dollars", () => {
    const out = applyMarkdownInlineToInlines([
      text(String.raw`\**not bold* \_not italic_ $x$ **unclosed`, []),
    ]);
    expect(out.inlines.map((node) => (node.kind === "text" ? node.text : "")).join("")).toBe(
      String.raw`*not bold _not italic_ $x$ **unclosed`
    );
    expect(out.inlines.some((node) => node.kind === "text" && node.marks.length > 0)).toBe(true);
    expect(out.inlines.every((node) => node.kind !== "text" || !node.marks.includes("bold"))).toBe(
      true
    );
  });

  it("shields math and supports code spans without converting their contents", () => {
    const source = String.raw`**outside** \( **inside** \) and \`**code**\``;
    const out = applyMarkdownInlineToInlines([text(source, [])]);
    expect(
      out.inlines.some(
        (node) => node.kind === "text" && node.text === "outside" && node.marks.includes("bold")
      )
    ).toBe(true);
    expect(
      out.inlines.some(
        (node) => node.kind === "text" && node.text.includes(String.raw`\( **inside** \)`)
      )
    ).toBe(true);
    expect(
      out.inlines.some(
        (node) => node.kind === "text" && node.text === "code" && node.marks.includes("bold")
      )
    ).toBe(true);
  });

  it("uses Unicode-aware word boundaries and is idempotent", () => {
    const first = applyMarkdownInlineToInlines([text("café **bold** 字", [])]);
    const second = applyMarkdownInlineToInlines(first.inlines);
    expect(first.inlines).toEqual(second.inlines);
    expect(first.inlines.some((node) => node.kind === "text" && node.marks.includes("bold"))).toBe(
      true
    );
  });

  it("does not scan text beyond the 20,000-character budget", () => {
    const source = "x".repeat(20_001) + " **not bold**";
    const out = applyMarkdownInlineToInlines([text(source, [])]);
    expect(out.applied).toBe(0);
    expect(out.inlines).toEqual([text(source, [])]);
  });
});
