import React, { useEffect, useState } from 'react';
import { DiagramLabelingBlock as DiagramLabelingBlockType, type CaseSensitivity } from '../../types';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { createId } from '../../utils/idUtils';
import { handleBoldHotkey } from '../../utils/boldMarkdown';
import { getImageUrlCandidates } from '../../utils/imageUrl';
import { AcceptedAnswersEditor } from './AcceptedAnswersEditor';
import { CaseSensitivityToggle } from './CaseSensitivityToggle';
import { mapAcceptedAnswers, resolveAcceptedAnswers } from '../../utils/acceptedAnswers';

interface DiagramLabelingBlockProps {
  block: DiagramLabelingBlockType;
  startNum: number;
  endNum: number;
  updateBlock: (block: DiagramLabelingBlockType) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
  onAddSubAnswerAtSlot?: (slotIndex: number) => void;
}

export function DiagramLabelingBlock({
  block,
  startNum,
  endNum,
  updateBlock,
  deleteBlock,
  moveBlock,
  errors = [],
  onAddSubAnswerAtSlot,
}: DiagramLabelingBlockProps) {
  const [imageLoadError, setImageLoadError] = useState(false);
  const [imageCandidateIndex, setImageCandidateIndex] = useState(0);
  const imageCandidates = getImageUrlCandidates(block.imageUrl ?? '');
  const resolvedImageUrl = imageCandidates[imageCandidateIndex] ?? '';

  useEffect(() => {
    setImageLoadError(false);
    setImageCandidateIndex(0);
  }, [block.imageUrl]);

  const updateInstruction = (instruction: string) => {
    updateBlock({ ...block, instruction });
  };

  const updateImageUrl = (imageUrl: string) => {
    updateBlock({ ...block, imageUrl });
  };

  const updateLabel = (
    labelId: string,
    updates: { prompt?: string; correctAnswer?: string; acceptedAnswers?: string[] } & CaseSensitivity,
  ) => {
    const newLabels = block.labels.map(l =>
      l.id === labelId ? { ...l, ...updates } : l
    );
    updateBlock({ ...block, labels: newLabels });
  };

  // Accepted answers are alternatives only: keep the authoritative
  // correctAnswer untouched so editing chips never rewrites the primary key.
  const updateLabelAcceptedAnswers = (labelId: string, next: string[]) => {
    updateBlock({
      ...block,
      labels: mapAcceptedAnswers(block.labels, (label) => label.id === labelId, next),
    });
  };

  const addLabel = () => {
    const newLabel = {
      id: createId('lbl'),
      x: 50,
      y: 50,
      prompt: '',
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

      <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
          <input
            type="checkbox"
            checked={block.referenceImagePlacement === 'instruction'}
            onChange={(event) =>
              updateBlock({
                ...block,
                referenceImagePlacement: event.target.checked
                  ? 'instruction'
                  : 'question',
              })
            }
            className="h-4 w-4 accent-blue-800"
          />
          Show reference image between instruction and questions (custom layout)
        </label>
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
          {resolvedImageUrl && !imageLoadError ? (
            <>
              <img
                src={resolvedImageUrl}
                alt="Diagram preview"
                className="h-auto w-full object-contain"
                onError={() => {
                  setImageCandidateIndex((current) => {
                    const next = current + 1;
                    if (next < imageCandidates.length) {
                      return next;
                    }
                    setImageLoadError(true);
                    return current;
                  });
                }}
                referrerPolicy="no-referrer"
              />
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 text-sm">
              {resolvedImageUrl ? (
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
              <div className="flex-1 grid gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  value={label.prompt ?? ''}
                  onChange={(e) => updateLabel(label.id, { prompt: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                  placeholder={`Label ${index + 1}`}
                  aria-label={`Prompt for label ${startNum + index}`}
                />
                <div>
                  <input
                    type="text"
                    value={label.correctAnswer}
                    onChange={(e) => updateLabel(label.id, { correctAnswer: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    placeholder="Answer..."
                    aria-label={`Correct answer for label ${startNum + index}`}
                  />
                  <div className="mt-1">
                    <AcceptedAnswersEditor
                      value={resolveAcceptedAnswers(label)}
                      onChange={(next) => updateLabelAcceptedAnswers(label.id, next)}
                      placeholder="Other accepted answers..."
                    />
                  </div>
                  <div className="mt-1">
                    <CaseSensitivityToggle
                      caseSensitive={label.caseSensitive}
                      onChange={(caseSensitive) => updateLabel(label.id, { caseSensitive })}
                    />
                  </div>
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
                <button onClick={() => removeLabel(label.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
