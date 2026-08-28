import type {
  ContentNode,
  RichTextDocument,
  RichTextNode,
  StructuredContent,
} from "../contracts/assessment";

const textNode = (text: string): RichTextNode => ({ type: "text", text });
const paragraph = (text: string): RichTextNode => ({
  type: "paragraph",
  content: text ? [textNode(text)] : undefined,
});

function legacyNodeToRich(node: ContentNode): RichTextNode {
  switch (node.type) {
    case "paragraph":
      return paragraph(node.text);
    case "heading":
      return {
        type: "heading",
        attrs: { level: Math.min(Math.max(node.level, 2), 3) },
        content: node.text ? [textNode(node.text)] : undefined,
      };
    case "equation":
      return { type: node.display ? "blockMath" : "inlineMath", attrs: { latex: node.latex } };
    case "image":
      return {
        type: "image",
        attrs: {
          src: assetSource(node.assetId),
          assetId: node.assetId,
          alt: node.alt,
          caption: node.caption ?? null,
        },
      };
    case "table":
      return {
        type: "table",
        content: node.rows.map((row) => ({
          type: "tableRow",
          content: row.map((cell) => ({
            type: "tableCell",
            content: [paragraph(cell)],
          })),
        })),
      };
  }
}

export function assetSource(assetId: string): string {
  if (/^https?:\/\//i.test(assetId) || assetId.startsWith("data:") || assetId.startsWith("/")) {
    return assetId;
  }
  return `/api/v1/media/${encodeURIComponent(assetId)}`;
}

export function documentFromStructuredContent(content: StructuredContent): RichTextDocument {
  if (content.version === 2 && content.document?.type === "doc") return content.document;
  return { type: "doc", content: content.nodes.map(legacyNodeToRich) };
}

export function structuredContentFromDocument(document: unknown): StructuredContent {
  return { version: 2, nodes: [], document: document as RichTextDocument };
}

function richNodeText(node: RichTextNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "inlineMath" || node.type === "blockMath") {
    return typeof node.attrs?.["latex"] === "string" ? node.attrs["latex"] : "";
  }
  if (node.type === "image") {
    return typeof node.attrs?.["alt"] === "string" ? node.attrs["alt"] : "";
  }
  return (node.content ?? []).map(richNodeText).join(node.type === "paragraph" ? "" : "\n");
}

export function plainTextFromContent(content: StructuredContent): string {
  if (content.version === 2 && content.document) {
    return (content.document.content ?? []).map(richNodeText).join("\n").trim();
  }
  return content.nodes
    .map((node) => {
      switch (node.type) {
        case "paragraph":
        case "heading":
          return node.text;
        case "equation":
          return node.latex;
        case "image":
          return node.alt;
        case "table":
          return node.rows.map((row) => row.join(" | ")).join("\n");
      }
    })
    .join("\n")
    .trim();
}

export function hasStructuredContent(content: StructuredContent): boolean {
  if (content.version === 2 && content.document) {
    const nodes = content.document.content ?? [];
    return nodes.some(
      (node) => node.type === "image" || node.type === "table" || richNodeText(node).trim()
    );
  }
  return content.nodes.length > 0 && plainTextFromContent(content).length > 0;
}
