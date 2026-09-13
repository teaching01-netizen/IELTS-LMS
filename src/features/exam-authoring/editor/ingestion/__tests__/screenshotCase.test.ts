import { describe, expect, it } from "vitest";
import { parseMathText } from "../mathIngest";
import { validateLatex } from "../mathConfidence";

const SCREENSHOT = [
  "f \\in L^1(\\mathbb{R})",
  "x \\in [0,1]",
  "\\sum_{n\\in \\mathbb Z} f(x+n)",
  "g(x)=\\sum_{n\\in \\mathbb Z} f(x+n)",
  "L^1([0,1])",
  "\\|g\\|_{L^1([0,1])} \\le \\|f\\|_{L^1(\\mathbb R)}",
];

describe("screenshot expressions validate", () => {
  for (const latex of SCREENSHOT) {
    it(latex.slice(0, 40), () => {
      expect(validateLatex(latex)).toEqual({ ok: true });
    });
  }
  it("full pasted paragraph converts every delimiter", () => {
    const pasted =
      "Let \\(f \\in L^1(\\mathbb{R})\\). Prove that for almost every \\(x \\in [0,1]\\), the series\n\n" +
      "\\[\\sum_{n\\in \\mathbb Z} f(x+n)\\]\n\nconverges absolutely.";
    const out = parseMathText(pasted);
    const kinds = out.document.nodes.flatMap((n) => (n.kind === "paragraph" ? n.children.map((c) => c.kind) : []));
    expect(kinds).toContain("inlineMath");
    expect(kinds).toContain("blockMath");
    expect(JSON.stringify(out.document)).not.toContain("\\(");
    expect(out.warnings.length).toBe(0);
  });
});
