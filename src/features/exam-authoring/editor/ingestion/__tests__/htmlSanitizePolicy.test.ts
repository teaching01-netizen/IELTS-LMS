import { describe, expect, it } from "vitest";
import { sanitizeForIngestion } from "../adapters/htmlSanitizePolicy";

describe("sanitizeForIngestion", () => {
  it("keeps benign paragraphs, marks, lists, tables", () => {
    const out = sanitizeForIngestion("<p>Hello <strong>world</strong> and <em>you</em></p><ul><li>a</li></ul>");
    expect(out.cleanHtml).toContain("<p>");
    expect(out.cleanHtml).toContain("Hello");
    expect(out.cleanHtml).not.toMatch(/<script/i);
  });
  it("removes scripts, iframes, objects, event handlers, javascript: urls", () => {
    const out = sanitizeForIngestion(
      '<p>Hi</p><script>alert(1)</script><iframe src="x"></iframe><p onclick="e()">t</p><a href="javascript:alert(1)">x</a>',
    );
    expect(out.cleanHtml).not.toMatch(/<script/i);
    expect(out.cleanHtml).not.toMatch(/<iframe/i);
    expect(out.cleanHtml).not.toMatch(/onclick/i);
    expect(out.cleanHtml).not.toMatch(/javascript:/i);
  });
  it("drops svg/math tags and style/class/id attributes", () => {
    const out = sanitizeForIngestion('<p style="color:red" class="MsoNormal" id="a">t</p><svg><use/></svg>');
    expect(out.cleanHtml).not.toMatch(/<svg/i);
    expect(out.cleanHtml).not.toMatch(/style=/i);
    expect(out.cleanHtml).not.toMatch(/MsoNormal/);
    expect(out.cleanHtml).toContain("t");
  });
  it("fail-closes on executable residue with empty html", () => {
    const out = sanitizeForIngestion('<p>ok</p><script>alert(1)</script>');
    expect(out.cleanHtml).not.toMatch(/<script/i);
    expect(out.cleanHtml).toContain("ok");
  });
  it("preserves math-looking text verbatim", () => {
    const latex = "$$\\frac{a}{b}$$ and \\(x^2\\) plus $5";
    const out = sanitizeForIngestion("<p>" + latex + "</p>");
    expect(out.cleanHtml).toContain("$$\\frac{a}{b}$$");
    expect(out.cleanHtml).toContain("$5");
  });
  it("keeps numeric colspan/rowspan and data-sat-latex placeholders", () => {
    const out = sanitizeForIngestion(
      '<table><tr><td colspan="2">a</td></tr></table><span data-sat-latex="x^2">x</span>',
    );
    expect(out.cleanHtml).toContain('colspan="2"');
    expect(out.cleanHtml).toContain("data-sat-latex");
  });
  it("returns empty plus no throw for empty input", () => {
    expect(sanitizeForIngestion("   ").cleanHtml).toBe("");
  });
});
