import React from 'react';
import { ClassificationBlock as ClassificationBlockType, type CaseSensitivity } from '../../types';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { createId } from '../../utils/idUtils';
import { handleBoldHotkey } from '../../utils/boldMarkdown';
import { InsertedImagesEditor } from './InsertedImagesEditor';
import { AcceptedAnswersEditor } from './AcceptedAnswersEditor';
import { CaseSensitivityToggle } from './CaseSensitivityToggle';
import { mapAcceptedAnswers } from '../../utils/acceptedAnswers';

interface ClassificationBlockProps {
  block: ClassificationBlockType;
  startNum: number;
  endNum: number;
  updateBlock: (block: ClassificationBlockType) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
  onAddSubAnswerAtSlot?: (slotIndex: number) => void;
}

export function ClassificationBlock({
  block,
  startNum,
  endNum,
  updateBlock,
  deleteBlock,
  moveBlock,
  errors = [],
  onAddSubAnswerAtSlot,
}: ClassificationBlockProps) {
  const updateInstruction = (instruction: string) => {
    updateBlock({ ...block, instruction });
  };

  const updateCategories = (categories: string[]) => {
    const previous = block.categories;
    // Value-based rename: an old value absent from the new list was renamed
    // (reorders keep every value present, so they never map). Removals
    // intentionally orphan (surfaced as invalid in the answer key).
    const removed = previous.filter((oldValue) => oldValue !== '' && !categories.includes(oldValue));
    const added = categories.filter((value, index) => value !== '' && value !== previous[index] && !previous.includes(value));
    const renamed = new Map<string, string>();
    removed.forEach((oldValue, i) => {
      const newValue = added[i];
      if (newValue !== undefined && !renamed.has(oldValue)) renamed.set(oldValue, newValue);
    });
    const items = renamed.size === 0
      ? block.items
      : block.items.map((item) => ({
          ...item,
          correctCategory: renamed.get(item.correctCategory) ?? item.correctCategory,
          ...(Array.isArray(item.acceptedAnswers)
            ? { acceptedAnswers: item.acceptedAnswers.map((entry) => renamed.get(entry) ?? entry) }
            : {}),
        }));
    updateBlock({ ...block, categories, items });
  };

  const updateItem = (
    itemId: string,
    updates: { text?: string; correctCategory?: string; acceptedAnswers?: string[] } & CaseSensitivity,
  ) => {
    const newItems = block.items.map(i =>
      i.id === itemId ? { ...i, ...updates } : i
    );
    updateBlock({ ...block, items: newItems });
  };

  const updateItemAcceptedAnswers = (itemId: string, next: string[]) => {
    updateBlock({
      ...block,
      items: mapAcceptedAnswers(block.items, (item) => item.id === itemId, next),
    });
  };

  const addCategory = () => {
    updateBlock({ ...block, categories: [...block.categories, ''] });
  };

  const removeCategory = (index: number) => {
    const newCategories = block.categories.filter((_, i) => i !== index);
    updateBlock({ ...block, categories: newCategories });
  };

  const addItem = () => {
    const newItem = {
      id: createId('item'),
      text: '',
      correctCategory: block.categories[0] || ''
    };
    updateBlock({ ...block, items: [...block.items, newItem] });
  };

  const removeItem = (itemId: string) => {
    const newItems = block.items.filter(i => i.id !== itemId);
    updateBlock({ ...block, items: newItems });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-sm shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="font-bold text-gray-900">Q{startNum}-{endNum}</span>
          <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded">Classification</span>
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

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">Categories ({block.categories.length})</label>
          <button onClick={addCategory} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Add Category</button>
        </div>
        <div className="space-y-2">
          {block.categories.map((category, index) => (
            <div key={index} className="flex items-center gap-2">
              <input type="text" value={category} onChange={(e) => {
                const newCategories = [...block.categories];
                newCategories[index] = e.target.value;
                updateCategories(newCategories);
              }} onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => {
                const newCategories = [...block.categories];
                newCategories[index] = nextValue;
                updateCategories(newCategories);
              })} className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" placeholder={`Category ${index + 1}`} />
              {block.categories.length > 2 && <button onClick={() => removeCategory(index)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-sm font-medium text-gray-700">Items to Classify ({block.items.length})</label>
          <button onClick={addItem} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Add Item</button>
        </div>
        <div className="space-y-2">
          {block.items.map((item, index) => (
            <div key={item.id} className="border rounded-md p-3">
              <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700 w-16">{startNum + index}.</span>
              <input
                type="text"
                value={item.text}
                onChange={(e) => updateItem(item.id, { text: e.target.value })}
                onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateItem(item.id, { text: nextValue }))}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder="Item text..."
              />
              <select value={item.correctCategory} onChange={(e) => updateItem(item.id, { correctCategory: e.target.value })} className="w-32 border border-gray-300 rounded px-2 py-1 text-sm">
                {block.categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
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
                <button onClick={() => removeItem(item.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
              </div>
              <div className="mt-2 ml-16 space-y-1">
                <AcceptedAnswersEditor
                  value={item.acceptedAnswers ?? []}
                  onChange={(next) => updateItemAcceptedAnswers(item.id, next)}
                  placeholder="Other accepted categories..."
                />
                <CaseSensitivityToggle
                  caseSensitive={item.caseSensitive}
                  onChange={(caseSensitive) => updateItem(item.id, { caseSensitive })}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
