import React from 'react';
import { FlowChartBlock as FlowChartBlockType, type CaseSensitivity } from '../../types';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { createId } from '../../utils/idUtils';
import { handleBoldHotkey } from '../../utils/boldMarkdown';
import { InsertedImagesEditor } from './InsertedImagesEditor';
import { AcceptedAnswersEditor } from './AcceptedAnswersEditor';
import { CaseSensitivityToggle } from './CaseSensitivityToggle';
import { mapAcceptedAnswers, resolveAcceptedAnswers } from '../../utils/acceptedAnswers';

interface FlowChartBlockProps {
  block: FlowChartBlockType;
  startNum: number;
  endNum: number;
  updateBlock: (block: FlowChartBlockType) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
  onAddSubAnswerAtSlot?: (slotIndex: number) => void;
}

export function FlowChartBlock({
  block,
  startNum,
  endNum,
  updateBlock,
  deleteBlock,
  moveBlock,
  errors = [],
  onAddSubAnswerAtSlot,
}: FlowChartBlockProps) {
  const updateInstruction = (instruction: string) => {
    updateBlock({ ...block, instruction });
  };

  const updateStep = (
    stepId: string,
    updates: { label?: string; correctAnswer?: string; acceptedAnswers?: string[] } & CaseSensitivity,
  ) => {
    const newSteps = block.steps.map(s =>
      s.id === stepId ? { ...s, ...updates } : s
    );
    updateBlock({ ...block, steps: newSteps });
  };

  // Accepted answers are alternatives only: keep the authoritative
  // correctAnswer untouched so editing chips never rewrites the primary key.
  const updateStepAcceptedAnswers = (stepId: string, next: string[]) => {
    updateBlock({
      ...block,
      steps: mapAcceptedAnswers(block.steps, (step) => step.id === stepId, next),
    });
  };

  const addStep = () => {
    const newStep = {
      id: createId('step'),
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
        <textarea
          value={block.instruction}
          onChange={(e) => updateInstruction(e.target.value)}
          onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateInstruction(nextValue))}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={2}
          placeholder="Enter instruction..."
        />
      </div>
      <InsertedImagesEditor
        images={block.insertedImages}
        onChange={(nextImages) => updateBlock({ ...block, insertedImages: nextImages })}
        errors={errors}
      />

      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-sm font-medium text-gray-700">Flow Chart Steps ({block.steps.length})</label>
          <button onClick={addStep} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Add Step</button>
        </div>
        <div className="space-y-2">
          {block.steps.map((step, index) => (
            <div key={step.id} className="border rounded-md p-3 flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700 w-16">{startNum + index}.</span>
              <input
                type="text"
                value={step.label}
                onChange={(e) => updateStep(step.id, { label: e.target.value })}
                onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateStep(step.id, { label: nextValue }))}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder="Step label..."
              />
              <div>
                <input type="text" value={step.correctAnswer} onChange={(e) => updateStep(step.id, { correctAnswer: e.target.value })} className="w-32 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="Answer..." />
                <div className="mt-1">
                  <AcceptedAnswersEditor
                    value={resolveAcceptedAnswers(step)}
                    onChange={(next) => updateStepAcceptedAnswers(step.id, next)}
                    placeholder="Other accepted answers..."
                  />
                </div>
                <div className="mt-1">
                  <CaseSensitivityToggle
                    caseSensitive={step.caseSensitive}
                    onChange={(caseSensitive) => updateStep(step.id, { caseSensitive })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-1">
                {onAddSubAnswerAtSlot ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddSubAnswerAtSlot(index);
                    }}
                    className="rounded-full border border-gray-300 bg-white p-1 text-gray-500 hover:border-blue-400 hover:text-blue-700"
                    title="Add sub-answer"
                    aria-label={`Add sub-answer to question ${startNum + index}.1`}
                  >
                    <Plus size={12} />
                  </button>
                ) : null}
                <button onClick={() => removeStep(step.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
