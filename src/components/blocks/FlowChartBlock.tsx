import React from 'react';
import { FlowChartBlock as FlowChartBlockType } from '../../types';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';

interface FlowChartBlockProps {
  block: FlowChartBlockType;
  startNum: number;
  endNum: number;
  updateBlock: (block: FlowChartBlockType) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
}

export function FlowChartBlock({ block, startNum, endNum, updateBlock, deleteBlock, moveBlock, errors = [] }: FlowChartBlockProps) {
  const updateInstruction = (instruction: string) => {
    updateBlock({ ...block, instruction });
  };

  const updateStep = (stepId: string, updates: { label?: string; correctAnswer?: string }) => {
    const newSteps = block.steps.map(s =>
      s.id === stepId ? { ...s, ...updates } : s
    );
    updateBlock({ ...block, steps: newSteps });
  };

  const addStep = () => {
    const newStep = {
      id: `s${Date.now()}`,
      label: '',
      correctAnswer: ''
    };
    updateBlock({ ...block, steps: [...block.steps, newStep] });
  };

  const removeStep = (stepId: string) => {
    const newSteps = block.steps.filter(s => s.id !== stepId);
    updateBlock({ ...block, steps: newSteps });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-sm shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="font-bold text-gray-900">Q{startNum}-{endNum}</span>
          <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded">Flow Chart</span>
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
          <label className="block text-sm font-medium text-gray-700">Flow Chart Steps ({block.steps.length})</label>
          <button onClick={addStep} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Add Step</button>
        </div>
        <div className="space-y-2">
          {block.steps.map((step, index) => (
            <div key={step.id} className="border rounded-md p-3 flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700 w-16">{startNum + index}.</span>
              <input type="text" value={step.label} onChange={(e) => updateStep(step.id, { label: e.target.value })} className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="Step label..." />
              <input type="text" value={step.correctAnswer} onChange={(e) => updateStep(step.id, { correctAnswer: e.target.value })} className="w-32 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="Answer..." />
              <button onClick={() => removeStep(step.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
