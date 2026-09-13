import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyLine } from "../exam/choiceBoundaries";
import {
  mapUnicodeMathToLatex,
  normalizePdfLineWrap,
  pdfCopyToNodes,
  segmentsToRaw,
} from "../adapters/pdfCopy";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "__fixtures__", "pdf");
const UPDATE = process.env.UPDATE_FIXTURES === "1";

describe("classifyLine", () => {
  it.each(["A. foo", "b) foo", "(C) foo", "[D] foo", "A \u2013 foo"])("choice: %s", (line) => {
    expect(classifyLine(line)).toBe("choice");
  });
  it.each(["E. foo", "AB. foo"])("not choice: %s", (line) => {
    expect(classifyLine(line)).not.toBe("choice");
  });
  it.each(["12. Solve this", "Q3: idea here", "Question 5. go"])("question: %s", (line) => {
    expect(classifyLine(line)).toBe("question");
  });
  it.each(["\u2022 item", "   ", "\u00a0"])("list/blank", (line) => {
    expect(["list", "blank"]).toContain(classifyLine(line));
  });
  it("classifies 1) item as question (numeric-marker rule)", () => {
    expect(classifyLine("1) item")).toBe("question");
  });
  it("tests choice before ordered-list (B. is choice)", () => {
    expect(classifyLine("B. Group two")).toBe("choice");
  });
});

describe("normalizePdfLineWrap", () => {
  it("joins soft wraps, breaks on terminal punctuation + blank lines", () => {
    const res = normalizePdfLineWrap("The function f is defined\nby f(x) = 2x + 3. What is\nthe value of f(4)?");
    expect(res.segments.map((s) => s.text)).toEqual([
      "The function f is defined by f(x) = 2x + 3. What is the value of f(4)?",
    ]);
    expect(res.appliedJoins).toBeGreaterThan(0);
  });
  it("never merges choice/question/list markers", () => {
    const res = normalizePdfLineWrap("Both improved over time.\nA. Group one.\nB. Group two.");
    expect(res.segments.map((s) => s.kind)).toEqual(["text", "choice", "choice"]);
  });
  it("keeps display math joined when its content ends with punctuation", () => {
    const res = normalizePdfLineWrap(
      "Before the estimate.\n\n\\[\n\\|g\\|_{L^1([0,1])} \\le \\|f\\|_{L^1(\\mathbb R)}.\n\\]\n\nAfter the estimate.",
    );
    expect(res.segments.map((s) => s.text)).toEqual([
      "Before the estimate.",
      "\\[ \\|g\\|_{L^1([0,1])} \\le \\|f\\|_{L^1(\\mathbb R)}. \\]",
      "After the estimate.",
    ]);
  });
  it("joins hyphenation with guards", () => {
    const joined = normalizePdfLineWrap("exam-\nple");
    expect(joined.segments[0]?.text).toBe("example");
    expect(normalizePdfLineWrap("2024-\n2025").segments.map((s) => s.text)).toEqual(["2024-", "2025"]);
    expect(normalizePdfLineWrap("word -\nnext").segments[0]?.text).not.toBe("wordnext");
  });
  it("unicode math passes through by default, converts whole-expression on opt-in", () => {
    const def = normalizePdfLineWrap("x \u2264 3\nand more");
    expect(JSON.stringify(def.segments)).toContain("\u2264");
    expect(mapUnicodeMathToLatex("x \u2264 3")).toContain("\\le");
    expect(mapUnicodeMathToLatex("The value x \u2264 3 apples")).toBe("The value x \\le 3 apples");
  });
  it("caps oversize input with warning, never throws", () => {
    const res = normalizePdfLineWrap("a".repeat(200000));
    expect(res.truncated).toBe(true);
    expect(res.warnings.some((w) => w.code === "import.truncated.size")).toBe(true);
  });
  it("never throws on nasty strings with bounded output", () => {
    const alphabet = ["\u0000", "\ud800", "\u200b", "\u202e", "\ufb01", "\u00a0", "\n", "\f", "\r", "A.", "-", "\\"];
    let seed = 42;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let i = 0; i < 500; i += 1) {
      let s = "";
      const len = next() % 60;
      for (let j = 0; j < len; j += 1) s += alphabet[next() % alphabet.length];
      const res = normalizePdfLineWrap(s);
      expect(segmentsToRaw(res.segments).replace(/\n\n/g, " ").length).toBeLessThanOrEqual(s.length + 32);
    }
  });
  it("is idempotent over fixtures + fuzz", () => {
    const inputs = ["The first line here\ncontinues here", "Question one here\ncontinues here", "exam-\nple here\nnow"];
    for (const input of inputs) {
      const once = normalizePdfLineWrap(input);
      const twice = normalizePdfLineWrap(segmentsToRaw(once.segments));
      expect(twice.segments).toEqual(once.segments);
    }
  });
});

describe("pdf golden fixtures", () => {
  const names = ["two-column-article", "hyphenated-worksheet", "rw-choices", "numbered-questions", "unicode-math"];
  for (const name of names) {
    it(name, () => {
      const input = readFileSync(join(dir, name + ".txt"), "utf8");
      const res = normalizePdfLineWrap(input);
      const actual = JSON.stringify({ segments: res.segments }, null, 2) + "\n";
      const path = join(dir, name + ".expected.json");
      let expected = "";
      try {
        expected = readFileSync(path, "utf8");
      } catch {
        expected = "";
      }
      if (UPDATE || !expected) {
        writeFileSync(path, actual);
        return;
      }
      expect(JSON.parse(actual)).toEqual(JSON.parse(expected));
    });
  }
});

describe("pdfCopyToNodes", () => {
  it("maps segments to Phase-02 paragraphs keeping kind metadata", () => {
    const out = pdfCopyToNodes("line one\nline two\n\nA. choice");
    expect(out.nodes.length).toBeGreaterThan(0);
    expect(out.segments.map((s) => s.kind)).toContain("choice");
  });
});
