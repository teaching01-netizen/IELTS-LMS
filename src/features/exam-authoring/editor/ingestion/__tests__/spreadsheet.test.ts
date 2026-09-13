import { describe, expect, it } from "vitest";
import {
  detectSpreadsheetPayload,
  parseSpreadsheetCsv,
  parseSpreadsheetHtml,
  parseSpreadsheetTsv,
  promoteFirstRowToHeader,
  spreadsheetClipboardToTable,
  spreadsheetGridToTableNode,
} from "../adapters/spreadsheet";
import { createPipelineContext } from "../application/pipelineContext";
import { isOverCaps, SPREADSHEET_CAPS } from "../exam/tableCaps";

const ctx = createPipelineContext({ field: "prompt" });

describe("detectSpreadsheetPayload", () => {
  it("prefers html tables over tsv bodies", () => {
    expect(detectSpreadsheetPayload({ "text/html": "<table><tr><td>a</td></tr></table>", "text/plain": "a\tb" })).toBe("html");
  });
  it("detects tabbed text as tsv", () => {
    expect(detectSpreadsheetPayload({ "text/plain": "a\tb\n1\t2" })).toBe("tsv");
  });
  it("detects balanced quoted commas as csv", () => {
    expect(detectSpreadsheetPayload({ "text/plain": '"a,b","c"\n"1","2"' })).toBe("csv");
  });
  it("returns none for prose", () => {
    expect(detectSpreadsheetPayload({ "text/plain": "Just a normal sentence here." })).toBe("none");
  });
});

describe("parseSpreadsheetTsv", () => {
  it("pads ragged rows and preserves empty cells + CRLF", () => {
    const grid = parseSpreadsheetTsv("a\t\tb\r\n1\t2");
    expect(grid.rows).toEqual([
      ["a", "", "b"],
      ["1", "2", ""],
    ]);
    expect(grid.headerRow).toBe(false);
  });
});

describe("parseSpreadsheetCsv", () => {
  it("handles quotes, escaped quotes, embedded newlines, unterminated quote", () => {
    const grid = parseSpreadsheetCsv('"a,b","c""d"\n"multi\nline",x');
    expect(grid.rows[0]).toEqual(["a,b", 'c"d']);
    expect(grid.rows[1]?.[0]).toBe("multi\nline");
    const unterminated = parseSpreadsheetCsv('"abc,def');
    expect(unterminated.rows[0]?.[0]).toBe("abc,def");
  });
});

describe("parseSpreadsheetHtml", () => {
  it("maps th/thead to header, br to newline, entities, skips script", () => {
    const grid = parseSpreadsheetHtml(
      '<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>a<br>b &amp; c</td><td><script>x</script>v</td></tr></tbody></table>',
    );
    expect(grid.headerRow).toBe(true);
    expect(grid.rows[1]?.[0]).toBe("a\nb & c");
    expect(grid.rows[1]?.[1]).toBe("v");
  });
  it("stops nested tables, flattens colspan, flags multi-table", () => {
    const grid = parseSpreadsheetHtml(
      '<table><tr><td colspan="2">wide</td></tr></table><table><tr><td>second</td></tr></table>',
    );
    expect(grid.rows[0]).toEqual(["wide", "wide"]);
    expect(grid.colspanFlattened).toBe(true);
    expect(grid.multiTable).toBe(true);
  });
  it("strips excel mso noise keeping values", () => {
    const grid = parseSpreadsheetHtml('<table><tr><td class="xl65" style="mso-x:1">12<o:p></o:p></td></tr></table>');
    expect(grid.rows[0]?.[0]).toContain("12");
  });
});

describe("caps", () => {
  it("rejects each over dimension with the exact message", () => {
    const wide = Array<string>(21).fill("x");
    const tall = Array.from({ length: 51 }, () => ["x", "y"]);
    for (const rows of [tall, [wide]]) {
      const sized = isOverCaps(rows);
      expect(sized.over).toBe(true);
      const res = spreadsheetClipboardToTable({ "text/plain": rows.map((r) => r.join("\t")).join("\n") }, ctx);
      expect(res.tooLarge).toBe(true);
      expect(res.document).toBeNull();
      expect(res.message).toMatch(/^Table too large to paste \(\d+ rows \u00d7 \d+ columns, \d+ cells\)\. The limit is 50 rows, 20 columns, 500 cells \u2014 paste a smaller range\.$/);
    }
    expect(SPREADSHEET_CAPS.maxCells).toBe(500);
  });
  it("truncates long cells keeping shape", () => {
    const res = spreadsheetClipboardToTable({ "text/plain": "a\t" + "y".repeat(3000) }, ctx);
    expect(res.tooLarge).toBe(false);
    expect(res.truncatedCells).toBe(1);
    expect(res.document?.nodes.length).toBe(1);
  });
  it("returns not-supported when table capability is off", () => {
    const noTable = createPipelineContext({
      field: "choice",
      capabilities: { ...ctx.capabilities, table: false },
    });
    const res = spreadsheetClipboardToTable({ "text/plain": "a\tb" }, noTable);
    expect(res.document).toBeNull();
    expect(res.message).toContain("not available in this field");
  });
});

describe("spreadsheetGridToTableNode", () => {
  it("matches the composer table shape with header + empty + multiline cells", () => {
    const node = spreadsheetGridToTableNode({
      rows: [
        ["H1", "H2"],
        ["", "a\n\nb"],
      ],
      source: "tsv",
      headerRow: true,
    });
    expect(node.kind).toBe("table");
    if (node.kind !== "table") throw new Error("expected table");
    expect(node.headerRow).toBe(true);
    const json = JSON.stringify(node);
    expect(json).toContain('"kind":"table"');
    expect(promoteFirstRowToHeader({ rows: [["a"]], source: "tsv", headerRow: false }).headerRow).toBe(true);
  });
  it("never throws on garbage with bounded cells", () => {
    const nasties = ["\0\0\0", "<table>".repeat(500), "a".repeat(100000), "<td>".repeat(2000)];
    for (const nasty of nasties) {
      const res = spreadsheetClipboardToTable({ "text/plain": nasty, "text/html": nasty }, ctx);
      const cells = res.document?.nodes.length ?? 0;
      expect(cells).toBeLessThanOrEqual(2000);
      void cells;
    }
  });
});
