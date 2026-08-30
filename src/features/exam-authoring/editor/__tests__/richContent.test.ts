import { describe, expect, it } from "vitest";
import type { StructuredContent } from "../../contracts/assessment";
import {
  documentFromStructuredContent,
  hasStructuredContent,
  plainTextFromContent,
  structuredContentFromDocument,
  plainContentFromText,
  supportsFastPlainEditing,
} from "../richContent";

describe("rich SAT question content", () => {
  it("migrates legacy nodes without flattening equations and tables", () => {
    const legacy: StructuredContent = {
      version: 1,
      nodes: [
        { type: "paragraph", id: "p1", text: "Solve for x" },
        { type: "equation", id: "e1", latex: "x^2=16", display: true },
        {
          type: "table",
          id: "t1",
          rows: [
            ["x", "y"],
            ["1", "2"],
          ],
        },
      ],
    };

    const document = documentFromStructuredContent(legacy);
    expect(document.content?.map((node) => node.type)).toEqual(["paragraph", "blockMath", "table"]);
    expect(document.content?.[1]?.attrs?.["latex"]).toBe("x^2=16");
  });

  it("persists version 2 as structured JSON and preserves marks", () => {
    const document = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x" },
            { type: "text", text: "2", marks: [{ type: "superscript" }] },
          ],
        },
      ],
    };
    const content = structuredContentFromDocument(document);
    expect(content.version).toBe(2);
    expect(content.nodes).toEqual([]);
    expect(content.document).toEqual(document);
    expect(plainTextFromContent(content)).toBe("x2");
  });

  it("round-trips fast plain content without creating rich structure", () => {
    const content = plainContentFromText("A concise SAT prompt");
    expect(plainTextFromContent(content)).toBe("A concise SAT prompt");
    expect(supportsFastPlainEditing(content)).toBe(true);
  });

  it("refuses fast editing when marks, equations, or multiple blocks could be lost", () => {
    const marked = structuredContentFromDocument({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }] }] });
    const multiple = structuredContentFromDocument({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }, { type: "paragraph", content: [{ type: "text", text: "two" }] }] });
    expect(supportsFastPlainEditing(marked)).toBe(false);
    expect(supportsFastPlainEditing(multiple)).toBe(false);
  });

  it("treats math and images as meaningful content", () => {
    const content: StructuredContent = {
      version: 2,
      nodes: [],
      document: {
        type: "doc",
        content: [
          { type: "inlineMath", attrs: { latex: "x+1" } },
          { type: "image", attrs: { alt: "Graph of y=x" } },
        ],
      },
    };
    expect(hasStructuredContent(content)).toBe(true);
    expect(plainTextFromContent(content)).toContain("x+1");
    expect(plainTextFromContent(content)).toContain("Graph of y=x");
  });
});
