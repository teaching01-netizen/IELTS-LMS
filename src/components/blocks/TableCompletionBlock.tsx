import React from 'react';
import { TableCompletionBlock as TableCompletionBlockType, AnswerRule } from '../../types';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { handleBoldHotkey } from '../../utils/boldMarkdown';
import { AcceptedAnswersEditor } from './AcceptedAnswersEditor';
import {
  buildAcceptedAnswerFields,
  resolveAcceptedAnswers,
  sanitizeAcceptedAnswers,
} from '../../utils/acceptedAnswers';
import {
  analyzeTablePlaceholders,
  getCanonicalTableCells,
  normalizeTableCompletionBlock,
} from '../../utils/tableCompletion';
import { InsertedImagesEditor } from './InsertedImagesEditor';

interface TableCompletionBlockProps {
  block: TableCompletionBlockType;
  startNum: number;
  endNum: number;
  updateBlock: (block: TableCompletionBlockType) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
}

const rowEditorGridStyle = {
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
} as const;

type TableCellTarget = Pick<TableCompletionBlockType['cells'][number], 'id' | 'row' | 'col'>;

function resolveCellUpdateIndex(cells: TableCompletionBlockType['cells'], target: TableCellTarget): number {
  const idMatches: number[] = [];
  const coordinateMatches: number[] = [];

  cells.forEach((cell, index) => {
    if (cell.id === target.id) {
      idMatches.push(index);
    }
    if (cell.row === target.row && cell.col === target.col) {
      coordinateMatches.push(index);
    }
  });

  if (idMatches.length === 1) return idMatches[0]!;
  if (coordinateMatches.length === 1) return coordinateMatches[0]!;

  const coordinateWithinId = idMatches.filter((index) => {
    const cell = cells[index];
    return cell?.row === target.row && cell?.col === target.col;
  });
  if (coordinateWithinId.length > 0) return coordinateWithinId[0]!;

  if (idMatches.length > 0) return idMatches[0]!;
  if (coordinateMatches.length > 0) return coordinateMatches[0]!;
  return -1;
}

