import { describe, expect, it } from "vitest";
import type { StructuredContent } from "../api/assessmentContracts";
import { collectStructuredImageAssetIds } from "../structuredImageAssets";

describe("collectStructuredImageAssetIds", () => {
  it("returns protected figure ids in document order, including nested ones", () => {
    const content: StructuredContent = {
      version: 2,
      nodes: [],
      document: {
        type: "doc",
        content: [
          { type: "image", attrs: { assetId: "asset-1" } },
          { type: "paragraph", content: [{ type: "text", text: "Graph" }] },
          {
            type: "table",
            content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "image", attrs: { assetId: "asset-2" } }] }] }],
          },
          { type: "image", attrs: { assetId: "https://cdn.example.test/direct.png" } },
          { type: "image", attrs: { src: "/static/inline.png" } },
        ],
      },
    };

    expect(collectStructuredImageAssetIds(content)).toEqual(["asset-1", "asset-2"]);
  });

  it("returns nothing for empty content", () => {
    expect(collectStructuredImageAssetIds(null)).toEqual([]);
  });
});
