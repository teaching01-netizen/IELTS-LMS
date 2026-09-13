/**
 * Phase 05 — spreadsheet clipboard (Excel / Sheets) to ImportDocument table.
 *
 * Source priority: text/html containing <table -> html; else text/plain with
 * tab -> tsv; else multiline comma-balanced-quotes -> csv; else none (caller
 * falls back to the Phase-02/04 text path). DOM-free string parser (no
 * document/DOMParser — SSR-safe, runs in plain vitest node env). TSV/CSV
 * never sniff headers (explicit promoteFirstRowToHeader instead); only real
 * <th> markup sets headerRow. Over-caps tables REJECT whole (exact message);
 * over-long cells truncate (shape preserved). Never throws on content.
 */
import type { ImportDocument, ImportMetadata, ImportNode, InlineNode, TableCell } from "../domain/importDocument";
import type { ImportWarning } from "../domain/importResult";
import { DIAGNOSTIC_MESSAGES } from "../domain/diagnostics";
import type { PipelineContext } from "../application/pipelineContext";
import { SPREADSHEET_CAPS, capSpreadsheetGrid, isOverCaps, oversizeMessage } from "../exam/tableCaps";

export type SpreadsheetSource = "html" | "tsv" | "csv" | "none";

export interface SpreadsheetGrid {
  rows: string[][];
  source: SpreadsheetSource;
  headerRow: boolean;
}

export interface SpreadsheetClipboard {
  "text/html"?: string | undefined;
  "text/plain"?: string | undefined;
}

export interface SpreadsheetResult {
  document: ImportDocument | null;
  source: SpreadsheetSource;
  headerRow: boolean;
  truncatedCells: number;
  tooLarge: boolean;
  message: string | null;
  warnings: ImportWarning[];
  transformations: string[];
}

function warn(code: ImportWarning["code"], message?: string): ImportWarning {
  return { code, message: message ?? DIAGNOSTIC_MESSAGES[code] };
}

export function detectSpreadsheetPayload(clip: SpreadsheetClipboard): SpreadsheetSource {
  const html = clip["text/html"];
  if (typeof html === "string" && /<table[\s>]/i.test(html)) return "html";
  const plain = clip["text/plain"];
  if (typeof plain === "string" && plain.includes("\t")) return "tsv";
  if (typeof plain === "string" && looksCsv(plain)) return "csv";
  return "none";
}

function looksCsv(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  let commaLines = 0;
  let quoted = 0;
  for (const line of lines) {
    if (line.includes(",")) commaLines += 1;
    if (line.includes('"')) quoted += 1;
  }
  return commaLines >= Math.ceil(lines.length / 2) && quoted > 0;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, digits: string) => {
      const code = Number(digits);
      return Number.isFinite(code) ? String.fromCharCode(code) : _m;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _m;
    });
}

function stripTagsKeepBreaks(html: string): { text: string; nestedTable: boolean } {
  let nestedTable = false;
  let out = "";
  let i = 0;
  let skipDepth = 0;
  const lower = html.toLowerCase();
  while (i < html.length) {
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      if (end < 0) break;
      const tag = html.slice(i + 1, end).trim();
      const name = tag.replace(/^\//, "").split(/[\s/]/)[0]?.toLowerCase() ?? "";
      const closing = tag.startsWith("/");
      if (!closing && (name === "script" || name === "style")) skipDepth += 1;
      else if (closing && (name === "script" || name === "style") && skipDepth > 0) skipDepth -= 1;
      else if (skipDepth === 0 && !closing && name === "table") nestedTable = true;
      else if (skipDepth === 0 && name === "br") out += "\n";
      i = end + 1;
      void lower;
      continue;
    }
    if (skipDepth === 0) out += html[i];
    i += 1;
  }
  return { text: decodeEntities(out), nestedTable };
}

