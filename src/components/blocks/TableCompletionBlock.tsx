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
  isSuspiciousTableCellContent,
  normalizeTableCompletionBlock,
  trimSuspiciousTableCellContent,
} from '../../utils/tableCompletion';
import { InsertedImagesEditor } from './InsertedImagesEditor';
import { maxVariantWordCountFromAcceptedAnswers, suggestUpgradedAnswerRule } from '../../utils/answerRuleAutoUpgrade';

interface TableCompletionBlockProps {
  block: TableCompletionBlockType;
  startNum: number;
  endNum: number;
  updateBlock: (block: TableCompletionBlockType) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
  onAddSubAnswerAtSlot?: (slotIndex: number) => void;
}

const rowEditorGridStyle = {
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
} as const;

type TableCellTarget = Pick<TableCompletionBlockType['cells'][number], 'id' | 'row' | 'col' | 'placeholderIndex'>;

function resolveCellUpdateIndex(cells: TableCompletionBlockType['cells'], target: TableCellTarget): number {
  const idMatches: number[] = [];
  const coordinateMatches: number[] = [];

  cells.forEach((cell, index) => {
    if (cell.id === target.id) {
      idMatches.push(index);
    }
    if (
      cell.row === target.row
      && cell.col === target.col
      && (cell.placeholderIndex ?? 0) === (target.placeholderIndex ?? 0)
    ) {
      coordinateMatches.push(index);
    }
  });

  if (idMatches.length === 1) return idMatches[0]!;
  if (coordinateMatches.length === 1) return coordinateMatches[0]!;

  const coordinateWithinId = idMatches.filter((index) => {
    const cell = cells[index];
    return (
      cell?.row === target.row
      && cell?.col === target.col
      && (cell?.placeholderIndex ?? 0) === (target.placeholderIndex ?? 0)
    );
  });
  if (coordinateWithinId.length > 0) return coordinateWithinId[0]!;

  if (idMatches.length > 0) return idMatches[0]!;
  if (coordinateMatches.length > 0) return coordinateMatches[0]!;
  return -1;
}

