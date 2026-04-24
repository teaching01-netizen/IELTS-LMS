import React from 'react';
import { SingleMCQBlock as SingleMCQBlockType, MCQOption } from '../../types';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { createId } from '../../utils/idUtils';
import { handleBoldHotkey } from '../../utils/boldMarkdown';

interface SingleMCQBlockProps {
  block: SingleMCQBlockType;
  startNum: number;
  endNum: number;
  updateBlock: (block: SingleMCQBlockType) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
}

export function SingleMCQBlock({ block, startNum, endNum, updateBlock, deleteBlock, moveBlock, errors = [] }: SingleMCQBlockProps) {
  const updateStem = (stem: string) => {
    updateBlock({ ...block, stem });
  };

  const updateOption = (optionId: string, updates: Partial<MCQOption>) => {
    const newOptions = block.options.map(opt =>
      opt.id === optionId ? { ...opt, ...updates } : opt
    );
    updateBlock({ ...block, options: newOptions });
  };

  const addOption = () => {
    const newOption: MCQOption = {
      id: createId('opt'),
      text: '',
      isCorrect: false
    };
    updateBlock({ ...block, options: [...block.options, newOption] });
  };

  const removeOption = (optionId: string) => {
    if (block.options.length <= 2) return; // Minimum 2 options
    const newOptions = block.options.filter(opt => opt.id !== optionId);
    updateBlock({ ...block, options: newOptions });
  };

  const setCorrectAnswer = (optionId: string) => {
    const newOptions = block.options.map(opt =>
      ({ ...opt, isCorrect: opt.id === optionId })
    );
    updateBlock({ ...block, options: newOptions });
  };

  const correctOption = block.options.find(opt => opt.isCorrect);

  return (
    <div className="bg-white border border-gray-200 rounded-sm shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="font-bold text-gray-900">Q{startNum}</span>
          <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded">
            Single Choice MCQ
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => moveBlock(block.id, 'up')}
            className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
            title="Move up"
          >
            <ArrowUp size={16} />
          </button>
          <button
            onClick={() => moveBlock(block.id, 'down')}
            className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
            title="Move down"
          >
            <ArrowDown size={16} />
          </button>
          <button
            onClick={() => deleteBlock(block.id)}
            className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
            title="Delete block"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Instruction */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Instruction
        </label>
        <textarea
          value={block.instruction}
          onChange={(e) => updateBlock({ ...block, instruction: e.target.value })}
          onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateBlock({ ...block, instruction: nextValue }))}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={2}
          placeholder="Enter instruction for this question..."
        />
      </div>

      {/* Question Stem */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Question Stem
        </label>
        <textarea
          value={block.stem}
          onChange={(e) => updateStem(e.target.value)}
          onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateStem(nextValue))}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={3}
          placeholder="Enter the question stem..."
        />
        {errors.find(e => e.field === 'stem') && (
          <p className="text-xs text-red-600 mt-1">{errors.find(e => e.field === 'stem')?.message}</p>
        )}
      </div>

      {/* Options */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">
            Options (Select one correct answer)
          </label>
          <button
            onClick={addOption}
            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <Plus size={14} /> Add Option
          </button>
        </div>
        <div className="space-y-2">
          {block.options.map((option, index) => (
            <div key={option.id} className="flex items-start gap-3 p-3 border rounded-md">
              <button
                onClick={() => setCorrectAnswer(option.id)}
                className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  option.isCorrect ? 'border-blue-600 bg-blue-600' : 'border-gray-300'
                }`}
              >
                {option.isCorrect && <div className="w-2 h-2 bg-white rounded-full" />}
              </button>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-700">
                    {String.fromCharCode(65 + index)}.
                  </span>
                  <input
                    type="text"
                    value={option.text}
                    onChange={(e) => updateOption(option.id, { text: e.target.value })}
                    onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateOption(option.id, { text: nextValue }))}
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Option text..."
                  />
                </div>
              </div>
              {block.options.length > 2 && (
                <button
                  onClick={() => removeOption(option.id)}
                  className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600 mt-1"
                  title="Remove option"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        {!correctOption && (
          <p className="text-xs text-amber-600 mt-2">Please select one correct answer</p>
        )}
      </div>
    </div>
  );
}