function findTables(html: string): string[] {
  const tables: string[] = [];
  const lower = html.toLowerCase();
  let cursor = 0;
  let depth = 0;
  while (cursor < html.length) {
    const open = lower.indexOf("<table", cursor);
    const close = lower.indexOf("</table>", cursor);
    if (open < 0 && close < 0) break;
    if (depth > 8) break;
    if (open >= 0 && (open < close || close < 0)) {
      const tagEnd = html.indexOf(">", open);
      if (tagEnd < 0) break;
      if (depth === 0) tables.push("");
      depth += 1;
      cursor = tagEnd + 1;
    } else if (close >= 0) {
      depth = Math.max(0, depth - 1);
      cursor = close + 8;
    } else break;
  }
  if (tables.length === 0) return [];
  const firstOpen = lower.indexOf("<table");
  const spans: string[] = [];
  let d = 0;
  let start = -1;
  let j = 0;
  while (j < html.length) {
    const o = lower.indexOf("<table", j);
    const c = lower.indexOf("</table>", j);
    if (o < 0 && c < 0) break;
    if (o >= 0 && (o < c || c < 0)) {
      const tagEnd = html.indexOf(">", o);
      if (tagEnd < 0) break;
      if (d === 0) start = o;
      d += 1;
      j = tagEnd + 1;
    } else {
      d -= 1;
      j = c + 8;
      if (d === 0 && start >= 0) {
        spans.push(html.slice(start, j));
        start = -1;
        void firstOpen;
      }
    }
  }
  return spans;
}

interface CellSpan {
  header: boolean;
  colspan: number;
  html: string;
}

function scanRowCells(rowHtml: string): CellSpan[] {
  const cells: CellSpan[] = [];
  const re = /<(td|th)\b([^>]*)>([\s\S]*?)(?:<\/\1>|$)/gi;
  let match: RegExpExecArray | null;
  let guard = 0;
  while ((match = re.exec(rowHtml)) !== null && guard < 5000) {
    guard += 1;
    const tag = match[1]?.toLowerCase() === "th";
    const attrs = match[2] ?? "";
    const inner = match[3] ?? "";
    const spanMatch = attrs.match(/colspan\s*=\s*["']?(\d+)/i);
    const colspan = Math.max(1, Math.min(20, Number(spanMatch?.[1] ?? 1) || 1));
    cells.push({ header: tag, colspan, html: inner });
  }
  return cells;
}

export function parseSpreadsheetHtml(html: string): SpreadsheetGrid & { multiTable: boolean; colspanFlattened: boolean } {
  const spans = findTables(html);
  const first = spans[0] ?? "";
  if (!first) return { rows: [], source: "html", headerRow: false, multiTable: spans.length > 1, colspanFlattened: false };
  const rows: string[][] = [];
  let headerRow = false;
  let colspanFlattened = false;
  const rowRe = /<tr\b[^>]*>([\s\S]*?)(?:<\/tr>|$)/gi;
  let rowMatch: RegExpExecArray | null;
  let rowIndex = 0;
  let guard = 0;
  while ((rowMatch = rowRe.exec(first)) !== null && guard < 5000) {
    guard += 1;
    const cells = scanRowCells(rowMatch[1] ?? "");
    const row: string[] = [];
    let rowHasHeader = false;
    for (const cell of cells) {
      const { text } = stripTagsKeepBreaks(cell.html);
      const value = text.replace(/\r/g, "").trim();
      for (let s = 0; s < cell.colspan; s += 1) row.push(value);
      if (cell.colspan > 1) colspanFlattened = true;
      if (cell.header) rowHasHeader = true;
    }
    if (rowIndex === 0 && rowHasHeader && cells.length > 0 && cells.every((c) => c.header)) headerRow = true;
    if (row.length > 0) rows.push(row);
    rowIndex += 1;
  }
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const rect = rows.map((r) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill("")] : r));
  return { rows: rect, source: "html", headerRow, multiTable: spans.length > 1, colspanFlattened };
}

export function parseSpreadsheetTsv(text: string): SpreadsheetGrid {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  const rows = lines.map((line) => line.split("\t"));
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return { rows: rows.map((r) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill("")] : r)), source: "tsv", headerRow: false };
}

export function parseSpreadsheetCsv(text: string): SpreadsheetGrid {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = (): void => {
    row.push(field);
    field = "";
  };
  const pushRow = (): void => {
    rows.push(row);
    row = [];
  };
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  while (i < normalized.length) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      pushField();
      i += 1;
    } else if (ch === "\n") {
      pushField();
      pushRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  pushField();
  if (row.length > 1 || (row.length === 1 && (row[0] ?? "").trim() !== "")) pushRow();
  while (rows.length > 0 && (rows[rows.length - 1] ?? []).every((c) => c.trim() === "")) rows.pop();
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return { rows: rows.map((r) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill("")] : r)), source: "csv", headerRow: false };
}

