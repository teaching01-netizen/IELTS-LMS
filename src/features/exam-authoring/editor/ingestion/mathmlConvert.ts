/**
 * Phase 03 — MathML to LaTeX tap point.
 *
 * Runs FIRST on the raw DOM (before Phase-02 sanitize, whose FORBID list
 * drops math tags): each convertible <math> element becomes a placeholder
 * <span data-sat-latex + data-sat-display> that Phase 02 treats as opaque
 * text and Phase 03 upgrades via validateLatex. Covers mi/mn/mo/mfrac/
 * msqrt/msup/msub/mover/munder/rectangular mtable; exotic constructs
 * (mmultiscripts, mglyph, menclose) and non-rectangular grids return null
 * (keep inner text + import.latex.invalid). Pure string/DOM-light: takes an
 * Element, returns latex. No React.
 */

export interface MathmlOutcome {
  latex: string;
  display: boolean;
}

function childElements(el: Element): Element[] {
  return Array.from(el.children);
}

function convertNode(el: Element): string | null {
  const tag = el.tagName.toLowerCase().replace(/^m:/, "");
  if (tag === "mi" || tag === "mn" || tag === "mo") return el.textContent ?? "";
  if (tag === "mtext") return "\\text{" + (el.textContent ?? "") + "}";
  if (tag === "mspace") return " ";
  if (tag === "mfrac") {
    const kids = childElements(el);
    if (kids.length !== 2) return null;
    const num = convertChildren(kids[0] as Element);
    const den = convertChildren(kids[1] as Element);
    if (num === null || den === null) return null;
    return "\\frac{" + num + "}{" + den + "}";
  }
  if (tag === "msqrt") {
    const inner = convertChildren(el);
    return inner === null ? null : "\\sqrt{" + inner + "}";
  }
  if (tag === "mroot") {
    const kids = childElements(el);
    if (kids.length !== 2) return null;
    const base = convertChildren(kids[0] as Element);
    const idx = convertChildren(kids[1] as Element);
    return base === null || idx === null ? null : "\\sqrt[" + idx + "]{" + base + "}";
  }
  if (tag === "msup") {
    const kids = childElements(el);
    if (kids.length !== 2) return null;
    const base = convertChildren(kids[0] as Element);
    const exp = convertChildren(kids[1] as Element);
    return base === null || exp === null ? null : base + "^{" + exp + "}";
  }
  if (tag === "msub") {
    const kids = childElements(el);
    if (kids.length !== 2) return null;
    const base = convertChildren(kids[0] as Element);
    const sub = convertChildren(kids[1] as Element);
    return base === null || sub === null ? null : base + "_{" + sub + "}";
  }
  if (tag === "msubsup") {
    const kids = childElements(el);
    if (kids.length !== 3) return null;
    const base = convertChildren(kids[0] as Element);
    const sub = convertChildren(kids[1] as Element);
    const sup = convertChildren(kids[2] as Element);
    return base === null || sub === null || sup === null ? null : base + "_{" + sub + "}^{" + sup + "}";
  }
  if (tag === "mover" || tag === "munder") {
    const kids = childElements(el);
    if (kids.length !== 2) return null;
    const base = convertChildren(kids[0] as Element);
    const over = convertChildren(kids[1] as Element);
    return base === null || over === null ? null : base;
  }
  if (tag === "mrow" || tag === "semantics") {
    return convertChildren(el);
  }
  if (tag === "annotation" || tag === "annotation-xml") return "";
  if (tag === "mtable") {
    const rows = childElements(el).filter((c) => c.tagName.toLowerCase() === "mtr");
    if (rows.length === 0) return null;
    const grid: string[][] = [];
    for (const row of rows) {
      const cells = childElements(row).filter((c) => c.tagName.toLowerCase() === "mtd");
      const converted: string[] = [];
      for (const cell of cells) {
        const v = convertChildren(cell);
        if (v === null) return null;
        converted.push(v);
      }
      grid.push(converted);
    }
    const width = grid[0]?.length ?? 0;
    if (width === 0 || !grid.every((r) => r.length === width)) return null;
    return "\\begin{matrix}" + grid.map((r) => r.join(" & ")).join(" \\\\") + "\\end{matrix}";
  }
  if (tag === "mmultiscripts" || tag === "mglyph" || tag === "menclose" || tag === "maction") return null;
  const kids = childElements(el);
  if (kids.length === 0) return el.textContent ?? "";
  return convertChildren(el);
}

function convertChildren(el: Element): string | null {
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      out += child.textContent ?? "";
      continue;
    }
    if (child.nodeType !== 1) continue;
    const v = convertNode(child as Element);
    if (v === null) return null;
    out += v;
  }
  return out;
}

export function mathmlToLatex(root: Element): MathmlOutcome | null {
  const tag = root.tagName.toLowerCase();
  const mathEl = tag === "math" ? root : root.querySelector("math");
  if (!mathEl) return null;
  const display = (mathEl.getAttribute("display") ?? "") === "block";
  const latex = convertChildren(mathEl);
  if (latex === null || !latex.trim()) return null;
  return { latex: latex.trim(), display };
}

export function mathmlToPlaceholder(root: Element): string | null {
  const converted = mathmlToLatex(root);
  if (!converted) return null;
  const escaped = converted.latex.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return '<span data-sat-latex="' + escaped + '" data-sat-display="' + (converted.display ? "1" : "0") + '"></span>';
}
