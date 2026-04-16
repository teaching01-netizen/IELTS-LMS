import React, { useState } from 'react';
import { QuestionBlock, ClozeBlock as ClozeBlockType, AnswerRule } from '../../types';
import { MoreVertical, Plus, Trash2, GripVertical, ArrowUp, ArrowDown, AlertCircle } from 'lucide-react';

interface Props {
  block: QuestionBlock;
  startNum: number;
  endNum: number;
  updateBlock: (b: QuestionBlock) => void;
  deleteBlock: (id: string) => void;
  moveBlock: (id: string, dir: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
}

const ANSWER_RULE_LABELS: Record<AnswerRule, string> = {
  'ONE_WORD': 'NO MORE THAN ONE WORD',
  'TWO_WORDS': 'NO MORE THAN TWO WORDS',
  'THREE_WORDS': 'NO MORE THAN THREE WORDS'
};

export const ClozeBlock: React.FC<Props> = ({ block, startNum, endNum, updateBlock, deleteBlock, moveBlock, errors = [] }) => {
  const [showMenu, setShowMenu] = useState(false);
  
  const clozeBlock = block as ClozeBlockType;
  const answerRule: AnswerRule = clozeBlock.answerRule || 'TWO_WORDS';
  
  const getFieldError = (field: string) => errors.find(e => e.field.includes(field));

  const updateQuestion = (qId: string, field: 'prompt' | 'correctAnswer', value: string) => {
    const newQuestions = clozeBlock.questions.map(q => 
      q.id === qId ? { ...q, [field]: value } : q
    );
    updateBlock({ ...clozeBlock, questions: newQuestions });
  };

  const addQuestion = () => {
    const newQ = { id: `q${Date.now()}`, prompt: '', correctAnswer: '' };
    updateBlock({ ...clozeBlock, questions: [...clozeBlock.questions, newQ] });
  };

  const removeQuestion = (qId: string) => {
    const newQuestions = clozeBlock.questions.filter(q => q.id !== qId);
    updateBlock({ ...clozeBlock, questions: newQuestions });
  };

  return (
    <div className="border border-gray-100 rounded-sm bg-white shadow-sm overflow-hidden">
      <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100 flex justify-between items-center border-l-4 border-l-blue-800 group">
        <div className="flex items-center gap-2">
          <GripVertical size={16} className="text-gray-400 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="font-semibold text-gray-900 text-sm">
            Questions {startNum}-{endNum}
          </div>
          {errors.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-sm">
              <AlertCircle size={12} /> {errors.length} issue{errors.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-gray-500 relative">
          <button onClick={() => setShowMenu(!showMenu)} className="hover:bg-gray-200 p-1 rounded-sm transition-colors text-gray-600"><MoreVertical size={16} /></button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-100 rounded-sm shadow-[0_4px_8px_-2px_rgba(9,30,66,0.25),0_0_1px_rgba(9,30,66,0.31)] z-10 py-1">
              <button onClick={() => { moveBlock(block.id, 'up'); setShowMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"><ArrowUp size={14} /> Move Up</button>
              <button onClick={() => { moveBlock(block.id, 'down'); setShowMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"><ArrowDown size={14} /> Move Down</button>
              <div className="h-px bg-gray-100 my-1 mx-2"></div>
              <button onClick={() => deleteBlock(block.id)} className="w-full text-left px-4 py-2 text-sm text-red-700 hover:bg-red-50 flex items-center gap-2 font-medium"><Trash2 size={14} /> Delete Block</button>
            </div>
          )}
        </div>
      </div>
      <div className="p-6">
        <div className="mb-5">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Summary Completion</div>
          <input 
            type="text" 
            value={clozeBlock.instruction} 
            onChange={(e) => updateBlock({ ...clozeBlock, instruction: e.target.value })}
            className={`w-full text-sm font-medium text-gray-800 outline-none border-b ${getFieldError('instruction') ? 'border-red-500 bg-red-50' : 'border-transparent hover:border-gray-200 focus:border-blue-700'} bg-transparent transition-colors px-1 py-0.5 rounded-sm mb-3`}
            placeholder="Complete the summary below. Choose NO MORE THAN TWO WORDS from the passage for each answer."
          />
          {getFieldError('instruction') && (
            <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={10} /> {getFieldError('instruction')!.message}</p>
          )}
          
          <div className="flex items-center gap-3 mt-3">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Answer Rule:</label>
            <select 
              value={answerRule} 
              onChange={(e) => updateBlock({ ...clozeBlock, answerRule: e.target.value as AnswerRule })}
              className={`border rounded-sm p-1.5 text-sm text-gray-700 focus:ring-1 focus:ring-blue-700 outline-none transition-colors ${getFieldError('answerRule') ? 'border-red-500 bg-red-50' : 'border-gray-100'}`}
            >
              <option value="ONE_WORD">NO MORE THAN ONE WORD</option>
              <option value="TWO_WORDS">NO MORE THAN TWO WORDS</option>
              <option value="THREE_WORDS">NO MORE THAN THREE WORDS</option>
            </select>
          </div>
        </div>
        
        <div className="space-y-4">
          {clozeBlock.questions.map((q, i) => (
            <div key={q.id} className="flex items-start gap-3 group/item">
              <div className="font-semibold text-gray-500 mt-2 w-8 text-right text-sm">{startNum + i}</div>
              <div className={`flex-1 bg-white border rounded-sm p-3 relative shadow-sm transition-colors hover:border-gray-200 ${getFieldError(`questions[${i}].prompt`) ? 'border-red-500 bg-red-50/30' : 'border-gray-100'}`}>
                <textarea 
                  value={q.prompt} 
                  onChange={(e) => updateQuestion(q.id, 'prompt', e.target.value)}
                  className="w-full bg-transparent outline-none text-sm resize-none mb-2 text-gray-800 placeholder:text-gray-400 focus:ring-1 focus:ring-blue-700 rounded-sm px-1" 
                  placeholder="Enter sentence with blank (e.g., The ____ is important.)" 
                  rows={2}
                />
                {getFieldError(`questions[${i}].prompt`) && (
                  <p className="text-xs text-red-600 mb-2 flex items-center gap-1"><AlertCircle size={10} /> {getFieldError(`questions[${i}].prompt`)!.message}</p>
                )}
                <div className="flex items-center gap-2 border-t border-gray-50 pt-2">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Correct Answer ({ANSWER_RULE_LABELS[answerRule]}):</span>
                  <input 
                    type="text" 
                    value={q.correctAnswer} 
                    onChange={(e) => updateQuestion(q.id, 'correctAnswer', e.target.value)}
                    className={`border rounded-sm px-2 py-1 text-sm w-48 focus:ring-1 focus:ring-blue-700 outline-none transition-colors text-gray-800 ${getFieldError(`questions[${i}].correctAnswer`) ? 'border-red-500 bg-red-50' : 'border-gray-100'}`}
                    placeholder="e.g., factories" 
                  />
                </div>
                {getFieldError(`questions[${i}].correctAnswer`) && (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={10} /> {getFieldError(`questions[${i}].correctAnswer`)!.message}</p>
                )}
                <button 
                  onClick={() => removeQuestion(q.id)} 
                  className="absolute top-2 right-2 text-gray-400 hover:text-red-700 opacity-0 group-hover/item:opacity-100 transition-all p-1 hover:bg-red-50 rounded-sm"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {clozeBlock.questions.length === 0 && (
            <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-gray-200 rounded-sm">
              No questions yet. Click "Add Question" to add your first question.
            </div>
          )}
        </div>
        <button onClick={addQuestion} className="mt-4 text-sm text-blue-800 flex items-center gap-1.5 hover:bg-blue-50 px-2.5 py-1.5 rounded-sm transition-colors font-semibold">
          <Plus size={14} /> Add Question
        </button>
      </div>
    </div>
  );
}
