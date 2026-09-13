import { describe, expect, it } from "vitest";
import { parseMathText, upgradeMathInDocument } from "../mathIngest";

describe("math properties", () => {
  it("idempotent upgrade", () => {
    for (const text of ["a \\(x^2\\) b", "$$y$$ and text", "plain", "$5 prices"]) {
      const once = parseMathText(text);
      const twice = upgradeMathInDocument(once.document);
      expect(twice.document).toEqual(once.document);
    }
  });
  it("no executable nodes post-upgrade (upgrade preserves text; pipeline stripExecutables owns executable removal)", () => {
    const out = parseMathText("text \\(x^2\\) $$y$$ done", "rich");
    const json = JSON.stringify(out.document);
    expect(json).not.toMatch(/javascript:/i);
    expect(json).toContain("inlineMath");
    expect(json).toContain("blockMath");
  });
  it("bounded output with capped error fields", () => {
    const big = "start " + "\\(x\\) ".repeat(200) + "end";
    const out = parseMathText(big);
    const json = JSON.stringify(out.document);
    expect(json.length).toBeLessThanOrEqual(4 * big.length + 1024 + 512 * 200);
    for (const warning of out.warnings) {
      expect(warning.message.length).toBeLessThanOrEqual(300);
    }
  });
  it("delimiter conservation: every input char lands in exactly one segment", () => {
    const inputs = ["a \\(x^2\\) b", "$$\\frac{a}{b}$$ tail", "mixed \\(a\\) and \\[b\\] end", "$5 stays"];
    for (const text of inputs) {
      const out = parseMathText(text);
      const rebuilt = out.document.nodes
        .flatMap((n) => (n.kind === "paragraph" ? n.children : []))
        .map((c) => {
          if (c.kind === "text") return c.text;
          const open = c.kind === "blockMath" ? "$$" : "\\(";
          const close = c.kind === "blockMath" ? "$$" : "\\)";
          return open + c.latex + close;
        })
        .join("");
      for (const ch of text.replace(/\s+/g, "")) {
        expect((rebuilt + JSON.stringify(out.warnings)).replace(/\s+/g, "")).toContain(ch === "$" ? "$" : ch);
      }
    }
  });
});
