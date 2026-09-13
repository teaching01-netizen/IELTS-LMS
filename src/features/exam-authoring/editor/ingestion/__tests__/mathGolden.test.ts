import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTextHtml } from "../adapters/textHtml";
import { upgradeMathInDocument } from "../mathIngest";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "fixtures");
const UPDATE = process.env.UPDATE_FIXTURES === "1";

describe("math golden fixtures", () => {
  it("math-delimiters segment + diagnostic sequence", async () => {
    const { parseMathText } = await import("../mathIngest");
    const cases = [
      "plain text only",
      "inline \\(x^2\\) here",
      "block $$\\frac{a}{b}$$ done",
      "display \\[y+1\\] end",
      "empty $$  $$ stays",
      "unclosed \\(never here",
      "bad $$\\frac{1\\invalid}$$ kept",
      "prices $5 and $19.99 stay",
    ];
    const actual = cases.map((text) => {
      const out = parseMathText(text);
      return {
        input: text,
        kinds: out.document.nodes.flatMap((n) => (n.kind === "paragraph" ? n.children.map((c) => c.kind) : [])),
        warnings: out.warnings.map((w) => w.code),
      };
    });
    const rendered = JSON.stringify(actual, null, 2) + "\n";
    const path = join(dir, "math-delimiters.expected.json");
    let expected = "";
    try {
      expected = readFileSync(path, "utf8");
    } catch {
      expected = "";
    }
    if (UPDATE || !expected) {
      writeFileSync(path, rendered);
      return;
    }
    expect(JSON.parse(rendered)).toEqual(JSON.parse(expected));
  });
  it("google-docs-math html path", () => {
    const html = readFileSync(join(dir, "google-docs-math.html"), "utf8");
    const parsed = parseTextHtml({ kind: "html", html }, { target: "rich" });
    const upgraded = upgradeMathInDocument(parsed.document);
    const actual =
      JSON.stringify(
        {
          nodes: upgraded.document.nodes.map((n) =>
            n.kind === "paragraph" ? n.children.map((c) => (c.kind === "text" ? { kind: c.kind, text: c.text } : c)) : n,
          ),
          warnings: upgraded.warnings.map((w) => w.code),
        },
        null,
        2,
      ) + "\n";
    const path = join(dir, "google-docs-math.expected.json");
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
});
