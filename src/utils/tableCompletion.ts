import type { ExamState, QuestionBlock, TableCell, TableCompletionBlock } from '../types';
import { countBlankPlaceholders } from './blankPlaceholders';
import { createId } from './idUtils';
import { syncAcceptedAnswers } from './acceptedAnswers';

export interface TablePlaceholderSlot {
  row: number;
  col: number;
  placeholderCount: number;
}

export interface TablePlaceholderAnalysis {
  slots: TablePlaceholderSlot[];
  multiPlaceholderSlots: TablePlaceholderSlot[];
}

const PLACEHOLDER_TOKEN = '____';

function rowsEqual(left: string[][], right: string[][]): boolean {
  if (left.length !== right.length) return false;
  for (let rowIndex = 0; rowIndex < left.length; rowIndex += 1) {
    const leftRow = left[rowIndex];
    const rightRow = right[rowIndex];
    if (!leftRow || !rightRow) return false;
    if (leftRow.length !== rightRow.length) return false;
    for (let colIndex = 0; colIndex < leftRow.length; colIndex += 1) {
      if (leftRow[colIndex] !== rightRow[colIndex]) return false;
    }
  }
  return true;
}

function cellsEqual(left: TableCell[], right: TableCell[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftCell = left[index];
    const rightCell = right[index];
    if (!leftCell || !rightCell) return false;
    if (leftCell.id !== rightCell.id) return false;
    if (leftCell.row !== rightCell.row || leftCell.col !== rightCell.col) return false;
    if (leftCell.correctAnswer !== rightCell.correctAnswer) return false;
    const leftAccepted = leftCell.acceptedAnswers ?? [];
    const rightAccepted = rightCell.acceptedAnswers ?? [];
    if (leftAccepted.length !== rightAccepted.length) return false;
    for (let acceptedIndex = 0; acceptedIndex < leftAccepted.length; acceptedIndex += 1) {
      if (leftAccepted[acceptedIndex] !== rightAccepted[acceptedIndex]) return false;
    }
  }
  return true;
}

function normalizeRows(headers: string[], rows: string[][]): string[][] {
  return rows.map((row) => {
    if (row.length === headers.length) return row;
    if (row.length > headers.length) return row.slice(0, headers.length);
    return [...row, ...new Array(headers.length - row.length).fill('')];
  });
}

function isValidCellCoordinate(cell: Pick<TableCell, 'row' | 'col'>, rowCount: number, headerCount: number): boolean {
  return (
    Number.isInteger(cell.row)
    && Number.isInteger(cell.col)
    && cell.row >= 0
    && cell.col >= 0
    && cell.row < rowCount
    && cell.col < headerCount
  );
}

