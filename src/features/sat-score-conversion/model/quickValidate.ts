import { cellAt, cellText, isRangeCell, tableCols, tableRows, type DraftCell, type DraftTable } from "./draft";

/**
 * Instant, local feedback while editing. It mirrors the server's rules
 * (integers that are multiples of 10 within 200-800; no empty cells; a score
 * lower than its left/upper neighbour is a warning) but the server's validate
 * and publish answers are authoritative and are what the UI trusts to publish.
 */

export const MIN_SCORE = 200;
export const MAX_SCORE = 800;

export interface CellFeedback {
  errors: Map<string, string>;
  warnings: Map<string, string>;
}

export const cellKey = (row: number, col: number) => `${row},${col}`;

/** Why a cell cannot be published, or null. */
export function cellError(cell: DraftCell): string | null {
  if (cell === null) return "No score entered.";
  if (typeof cell === "string") return `"${cell}" is not a whole number.`;
  const [low, high] = isRangeCell(cell) ? [cell.low, cell.high] : [cell, cell];
  if (low < MIN_SCORE || high > MAX_SCORE || low > high) return `Scores must be between ${MIN_SCORE} and ${MAX_SCORE}.`;
  if (low % 10 !== 0 || high % 10 !== 0) return "Scores must be multiples of 10.";
  return null;
}

function lowOf(cell: DraftCell): number | null {
  if (typeof cell === "number") return cell;
  return isRangeCell(cell) ? cell.low : null;
}

export function quickValidateTable(table: DraftTable): CellFeedback {
  const errors = new Map<string, string>();
  const warnings = new Map<string, string>();
  const rows = tableRows(table);
  const cols = tableCols(table);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = cellAt(table, row, col);
      const problem = cellError(cell);
      if (problem) {
        errors.set(cellKey(row, col), problem);
        continue;
      }
      const value = lowOf(cell);
      const left = col > 0 ? lowOf(cellAt(table, row, col - 1)) : null;
      const up = row > 0 ? lowOf(cellAt(table, row - 1, col)) : null;
      if (value !== null && left !== null && value < left) {
        warnings.set(cellKey(row, col), `${cellText(cell)} is lower than the previous Module 2 value (${left}).`);
      } else if (value !== null && up !== null && value < up) {
        warnings.set(cellKey(row, col), `${cellText(cell)} is lower than the previous Module 1 value (${up}).`);
      }
    }
  }
  return { errors, warnings };
}
