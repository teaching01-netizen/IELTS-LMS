import { describe, expect, it } from "vitest";
import { createSatSupportingMaterial } from "../contentTemplates";
import { hasStructuredContent } from "../../../editor/richContent";

describe("SAT supporting-material starters", () => {
  it("creates semantic paired-text structure", () => {
    const content = createSatSupportingMaterial("paired_texts");
    expect(content.document?.content?.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "paragraph",
    ]);
    expect(hasStructuredContent(content)).toBe(true);
  });

  it("creates student notes as an editable bullet list", () => {
    const content = createSatSupportingMaterial("student_notes");
    expect(content.document?.content?.[1]?.type).toBe("bulletList");
    expect(content.document?.content?.[1]?.content).toHaveLength(3);
  });

  it("creates a 3 by 3 table with a header row", () => {
    const table = createSatSupportingMaterial("data_table").document?.content?.[0];
    expect(table?.type).toBe("table");
    expect(table?.content).toHaveLength(3);
    expect(table?.content?.[0]?.content?.every((cell) => cell.type === "tableHeader")).toBe(true);
  });
});
