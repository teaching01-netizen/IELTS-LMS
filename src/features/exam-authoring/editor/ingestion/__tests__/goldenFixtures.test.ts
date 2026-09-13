import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTextHtml } from "../adapters/textHtml";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures");
const rich = { target: "rich" as const };
const UPDATE = process.env.UPDATE_FIXTURES === "1";

function loadFixture(name: string): { input: string; expected: string } {
  const input = readFileSync(join(fixtureDir, name + ".html"), "utf8");
  let expected = "";
  try {
    expected = readFileSync(join(fixtureDir, name + ".expected.json"), "utf8");
  } catch {
    expected = "";
  }
  return { input, expected };
}

function check(name: string): void {
  const { input, expected } = loadFixture(name);
  const out = parseTextHtml({ kind: "html", html: input }, rich);
  const actual = JSON.stringify(
    { nodes: out.document.nodes, warnings: out.warnings.map((w) => w.code) },
    null,
    2,
  );
  if (UPDATE || expected.length === 0) {
    writeFileSync(join(fixtureDir, name + ".expected.json"), actual + "\n");
    return;
  }
  expect(actual).toBe(expected.trimEnd() + "\n".slice(0, 0) + (expected.endsWith("\n") ? "" : ""));
  expect(JSON.parse(actual)).toEqual(JSON.parse(expected));
}

describe("golden ingestion fixtures", () => {
  it("google-docs-paste", () => check("google-docs-paste"));
  it("word-msonormal", () => check("word-msonormal"));
  it("sanitize-attack keeps only benign text", () => {
    const { input } = loadFixture("sanitize-attack");
    const out = parseTextHtml({ kind: "html", html: input }, rich);
    const json = JSON.stringify(out.document);
    expect(json).toContain("Benign intro");
    expect(json).toContain("Benign outro");
    expect(json).not.toMatch(/<script/i);
    expect(json).not.toMatch(/javascript:/i);
    check("sanitize-attack");
  });
});
