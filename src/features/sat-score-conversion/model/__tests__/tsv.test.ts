import { describe, expect, it } from "vitest";
import { createMatrix, createModule2, setCells, emptyDraft, addTable, parseCellText, type DraftMatrix } from "../draft";
import { exportTable } from "../exportTable";
import { parsePaste, selectionTsv, splitRows, tableCsv, tableTsv } from "../tsv";

/** A TSV the way Google Sheets copies it: blank top-left, 0..N-1 headers. */
function sheet(rows: number, cols: number, value = (r: number, c: number) => 200 + 10 * (r + c), eol = "\n") {
  const header = ["", ...Array.from({ length: cols }, (_, c) => String(c))].join("\t");
  const body = Array.from({ length: rows }, (_, r) => [String(r), ...Array.from({ length: cols }, (_, c) => String(value(r, c)))].join("\t"));
  return [header, ...body].join(eol);
}

describe("parsePaste", () => {
  it("reads a full table with a blank top-left cell and headers (4 x 4 grid)", () => {
    const result = parsePaste(sheet(4, 4), 4, 4);
    expect(result).toMatchObject({ ok: true, shape: "headers", row: 0, col: 0 });
    if (result.ok) {
      expect(result.values).toHaveLength(4);
      expect(result.values[3]).toEqual(["230", "240", "250", "260"]);
    }
  });

  it("accepts CRLF line endings and trailing blank lines", () => {
    const result = parsePaste(`${sheet(3, 3, undefined, "\r\n")}\r\n\r\n\r\n`, 3, 3);
    expect(result).toMatchObject({ ok: true, shape: "headers" });
  });

  it("reads a headerless whole-grid paste from the origin regardless of the cursor", () => {
    const text = "200\t210\n210\t220";
    expect(parsePaste(text, 2, 2, 1, 1)).toMatchObject({ ok: true, shape: "grid", row: 0, col: 0 });
  });

  it("places a partial rectangle at the anchor and rejects one that overflows", () => {
    expect(parsePaste("300\t310\n310\t320", 5, 5, 2, 1)).toMatchObject({ ok: true, shape: "block", row: 2, col: 1 });
    const overflow = parsePaste("300\t310\n310\t320", 5, 5, 4, 4);
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.errors[0]).toContain("does not fit at row 4, column 4");
  });

  it("names a duplicate or missing header", () => {
    const dup = sheet(3, 3).replace("\t1\t2\n", "\t1\t1\n");
    const result = parsePaste(dup, 3, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain('Duplicate Column header "1"');
      expect(result.errors.join(" ")).toContain('expected 2');
    }
    const skipped = parsePaste(sheet(3, 3).replace("\n1\t", "\n7\t"), 3, 3);
    expect(skipped.ok).toBe(false);
    if (!skipped.ok) expect(skipped.errors[0]).toContain("Row header 2");
  });

  it("rejects ragged and empty input", () => {
    expect(parsePaste("200\t210\n210", 2, 2).ok).toBe(false);
    expect(parsePaste("\n\n", 2, 2).ok).toBe(false);
  });

  it("keeps non-numeric text so the admin can see it", () => {
    const result = parsePaste("200\tabc\n210\t220", 2, 2);
    expect(result.ok && result.values[0]).toEqual(["200", "abc"]);
    expect(parseCellText("abc")).toBe("abc");
    expect(parseCellText("  250 ")).toBe(250);
    expect(parseCellText("")).toBeNull();
    expect(parseCellText("2.5")).toBe("2.5");
    // A huge number never reaches the wire as an imprecise value; it stays visible text.
    expect(parseCellText("99999999999999999999")).toBe("99999999999999999999");
    expect(parseCellText("000000800")).toBe(800);
    // A tab or newline inside a cell cannot break a row when the table is exported.
    expect(parseCellText("1\t2\n3")).toBe("1 2 3");
  });

  it("reads CSV when there are no tabs, with quoted fields", () => {
    expect(splitRows('"a,b",2\n3,"4"')).toEqual([["a,b", "2"], ["3", "4"]]);
    expect(parsePaste("200,210\n210,220", 2, 2)).toMatchObject({ ok: true, shape: "grid" });
  });

  it("ignores blank lines between rows of a table, but keeps an empty cell of a one-column table", () => {
    expect(splitRows("200\t210\n\n210\t220\n")).toEqual([["200", "210"], ["210", "220"]]);
    expect(splitRows("200\n\n400")).toEqual([["200"], [""], ["400"]]);
    expect(parsePaste("\t0\t1\r\n\r\n0\t200\t210\r\n\r\n1\t210\t220", 2, 2)).toMatchObject({ ok: true, shape: "headers" });
  });

  it("ignores a trailing tab on every row", () => {
    const text = "300\t310\t\n310\t320\t";
    expect(parsePaste(text, 5, 5, 0, 0)).toMatchObject({ ok: true, shape: "block" });
  });

  it("parses a 1D table (one column) with its headers", () => {
    expect(parsePaste("\t0\n0\t200\n1\t300\n2\t400", 3, 1)).toMatchObject({ ok: true, shape: "headers" });
  });
});

describe("serializers", () => {
  const matrix = (() => {
    const m = createMatrix(2, 2);
    let draft = addTable(emptyDraft(), "math", "full_lower", m);
    for (let r = 0; r <= 2; r += 1) for (let c = 0; c <= 2; c += 1) draft = { ...draft, draft: setCells(draft.draft, "math", draft.id, [{ row: r, col: c, value: 200 + 10 * (r + c) }]) };
    return draft.draft.sections.math.tables[draft.id] as DraftMatrix;
  })();

  it("table TSV round-trips through the importer", () => {
    const tsv = tableTsv(matrix);
    expect(tsv.split("\n")[0]).toBe("\t0\t1\t2");
    const back = parsePaste(tsv, 3, 3);
    expect(back).toMatchObject({ ok: true, shape: "headers" });
    if (back.ok) expect(back.values).toEqual([["200", "210", "220"], ["210", "220", "230"], ["220", "230", "240"]]);
  });

  it("copies a selection as header-less TSV that pastes back as a block", () => {
    const text = selectionTsv(matrix, 1, 1, 2, 2);
    expect(text).toBe("220\t230\n230\t240");
    expect(parsePaste(text, 3, 3, 1, 1)).toMatchObject({ ok: true, shape: "block", row: 1, col: 1 });
  });

  it("exports CSV, TSV and JSON with stable names", () => {
    expect(tableCsv(matrix).split("\n")[1]).toBe("0,200,210,220");
    expect(exportTable(matrix, "tsv", "math-full_lower")).toMatchObject({ filename: "math-full_lower.tsv" });
    expect(JSON.parse(exportTable(matrix, "json", "x").text).kind).toBe("matrix");
  });

  it("exports a 1D table as one column", () => {
    const table = createModule2(2);
    expect(tableTsv(table)).toBe("\t0\n0\t\n1\t\n2\t");
  });
});
