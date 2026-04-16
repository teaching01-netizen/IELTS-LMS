import React, { useState } from 'react';
import { QuestionBlock, MultiMCQBlock as MultiMCQBlockType } from '../../types';
import { MoreVertical, Plus, Trash2, GripVertical, ArrowUp, ArrowDown, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Props {
  block: QuestionBlock;
  startNum: number;
  endNum: number;
  updateBlock: (b: QuestionBlock) => void;
  deleteBlock: (id: string) => void;
  moveBlock: (id: string, dir: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
}

export const MultiSelectMCQBlock: React.FC<Props> = ({ block, startNum, endNum, updateBlock, deleteBlock, moveBlock, errors = [] }) => {
  const [showMenu, setShowMenu] = useState(false);
  
  const mcqBlock = block as MultiMCQBlockType;
  const options = mcqBlock.options || [];
  const requiredSelections = mcqBlock.requiredSelections || 2;
  
  const getFieldError = (field: string) => errors.find(e => e.field.includes(field));
  const correctCount = options.filter(o => o.isCorrect).length;
  const isExactCorrect = correctCount === requiredSelections;

  const addOption = () => {
    const newO = { id: `o${Date.now()}`, text: '', isCorrect: false };
    updateBlock({ ...mcqBlock, options: [...options, newO] });
  };

  const updateOption = (id: string, field: 'text' | 'isCorrect', value: string | boolean) => {
    const newO = options.map(o => o.id === id ? { ...o, [field]: value } : o);
    updateBlock({ ...mcqBlock, options: newO });
  };

  const removeOption = (id: string) => {
    const newO = options.filter(o => o.id !== id);
    updateBlock({ ...mcqBlock, options: newO });
  };

  const toLetter = (num: number) => String.fromCharCode(65 + num);

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
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Multi-Select MCQ</div>
          <input 
            type="text" 
            value={mcqBlock.instruction} 
            onChange={(e) => updateBlock({ ...mcqBlock, instruction: e.target.value })}
            className={`w-full text-sm font-medium text-gray-800 outline-none border-b ${getFieldError('instruction') ? 'border-red-500 bg-red-50' : 'border-transparent hover:border-gray-200 focus:border-blue-700'} bg-transparent transition-colors px-1 py-0.5 rounded-sm mb-3`}
            placeholder="Instruction text..."
          />
          {getFieldError('instruction') && (
            <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={10} /> {getFieldError('instruction')!.message}</p>
          )}
        </div>

        <div className="mb-5">
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5 block">Question Stem</label>
          <input 
            type="text" 
            value={mcqBlock.stem} 
            onChange={(e) => updateBlock({ ...mcqBlock, stem: e.target.value })}
            className={`w-full text-sm text-gray-800 outline-none border rounded-sm p-2 ${getFieldError('stem') ? 'border-red-500 bg-red-50' : 'border-gray-200 focus:border-blue-700 focus:ring-1 focus:ring-blue-700'} transition-colors`}
            placeholder="Enter the question stem..."
          />
          {getFieldError('stem') && (
            <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={10} /> {getFieldError('stem')!.message}</p>
          )}
        </div>
        
        <div className={`border rounded-sm p-4 mb-4 ${isExactCorrect ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${isExactCorrect ? 'bg-green-500 text-white' : 'bg-amber-500 text-white'}`}>
                {isExactCorrect ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              </div>
              <div className="text-sm">
                <span className="font-bold text-[10px] uppercase tracking-wider mr-2">Smart Numbering:</span>
                <span className="text-gray-700">This block counts as <strong>{requiredSelections}</strong> question{requiredSelections > 1 ? 's' : ''}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Required Correct:</label>
              <select 
                value={requiredSelections} 
                onChange={(e) => updateBlock({ ...mcqBlock, requiredSelections: parseInt(e.target.value) })}
                className="border border-gray-200 rounded-sm p-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-700 transition-colors bg-white text-gray-700 font-semibold"
              >
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </div>
          </div>
          {!isExactCorrect && (
            <p className="text-xs text-amber-700 mt-2 flex items-center gap-1">
              <AlertCircle size={10} /> 
              Currently {correctCount} correct option{correctCount !== 1 ? 's' : ''} selected. Must have exactly {requiredSelections}.
            </p>
          )}
        </div>
        
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={o.id} className={`flex items-center gap-3 p-2.5 rounded-sm border transition-colors shadow-sm ${o.isCorrect ? 'bg-green-50/50 border-green-200' : 'bg-white border-gray-100 hover:border-gray-200'} group/item`}>
              <div className="font-semibold text-gray-400 w-6 text-center text-sm">{toLetter(i)}.</div>
              <input 
                type="text" 
                value={o.text} 
                onChange={(e) => updateOption(o.id, 'text', e.target.value)}
                className={`flex-1 bg-transparent outline-none text-sm px-2 py-1 text-gray-800 placeholder:text-gray-400 focus:ring-1 focus:ring-blue-700 rounded-sm ${getFieldError(`options[${i}].text`) ? 'border border-red-500' : ''}`}
                placeholder="Option text..." 
              />
              <label className="flex items-center gap-2 cursor-pointer bg-gray-50 hover:bg-gray-100 px-2 py-1 rounded-sm transition-colors border border-gray-100">
                <input 
                  type="checkbox" 
                  checked={o.isCorrect} 
                  onChange={(e) => updateOption(o.id, 'isCorrect', e.target.checked)}
                  className="w-4 h-4 text-green-800 rounded-sm focus:ring-green-700 accent-green-800"
                />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${o.isCorrect ? 'text-green-700' : 'text-gray-500'}`}>
                  {o.isCorrect ? 'Correct' : 'Incorrect'}
                </span>
              </label>
              <button 
                onClick={() => removeOption(o.id)} 
                className="text-gray-400 hover:text-red-700 opacity-0 group-hover/item:opacity-100 transition-all p-1 hover:bg-red-50 rounded-sm"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        
        {getFieldError('options') && (
          <p className="text-xs text-red-600 mt-2 flex items-center gap-1"><AlertCircle size={10} /> {getFieldError('options')!.message}</p>
        )}

        <div className="mt-4 flex justify-between items-center">
          <button onClick={addOption} className="text-sm text-blue-800 flex items-center gap-1.5 hover:bg-blue-50 px-2.5 py-1.5 rounded-sm transition-colors font-semibold">
            <Plus size={14} /> Add Option
          </button>
          <div className={`text-[10px] font-bold uppercase tracking-widest ${isExactCorrect ? 'text-green-700' : 'text-amber-700'}`}>
            {correctCount}/{requiredSelections} correct configured
          </div>
        </div>
      </div>
    </div>
  );
}
