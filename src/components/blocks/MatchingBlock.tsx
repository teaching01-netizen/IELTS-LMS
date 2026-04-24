import React, { useState } from 'react';
import { QuestionBlock, MatchingBlock as MatchingBlockType } from '../../types';
import { MoreVertical, Plus, Trash2, GripVertical, ArrowRight, ArrowUp, ArrowDown, AlertCircle, AlertTriangle } from 'lucide-react';
import { createId } from '../../utils/idUtils';
import { handleBoldHotkey } from '../../utils/boldMarkdown';

interface Props {
  block: QuestionBlock;
  startNum: number;
  endNum: number;
  updateBlock: (b: QuestionBlock) => void;
  deleteBlock: (id: string) => void;
  moveBlock: (id: string, dir: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
}

export const MatchingBlock: React.FC<Props> = ({ block, startNum, endNum, updateBlock, deleteBlock, moveBlock, errors = [] }) => {
  const [showMenu, setShowMenu] = useState(false);
  
  const matchingBlock = block as MatchingBlockType;
  const headings = matchingBlock.headings || [];
  const questions = matchingBlock.questions || [];
  
  const getFieldError = (field: string) => errors.find(e => e.field.includes(field));

  const toRoman = (num: number): string => {
    const roman = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
    return roman[num] || num.toString();
  };

  const addHeading = () => {
    const newH = { id: createId('h'), text: '' };
    updateBlock({ ...matchingBlock, headings: [...headings, newH] });
  };

  const updateHeading = (id: string, text: string) => {
    const newH = headings.map(h => h.id === id ? { ...h, text } : h);
    updateBlock({ ...matchingBlock, headings: newH });
  };

  const removeHeading = (id: string) => {
    const newH = headings.filter(h => h.id !== id);
    updateBlock({ ...matchingBlock, headings: newH });
  };

  const addParagraph = () => {
    const nextChar = String.fromCharCode(65 + questions.length);
    const newQ = { id: createId('q'), paragraphLabel: nextChar, correctHeading: '' };
    updateBlock({ ...matchingBlock, questions: [...questions, newQ] });
  };

  const updateParagraphAnswer = (id: string, answer: string) => {
    const newQ = questions.map(q => q.id === id ? { ...q, correctHeading: answer } : q);
    updateBlock({ ...matchingBlock, questions: newQ });
  };

  const removeParagraph = (id: string) => {
    const newQ = questions.filter(q => q.id !== id);
    updateBlock({ ...matchingBlock, questions: newQ });
  };

  const matchedHeadingIndices = questions.map(q => q.correctHeading).filter(Boolean);
  const unusedHeadings = headings.filter((_, i) => {
    const roman = toRoman(i);
    return !matchedHeadingIndices.includes(roman);
  });

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
        <div className="mb-6">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Matching Headings</div>
          <input 
            type="text" 
            value={matchingBlock.instruction} 
            onChange={(e) => updateBlock({ ...matchingBlock, instruction: e.target.value })}
            onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateBlock({ ...matchingBlock, instruction: nextValue }))}
            className={`w-full text-sm font-medium text-gray-800 outline-none border-b ${getFieldError('instruction') ? 'border-red-500 bg-red-50' : 'border-transparent hover:border-gray-200 focus:border-blue-700'} bg-transparent transition-colors px-1 py-0.5 rounded-sm mb-3`}
            placeholder="Choose the correct heading for each paragraph from the list of headings below."
          />
          {getFieldError('instruction') && (
            <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={10} /> {getFieldError('instruction')!.message}</p>
          )}
        </div>
        
        <div className="flex gap-8">
          <div className="flex-1">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 px-1">Headings</h3>
            <div className="space-y-2">
              {headings.map((h, i) => {
                const roman = toRoman(i);
                const isMatched = matchedHeadingIndices.includes(roman);
                return (
                  <div key={h.id} className={`flex items-start gap-2 group/item ${isMatched ? 'opacity-50' : ''}`}>
                    <div className="font-semibold text-gray-500 mt-2 w-6 text-right text-xs">{roman}.</div>
                    <div className={`flex-1 bg-white border rounded-sm p-1 relative flex items-center shadow-sm transition-colors hover:border-gray-200 ${getFieldError(`headings[${i}].text`) ? 'border-red-500' : 'border-gray-100'}`}>
                      <input 
                        type="text" 
                        value={h.text} 
                        onChange={(e) => updateHeading(h.id, e.target.value)}
                        onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateHeading(h.id, nextValue))}
                        className="w-full bg-transparent outline-none text-sm px-2 py-1 text-gray-800 placeholder:text-gray-400 focus:ring-1 focus:ring-blue-700 rounded-sm" 
                        placeholder="Type heading..." 
                      />
                      <button 
                        onClick={() => removeHeading(h.id)} 
                        className="text-gray-400 hover:text-red-700 opacity-0 group-hover/item:opacity-100 transition-all p-1 hover:bg-red-50 rounded-sm mr-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button onClick={addHeading} className="mt-4 text-sm text-blue-800 flex items-center gap-1.5 hover:bg-blue-50 px-2.5 py-1.5 rounded-sm transition-colors font-semibold">
              <Plus size={14} /> Add Heading
            </button>
            <div className="mt-4 text-[10px] text-gray-400 font-bold uppercase tracking-wider px-1">
              Auto-generated numerals
            </div>
          </div>

          <div className="flex-1">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 px-1">Paragraphs</h3>
            <div className="space-y-2">
              {questions.map((q, i) => (
                <div key={q.id} className="flex items-center gap-3 group/item">
                  <div className="font-semibold text-gray-500 w-6 text-right text-xs">Q{startNum + i}</div>
                  <div className="flex-1 bg-white border border-gray-100 rounded-sm p-2 flex items-center justify-between shadow-sm transition-colors hover:border-gray-200">
                    <span className="text-sm font-semibold text-gray-700 ml-2">Paragraph {q.paragraphLabel}</span>
                    <div className="flex items-center gap-2">
                      <ArrowRight size={14} className="text-gray-400" />
                      <select 
                        value={q.correctHeading} 
                        onChange={(e) => updateParagraphAnswer(q.id, e.target.value)}
                        className={`border rounded-sm p-1 text-sm text-gray-700 focus:ring-1 focus:ring-blue-700 outline-none w-24 transition-colors ${getFieldError(`questions[${i}].correctHeading`) ? 'border-red-500' : ''}`}
                      >
                        <option value="">Choose</option>
                        {headings.map((_, hi) => (
                          <option key={hi} value={toRoman(hi)}>{toRoman(hi)}</option>
                        ))}
                      </select>
                      <button 
                        onClick={() => removeParagraph(q.id)} 
                        className="text-gray-400 hover:text-red-700 opacity-0 group-hover/item:opacity-100 transition-all p-1 hover:bg-red-50 rounded-sm"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addParagraph} className="mt-4 text-sm text-blue-800 flex items-center gap-1.5 hover:bg-blue-50 px-2.5 py-1.5 rounded-sm transition-colors font-semibold">
              <Plus size={14} /> Add Paragraph
            </button>

            {unusedHeadings.length > 0 && (
              <div className="mt-6 p-4 bg-amber-50 border border-amber-100 rounded-sm shadow-sm">
                <h4 className="text-[10px] font-bold text-amber-800 uppercase tracking-widest mb-2 flex items-center gap-1">
                  <AlertTriangle size={12} /> Unmatched Headings:
                </h4>
                <div className="flex flex-wrap gap-2">
                  {unusedHeadings.map((_, i) => {
                    const headingIndex = headings.findIndex((h, hi) => {
                      const roman = toRoman(hi);
                      return !matchedHeadingIndices.includes(roman);
                    });
                    return (
                      <span key={i} className="bg-white px-2 py-0.5 rounded-sm border border-amber-200 text-amber-800 font-bold text-xs">
                        {toRoman(headingIndex)}
                      </span>
                    );
                  })}
                  {headings.length === 0 && <span className="text-amber-400 text-xs italic">None</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
