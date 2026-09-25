/**
 * The rules that turn a file name into a usable description.
 *
 * These matter because the result is committed to the question: it satisfies
 * the blocking `sat.accessibility.alt.required` publish rule, so it has to be
 * something a reader could act on — and when the name carries nothing, the
 * neutral fallback is the honest answer rather than a camera's serial number.
 */
import { describe, expect, it } from "vitest";
import { ALT_TEXT_FALLBACK, suggestAltText } from "../domain/altTextSuggestion";

describe("suggestAltText", () => {
  it("names an image from the words in its file name", () => {
    expect(suggestAltText("supply-demand-curve.png")).toBe("Supply demand curve");
    expect(suggestAltText("supply_demand_curve.png")).toBe("Supply demand curve");
    // The name's own casing survives, so acronyms are not flattened.
    expect(suggestAltText("DemandShiftCurve.png")).toBe("Demand Shift Curve");
    expect(suggestAltText("GDP-per-capita.png")).toBe("GDP per capita");
    expect(suggestAltText("chart-1.png")).toBe("Chart 1");
    expect(suggestAltText("a-graph.png")).toBe("Graph");
    expect(suggestAltText("scan-of-page-3.png")).toBe("Page 3");
  });

  it("reads a path or URL the same way as a bare file name", () => {
    expect(suggestAltText("https://cdn.example/rw/graph-2.webp")).toBe("Graph 2");
    expect(suggestAltText("/api/v1/media/diagram.png")).toBe("Diagram");
    expect(suggestAltText("https://cdn.example/units.png?v=3#top")).toBe("Units");
  });

  it("falls back to a neutral label when the name carries no words", () => {
    for (const name of [
      "",
      "IMG_2384.png",
      "img2384.png",
      "dsc00042.jpg",
      "Screenshot 2026-09-25 at 10.32.11.png",
      "untitled.png",
      "photo.png",
      "12345.png",
      "   ",
    ]) {
      expect(suggestAltText(name)).toBe(ALT_TEXT_FALLBACK);
    }
  });

  it("keeps the description to a sentence", () => {
    const long = `${"demand curve ".repeat(30).trim().split(" ").join("-")}.png`;
    const suggestion = suggestAltText(long);
    expect(suggestion.length).toBeLessThanOrEqual(200);
    expect(suggestion.startsWith("Demand curve")).toBe(true);
  });
});