export function TableCompletionBlock({
  block,
  startNum,
  endNum,
  updateBlock,
  deleteBlock,
  moveBlock,
  errors = [],
}: TableCompletionBlockProps) {
  const commitBlock = React.useCallback(
    (nextBlock: TableCompletionBlockType) => {
      updateBlock(normalizeTableCompletionBlock(nextBlock));
    },
    [updateBlock],
  );

  React.useEffect(() => {
    const normalized = normalizeTableCompletionBlock(block);
    if (normalized !== block) {
      updateBlock(normalized);
    }
  }, [block, updateBlock]);

  const canonicalCells = React.useMemo(() => getCanonicalTableCells(block), [block]);
  const placeholderAnalysis = React.useMemo(
    () => analyzeTablePlaceholders(block.rows, block.headers.length),
    [block.rows, block.headers.length],
  );

  const updateInstruction = (instruction: string) => {
    commitBlock({ ...block, instruction });
  };

  const updateAnswerRule = (answerRule: AnswerRule) => {
    commitBlock({ ...block, answerRule });
  };

  const updateHeader = (index: number, value: string) => {
    const nextHeaders = [...block.headers];
    nextHeaders[index] = value;
    commitBlock({ ...block, headers: nextHeaders });
  };

  const removeHeader = (index: number) => {
    if (block.headers.length <= 2) return;

    const nextHeaders = block.headers.filter((_, headerIndex) => headerIndex !== index);
    const nextRows = block.rows.map((row) => row.filter((_, cellIndex) => cellIndex !== index));

    commitBlock({
      ...block,
      headers: nextHeaders,
      rows: nextRows,
    });
  };

  const updateRowCell = (rowIndex: number, cellIndex: number, value: string) => {
    const nextRows = block.rows.map((row, candidateRowIndex) => {
      if (candidateRowIndex !== rowIndex) return row;
      return row.map((cellValue, candidateCellIndex) =>
        candidateCellIndex === cellIndex ? value : cellValue,
      );
    });
    commitBlock({ ...block, rows: nextRows });
  };

  const removeRow = (rowIndex: number) => {
    if (block.rows.length <= 1) return;
    const nextRows = block.rows.filter((_, index) => index !== rowIndex);
    commitBlock({ ...block, rows: nextRows });
  };

  const addHeader = () => {
    commitBlock({ ...block, headers: [...block.headers, ''] });
  };

  const addRow = () => {
    commitBlock({
      ...block,
      rows: [...block.rows, new Array(block.headers.length).fill('')],
    });
  };

  const updateCellPrimaryAnswer = (target: TableCellTarget, value: string) => {
    const targetIndex = resolveCellUpdateIndex(block.cells, target);
    if (targetIndex < 0) return;

    const nextCells = block.cells.map((cell, index) => {
      if (index !== targetIndex) return cell;

      const rest = sanitizeAcceptedAnswers((cell.acceptedAnswers ?? []).slice(1));
      const trimmed = value.trim();
      const nextAccepted = trimmed ? sanitizeAcceptedAnswers([trimmed, ...rest]) : rest;

      return {
        ...cell,
        correctAnswer: value,
        acceptedAnswers: nextAccepted,
      };
    });

    commitBlock({ ...block, cells: nextCells });
  };

  const updateCellAcceptedAnswers = (target: TableCellTarget, nextAnswers: string[]) => {
    const targetIndex = resolveCellUpdateIndex(block.cells, target);
    if (targetIndex < 0) return;

    const nextCells = block.cells.map((cell, index) =>
      index === targetIndex ? { ...cell, ...buildAcceptedAnswerFields(nextAnswers) } : cell,
    );
    commitBlock({ ...block, cells: nextCells });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-sm shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="font-bold text-gray-900">Q{startNum}-{endNum}</span>
          <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded">
            Table Completion
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => moveBlock(block.id, 'up')}
            className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
          >
            <ArrowUp size={16} />
          </button>
          <button
            onClick={() => moveBlock(block.id, 'down')}
            className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
          >
            <ArrowDown size={16} />
          </button>
          <button
            onClick={() => deleteBlock(block.id)}
            className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {errors.length > 0 ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errors.map((error, index) => (
            <div key={`${error.field}-${index}`}>{error.message}</div>
          ))}
        </div>
      ) : null}

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Instruction</label>
        <textarea
          value={block.instruction}
          onChange={(event) => updateInstruction(event.target.value)}
          onKeyDown={(event) => handleBoldHotkey(event, (nextValue) => updateInstruction(nextValue))}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={2}
          placeholder="Enter instruction..."
        />
      </div>
      <InsertedImagesEditor
        images={block.insertedImages}
        onChange={(nextImages) => commitBlock({ ...block, insertedImages: nextImages })}
        errors={errors}
      />

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Answer Rule</label>
        <select
          value={block.answerRule}
          onChange={(event) => updateAnswerRule(event.target.value as AnswerRule)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="ONE_WORD">One word only</option>
          <option value="TWO_WORDS">No more than two words</option>
          <option value="THREE_WORDS">No more than three words</option>
        </select>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">Table Headers</label>
          <button
            onClick={addHeader}
            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <Plus size={14} /> Add Column
          </button>
        </div>
        <div className="grid gap-2" style={rowEditorGridStyle}>
          {block.headers.map((header, headerIndex) => (
            <div key={headerIndex} className="flex items-center gap-1">
              <input
                type="text"
                value={header}
                onChange={(event) => updateHeader(headerIndex, event.target.value)}
                onKeyDown={(event) =>
                  handleBoldHotkey(event, (nextValue) => updateHeader(headerIndex, nextValue))
                }
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder={`Column ${headerIndex + 1}`}
              />
              <button
                type="button"
                onClick={() => removeHeader(headerIndex)}
                disabled={block.headers.length <= 2}
                className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                title={block.headers.length <= 2 ? 'At least 2 columns are required' : 'Delete column'}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">Table Rows ({block.rows.length})</label>
          <button
            onClick={addRow}
            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <Plus size={14} /> Add Row
          </button>
        </div>

        <p className="mb-2 text-xs text-gray-500">
          Use <span className="font-mono">____</span> once per answer cell. Numbering is auto-generated in row order.
        </p>

        {block.rows.map((row, rowIndex) => (
          <div key={rowIndex} className="mb-2 rounded-md border border-gray-200 p-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600">Row {rowIndex + 1}</span>
              <button
                type="button"
                onClick={() => removeRow(rowIndex)}
                disabled={block.rows.length <= 1}
                className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                title={block.rows.length <= 1 ? 'At least 1 row is required' : 'Delete row'}
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div className="grid gap-2" style={rowEditorGridStyle}>
              {row.map((cell, cellIndex) => {
                const placeholderCount = placeholderAnalysis.slots.find(
                  (slot) => slot.row === rowIndex && slot.col === cellIndex,
                )?.placeholderCount ?? 0;
                return (
                  <div key={cellIndex} className="space-y-1">
                    <label className="block text-[11px] font-medium text-gray-500">
                      {block.headers[cellIndex] || `Column ${cellIndex + 1}`}
                    </label>
                    <textarea
                      value={cell}
                      onChange={(event) => updateRowCell(rowIndex, cellIndex, event.target.value)}
                      onKeyDown={(event) =>
                        handleBoldHotkey(event, (nextValue) =>
                          updateRowCell(rowIndex, cellIndex, nextValue),
                        )
                      }
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={2}
                      placeholder={`Cell ${rowIndex + 1}-${cellIndex + 1}`}
                    />
                    {placeholderCount > 1 ? (
                      <p className="text-[11px] text-amber-700">
                        More than one placeholder found. Keep one <span className="font-mono">____</span> per cell.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">
            Blank Answers ({canonicalCells.length})
          </label>
        </div>
        <div className="space-y-2">
          {canonicalCells.map((cell, index) => (
            <div key={`${cell.id}-${cell.row}-${cell.col}-${index}`} className="rounded-md border border-gray-200 p-3">
              <div className="mb-1 text-sm font-medium text-gray-700">{startNum + index}.</div>
              <input
                type="text"
                value={cell.correctAnswer}
                onChange={(event) => updateCellPrimaryAnswer(cell, event.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Primary answer..."
              />
            </div>
          ))}
          {canonicalCells.length === 0 ? (
            <p className="text-xs text-gray-500">
              Add at least one <span className="font-mono">____</span> placeholder in the table rows to create answer blanks.
            </p>
          ) : null}
        </div>
      </div>

      <details className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-gray-700">
          Advanced Answers
        </summary>
        <div className="mt-3 space-y-3">
          {canonicalCells.map((cell, index) => (
            <div key={`advanced-${cell.id}-${cell.row}-${cell.col}-${index}`} className="rounded-md border border-gray-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                <span>Q{startNum + index}</span>
                <span>
                  Row {cell.row + 1}, Column {cell.col + 1}
                </span>
              </div>
              <AcceptedAnswersEditor
                value={resolveAcceptedAnswers(cell)}
                onChange={(nextAnswers) => updateCellAcceptedAnswers(cell, nextAnswers)}
                placeholder="Add accepted answer..."
              />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
