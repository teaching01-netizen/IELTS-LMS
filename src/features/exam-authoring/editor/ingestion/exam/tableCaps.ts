/**
 * Phase 05 — spreadsheet grid caps (exam-side policy).
 *
 * Adapter-level net (whole-table REJECT) in front of the Phase-01 outer
 * truncation backstop. Numbers derive from INGESTION_LIMITS: the adapter
 * rejects absurd pastes with a user-facing message; enforceLimits() still
 * truncates anything that slips through. Import these constants — never
 * redeclare table budgets elsewhere.
 */
import { INGESTION_LIMITS } from "../domain/limits";

export const SPREADSHEET_CAPS = {
  maxRows: 50,
  maxCols: 20,
  maxCells: 500,
  maxCellChars: 2000,
} as const;

static_assertCaps();
function static_assertCaps(): void {
  if (SPREADSHEET_CAPS.maxRows > INGESTION_LIMITS.tableRows) throw new Error("adapter rows exceed outer bound");
  if (SPREADSHEET_CAPS.maxCols > INGESTION_LIMITS.tableCols) throw new Error("adapter cols exceed outer bound");
  if (SPREADSHEET_CAPS.maxCells > INGESTION_LIMITS.tableCells) throw new Error("adapter cells exceed outer bound");
}

export interface CappedGrid {
  rows: string[][];
  truncatedCells: number;
}

export function isOverCaps(rows: string[][]): { over: boolean; rowCount: number; colCount: number; cellCount: number } {
  const rowCount = rows.length;
  let colCount = 0;
  for (const row of rows) colCount = Math.max(colCount, row.length);
  const cellCount = rowCount * colCount;
  const over =
    rowCount > SPREADSHEET_CAPS.maxRows ||
    colCount > SPREADSHEET_CAPS.maxCols ||
    cellCount > SPREADSHEET_CAPS.maxCells;
  return { over, rowCount, colCount, cellCount };
}

export function oversizeMessage(rowCount: number, colCount: number, cellCount: number): string {
  return (
    "Table too large to paste (" +
    rowCount +
    " rows \u00d7 " +
    colCount +
    " columns, " +
    cellCount +
    " cells). The limit is 50 rows, 20 columns, 500 cells \u2014 paste a smaller range."
  );
}

export function capSpreadsheetGrid(rows: string[][]): CappedGrid {
  let truncatedCells = 0;
  const capped = rows.map((row) =>
    row.map((cell) => {
      if (cell.length > SPREADSHEET_CAPS.maxCellChars) {
        truncatedCells += 1;
        return cell.slice(0, SPREADSHEET_CAPS.maxCellChars);
      }
      return cell;
    }),
  );
  return { rows: capped, truncatedCells };
}
