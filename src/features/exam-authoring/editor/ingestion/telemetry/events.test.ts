import { describe, expect, it } from "vitest";
import {
  emitIngestionEvent,
  resetIngestionEventSink,
  setIngestionEventSink,
  type IngestionEvent,
} from "./events";

const EVIL = "<p>pasted-secret</p>$x^{2}$blob-bytes-marker";

describe("ingestion telemetry", () => {
  it("serializes events without any content field", () => {
    const seen: IngestionEvent[] = [];
    setIngestionEventSink((event) => {
      seen.push(event);
    });
    try {
      emitIngestionEvent({
        name: "ingestion.parsed",
        field: "prompt",
        sectionKey: "math",
        nodeCount: 3,
        tableCells: 4,
        images: 1,
        equations: 2,
        parseMs: 9,
        codes: ["import.ok", "import.image.alt-required"],
      });
      emitIngestionEvent({
        name: "ingestion.warning",
        field: "choice",
        sectionKey: "reading-writing",
        codes: ["import.script.stripped"],
      });
    } finally {
      resetIngestionEventSink();
    }
    expect(seen).toHaveLength(2);
    const serialized = JSON.stringify(seen);
    expect(serialized).not.toContain("pasted-secret");
    expect(serialized).not.toContain("blob-bytes-marker");
    expect(serialized).not.toContain("$x^{2}$");
    // Only routing plus aggregates are present.
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(
      [
        "codes",
        "equations",
        "field",
        "images",
        "name",
        "nodeCount",
        "parseMs",
        "sectionKey",
        "tableCells",
      ].sort(),
    );
    const parsed = JSON.stringify(seen).toLowerCase();
    expect(parsed).not.toContain("text");
    expect(parsed).not.toContain("html");
    expect(parsed).not.toContain("bytes");
    expect(parsed).not.toContain("filename");
    expect(EVIL.length).toBeGreaterThan(0);
  });
});
