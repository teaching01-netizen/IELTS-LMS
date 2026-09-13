import { describe, expect, it } from "vitest";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spreadsheetClipboardToTable } from "../adapters/spreadsheet";
import { createPipelineContext } from "../application/pipelineContext";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "__fixtures__", "spreadsheet");
const ctx = createPipelineContext({ field: "prompt" });
const UPDATE = process.env.UPDATE_FIXTURES === "1";

function snap(name: string, clip: { "text/html"?: string; "text/plain"?: string }): void {
  const res = spreadsheetClipboardToTable(clip, ctx);
  const actual = JSON.stringify(
    { source: res.source, headerRow: res.headerRow, tooLarge: res.tooLarge, message: res.message, document: res.document },
    null,
    2,
  ) + "\n";
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
}

describe("spreadsheet golden fixtures", () => {
  it("simple-3x3 html", () => {
    snap("simple-3x3-html", { "text/html": readFileSync(join(dir, "simple-3x3.html"), "utf8") });
  });
  it("simple-3x3 tsv", () => {
    snap("simple-3x3-tsv", { "text/plain": readFileSync(join(dir, "simple-3x3.tsv"), "utf8") });
  });
  it("header-row html", () => {
    snap("header-row", { "text/html": readFileSync(join(dir, "header-row.html"), "utf8") });
  });
  it("empty cells preserved", () => {
    snap("empty-cells", { "text/plain": readFileSync(join(dir, "empty-cells.tsv"), "utf8") });
  });
  it("multiline csv cell becomes multi-paragraph single cell", async () => {
    const { parseSpreadsheetCsv, spreadsheetGridToTableNode } = await import("../adapters/spreadsheet");
    const grid = parseSpreadsheetCsv('"line one\nline two",plain');
    expect(grid.rows).toEqual([["line one\nline two", "plain"]]);
    const node = spreadsheetGridToTableNode(grid);
    expect(JSON.stringify(node)).toContain("line one");
    try {
      unlinkSync(join(dir, "multiline-cell.tsv"));
    } catch {
      /* already removed */
    }
    try {
      unlinkSync(join(dir, "oversize.tsv"));
    } catch {
      /* placeholder superseded by inline oversize test */
    }
  });
  it("excel html noise stripped", () => {
    snap("excel-html", { "text/html": readFileSync(join(dir, "excel-html.html"), "utf8") });
  });
  it("oversize rejects with exact message", () => {
    const rows = Array.from({ length: 51 }, (_, i) => "r" + i + "\tc");
    const res = spreadsheetClipboardToTable({ "text/plain": rows.join("\n") }, ctx);
    expect(res.tooLarge).toBe(true);
    expect(res.document).toBeNull();
    expect(res.message).toMatch(/^Table too large to paste \(51 rows \u00d7 2 columns, 102 cells\)\. The limit is 50 rows, 20 columns, 500 cells \u2014 paste a smaller range\.$/);
  });
});
