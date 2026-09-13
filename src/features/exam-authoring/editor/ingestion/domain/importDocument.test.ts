import { describe, expect, it } from "vitest";
import type { ImportDocument, ImportNode } from "./importDocument";
import { IMPORT_DOCUMENT_VERSION } from "./importDocument";
import {
  cell,
  codeBlock,
  heading,
  image,
  p,
  sampleDocument,
  table,
  text,
} from "../testing/builders";

describe("importDocument AST", () => {
  it("pins the document version to 1", () => {
    expect(IMPORT_DOCUMENT_VERSION).toBe(1);
    expect(sampleDocument().version).toBe(1);
  });

  it("round-trips builders through JSON without loss", () => {
    const doc: ImportDocument = sampleDocument();
    const revived = JSON.parse(JSON.stringify(doc)) as ImportDocument;
    expect(revived).toEqual(doc);
  });

  it("covers every block kind in the closed union", () => {
    const kinds = sampleDocument().nodes.map((node) => node.kind);
    expect(kinds).toContain("paragraph");
    expect(kinds).toContain("table");
    const extra: ImportNode[] = [
      heading(2),
      heading(3),
      codeBlock("print(1)"),
      image(),
      { kind: "divider", meta: sampleDocument().sourceMeta },
      {
        kind: "bulletList",
        items: [[p()]],
        ordered: false,
        meta: sampleDocument().sourceMeta,
      },
      {
        kind: "orderedList",
        items: [[p()]],
        ordered: true,
        meta: sampleDocument().sourceMeta,
      },
    ];
    expect(extra.map((node) => node.kind).sort()).toEqual(
      [
        "bulletList",
        "codeBlock",
        "divider",
        "heading",
        "heading",
        "image",
        "orderedList",
      ].sort(),
    );
  });

  it("keeps BlobRef opaque (identity plus shape, never bytes)", () => {
    const node = image({
      blobRef: { id: "blob-1", mimeType: "image/png", sizeBytes: 12 },
    });
    expect(node.kind).toBe("image");
    if (node.kind !== "image") throw new Error("narrowing failed");
    expect(Object.keys(node.blobRef ?? {}).sort()).toEqual(
      ["id", "mimeType", "sizeBytes"].sort(),
    );
    expect(JSON.stringify(node)).not.toContain("base64");
    expect(text("a").kind).toBe("text");
    expect(table().kind).toBe("table");
    expect(cell("x").children).toHaveLength(1);
  });
});
