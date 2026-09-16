import type {
  ContentNode,
  RichTextDocument,
  RichTextNode,
  StructuredContent,
} from "../contracts/assessment";
import { withRichContentIdentities } from './richContentIdentity';
import { validateDurableImageSource } from "./ingestion/domain/imagePolicy";

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
    case "image": {
      const source = assetSource(node.assetId);
      const validation = validateDurableImageSource(node.assetId);
      const assetId = validation.ok && validation.kind === "asset" ? node.assetId : null;
      return {
        type: "image",
        attrs: {
          src: source,
          assetId,
          alt: node.alt,
          caption: node.caption ?? null,
        },
      };
    }
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
  const validation = validateDurableImageSource(assetId);
  if (!validation.ok) return "";
  if (validation.kind === "https" || validation.kind === "relative") return assetId.trim();
  return `/api/v1/media/${encodeURIComponent(assetId.trim())}`;
}

export function documentFromStructuredContent(content: StructuredContent | null | undefined): RichTextDocument {
  if (content?.version === 2 && content.document?.type === "doc") return withRichContentIdentities(content.document);
  return withRichContentIdentities({ type: "doc", content: (content?.nodes ?? []).map((node) => {
    const rich = legacyNodeToRich(node);
    return { ...rich, attrs: { ...rich.attrs, id: node.id } };
  }) });
}

export function structuredContentFromDocument(document: unknown): StructuredContent {
  return { version: 2, nodes: [], document: withRichContentIdentities(document as RichTextDocument) };
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

export function plainTextFromContent(content: StructuredContent | null | undefined): string {
  if (!content) return "";
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

export function hasStructuredContent(content: StructuredContent | null | undefined): boolean {
  if (!content) return false;
  if (content.version === 2 && content.document) {
    const nodes = content.document.content ?? [];
    return nodes.some(
      (node) => node.type === "image" || node.type === "table" || richNodeText(node).trim()
    );
  }
  return content.nodes.length > 0 && plainTextFromContent(content).length > 0;
}


export function plainContentFromText(text: string): StructuredContent {
  const paragraphNode: RichTextNode = text.length
    ? { type: "paragraph", content: [{ type: "text", text }] }
    : { type: "paragraph" };
  return structuredContentFromDocument({ type: "doc", content: [paragraphNode] });
}

export function supportsFastPlainEditing(content: StructuredContent | null | undefined): boolean {
  if (!content) return false;
  if (content.version === 1) {
    return content.nodes.every((node) => node.type === "paragraph") && content.nodes.length <= 1;
  }
  const document = content.document;
  if (!document || document.type !== "doc") return content.nodes.length === 0;
  const blocks = document.content ?? [];
  if (blocks.length > 1) return false;
  const paragraph = blocks[0];
  if (!paragraph) return true;
  if (paragraph.type !== "paragraph") return false;
  return (paragraph.content ?? []).every((node) =>
    node.type === "text" && (!node.marks || node.marks.length === 0)
  );
}
