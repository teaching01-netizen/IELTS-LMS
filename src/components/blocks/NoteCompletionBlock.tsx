import React from 'react';
import { NoteCompletionBlock as NoteCompletionBlockType, AnswerRule } from '../../types';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';

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
    const newQuestions = block.questions.map(q =>
      q.id === questionId ? { ...q, ...updates } : q
    );
    updateBlock({ ...block, questions: newQuestions });
  };

  const updateBlank = (questionId: string, blankId: string, updates: { correctAnswer?: string }) => {
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
      id: `q${Date.now()}`,
      noteText: '',
      blanks: [],
      answerRule: 'TWO_WORDS' as AnswerRule
    };
    updateBlock({ ...block, questions: [...block.questions, newQuestion] });
  };

  const removeQuestion = (questionId: string) => {
    const newQuestions = block.questions.filter(q => q.id !== questionId);
    updateBlock({ ...block, questions: newQuestions });
  };

  const addBlank = (questionId: string) => {
    const newQuestions = block.questions.map(q => {
      if (q.id !== questionId) return q;
      const newBlank = {
        id: `b${Date.now()}`,
        correctAnswer: '',
        position: q.blanks.length
      };
      return { ...q, blanks: [...q.blanks, newBlank] };
    });
    updateBlock({ ...block, questions: newQuestions });
  };

  const removeBlank = (questionId: string, blankId: string) => {
    const newQuestions = block.questions.map(q => {
      if (q.id !== questionId) return q;
      const newBlanks = q.blanks.filter(b => b.id !== blankId);
      return { ...q, blanks: newBlanks };
    });
    updateBlock({ ...block, questions: newQuestions });
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
        <textarea value={block.instruction} onChange={(e) => updateInstruction(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} placeholder="Enter instruction..." />
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
                <span className="text-sm font-medium text-gray-700">{startNum + index}.</span>
                <div className="flex items-center gap-2">
                  <select value={question.answerRule} onChange={(e) => updateQuestion(question.id, { answerRule: e.target.value as AnswerRule })} className="text-xs border border-gray-300 rounded px-2 py-1">
                    <option value="ONE_WORD">One word</option>
                    <option value="TWO_WORDS">Two words</option>
                    <option value="THREE_WORDS">Three words</option>
                  </select>
                  <button onClick={() => removeQuestion(question.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Note Text (use ____ for blanks)</label>
                  <textarea value={question.noteText} onChange={(e) => updateQuestion(question.id, { noteText: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" rows={3} placeholder="Enter note with ____ for blanks..." />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-medium text-gray-600">Blank Answers ({question.blanks.length})</label>
                    <button onClick={() => addBlank(question.id)} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={12} /> Add Blank</button>
                  </div>
                  {question.blanks.length > 0 ? (
                    <div className="space-y-2">
                      {question.blanks.map((blank, blankIndex) => (
                        <div key={blank.id} className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-16">Blank {blankIndex + 1}:</span>
                          <input type="text" value={blank.correctAnswer} onChange={(e) => updateBlank(question.id, blank.id, { correctAnswer: e.target.value })} className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="Answer..." />
                          <button onClick={() => removeBlank(question.id, blank.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"><Trash2 size={12} /></button>
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
