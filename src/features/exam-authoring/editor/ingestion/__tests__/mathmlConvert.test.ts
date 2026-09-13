import { describe, expect, it } from "vitest";
import { mathmlToLatex, mathmlToPlaceholder } from "../mathmlConvert";

function el(html: string): Element {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const found = doc.body.firstElementChild;
  if (!found) throw new Error("no element");
  return found;
}

describe("mathmlToLatex", () => {
  it("converts mfrac/msqrt/msup/msub", () => {
    expect(mathmlToLatex(el("<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>"))?.latex).toBe("\\frac{a}{b}");
    expect(mathmlToLatex(el("<math><msqrt><mi>x</mi></msqrt></math>"))?.latex).toBe("\\sqrt{x}");
    expect(mathmlToLatex(el("<math><msup><mi>x</mi><mn>2</mn></msup></math>"))?.latex).toBe("x^{2}");
    expect(mathmlToLatex(el("<math><msub><mi>x</mi><mn>1</mn></msub></math>"))?.latex).toBe("x_{1}");
  });
  it("converts rectangular mtable to matrix", () => {
    const out = mathmlToLatex(
      el("<math><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr><mtr><mtd><mn>3</mn></mtd><mtd><mn>4</mn></mtd></mtr></mtable></math>"),
    );
    expect(out?.latex).toContain("\\begin{matrix}");
  });
  it("returns null for exotic/non-rectangular constructs", () => {
    expect(mathmlToLatex(el("<math><mmultiscripts><mi>x</mi></mmultiscripts></math>"))).toBeNull();
    expect(
      mathmlToLatex(el("<math><mtable><mtr><mtd><mn>1</mn></mtd></mtr><mtr><mtd><mn>2</mn></mtd><mtd><mn>3</mn></mtd></mtr></mtable></math>")),
    ).toBeNull();
    expect(mathmlToLatex(el("<math><menclose><mi>x</mi></menclose></math>"))).toBeNull();
  });
  it("strips semantics wrappers", () => {
    expect(
      mathmlToLatex(el("<math><semantics><mi>x</mi><annotation>ex</annotation></semantics></math>"))?.latex,
    ).toBe("x");
  });
  it("emits placeholder spans carrying data-sat-latex", () => {
    const placeholder = mathmlToPlaceholder(el("<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>"));
    expect(placeholder).toContain("data-sat-latex");
    expect(placeholder).toContain("frac");
  });
});
