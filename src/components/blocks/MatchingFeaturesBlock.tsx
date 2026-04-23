import React from 'react';
import { MatchingFeaturesBlock as MatchingFeaturesBlockType } from '../../types';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { createId } from '../../utils/idUtils';
import { handleBoldHotkey } from '../../utils/boldMarkdown';

interface MatchingFeaturesBlockProps {
  block: MatchingFeaturesBlockType;
  startNum: number;
  endNum: number;
  updateBlock: (block: MatchingFeaturesBlockType) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
}

export function MatchingFeaturesBlock({ block, startNum, endNum, updateBlock, deleteBlock, moveBlock, errors = [] }: MatchingFeaturesBlockProps) {
  const updateInstruction = (instruction: string) => {
    updateBlock({ ...block, instruction });
  };

  const updateFeature = (featureId: string, updates: { text?: string; correctMatch?: string }) => {
    const newFeatures = block.features.map(f =>
      f.id === featureId ? { ...f, ...updates } : f
    );
    updateBlock({ ...block, features: newFeatures });
  };

  const updateOptions = (options: string[]) => {
    updateBlock({ ...block, options });
  };

  const addFeature = () => {
    const newFeature = {
      id: createId('feat'),
      text: '',
      correctMatch: block.options[0] || ''
    };
    updateBlock({ ...block, features: [...block.features, newFeature] });
  };

  const removeFeature = (featureId: string) => {
    const newFeatures = block.features.filter(f => f.id !== featureId);
    updateBlock({ ...block, features: newFeatures });
  };

  const addOption = () => {
    updateBlock({ ...block, options: [...block.options, ''] });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-sm shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="font-bold text-gray-900">Q{startNum}-{endNum}</span>
          <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded">Matching Features</span>
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

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">Matching Options ({block.options.length})</label>
          <button onClick={addOption} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Add Option</button>
        </div>
        <div className="flex flex-wrap gap-2 mb-2">
          {block.options.map((option, index) => (
            <input key={index} type="text" value={option} onChange={(e) => {
              const newOptions = [...block.options];
              newOptions[index] = e.target.value;
              updateOptions(newOptions);
            }} onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => {
              const newOptions = [...block.options];
              newOptions[index] = nextValue;
              updateOptions(newOptions);
            })} className="w-32 border border-gray-300 rounded px-2 py-1 text-sm" placeholder={`Option ${index + 1}`} />
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-sm font-medium text-gray-700">Features ({block.features.length})</label>
          <button onClick={addFeature} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Add Feature</button>
        </div>
        <div className="space-y-2">
          {block.features.map((feature, index) => (
            <div key={feature.id} className="border rounded-md p-3 flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700 w-16">{startNum + index}.</span>
              <input
                type="text"
                value={feature.text}
                onChange={(e) => updateFeature(feature.id, { text: e.target.value })}
                onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateFeature(feature.id, { text: nextValue }))}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder="Feature statement..."
              />
              <select value={feature.correctMatch} onChange={(e) => updateFeature(feature.id, { correctMatch: e.target.value })} className="w-32 border border-gray-300 rounded px-2 py-1 text-sm">
                {block.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
              <button onClick={() => removeFeature(feature.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
