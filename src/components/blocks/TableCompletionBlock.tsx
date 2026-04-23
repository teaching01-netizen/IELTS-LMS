import React from 'react';
import { TableCompletionBlock as TableCompletionBlockType, AnswerRule } from '../../types';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { createId } from '../../utils/idUtils';
import { handleBoldHotkey } from '../../utils/boldMarkdown';

interface TableCompletionBlockProps {
  block: TableCompletionBlockType;
  startNum: number;
  endNum: number;
  updateBlock: (block: TableCompletionBlockType) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
}

function normalizeTableRows(headers: string[], rows: string[][]) {
  return rows.map((row) => {
    if (row.length === headers.length) return row;
    if (row.length > headers.length) return row.slice(0, headers.length);
    return [...row, ...new Array(headers.length - row.length).fill('')];
  });
}

export function TableCompletionBlock({ block, startNum, endNum, updateBlock, deleteBlock, moveBlock, errors = [] }: TableCompletionBlockProps) {
  const updateInstruction = (instruction: string) => {
    updateBlock({ ...block, instruction });
  };

  React.useEffect(() => {
    const needsNormalization = block.rows.some((row) => row.length !== block.headers.length);
    if (!needsNormalization) return;
    updateBlock({ ...block, rows: normalizeTableRows(block.headers, block.rows) });
  }, [block, updateBlock]);

  const updateAnswerRule = (answerRule: AnswerRule) => {
    updateBlock({ ...block, answerRule });
  };

  const updateHeader = (index: number, value: string) => {
    const newHeaders = [...block.headers];
    newHeaders[index] = value;
    updateBlock({ ...block, headers: newHeaders });
  };

  const removeHeader = (index: number) => {
    if (block.headers.length <= 2) return;

    const nextHeaders = block.headers.filter((_, i) => i !== index);
    const nextRows = normalizeTableRows(
      nextHeaders,
      block.rows.map((row) => row.filter((_, i) => i !== index)),
    );
    const nextCells = block.cells
      .filter((cell) => cell.col !== index)
      .map((cell) => (cell.col > index ? { ...cell, col: cell.col - 1 } : cell));

    updateBlock({ ...block, headers: nextHeaders, rows: nextRows, cells: nextCells });
  };

  const updateRowCell = (rowIndex: number, cellIndex: number, value: string) => {
    const nextRows = block.rows.map((row, rIdx) => {
      if (rIdx !== rowIndex) return row;
      return row.map((cellValue, cIdx) => (cIdx === cellIndex ? value : cellValue));
    });
    updateBlock({ ...block, rows: nextRows });
  };

  const removeRow = (rowIndex: number) => {
    if (block.rows.length <= 1) return;

    const nextRows = block.rows.filter((_, index) => index !== rowIndex);
    const nextCells = block.cells
      .filter((cell) => cell.row !== rowIndex)
      .map((cell) => (cell.row > rowIndex ? { ...cell, row: cell.row - 1 } : cell));

    updateBlock({ ...block, rows: nextRows, cells: nextCells });
  };

  const updateCell = (cellId: string, updates: { correctAnswer?: string; row?: number; col?: number }) => {
    const newCells = block.cells.map(c =>
      c.id === cellId ? { ...c, ...updates } : c
    );
    updateBlock({ ...block, cells: newCells });
  };

  const addHeader = () => {
    const nextHeaders = [...block.headers, ''];
    const nextRows = normalizeTableRows(nextHeaders, block.rows);
    updateBlock({ ...block, headers: nextHeaders, rows: nextRows });
  };

  const addRow = () => {
    updateBlock({ ...block, rows: [...block.rows, new Array(block.headers.length).fill('')] });
  };

  const addCell = () => {
    const newCell = {
      id: createId('cell'),
      correctAnswer: '',
      row: 0,
      col: 0
    };
    updateBlock({ ...block, cells: [...block.cells, newCell] });
  };

  const removeCell = (cellId: string) => {
    updateBlock({ ...block, cells: block.cells.filter((cell) => cell.id !== cellId) });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-sm shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="font-bold text-gray-900">Q{startNum}-{endNum}</span>
          <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded">Table Completion</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => moveBlock(block.id, 'up')} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"><ArrowUp size={16} /></button>
          <button onClick={() => moveBlock(block.id, 'down')} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"><ArrowDown size={16} /></button>
          <button onClick={() => deleteBlock(block.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Instruction</label>
        <textarea
          value={block.instruction}
          onChange={(e) => updateInstruction(e.target.value)}
          onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateInstruction(nextValue))}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={2}
          placeholder="Enter instruction..."
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Answer Rule</label>
        <select value={block.answerRule} onChange={(e) => updateAnswerRule(e.target.value as AnswerRule)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="ONE_WORD">One word only</option>
          <option value="TWO_WORDS">No more than two words</option>
          <option value="THREE_WORDS">No more than three words</option>
        </select>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">Table Headers</label>
          <button onClick={addHeader} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Add Column</button>
        </div>
        <div className="flex gap-2 mb-2">
          {block.headers.map((header, i) => (
            <div key={i} className="flex flex-1 items-center gap-1">
              <input
                type="text"
                value={header}
                onChange={(e) => updateHeader(i, e.target.value)}
                onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateHeader(i, nextValue))}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder={`Column ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => removeHeader(i)}
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
          <button onClick={addRow} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Add Row</button>
        </div>
        {block.rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-2 mb-2 items-center">
            {row.map((cell, cellIndex) => (
              <input
                key={cellIndex}
                type="text"
                value={cell}
                onChange={(e) => updateRowCell(rowIndex, cellIndex, e.target.value)}
                onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateRowCell(rowIndex, cellIndex, nextValue))}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder={`Cell ${rowIndex + 1}-${cellIndex + 1}`}
              />
            ))}
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
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">Answer Cells ({block.cells.length})</label>
          <button onClick={addCell} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Add Cell</button>
        </div>
        <div className="space-y-2">
          {block.cells.map((cell, index) => (
            <div key={cell.id} className="border rounded-md p-3 flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700 w-16">{startNum + index}.</span>
              <input type="number" value={cell.row} onChange={(e) => updateCell(cell.id, { row: parseInt(e.target.value) || 0 })} className="w-16 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="Row" />
              <input type="number" value={cell.col} onChange={(e) => updateCell(cell.id, { col: parseInt(e.target.value) || 0 })} className="w-16 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="Col" />
              <input type="text" value={cell.correctAnswer} onChange={(e) => updateCell(cell.id, { correctAnswer: e.target.value })} className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="Answer..." />
              <button
                type="button"
                onClick={() => removeCell(cell.id)}
                className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                title="Delete answer cell"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
