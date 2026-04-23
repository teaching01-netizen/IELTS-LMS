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

export function TableCompletionBlock({ block, startNum, endNum, updateBlock, deleteBlock, moveBlock, errors = [] }: TableCompletionBlockProps) {
  const updateInstruction = (instruction: string) => {
    updateBlock({ ...block, instruction });
  };

  const updateAnswerRule = (answerRule: AnswerRule) => {
    updateBlock({ ...block, answerRule });
  };

  const updateHeader = (index: number, value: string) => {
    const newHeaders = [...block.headers];
    newHeaders[index] = value;
    updateBlock({ ...block, headers: newHeaders });
  };

  const updateCell = (cellId: string, updates: { correctAnswer?: string; row?: number; col?: number }) => {
    const newCells = block.cells.map(c =>
      c.id === cellId ? { ...c, ...updates } : c
    );
    updateBlock({ ...block, cells: newCells });
  };

  const addHeader = () => {
    updateBlock({ ...block, headers: [...block.headers, ''] });
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
            <input
              key={i}
              type="text"
              value={header}
              onChange={(e) => updateHeader(i, e.target.value)}
              onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateHeader(i, nextValue))}
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder={`Column ${i + 1}`}
            />
          ))}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">Table Rows ({block.rows.length})</label>
          <button onClick={addRow} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Add Row</button>
        </div>
        {block.rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-2 mb-2">
            {row.map((cell, cellIndex) => (
              <input key={cellIndex} type="text" value={cell} className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" placeholder={`Cell ${rowIndex + 1}-${cellIndex + 1}`} readOnly />
            ))}
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
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
