import { cellText, type DraftCell, type DraftTable, cellAt, tableCols, tableRows } from "./draft";

/**
 * Clipboard / import text <-> grid text. Google Sheets copies TSV; the importer
 * also accepts CSV. Nothing here touches the draft: a parse either yields a
 * rectangle of strings with where it goes, or a list of problems.
 */

export type PasteShape = "headers" | "grid" | "block";

export type PasteResult =
  | {
      ok: true;
      shape: PasteShape;
      /** Cell text, `rows x cols`; headers (when present) are already removed. */
      values: string[][];
      /** Where the top-left value lands: the origin for a whole grid, the anchor for a block. */
      row: number;
      col: number;
    }
  | { ok: false; errors: string[] };

/** Splits one CSV line, honouring double-quoted fields and "" escapes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** Text -> rows of cells. Tabs win; a tab-less multi-column paste is read as CSV. */
export function splitRows(text: string): string[][] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  const hasTab = lines.some((line) => line.includes("\t"));
  const rows = lines.map((line) => (hasTab ? line.split("\t") : splitCsvLine(line)).map((cell) => cell.trim()));
  // Blank lines between rows of a multi-column table are paste artifacts, not
  // data (an empty row of a real table still carries its tabs). A single-column
  // table keeps them: there, a blank line is an empty cell.
  const multiColumn = rows.some((row) => row.length > 1);
  return multiColumn ? rows.filter((row) => row.length > 1 || row[0] !== "") : rows;
}

function headerErrors(rows: string[][], rowCount: number, colCount: number): string[] {
  const errors: string[] = [];
  const check = (labels: string[], expected: number, axis: string) => {
    const seen = new Set<string>();
    labels.forEach((label, index) => {
      if (seen.has(label)) errors.push(`Duplicate ${axis} header "${label}".`);
      seen.add(label);
      if (label !== String(index)) errors.push(`${axis} header ${index + 1} is "${label}"; expected ${index} (headers run 0 to ${expected - 1}).`);
    });
  };
  check(rows[0]!.slice(1), colCount, "Column");
  check(rows.slice(1).map((row) => row[0]!), rowCount, "Row");
  return errors;
}

function rectangular(rows: string[][]): boolean {
  return rows.length > 0 && rows.every((row) => row.length === rows[0]!.length);
}

/**
 * Reads a paste for a grid of `rowCount x colCount` cells with the cursor at
 * (anchorRow, anchorCol):
 *   (R+1) x (C+1) -> headers on both axes (top-left cell ignored), must be 0..N-1
 *   R x C         -> the whole grid, headerless, from the origin
 *   anything else -> a block at the anchor; rejected when it would overflow
 */
export function parsePaste(text: string, rowCount: number, colCount: number, anchorRow = 0, anchorCol = 0): PasteResult {
  let rows = splitRows(text);
  if (rows.length === 0) return { ok: false, errors: ["Nothing to paste."] };
  // A trailing tab on every row (some exports) is an empty column, not data.
  if (rectangular(rows) && rows[0]!.length > 1 && rows.every((row) => row[row.length - 1] === "") && rows[0]!.length !== colCount + 1 && rows[0]!.length !== colCount) {
    rows = rows.map((row) => row.slice(0, -1));
  }
  if (!rectangular(rows)) {
    return { ok: false, errors: ["The rows have different numbers of cells. Copy a complete rectangle from the sheet."] };
  }
  const height = rows.length;
  const width = rows[0]!.length;
  if (height === rowCount + 1 && width === colCount + 1) {
    const errors = headerErrors(rows, rowCount, colCount);
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, shape: "headers", values: rows.slice(1).map((row) => row.slice(1)), row: 0, col: 0 };
  }
  if (height === rowCount && width === colCount) return { ok: true, shape: "grid", values: rows, row: 0, col: 0 };
  if (anchorRow + height > rowCount || anchorCol + width > colCount) {
    return {
      ok: false,
      errors: [
        `A ${height} x ${width} block does not fit at row ${anchorRow}, column ${anchorCol} of this ${rowCount} x ${colCount} table. ` +
          `Select the first cell to replace, or paste the whole table (${rowCount} x ${colCount}, or ${rowCount + 1} x ${colCount + 1} with headers).`,
      ],
    };
  }
  return { ok: true, shape: "block", values: rows, row: anchorRow, col: anchorCol };
}

/** A rectangle of cells as TSV (what Google Sheets pastes). */
export function toTsv(values: DraftCell[][]): string {
  return values.map((row) => row.map(cellText).join("\t")).join("\n");
}

function rectangle(table: DraftTable, top: number, left: number, bottom: number, right: number): DraftCell[][] {
  const rows: DraftCell[][] = [];
  for (let r = top; r <= bottom; r += 1) {
    const row: DraftCell[] = [];
    for (let c = left; c <= right; c += 1) row.push(cellAt(table, r, c));
    rows.push(row);
  }
  return rows;
}

/** The selected rectangle (inclusive) as TSV, without headers. */
export function selectionTsv(table: DraftTable, top: number, left: number, bottom: number, right: number): string {
  return toTsv(rectangle(table, top, left, bottom, right));
}

/** The whole table with a blank top-left cell and 0..N-1 headers: round-trips through `parsePaste`. */
export function tableTsv(table: DraftTable): string {
  const rows = tableRows(table);
  const cols = tableCols(table);
  const header = ["", ...Array.from({ length: cols }, (_, c) => String(c))].join("\t");
  const body = rectangle(table, 0, 0, rows - 1, cols - 1).map((row, r) => [String(r), ...row.map(cellText)].join("\t"));
  return [header, ...body].join("\n");
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function tableCsv(table: DraftTable): string {
  return tableTsv(table)
    .split("\n")
    .map((line) => line.split("\t").map(csvField).join(","))
    .join("\n");
}
