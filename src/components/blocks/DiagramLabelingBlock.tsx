import React, { useEffect, useState } from 'react';
import { DiagramLabelingBlock as DiagramLabelingBlockType } from '../../types';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { createId } from '../../utils/idUtils';
import { handleBoldHotkey } from '../../utils/boldMarkdown';

interface DiagramLabelingBlockProps {
  block: DiagramLabelingBlockType;
  startNum: number;
  endNum: number;
  updateBlock: (block: DiagramLabelingBlockType) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
}

export function DiagramLabelingBlock({ block, startNum, endNum, updateBlock, deleteBlock, moveBlock, errors = [] }: DiagramLabelingBlockProps) {
  const [imageLoadError, setImageLoadError] = useState(false);

  useEffect(() => {
    setImageLoadError(false);
  }, [block.imageUrl]);

  const updateInstruction = (instruction: string) => {
    updateBlock({ ...block, instruction });
  };

  const updateImageUrl = (imageUrl: string) => {
    updateBlock({ ...block, imageUrl });
  };

  const updateLabel = (labelId: string, updates: { x?: number; y?: number; correctAnswer?: string }) => {
    const newLabels = block.labels.map(l =>
      l.id === labelId ? { ...l, ...updates } : l
    );
    updateBlock({ ...block, labels: newLabels });
  };

  const addLabel = () => {
    const newLabel = {
      id: createId('lbl'),
      x: 50,
      y: 50,
      correctAnswer: ''
    };
    updateBlock({ ...block, labels: [...block.labels, newLabel] });
  };

  const removeLabel = (labelId: string) => {
    const newLabels = block.labels.filter(l => l.id !== labelId);
    updateBlock({ ...block, labels: newLabels });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-sm shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="font-bold text-gray-900">Q{startNum}-{endNum}</span>
          <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded">
            Diagram Labeling
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => moveBlock(block.id, 'up')} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"><ArrowUp size={16} /></button>
          <button onClick={() => moveBlock(block.id, 'down')} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"><ArrowDown size={16} /></button>
          <button onClick={() => deleteBlock(block.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
        </div>
      </div>

      {/* Instruction */}
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

      {/* Image URL */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Diagram Image URL</label>
        <input type="text" value={block.imageUrl} onChange={(e) => updateImageUrl(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Enter image URL..." />
      </div>

      {/* Image Preview */}
      <div className="mb-6">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Preview</div>
        <div className="relative overflow-hidden rounded-md border border-gray-200 bg-gray-50" style={{ minHeight: 280 }}>
          {block.imageUrl && !imageLoadError ? (
            <>
              <img
                src={block.imageUrl}
                alt="Diagram preview"
                className="h-auto w-full object-contain"
                onError={() => setImageLoadError(true)}
              />
              {block.labels.map((label, index) => (
                <span
                  key={label.id}
                  className="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-blue-600 bg-white text-sm font-bold text-blue-700"
                  style={{ left: `${label.x}%`, top: `${label.y}%` }}
                  title={`Label ${startNum + index} (${label.x}%, ${label.y}%)`}
                >
                  {startNum + index}
                </span>
              ))}
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 text-sm">
              {block.imageUrl ? (
                <>
                  <p className="font-medium text-gray-700">Unable to load image</p>
                  <p className="text-xs text-gray-400 mt-1">Check the URL above and try again.</p>
                </>
              ) : (
                <>
                  <p className="font-medium text-gray-700">No image URL set</p>
                  <p className="text-xs text-gray-400 mt-1">Paste a URL to preview the diagram.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Labels */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-sm font-medium text-gray-700">Labels ({block.labels.length})</label>
          <button onClick={addLabel} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Add Label</button>
        </div>
        <div className="space-y-2">
          {block.labels.map((label, index) => (
            <div key={label.id} className="border rounded-md p-3 flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700 w-16">{startNum + index}.</span>
              <input type="number" value={label.x} onChange={(e) => updateLabel(label.id, { x: parseInt(e.target.value) || 0 })} className="w-16 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="X%" />
              <input type="number" value={label.y} onChange={(e) => updateLabel(label.id, { y: parseInt(e.target.value) || 0 })} className="w-16 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="Y%" />
              <input type="text" value={label.correctAnswer} onChange={(e) => updateLabel(label.id, { correctAnswer: e.target.value })} className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="Answer..." />
              <button onClick={() => removeLabel(label.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
