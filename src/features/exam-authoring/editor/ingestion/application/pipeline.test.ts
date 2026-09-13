import { describe, expect, it } from "vitest";
import type { ImportDocument } from "../domain/importDocument";
import type { ImportResult } from "../domain/importResult";
import type { SourceAdapter } from "../adapters/adapter";
import type { PipelineContext } from "./pipelineContext";
import { runIngestionPipeline, type RawSource } from "./pipeline";
import { p, sampleDocument, text } from "../testing/builders";

function ctx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    field: "prompt",
    sectionKey: "reading-writing",
    capabilities: {
      blockStyles: true,
      lists: true,
      underline: true,
      equation: true,
      image: true,
      table: true,
      code: true,
      history: true,
    },
    flags: {},
    ...overrides,
  };
}

function cannedResult(doc: ImportDocument, tag: string): ImportResult {
  return {
    document: doc,
    confidence: doc.sourceMeta.confidence,
    transformations: [tag],
    suggestions: [],
    warnings: [],
    metrics: {
      parseMs: 0,
      nodeCount: doc.nodes.length,
      tableCells: 0,
      images: 0,
      equations: 0,
      truncated: false,
    },
  };
}

function stub(
  kind: SourceAdapter["sourceKind"],
  handles: boolean,
  tag: string,
): SourceAdapter {
  return {
    sourceKind: kind,
    canHandle: () => handles,
    adapt: (_source: RawSource, _ctx: PipelineContext) =>
      cannedResult(sampleDocument(), tag),
  };
}

describe("runIngestionPipeline", () => {
  it("selects adapters by fixed priority regardless of registration order", () => {
    const source: RawSource = { kinds: ["text", "html"], text: "a", html: "<p>a</p>" };
    const htmlFirst = runIngestionPipeline(source, ctx(), {
      adapters: [stub("html", true, "adapter-selected:html"), stub("text", true, "adapter-selected:text")],
      normalizers: [],
      clock: () => 1000,
    });
    // text (rank 0) sorts ahead of html (rank 1).
    expect(htmlFirst.transformations).toContain("adapter-selected:text");
    expect(htmlFirst.transformations).not.toContain("adapter-selected:html");
  });

  it("returns an import.empty result when no adapter matches", () => {
    const result = runIngestionPipeline({ kinds: [] }, ctx(), {
      adapters: [stub("text", false, "adapter-selected:text")],
      normalizers: [],
      clock: () => 7,
    });
    expect(result.document.nodes).toEqual([]);
    expect(result.confidence).toBe(0);
    expect(result.metrics.nodeCount).toBe(0);
    expect(result.metrics.truncated).toBe(false);
    expect(result.metrics.parseMs).toBe(0);
  });

  it("is byte-identical across 100 runs for fixed input and context", () => {
    const source: RawSource = { kinds: ["text"], text: "stable" };
    const deps = {
      adapters: [stub("text", true, "adapter-selected:text")],
      normalizers: [],
      clock: () => 42,
    };
    const first = JSON.stringify(runIngestionPipeline(source, ctx(), deps));
    for (let i = 0; i < 100; i += 1) {
      expect(JSON.stringify(runIngestionPipeline(source, ctx(), deps))).toBe(first);
    }
  });

  it("assembles metrics with the expected shape on every path", () => {
    const doc = sampleDocument();
    doc.nodes = [p([text("a")])];
    const result = runIngestionPipeline({ kinds: ["text"], text: "a" }, ctx(), {
      adapters: [
        {
          sourceKind: "text",
          canHandle: () => true,
          adapt: () => cannedResult(doc, "adapter-selected:text"),
        },
      ],
      normalizers: [],
      clock: () => 5,
    });
    expect(result.metrics).toMatchObject({
      nodeCount: 1,
      tableCells: 0,
      images: 0,
      equations: 0,
      truncated: false,
    });
    expect(typeof result.metrics.parseMs).toBe("number");
    expect(result.confidence).toBe(2);
    expect(result.transformations).toContain("adapter-selected:text");
  });
});
