import React from 'react';
import { NoteCompletionBlock as NoteCompletionBlockType, AnswerRule } from '../../types';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { createId } from '../../utils/idUtils';
import { countBlankPlaceholders } from '../../utils/blankPlaceholders';
import { handleBoldHotkey } from '../../utils/boldMarkdown';
import { AcceptedAnswersEditor } from './AcceptedAnswersEditor';
import {
  buildAcceptedAnswerFields,
  resolveAcceptedAnswers,
} from '../../utils/acceptedAnswers';

interface NoteCompletionBlockProps {
  block: NoteCompletionBlockType;
  startNum: number;
  endNum: number;
  updateBlock: (block: NoteCompletionBlockType) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
}

export function NoteCompletionBlock({ block, startNum, endNum, updateBlock, deleteBlock, moveBlock, errors = [] }: NoteCompletionBlockProps) {
  const updateInstruction = (instruction: string) => {
    updateBlock({ ...block, instruction });
  };

  const updateQuestion = (questionId: string, updates: { noteText?: string; answerRule?: AnswerRule }) => {
    const newQuestions = block.questions.map((q) => {
      if (q.id !== questionId) return q;

      const nextNoteText = updates.noteText ?? q.noteText;
      const placeholderCount = countBlankPlaceholders(nextNoteText);

      let nextBlanks = q.blanks;
      if (placeholderCount !== q.blanks.length) {
        nextBlanks = q.blanks.slice(0, placeholderCount);
        while (nextBlanks.length < placeholderCount) {
          nextBlanks = [
            ...nextBlanks,
            {
              id: createId('blank'),
              correctAnswer: '',
              acceptedAnswers: [],
              position: nextBlanks.length,
            },
          ];
        }
      }

      nextBlanks = nextBlanks.map((blank, index) => ({ ...blank, position: index }));

      return { ...q, ...updates, noteText: nextNoteText, blanks: nextBlanks };
    });

    updateBlock({ ...block, questions: newQuestions });
  };

  const updateBlank = (
    questionId: string,
    blankId: string,
    updates: { correctAnswer?: string; acceptedAnswers?: string[] },
  ) => {
    const newQuestions = block.questions.map(q => {
      if (q.id !== questionId) return q;
      const newBlanks = q.blanks.map(b =>
        b.id === blankId ? { ...b, ...updates } : b
      );
      return { ...q, blanks: newBlanks };
    });
    updateBlock({ ...block, questions: newQuestions });
  };

  const addQuestion = () => {
    const newQuestion = {
      id: createId('q'),
      noteText: 'The ____ is important.',
      blanks: [{ id: createId('blank'), correctAnswer: '', acceptedAnswers: [], position: 0 }],
      answerRule: 'TWO_WORDS' as AnswerRule
    };
    updateBlock({ ...block, questions: [...block.questions, newQuestion] });
  };

  const removeQuestion = (questionId: string) => {
    const newQuestions = block.questions.filter(q => q.id !== questionId);
    updateBlock({ ...block, questions: newQuestions });
  };

  const getQuestionNumberLabel = (questionIndex: number) => {
    const offset = block.questions
      .slice(0, questionIndex)
      .reduce((count, q) => count + q.blanks.length, 0);
    const start = startNum + offset;
    const blanks = block.questions[questionIndex]?.blanks.length ?? 0;
    const end = start + Math.max(0, blanks - 1);
    if (blanks <= 1) return `${start}`;
    return `${start}–${end}`;
  };

  return (
    <div className="bg-white border border-gray-200 rounded-sm shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="font-bold text-gray-900">Q{startNum}-{endNum}</span>
          <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded">Note Completion</span>
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

      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-sm font-medium text-gray-700">Notes ({block.questions.length})</label>
          <button onClick={addQuestion} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Add Note</button>
        </div>
        <div className="space-y-4">
          {block.questions.map((question, index) => (
            <div key={question.id} className="border rounded-md p-4">
              <div className="flex items-start justify-between mb-3">
                <span className="text-sm font-medium text-gray-700">{getQuestionNumberLabel(index)}.</span>
                <div className="flex items-center gap-2">
                  <select value={question.answerRule} onChange={(e) => updateQuestion(question.id, { answerRule: e.target.value as AnswerRule })} className="text-xs border border-gray-300 rounded px-2 py-1">
                    <option value="ONE_WORD">One word only</option>
                    <option value="TWO_WORDS">No more than two words</option>
                    <option value="THREE_WORDS">No more than three words</option>
                  </select>
                  <button onClick={() => removeQuestion(question.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Note Text (use ____ for blanks)</label>
                  <textarea
                    value={question.noteText}
                    onChange={(e) => updateQuestion(question.id, { noteText: e.target.value })}
                    onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateQuestion(question.id, { noteText: nextValue }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="Enter note with ____ for blanks..."
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Use <span className="font-mono">____</span> to create blanks. Answers below are generated automatically.
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-medium text-gray-600">Blank Answers ({question.blanks.length})</label>
                  </div>
                  {question.blanks.length > 0 ? (
                    <div className="space-y-2">
                      {question.blanks.map((blank, blankIndex) => (
                        <div key={blank.id} className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-16 self-start pt-1">Blank {blankIndex + 1}:</span>
                          <div className="flex-1">
                            <AcceptedAnswersEditor
                              value={resolveAcceptedAnswers(blank)}
                              onChange={(next) =>
                                updateBlank(question.id, blank.id, buildAcceptedAnswerFields(next))
                              }
                              placeholder="Answer..."
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">No blanks added yet</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