function dedupeByCoordinate(cells: TableCell[]): TableCell[] {
  const seen = new Set<string>();
  const deduped: TableCell[] = [];
  for (const cell of cells) {
    const key = `${cell.row}:${cell.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(cell);
  }
  return deduped;
}

function injectLegacyPlaceholders(rows: string[][], cells: TableCell[]): string[][] {
  if (rows.length === 0 || cells.length === 0) return rows;

  return rows.map((row, rowIndex) =>
    row.map((value, colIndex) => {
      const isMapped = cells.some((cell) => cell.row === rowIndex && cell.col === colIndex);
      if (!isMapped) return value;
      if (countBlankPlaceholders(value) > 0) return value;

      const trimmed = value.trim();
      if (!trimmed) return PLACEHOLDER_TOKEN;
      return `${value} ${PLACEHOLDER_TOKEN}`;
    }),
  );
}

export function analyzeTablePlaceholders(rows: string[][], headerCount: number): TablePlaceholderAnalysis {
  const slots: TablePlaceholderSlot[] = [];
  const multiPlaceholderSlots: TablePlaceholderSlot[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    for (let colIndex = 0; colIndex < headerCount; colIndex += 1) {
      const value = row[colIndex] ?? '';
      const placeholderCount = countBlankPlaceholders(value);
      if (placeholderCount > 0) {
        const slot: TablePlaceholderSlot = { row: rowIndex, col: colIndex, placeholderCount };
        slots.push(slot);
        if (placeholderCount > 1) {
          multiPlaceholderSlots.push(slot);
        }
      }
    }
  }

  return { slots, multiPlaceholderSlots };
}

export function getCanonicalTableCells(block: TableCompletionBlock): TableCell[] {
  const normalizedRows = normalizeRows(block.headers, block.rows);
  const validCells = block.cells.filter((cell) =>
    isValidCellCoordinate(cell, normalizedRows.length, block.headers.length),
  );
  const dedupedCells = dedupeByCoordinate(validCells);

  const initialAnalysis = analyzeTablePlaceholders(normalizedRows, block.headers.length);
  const effectiveRows =
    initialAnalysis.slots.length === 0
      ? injectLegacyPlaceholders(normalizedRows, dedupedCells)
      : normalizedRows;
  const analysis = analyzeTablePlaceholders(effectiveRows, block.headers.length);

  if (analysis.slots.length === 0) {
    return dedupedCells.map((cell) => syncAcceptedAnswers(cell));
  }

  const byCoordinate = new Map<string, TableCell>();
  for (const cell of dedupedCells) {
    byCoordinate.set(`${cell.row}:${cell.col}`, cell);
  }

  const used = new Set<string>();
  const fallback = dedupedCells.slice();

  return analysis.slots.map((slot, index) => {
    const coordinateKey = `${slot.row}:${slot.col}`;
    const coordinateMatch = byCoordinate.get(coordinateKey);
    if (coordinateMatch) {
      used.add(coordinateMatch.id);
      return syncAcceptedAnswers({
        ...coordinateMatch,
        row: slot.row,
        col: slot.col,
      });
    }

    const nextFallback = fallback.find((candidate) => !used.has(candidate.id));
    if (nextFallback) {
      used.add(nextFallback.id);
      return syncAcceptedAnswers({
        ...nextFallback,
        row: slot.row,
        col: slot.col,
      });
    }

    return {
      id: `slot-${slot.row}-${slot.col}-${index}`,
      row: slot.row,
      col: slot.col,
      correctAnswer: '',
      acceptedAnswers: [],
    };
  });
}

export function normalizeTableCompletionBlock(block: TableCompletionBlock): TableCompletionBlock {
  const normalizedRowsBase = normalizeRows(block.headers, block.rows);
  const validCells = block.cells.filter((cell) =>
    isValidCellCoordinate(cell, normalizedRowsBase.length, block.headers.length),
  );
  const dedupedCells = dedupeByCoordinate(validCells);

  const initialAnalysis = analyzeTablePlaceholders(normalizedRowsBase, block.headers.length);
  const effectiveRows =
    initialAnalysis.slots.length === 0
      ? injectLegacyPlaceholders(normalizedRowsBase, dedupedCells)
      : normalizedRowsBase;

  const canonicalCells = getCanonicalTableCells({
    ...block,
    rows: effectiveRows,
    cells: dedupedCells,
  }).map((cell) => {
    if (cell.id.startsWith('slot-')) {
      return { ...cell, id: createId('cell') };
    }
    return cell;
  });

  const normalized: TableCompletionBlock = {
    ...block,
    rows: effectiveRows,
    cells: canonicalCells,
  };

  if (rowsEqual(block.rows, normalized.rows) && cellsEqual(block.cells, normalized.cells)) {
    return block;
  }

  return normalized;
}

function normalizeBlock(block: QuestionBlock): QuestionBlock {
  if (block.type !== 'TABLE_COMPLETION') {
    return block;
  }
  return normalizeTableCompletionBlock(block as TableCompletionBlock);
}

function normalizeBlocks(blocks: QuestionBlock[]): { blocks: QuestionBlock[]; changed: boolean } {
  let changed = false;
  const nextBlocks = blocks.map((block) => {
    const normalized = normalizeBlock(block);
    if (normalized !== block) changed = true;
    return normalized;
  });
  return { blocks: nextBlocks, changed };
}

export function normalizeExamStateTableCompletionBlocks(state: ExamState): ExamState {
  const readingPassages = state.reading.passages.map((passage) => {
    const normalized = normalizeBlocks(passage.blocks);
    if (!normalized.changed) return passage;
    return {
      ...passage,
      blocks: normalized.blocks,
    };
  });

  const listeningParts = state.listening.parts.map((part) => {
    const normalized = normalizeBlocks(part.blocks);
    if (!normalized.changed) return part;
    return {
      ...part,
      blocks: normalized.blocks,
    };
  });

  const readingChanged = readingPassages.some((passage, index) => passage !== state.reading.passages[index]);
  const listeningChanged = listeningParts.some((part, index) => part !== state.listening.parts[index]);

  if (!readingChanged && !listeningChanged) {
    return state;
  }

  return {
    ...state,
    reading: {
      ...state.reading,
      passages: readingPassages,
    },
    listening: {
      ...state.listening,
      parts: listeningParts,
    },
  };
}
