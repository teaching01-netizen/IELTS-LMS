import type { RichTextNode, StructuredContent } from "../../contracts/assessment";

export type SatSupportingMaterialStarter = "paired_texts" | "student_notes" | "data_table";

export function createSatSupportingMaterial(starter: SatSupportingMaterialStarter): StructuredContent {
  switch (starter) {
    case "paired_texts":
      return document([
        heading("Text 1"),
        paragraph(""),
        heading("Text 2"),
        paragraph(""),
      ]);
    case "student_notes":
      return document([
        paragraph("A student has taken the following notes:"),
        {
          type: "bulletList",
          content: ["", "", ""].map((text) => ({
            type: "listItem",
            content: [paragraph(text)],
          })),
        },
      ]);
    case "data_table":
      return document([
        {
          type: "table",
          content: [0, 1, 2].map((rowIndex) => ({
            type: "tableRow",
            content: [0, 1, 2].map(() => ({
              type: rowIndex === 0 ? "tableHeader" : "tableCell",
              content: [paragraph("")],
            })),
          })),
        },
      ]);
  }
}

function document(content: RichTextNode[]): StructuredContent {
  return { version: 2, nodes: [], document: { type: "doc", content } };
}

function heading(text: string): RichTextNode {
  return { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text }] };
}

function paragraph(text: string): RichTextNode {
  return text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
}
