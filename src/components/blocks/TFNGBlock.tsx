import React, { useState } from 'react';
import { QuestionBlock, TFNGBlock as TFNGBlockType, TFNGMode } from '../../types';
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

export const TFNGBlock: React.FC<Props> = ({ block, startNum, endNum, updateBlock, deleteBlock, moveBlock, errors = [] }) => {
  const [showMenu, setShowMenu] = useState(false);
  
  const tfngBlock = block as TFNGBlockType;
  const mode: TFNGMode = tfngBlock.mode || 'TFNG';
  
  const tfngOptions = mode === 'TFNG' 
    ? ['T', 'F', 'NG'] as const
    : ['Y', 'N', 'NG'] as const;
  
  const getFieldError = (field: string) => errors.find(e => e.field.includes(field));

  const updateQuestion = (qId: string, field: 'statement' | 'correctAnswer', value: string) => {
    const newQuestions = tfngBlock.questions.map(q => 
      q.id === qId ? { ...q, [field]: value } : q
    );
    updateBlock({ ...tfngBlock, questions: newQuestions });
  };

  const addRow = () => {
    const newQ = { id: `q${Date.now()}`, statement: '', correctAnswer: (mode === 'TFNG' ? 'T' : 'Y') as 'T' | 'F' | 'NG' | 'Y' | 'N' };
    updateBlock({ ...tfngBlock, questions: [...tfngBlock.questions, newQ] });
  };

  const removeRow = (qId: string) => {
    const newQuestions = tfngBlock.questions.filter(q => q.id !== qId);
    updateBlock({ ...tfngBlock, questions: newQuestions });
  };

  const toggleMode = (newMode: TFNGMode) => {
    const answerMap: Record<TFNGMode, Record<string, 'T' | 'F' | 'NG' | 'Y' | 'N'>> = {
      'TFNG': { 'T': 'T', 'F': 'F', 'Y': 'T', 'N': 'F', 'NG': 'NG' },
      'YNNG': { 'T': 'Y', 'F': 'N', 'Y': 'Y', 'N': 'N', 'NG': 'NG' }
    };

    const newQuestions = tfngBlock.questions.map(q => ({
      ...q,
      correctAnswer: answerMap[newMode][q.correctAnswer] || (newMode === 'TFNG' ? 'T' : 'Y')
    }));

    updateBlock({ ...tfngBlock, mode: newMode, questions: newQuestions });
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
        <div className="flex justify-between items-start mb-5">
          <div className="w-full">
            <div className="flex items-center gap-4 mb-3">
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Question Mode:</div>
              <div className="flex gap-1 bg-gray-100 p-0.5 rounded-sm">
                <button
                  onClick={() => toggleMode('TFNG')}
                  className={`px-3 py-1 text-xs font-semibold rounded-sm transition-all ${mode === 'TFNG' ? 'bg-blue-800 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  T / F / NG
                </button>
                <button
                  onClick={() => toggleMode('YNNG')}
                  className={`px-3 py-1 text-xs font-semibold rounded-sm transition-all ${mode === 'YNNG' ? 'bg-blue-800 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  Y / N / NG
                </button>
              </div>
            </div>
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Instruction:</div>
            <input 
              type="text" 
              value={tfngBlock.instruction} 
              onChange={(e) => updateBlock({ ...tfngBlock, instruction: e.target.value })}
              className={`w-full text-sm font-medium text-gray-800 outline-none border-b ${getFieldError('instruction') ? 'border-red-500 bg-red-50' : 'border-transparent hover:border-gray-200 focus:border-blue-700'} bg-transparent transition-colors px-1 py-0.5 rounded-sm`}
              placeholder={mode === 'TFNG' ? 'Do the following statements agree with the information given?' : 'Do the following statements agree with the writer\'s views?'}
            />
            {getFieldError('instruction') && (
              <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={10} /> {getFieldError('instruction')!.message}</p>
            )}
          </div>
        </div>
        
        <div className="border border-gray-100 rounded-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="text-[10px] text-gray-500 font-bold uppercase tracking-wider bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 py-2 w-10 text-center">#</th>
                <th className="px-3 py-2">Statement</th>
                <th className="px-3 py-2 w-14 text-center">{tfngOptions[0]}</th>
                <th className="px-3 py-2 w-14 text-center">{tfngOptions[1]}</th>
                <th className="px-3 py-2 w-14 text-center">{tfngOptions[2]}</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {tfngBlock.questions.map((q, i) => (
                <tr key={q.id} className="hover:bg-gray-50/50 group/row transition-colors">
                  <td className="px-3 py-3 text-center font-semibold text-gray-500">{startNum + i}</td>
                  <td className="px-3 py-3">
                    <input 
                      type="text" 
                      value={q.statement} 
                      onChange={(e) => updateQuestion(q.id, 'statement', e.target.value)}
                      className={`w-full bg-transparent outline-none focus:ring-1 focus:ring-blue-700 rounded-sm px-2 py-1 text-gray-800 placeholder:text-gray-400 ${getFieldError(`questions[${i}].statement`) ? 'border border-red-500 bg-red-50' : ''}`}
                      placeholder="Type statement..." 
                    />
                  </td>
                  {tfngOptions.map(opt => (
                    <td key={opt} className="px-3 py-3 text-center">
                      <input 
                        type="radio" 
                        name={`q-${q.id}`} 
                        checked={q.correctAnswer === opt} 
                        onChange={() => updateQuestion(q.id, 'correctAnswer', opt)}
                        className="w-4 h-4 text-blue-800 focus:ring-blue-700 border-gray-300 accent-blue-800" 
                      />
                    </td>
                  ))}
                  <td className="px-3 py-3 text-center">
                    <button onClick={() => removeRow(q.id)} className="text-gray-400 hover:text-red-700 opacity-0 group-hover/row:opacity-100 transition-all p-1 hover:bg-red-50 rounded-sm">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {tfngBlock.questions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-500 text-sm">
                    No questions yet. Click "Add Row" to add your first question.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-between items-center">
          <button onClick={addRow} className="text-sm text-blue-800 flex items-center gap-1.5 hover:bg-blue-50 px-2.5 py-1.5 rounded-sm transition-colors font-semibold">
            <Plus size={14} /> Add Row
          </button>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex gap-4">
            <span>Total: {tfngBlock.questions.length}</span>
            {tfngOptions.map(opt => (
              <span key={opt} className={opt === 'T' || opt === 'Y' ? 'text-green-800' : opt === 'F' || opt === 'N' ? 'text-red-800' : 'text-gray-600'}>
                {opt}: {tfngBlock.questions.filter(q => q.correctAnswer === opt).length}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
