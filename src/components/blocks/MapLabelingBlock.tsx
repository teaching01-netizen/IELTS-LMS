import React, { useEffect, useRef, useState } from 'react';
import { QuestionBlock, MapBlock as MapBlockType } from '../../types';
import { MoreVertical, Plus, Trash2, GripVertical, Image as ImageIcon, ArrowUp, ArrowDown, AlertCircle, Link as LinkIcon } from 'lucide-react';
import { MIN_HEIGHTS } from '../../constants/uiConstants';
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

export const MapLabelingBlock: React.FC<Props> = ({ block, startNum, endNum, updateBlock, deleteBlock, moveBlock, errors = [] }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState(false);
  const imageRef = useRef<HTMLDivElement>(null);
  
  const mapBlock = block as MapBlockType;
  const questions = mapBlock.questions || [];
  
  const getFieldError = (field: string) => errors.find(e => e.field.includes(field));

  useEffect(() => {
    setImageLoadError(false);
  }, [mapBlock.assetUrl]);

  const addHotspot = (x: number = 50, y: number = 50) => {
    const newQ = { id: createId('q'), label: `Location ${questions.length + 1}`, correctAnswer: '', x, y };
    updateBlock({ ...mapBlock, questions: [...questions, newQ] });
  };

  const removeHotspot = (id: string) => {
    const newQ = questions.filter(q => q.id !== id);
    updateBlock({ ...mapBlock, questions: newQ });
  };

  const updateHotspot = (id: string, field: 'label' | 'correctAnswer' | 'x' | 'y', value: string | number) => {
    const newQ = questions.map(q => q.id === id ? { ...q, [field]: value } : q);
    updateBlock({ ...mapBlock, questions: newQ });
  };

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    addHotspot(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
  };

  const handleHotspotDrag = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (!imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    updateHotspot(id, 'x', Math.max(0, Math.min(100, Math.round(x * 10) / 10)));
    updateHotspot(id, 'y', Math.max(0, Math.min(100, Math.round(y * 10) / 10)));
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
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Map / Diagram Labeling</div>
          <input 
            type="text" 
            value={mapBlock.instruction} 
            onChange={(e) => updateBlock({ ...mapBlock, instruction: e.target.value })}
            onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateBlock({ ...mapBlock, instruction: nextValue }))}
            className={`w-full text-sm font-medium text-gray-800 outline-none border-b ${getFieldError('instruction') ? 'border-red-500 bg-red-50' : 'border-transparent hover:border-gray-200 focus:border-blue-700'} bg-transparent transition-colors px-1 py-0.5 rounded-sm mb-3`}
            placeholder="Label the map below."
          />
          {getFieldError('instruction') && (
            <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={10} /> {getFieldError('instruction')!.message}</p>
          )}
        </div>
        
        <div className="mb-4">
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-2">Image URL</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <LinkIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="url" 
                value={mapBlock.assetUrl} 
                onChange={(e) => updateBlock({ ...mapBlock, assetUrl: e.target.value })}
                className={`w-full pl-10 pr-4 py-2 border rounded-sm text-sm outline-none transition-colors ${getFieldError('assetUrl') ? 'border-red-500 bg-red-50' : 'border-gray-200 focus:border-blue-700 focus:ring-1 focus:ring-blue-700'} text-gray-800`}
                placeholder="https://example.com/map.png"
              />
            </div>
          </div>
          {getFieldError('assetUrl') && (
            <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={10} /> {getFieldError('assetUrl')!.message}</p>
          )}
        </div>
        
	        <div 
	          ref={imageRef}
	          className={`border-2 rounded-sm relative overflow-hidden transition-colors cursor-crosshair ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'} ${getFieldError('assetUrl') ? 'border-red-200 bg-red-50/30' : ''}`}
	          style={{ minHeight: MIN_HEIGHTS.MAP_LABELING }}
	          onClick={handleImageClick}
	          onMouseEnter={() => setIsDragging(true)}
	          onMouseLeave={() => setIsDragging(false)}
	        >
	          {mapBlock.assetUrl && !imageLoadError ? (
	            <img
	              src={mapBlock.assetUrl}
	              alt="Map"
	              className="w-full h-full object-contain pointer-events-none"
	              onError={() => setImageLoadError(true)}
	            />
	          ) : (
	            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
	              <ImageIcon size={32} className="mb-2 text-gray-300" />
	              <p className="text-sm font-medium text-gray-600">
	                {mapBlock.assetUrl ? 'Unable to load image' : 'Enter an image URL above'}
	              </p>
	              <p className="text-[10px] mt-1 text-gray-400 font-bold uppercase tracking-wider">
	                {mapBlock.assetUrl ? 'Check the URL and try again' : 'or click to add hotspot'}
	              </p>
	            </div>
	          )}
          
          {questions.map((q, i) => (
            <div 
              key={q.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', q.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverId(q.id);
              }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverId(null);
                handleHotspotDrag(e, q.id);
              }}
              className={`absolute w-8 h-8 bg-blue-800 text-white rounded-full flex items-center justify-center shadow-[0_2px_4px_rgba(0,0,0,0.2)] text-[10px] font-bold cursor-move border-2 border-white transition-all hover:scale-110 hover:z-10 ${dragOverId === q.id ? 'scale-125 ring-2 ring-yellow-400' : ''}`}
              style={{ left: `${q.x}%`, top: `${q.y}%`, transform: 'translate(-50%, -50%)' }}
              title={`${q.label} (${q.x}%, ${q.y}%)`}
            >
              {startNum + i}
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-between items-center">
          <button onClick={() => addHotspot()} className="text-sm text-blue-800 flex items-center gap-1.5 hover:bg-blue-50 px-2.5 py-1.5 rounded-sm transition-colors font-semibold">
            <Plus size={14} /> Add Hotspot
          </button>
          <div className="text-[10px] text-gray-500">
            {questions.length} hotspot{questions.length !== 1 ? 's' : ''} • Click image to add
          </div>
        </div>

        {questions.length > 0 && (
          <div className="mt-6 space-y-2">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 px-1">Hotspot Labels</div>
            {questions.map((q, i) => (
              <div key={q.id} className="flex items-center gap-3 bg-white p-2.5 rounded-sm border border-gray-100 shadow-sm transition-colors hover:border-gray-200 group/item">
                <div className="w-8 h-8 bg-blue-50 text-blue-800 rounded-full flex items-center justify-center text-xs font-bold border border-blue-100">
                  {startNum + i}
                </div>
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Label</label>
                    <input 
                      type="text" 
                      value={q.label} 
                      onChange={(e) => updateHotspot(q.id, 'label', e.target.value)}
                      onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateHotspot(q.id, 'label', nextValue))}
                      className={`w-full border rounded-sm px-2 py-1 text-xs focus:ring-1 focus:ring-blue-700 outline-none transition-colors text-gray-800 ${getFieldError(`questions[${i}].label`) ? 'border-red-500' : 'border-gray-100'}`}
                      placeholder="Location A"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Answer</label>
                    <input 
                      type="text" 
                      value={q.correctAnswer} 
                      onChange={(e) => updateHotspot(q.id, 'correctAnswer', e.target.value)}
                      className={`w-full border rounded-sm px-2 py-1 text-xs focus:ring-1 focus:ring-blue-700 outline-none transition-colors text-gray-800 ${getFieldError(`questions[${i}].correctAnswer`) ? 'border-red-500' : 'border-gray-100'}`}
                      placeholder="Correct answer"
                    />
                  </div>
                  <div className="flex gap-1">
                    <div className="flex-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">X%</label>
                      <input 
                        type="number" 
                        min="0" 
                        max="100"
                        value={q.x} 
                        onChange={(e) => updateHotspot(q.id, 'x', parseFloat(e.target.value) || 0)}
                        className="w-full border border-gray-100 rounded-sm px-2 py-1 text-xs focus:ring-1 focus:ring-blue-700 outline-none transition-colors text-gray-800"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Y%</label>
                      <input 
                        type="number" 
                        min="0" 
                        max="100"
                        value={q.y} 
                        onChange={(e) => updateHotspot(q.id, 'y', parseFloat(e.target.value) || 0)}
                        className="w-full border border-gray-100 rounded-sm px-2 py-1 text-xs focus:ring-1 focus:ring-blue-700 outline-none transition-colors text-gray-800"
                      />
                    </div>
                  </div>
                </div>
                {getFieldError(`questions[${i}].correctAnswer`) && (
                  <p className="text-xs text-red-600 col-span-full mt-1 flex items-center gap-1"><AlertCircle size={10} /> {getFieldError(`questions[${i}].correctAnswer`)!.message}</p>
                )}
                <button 
                  onClick={() => removeHotspot(q.id)} 
                  className="text-gray-400 hover:text-red-700 opacity-0 group-hover/item:opacity-100 transition-all p-1.5 hover:bg-red-50 rounded-sm"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
