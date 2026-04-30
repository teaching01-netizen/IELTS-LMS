import React from 'react';
import { ShortAnswerBlock as ShortAnswerBlockType, AnswerRule } from '../../types';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { createId } from '../../utils/idUtils';
import { handleBoldHotkey } from '../../utils/boldMarkdown';
import { AcceptedAnswersEditor } from './AcceptedAnswersEditor';
import {
  buildAcceptedAnswerFields,
  resolveAcceptedAnswers,
} from '../../utils/acceptedAnswers';

interface ShortAnswerBlockProps {
  block: ShortAnswerBlockType;
  startNum: number;
  endNum: number;
  updateBlock: (block: ShortAnswerBlockType) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
}

export function ShortAnswerBlock({ block, startNum, endNum, updateBlock, deleteBlock, moveBlock, errors = [] }: ShortAnswerBlockProps) {
  const updateInstruction = (instruction: string) => {
    updateBlock({ ...block, instruction });
  };

  const updateQuestion = (
    questionId: string,
    updates: { prompt?: string; correctAnswer?: string; acceptedAnswers?: string[]; answerRule?: AnswerRule },
  ) => {
    const newQuestions = block.questions.map(q =>
      q.id === questionId ? { ...q, ...updates } : q
    );
    updateBlock({ ...block, questions: newQuestions });
  };

  const addQuestion = () => {
    const newQuestion = {
      id: createId('q'),
      prompt: '',
      correctAnswer: '',
      acceptedAnswers: [],
      answerRule: 'TWO_WORDS' as AnswerRule
    };
    updateBlock({ ...block, questions: [...block.questions, newQuestion] });
  };

  const removeQuestion = (questionId: string) => {
    const newQuestions = block.questions.filter(q => q.id !== questionId);
    updateBlock({ ...block, questions: newQuestions });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-sm shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="font-bold text-gray-900">Q{startNum}-{endNum}</span>
          <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded">
            Short Answer
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
          onChange={(e) => updateInstruction(e.target.value)}
          onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateInstruction(nextValue))}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={2}
          placeholder="Enter instruction for this question..."
        />
      </div>

      {/* Questions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-sm font-medium text-gray-700">
            Questions ({block.questions.length})
          </label>
          <button
            onClick={addQuestion}
            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <Plus size={14} /> Add Question
          </button>
        </div>
        <div className="space-y-4">
          {block.questions.map((question, index) => (
            <div key={question.id} className="border rounded-md p-4">
              <div className="flex items-start justify-between mb-3">
                <span className="text-sm font-medium text-gray-700">
                  {startNum + index}.
                </span>
                <button
                  onClick={() => removeQuestion(question.id)}
                  className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                  title="Remove question"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Prompt
                  </label>
                  <textarea
                    value={question.prompt}
                    onChange={(e) => updateQuestion(question.id, { prompt: e.target.value })}
                    onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateQuestion(question.id, { prompt: nextValue }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={2}
                    placeholder="Enter the question prompt..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Accepted Answers</label>
                  <AcceptedAnswersEditor
                    value={resolveAcceptedAnswers(question)}
                    onChange={(next) => updateQuestion(question.id, buildAcceptedAnswerFields(next))}
                    placeholder="Enter the accepted answer..."
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
