import { describe, expect, it } from "vitest";
import { INGESTION_LIMITS } from "../domain/limits";
import type { ImportDocument, ImportNode } from "../domain/importDocument";
import { capTable, enforceLimits } from "./guards";
import { cell, p, table, testMeta, text } from "../testing/builders";

function docWith(nodes: ImportNode[]): ImportDocument {
  return { version: 1, nodes, sourceMeta: testMeta() };
}

describe("enforceLimits", () => {
  it("caps tables at 250 rows with import.truncated.rows", () => {
    const rows = Array.from({ length: 300 }, (_, i) => [cell("r" + i)]);
    const node = table(rows);
    expect(node.kind).toBe("table");
    if (node.kind !== "table") throw new Error("narrowing failed");
    const capped = capTable(node);
    expect(capped.node.kind).toBe("table");
    if (capped.node.kind !== "table") throw new Error("narrowing failed");
    expect(capped.node.rows).toHaveLength(INGESTION_LIMITS.tableRows);
    expect(capped.codes).toContain("import.truncated.rows");
    expect(capped.droppedRows).toBe(50);

    const guarded = enforceLimits(docWith([table(rows)]));
    expect(guarded.truncated).toBe(true);
    expect(guarded.warnings.some((w) => w.code === "import.truncated.rows")).toBe(true);
  });

  it("caps columns then total cells", () => {
    const wide = [Array.from({ length: 60 }, (_, i) => cell("c" + i))];
    const guarded = enforceLimits(docWith([table(wide)]));
    const out = guarded.doc.nodes[0];
    expect(out?.kind).toBe("table");
    if (!out || out.kind !== "table") throw new Error("narrowing failed");
    expect(out.rows[0]).toHaveLength(INGESTION_LIMITS.tableCols);
    expect(guarded.warnings.some((w) => w.code === "import.truncated.cols")).toBe(true);
  });

  it("caps node count at 2000 with import.truncated.nodes", () => {
    const nodes = Array.from({ length: 2005 }, () => p());
    const guarded = enforceLimits(docWith(nodes));
    expect(guarded.doc.nodes).toHaveLength(INGESTION_LIMITS.nodeCount);
    expect(guarded.warnings.some((w) => w.code === "import.truncated.nodes")).toBe(true);
    expect(guarded.truncated).toBe(true);
  });

  it("truncates over-long text nodes", () => {
    const long = "x".repeat(INGESTION_LIMITS.textNodeChars + 10);
    const guarded = enforceLimits(docWith([p([text(long)])]));
    const first = guarded.doc.nodes[0];
    if (!first || first.kind !== "paragraph") throw new Error("narrowing failed");
    const inline = first.children[0];
    if (!inline || inline.kind !== "text") throw new Error("narrowing failed");
    expect(inline.text).toHaveLength(INGESTION_LIMITS.textNodeChars);
    expect(guarded.warnings.some((w) => w.code === "import.truncated.text")).toBe(true);
  });

  it("caps latex with truncated.text plus latex.invalid fallback", () => {
    const latex = "y".repeat(INGESTION_LIMITS.latexChars + 5);
    const guarded = enforceLimits(
      docWith([p([{ kind: "inlineMath", latex, meta: testMeta() }])]),
    );
    expect(
      guarded.warnings.some((w) => w.code === "import.latex.invalid"),
    ).toBe(true);
    expect(
      guarded.warnings.some((w) => w.code === "import.truncated.text"),
    ).toBe(true);
  });

  it("flattens lists deeper than htmlDepth", () => {
    let deep: ImportNode = p([text("leaf")]);
    for (let i = 0; i < INGESTION_LIMITS.htmlDepth + 2; i += 1) {
      deep = {
        kind: "bulletList",
        items: [[deep]],
        ordered: false,
        meta: testMeta(),
      };
    }
    const guarded = enforceLimits(docWith([deep]));
    expect(guarded.truncated).toBe(true);
    expect(
      guarded.warnings.some((w) => w.code === "import.truncated.depth"),
    ).toBe(true);
    expect(
      guarded.warnings.some((w) => w.code === "import.list.flattened"),
    ).toBe(true);
  });
});
