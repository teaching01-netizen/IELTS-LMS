import type { RichTextDocument, RichTextNode, StructuredContent } from "./api/assessmentContracts";
import { documentFromStructuredContent } from "../exam-authoring/api/renderingPublic";

/** A value the browser can load as-is; anything else is an asset id to resolve. */
export function directSource(value: string): string {
  if (/^blob:/i.test(value)) return value;
  if (/^data:image\/(?:png|gif|jpeg|webp)[;,]/i.test(value)) return value;
  return /^(?:https?:\/\/|\/)/i.test(value) ? value : "";
}

/** Asset ids of the figures in `content` that must be resolved, in document order. */
export function collectStructuredImageAssetIds(content: StructuredContent | null | undefined): string[] {
  const assetIds: string[] = [];
  const visit = (nodes: readonly RichTextNode[] | undefined) => {
    for (const node of nodes ?? []) {
      const assetId = node.attrs?.["assetId"];
      if (node.type === "image" && typeof assetId === "string" && assetId && !directSource(assetId)) {
        assetIds.push(assetId);
      }
      visit(node.content);
    }
  };
  visit((documentFromStructuredContent(content) as RichTextDocument).content);
  return assetIds;
}