export function promoteFirstRowToHeader(grid: SpreadsheetGrid): SpreadsheetGrid {
  return { ...grid, headerRow: true };
}

function cellToTableCell(value: string, header: boolean, source: SpreadsheetSource): TableCell {
  const lines = value.split("\n").map((l) => l.replace(/ +$/g, ""));
  while (lines.length > 0 && (lines[0] ?? "").trim() === "") lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
  const meta: ImportMetadata = { source: source === "none" ? "text" : "spreadsheet", confidence: 2, transformations: [] };
  if (lines.length === 0) {
    return { children: [{ kind: "text", text: "", marks: [], meta }] };
  }
  void header;
  return { children: lines.map((line) => ({ kind: "text", text: line, marks: [], meta }) as InlineNode) };
}

export function spreadsheetGridToTableNode(grid: SpreadsheetGrid): ImportNode {
  const meta: ImportMetadata = { source: "spreadsheet", confidence: 2, transformations: [] };
  const rows = grid.rows.map((row, rowIndex) =>
    row.map((cell) => cellToTableCell(cell, grid.headerRow && rowIndex === 0, grid.source)),
  );
  return { kind: "table", rows, headerRow: grid.headerRow, meta };
}

export function spreadsheetClipboardToTable(clip: SpreadsheetClipboard, ctx?: PipelineContext): SpreadsheetResult {
  const base = { headerRow: false, truncatedCells: 0, tooLarge: false, message: null as string | null };
  if (ctx?.capabilities.table === false) {
    const notSupported = "Tables are not available in this field. The data was not pasted as a table.";
    return {
      document: null,
      source: detectSpreadsheetPayload(clip),
      ...base,
      message: notSupported,
      warnings: [warn("import.block.degraded", notSupported)],
      transformations: ["spreadsheet.not-supported"],
    };
  }
  const source = detectSpreadsheetPayload(clip);
  if (source === "none") {
    return { document: null, source, ...base, warnings: [], transformations: [] };
  }
  const parsed =
    source === "html"
      ? parseSpreadsheetHtml(clip["text/html"] ?? "")
      : source === "tsv"
        ? { ...parseSpreadsheetTsv(clip["text/plain"] ?? ""), multiTable: false, colspanFlattened: false }
        : { ...parseSpreadsheetCsv(clip["text/plain"] ?? ""), multiTable: false, colspanFlattened: false };
  if (parsed.rows.length === 0) {
    return {
      document: null,
      source,
      ...base,
      warnings: [warn("import.empty")],
      transformations: ["spreadsheet.empty"],
    };
  }
  const sized = isOverCaps(parsed.rows);
  if (sized.over) {
    return {
      document: null,
      source,
      ...base,
      tooLarge: true,
      message: oversizeMessage(sized.rowCount, sized.colCount, sized.cellCount),
      warnings: [warn("import.truncated.cells", oversizeMessage(sized.rowCount, sized.colCount, sized.cellCount))],
      transformations: ["spreadsheet.too-large"],
    };
  }
  const capped = capSpreadsheetGrid(parsed.rows);
  const grid: SpreadsheetGrid = { rows: capped.rows, source, headerRow: parsed.headerRow };
  const warnings: ImportWarning[] = [];
  const transformations = ["spreadsheet." + source];
  if (parsed.multiTable) {
    warnings.push(warn("import.table.split", "Multiple tables found; only the first was kept."));
    transformations.push("spreadsheet.multi-table");
  }
  if (parsed.colspanFlattened) {
    warnings.push(warn("import.table.split", "Merged cells were flattened to a rectangle."));
    transformations.push("spreadsheet.colspan-flattened");
  }
  if (capped.truncatedCells > 0) {
    warnings.push(
      warn("import.truncated.text", capped.truncatedCells + " cell(s) were shortened to " + SPREADSHEET_CAPS.maxCellChars + " characters."),
    );
    transformations.push("spreadsheet.cells-truncated:" + capped.truncatedCells);
  }
  const meta: ImportMetadata = { source: "spreadsheet", confidence: 2, transformations: [...transformations] };
  return {
    document: { version: 1, nodes: [spreadsheetGridToTableNode(grid)], sourceMeta: meta },
    source,
    headerRow: grid.headerRow,
    truncatedCells: capped.truncatedCells,
    ...{ tooLarge: false },
    message: null,
    warnings,
    transformations,
  };
}
