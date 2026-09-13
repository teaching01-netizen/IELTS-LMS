import { describe, expect, it } from "vitest";
import type { ImportDocument, ImportNode } from "../domain/importDocument";
import { DIAGNOSTIC_MESSAGES } from "../domain/diagnostics";
import { stripExecutables } from "./policy";
import { p, testMeta, text } from "../testing/builders";

function docWith(nodes: ImportNode[]): ImportDocument {
  return { version: 1, nodes, sourceMeta: testMeta() };
}

describe("stripExecutables", () => {
  it("strips script payloads with import.script.stripped", () => {
    const out = stripExecutables(
      docWith([p([text('<script>alert(1)</script>hello')])]),
    );
    expect(out.warnings.some((w) => w.code === "import.script.stripped")).toBe(true);
    expect(out.doc.nodes).toHaveLength(0);
  });

  it("strips javascript: image urls with import.script.stripped", () => {
    const out = stripExecutables(
      docWith([
        {
          kind: "image",
          blobRef: null,
          url: "javascript:alert(1)",
          alt: "x",
          caption: null,
          meta: testMeta({ source: "image" }),
        },
      ]),
    );
    expect(out.warnings.some((w) => w.code === "import.script.stripped")).toBe(true);
    const node = out.doc.nodes[0];
    if (!node || node.kind !== "image") throw new Error("narrowing failed");
    expect(node.url).toBeNull();
    expect(node.alt).toBe("x");
  });

  it("strips object/embed/form payloads with import.object.stripped", () => {
    const out = stripExecutables(
      docWith([p([text('see <object data="x"> fallback')])]),
    );
    expect(out.warnings.some((w) => w.code === "import.object.stripped")).toBe(true);
  });

  it("message templates contain no interpolated content", () => {
    const evil = "<script>alert('CONTENT-MARKER-12345')</script>";
    const out = stripExecutables(docWith([p([text(evil)])]));
    const serialized = JSON.stringify(out.warnings) + JSON.stringify(out.transformations);
    expect(serialized).not.toContain("CONTENT-MARKER-12345");
    expect(serialized).not.toContain("alert(");
    for (const warning of out.warnings) {
      expect(warning.message).toBe(DIAGNOSTIC_MESSAGES[warning.code]);
    }
  });
});