function normalizeScoreGroupId(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function TableCompletionBlock({
  block,
  startNum,
  endNum,
  updateBlock,
  deleteBlock,
  moveBlock,
  errors = [],
  onAddSubAnswerAtSlot,
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
  const canonicalCellDisplayNumbers = React.useMemo(() => {
    const rootNumbers = new Map<string, number>();
    let nextRootNumber = startNum;
    return canonicalCells.map((cell) => {
      const groupId = normalizeScoreGroupId(cell.scoreGroupId);
      const rootId = groupId ? `group:${groupId}` : `slot:${cell.id}`;
      const existing = rootNumbers.get(rootId);
      if (existing !== undefined) {
        return existing;
      }
      rootNumbers.set(rootId, nextRootNumber);
      const assigned = nextRootNumber;
      nextRootNumber += 1;
      return assigned;
    });
  }, [canonicalCells, startNum]);
  const placeholderAnalysis = React.useMemo(
    () => analyzeTablePlaceholders(block.rows, block.headers.length),
    [block.rows, block.headers.length],
  );
  const suspiciousCells = React.useMemo(
    () =>
      block.rows.flatMap((row, rowIndex) =>
        row.flatMap((cellValue, cellIndex) =>
          isSuspiciousTableCellContent(cellValue)
            ? [{ row: rowIndex, col: cellIndex, value: cellValue }]
            : [],
        ),
      ),
    [block.rows],
  );

  const updateInstruction = (instruction: string) => {
    commitBlock({ ...block, instruction });
  };

  const updateAnswerRule = (answerRule: AnswerRule) => {
    const requiredWords = Math.max(
      0,
      ...block.cells.map((cell) => maxVariantWordCountFromAcceptedAnswers(resolveAcceptedAnswers(cell))),
    );
    const upgrade = suggestUpgradedAnswerRule(answerRule, requiredWords);
    commitBlock({ ...block, answerRule: upgrade ?? answerRule });
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

  const trimRowCell = (rowIndex: number, cellIndex: number) => {
    const currentValue = block.rows[rowIndex]?.[cellIndex] ?? '';
    const trimmedValue = trimSuspiciousTableCellContent(currentValue);
    if (trimmedValue === currentValue) return;
    updateRowCell(rowIndex, cellIndex, trimmedValue);
  };

  const trimAllSuspiciousCells = () => {
    const nextRows = block.rows.map((row) =>
      row.map((cellValue) => trimSuspiciousTableCellContent(cellValue)),
    );
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
    const requiredWords = Math.max(
      0,
      ...nextCells.map((cell) => maxVariantWordCountFromAcceptedAnswers(resolveAcceptedAnswers(cell))),
    );
    const upgrade = suggestUpgradedAnswerRule(block.answerRule, requiredWords);
    commitBlock({ ...block, cells: nextCells, ...(upgrade ? { answerRule: upgrade } : {}) });
  };

  const updateCellAcceptedAnswers = (target: TableCellTarget, nextAnswers: string[]) => {
    const targetIndex = resolveCellUpdateIndex(block.cells, target);
    if (targetIndex < 0) return;

    const nextCells = block.cells.map((cell, index) =>
      index === targetIndex ? { ...cell, ...buildAcceptedAnswerFields(nextAnswers) } : cell,
    );
    const requiredWords = Math.max(
      0,
      ...nextCells.map((cell) => maxVariantWordCountFromAcceptedAnswers(resolveAcceptedAnswers(cell))),
    );
    const upgrade = suggestUpgradedAnswerRule(block.answerRule, requiredWords);
    commitBlock({ ...block, cells: nextCells, ...(upgrade ? { answerRule: upgrade } : {}) });
  };

  const clearCellScoring = (cell: TableCompletionBlockType['cells'][number]) => {
    const {
      scoreGroupId: _scoreGroupId,
      scoreWeight: _scoreWeight,
      groupRule: _groupRule,
      requiredCorrect: _requiredCorrect,
      ...rest
    } = cell;
    void _scoreGroupId;
    void _scoreWeight;
    void _groupRule;
    void _requiredCorrect;
    return rest;
  };

  const clearScoreGroup = (
    cells: TableCompletionBlockType['cells'],
    scoreGroupId: string | null,
  ): TableCompletionBlockType['cells'] => {
    if (!scoreGroupId) return cells;
    return cells.map((cell) =>
      normalizeScoreGroupId(cell.scoreGroupId) === scoreGroupId ? clearCellScoring(cell) : cell,
    );
  };

  const getCellScoringMode = (index: number): 'independent' | 'grouped_start' | 'grouped_follow' => {
    const currentCell = canonicalCells[index];
    if (!currentCell) return 'independent';
    const currentGroupId = normalizeScoreGroupId(currentCell.scoreGroupId);
    if (!currentGroupId) return 'independent';

    const previousCell = canonicalCells[index - 1];
    if (
      previousCell
      && normalizeScoreGroupId(previousCell.scoreGroupId) === currentGroupId
      && previousCell.groupRule === 'at_least_n'
      && previousCell.requiredCorrect === 2
    ) {
      return 'grouped_follow';
    }

    if (currentCell.groupRule === 'at_least_n' && currentCell.requiredCorrect === 2) {
      return 'grouped_start';
    }

    return 'grouped_start';
  };

  const updateCellScoringMode = (index: number, mode: 'independent' | 'grouped_start') => {
    const currentCell = canonicalCells[index];
    if (!currentCell) return;
    const nextCell = canonicalCells[index + 1];
    let nextCells = [...block.cells];

    nextCells = clearScoreGroup(nextCells, normalizeScoreGroupId(currentCell.scoreGroupId));
    if (nextCell) {
      nextCells = clearScoreGroup(nextCells, normalizeScoreGroupId(nextCell.scoreGroupId));
    }

    if (mode === 'grouped_start') {
      if (!nextCell) return;
      const groupId = `grp-${currentCell.id}`;

      const currentIndex = resolveCellUpdateIndex(nextCells, currentCell);
      const nextIndex = resolveCellUpdateIndex(nextCells, nextCell);
      if (currentIndex < 0 || nextIndex < 0) return;
      const currentCellValue = nextCells[currentIndex];
      const nextCellValue = nextCells[nextIndex];
      if (!currentCellValue || !nextCellValue) return;

      nextCells[currentIndex] = {
        ...currentCellValue,
        scoreGroupId: groupId,
        scoreWeight: 1,
        groupRule: 'at_least_n',
        requiredCorrect: 2,
      };
      nextCells[nextIndex] = {
        ...nextCellValue,
        scoreGroupId: groupId,
        scoreWeight: 0,
        groupRule: 'at_least_n',
        requiredCorrect: 2,
      };
      commitBlock({ ...block, cells: nextCells });
      return;
    }

    const currentIndex = resolveCellUpdateIndex(nextCells, currentCell);
    if (currentIndex < 0) return;
    const currentCellValue = nextCells[currentIndex];
    if (!currentCellValue) return;
    nextCells[currentIndex] = clearCellScoring(currentCellValue);
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
          Use <span className="font-mono">____</span> for each blank (you can add multiple in one cell, e.g. <span className="font-mono">____, ____</span>). Numbering is auto-generated in row order.
        </p>
        {suspiciousCells.length > 0 ? (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <div className="flex items-center justify-between gap-3">
              <span>
                Found {suspiciousCells.length} suspicious table cell
                {suspiciousCells.length === 1 ? '' : 's'} with unusually long pasted text.
              </span>
              <button
                type="button"
                onClick={trimAllSuspiciousCells}
                className="rounded border border-amber-300 bg-white px-2 py-1 font-medium text-amber-800 hover:bg-amber-100"
              >
                Auto-trim text
              </button>
            </div>
          </div>
        ) : null}

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
                const suspiciousCell = isSuspiciousTableCellContent(cell);
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
                      <p className="text-[11px] text-blue-700">
                        {placeholderCount} blanks in this cell
                      </p>
                    ) : null}
                    {suspiciousCell ? (
                      <div className="flex items-center justify-between rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                        <span>Suspicious long text in this cell</span>
                        <button
                          type="button"
                          onClick={() => trimRowCell(rowIndex, cellIndex)}
                          className="font-medium text-amber-900 hover:underline"
                        >
                          Trim
                        </button>
                      </div>
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
              <div className="mb-1 flex items-center justify-between text-sm font-medium text-gray-700">
                <span>{canonicalCellDisplayNumbers[index] ?? (startNum + index)}.</span>
                {onAddSubAnswerAtSlot ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddSubAnswerAtSlot(index);
                    }}
                                className="rounded-full border border-gray-300 bg-white p-1 text-gray-500 hover:border-blue-400 hover:text-blue-700"
                                title="Add sub-answer"
                    aria-label={`Add sub-answer to question ${(canonicalCellDisplayNumbers[index] ?? (startNum + index))}.1`}
                  >
                    <Plus size={12} />
                  </button>
                ) : null}
              </div>
              <div className="mb-2">
                {getCellScoringMode(index) === 'grouped_follow' ? (
                  <p className="text-xs text-blue-700">Grouped with previous slot (2 correct required = 1 point)</p>
                ) : (
                  <select
                    value={getCellScoringMode(index) === 'grouped_start' ? 'grouped_start' : 'independent'}
                    onChange={(event) =>
                      updateCellScoringMode(
                        index,
                        event.target.value as 'independent' | 'grouped_start',
                      )
                    }
                    disabled={index === canonicalCells.length - 1}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs disabled:bg-gray-100"
                  >
                    <option value="independent">Independent (1 slot = 1 point)</option>
                    <option value="grouped_start">Grouped with next slot (2 correct required = 1 point)</option>
                  </select>
                )}
              </div>
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
                <span>Q{canonicalCellDisplayNumbers[index] ?? (startNum + index)}</span>
                <span>
                  Row {cell.row + 1}, Column {cell.col + 1}
                  {typeof cell.placeholderIndex === 'number' && cell.placeholderIndex > 0
                    ? `, Blank ${cell.placeholderIndex + 1}`
                    : ''}
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
