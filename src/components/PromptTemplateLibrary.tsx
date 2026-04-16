import React, { useMemo, useState } from 'react';
import { Dialog } from './ui/Dialog';
import { PROMPT_TEMPLATE_LIBRARY } from '../utils/builderEnhancements';
import type { PromptTemplateRecord } from '../types';
import { Pencil, Trash2 } from 'lucide-react';

interface PromptTemplateLibraryProps {
  customTemplates: PromptTemplateRecord[];
  currentPrompt: string;
  isOpen: boolean;
  onClose: () => void;
  onInsert: (template: PromptTemplateRecord) => void;
  onSaveCustom: (template: PromptTemplateRecord) => void;
  onUpdateCustom: (template: PromptTemplateRecord) => void;
  onDeleteCustom: (templateId: string) => void;
}

export function PromptTemplateLibrary({
  customTemplates,
  currentPrompt,
  isOpen,
  onClose,
  onInsert,
  onSaveCustom,
  onUpdateCustom,
  onDeleteCustom,
}: PromptTemplateLibraryProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'All' | PromptTemplateRecord['category']>('All');
  const [customTitle, setCustomTitle] = useState('');
  const [customTopic, setCustomTopic] = useState<PromptTemplateRecord['topic']>('Education');
  const [customCategory, setCustomCategory] =
    useState<PromptTemplateRecord['category']>('Task 2 Essay');
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplateRecord | null>(null);

  const templates = useMemo(
    () => [...PROMPT_TEMPLATE_LIBRARY, ...customTemplates],
    [customTemplates],
  );

  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      const matchesCategory = category === 'All' || template.category === category;
      const matchesQuery = [template.title, template.topic, template.prompt]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase());

      return matchesCategory && matchesQuery;
    });
  }, [category, query, templates]);

  const handleEditTemplate = (template: PromptTemplateRecord) => {
    setEditingTemplate(template);
    setCustomTitle(template.title);
    setCustomTopic(template.topic);
    setCustomCategory(template.category);
  };

  const handleDeleteTemplate = (templateId: string) => {
    if (confirm('Are you sure you want to delete this template?')) {
      onDeleteCustom(templateId);
    }
  };

  const handleSaveOrUpdateCustom = () => {
    if (!customTitle.trim() || !currentPrompt.trim()) {
      return;
    }

    if (editingTemplate) {
      onUpdateCustom({
        ...editingTemplate,
        title: customTitle.trim(),
        topic: customTopic,
        category: customCategory,
        prompt: currentPrompt,
      });
      setEditingTemplate(null);
    } else {
      onSaveCustom({
        id: `custom-template-${Date.now()}`,
        title: customTitle.trim(),
        topic: customTopic,
        category: customCategory,
        prompt: currentPrompt,
        source: 'custom',
      });
    }
    setCustomTitle('');
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Prompt Templates" size="xl" className="rounded-3xl">
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search topic, category, or wording"
            className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:bg-white"
          />
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as 'All' | PromptTemplateRecord['category'])
            }
            className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:bg-white"
          >
            <option value="All">All categories</option>
            <option value="Task 1 Academic">Task 1 Academic</option>
            <option value="Task 1 General Training">Task 1 General Training</option>
            <option value="Task 2 Essay">Task 2 Essay</option>
          </select>
        </div>

        <div className="grid gap-3 max-h-[45vh] overflow-y-auto">
          {filteredTemplates.map((template) => (
            <div
              key={template.id}
              className="rounded-3xl border border-gray-100 bg-white px-5 py-4 text-left shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50 relative group"
            >
              <button
                onClick={() => {
                  onInsert(template);
                  onClose();
                }}
                className="w-full text-left"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">{template.title}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {template.topic} · {template.category}
                    </p>
                    <p className="text-sm text-gray-700 mt-3 leading-relaxed">{template.prompt}</p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
                    {template.source}
                  </span>
                </div>
              </button>
              {template.source === 'custom' && (
                <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditTemplate(template);
                    }}
                    className="p-1.5 rounded-lg bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                    title="Edit template"
                  >
                    <Pencil size={14} className="text-gray-600" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteTemplate(template.id);
                    }}
                    className="p-1.5 rounded-lg bg-white border border-gray-200 hover:border-red-300 hover:bg-red-50 transition-colors"
                    title="Delete template"
                  >
                    <Trash2 size={14} className="text-gray-600" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50 px-5 py-5">
          <p className="text-xs font-black text-gray-400 uppercase tracking-[0.22em] mb-4">
            {editingTemplate ? 'Edit Custom Template' : 'Save Custom Template'}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              value={customTitle}
              onChange={(event) => setCustomTitle(event.target.value)}
              placeholder="Template title"
              className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500"
            />
            <select
              value={customTopic}
              onChange={(event) => setCustomTopic(event.target.value as PromptTemplateRecord['topic'])}
              className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500"
            >
              <option value="Education">Education</option>
              <option value="Technology">Technology</option>
              <option value="Environment">Environment</option>
              <option value="Health">Health</option>
              <option value="Society">Society</option>
            </select>
            <select
              value={customCategory}
              onChange={(event) =>
                setCustomCategory(event.target.value as PromptTemplateRecord['category'])
              }
              className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500"
            >
              <option value="Task 1 Academic">Task 1 Academic</option>
              <option value="Task 1 General Training">Task 1 General Training</option>
              <option value="Task 2 Essay">Task 2 Essay</option>
            </select>
            <div className="flex gap-2">
              <button
                onClick={handleSaveOrUpdateCustom}
                className="flex-1 rounded-2xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-black transition-colors"
              >
                {editingTemplate ? 'Update Template' : 'Save Current Prompt'}
              </button>
              {editingTemplate && (
                <button
                  onClick={() => {
                    setEditingTemplate(null);
                    setCustomTitle('');
                  }}
                  className="px-4 py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-white transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
