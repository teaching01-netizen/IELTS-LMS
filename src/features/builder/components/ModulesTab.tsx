import React from 'react';
import { Layers, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { ExamConfig, ModuleType, QuestionType } from '../../../types';
import { ALL_QUESTION_TYPES } from '../../../constants/examDefaults';

interface ModulesTabProps {
  config: ExamConfig;
  onChange: (config: ExamConfig) => void;
}

export function ModulesTab({ config, onChange }: ModulesTabProps) {
  const updateSection = (module: ModuleType, value: Partial<ExamConfig['sections'][ModuleType]>) => {
    onChange({
      ...config,
      sections: {
        ...config.sections,
        [module]: {
          ...config.sections[module],
          ...value
        }
      }
    });
  };

  const toggleQuestionType = (module: ModuleType, type: QuestionType) => {
    const currentTypes = config.sections[module].allowedQuestionTypes;
    const newTypes = currentTypes.includes(type)
      ? currentTypes.filter(t => t !== type)
      : [...currentTypes, type];
    updateSection(module, { allowedQuestionTypes: newTypes });
  };

  const addWritingTask = () => {
    const tasks = [...config.sections.writing.tasks];
    const nextIndex = tasks.length + 1;
    onChange({
      ...config,
      sections: {
        ...config.sections,
        writing: {
          ...config.sections.writing,
          tasks: [
            ...tasks,
            {
              id: `task${nextIndex}`,
              label: `Task ${nextIndex}`,
              taskType: 'task2-essay',
              minWords: config.standards.writingTasks.task2.minWords,
              recommendedTime: config.standards.writingTasks.task2.recommendedTime,
            },
          ],
        },
      },
    });
  };

  const removeWritingTask = (taskId: string) => {
    if (taskId === 'task1' || taskId === 'task2') {
      return;
    }

    onChange({
      ...config,
      sections: {
        ...config.sections,
        writing: {
          ...config.sections.writing,
          tasks: config.sections.writing.tasks.filter((task) => task.id !== taskId),
        },
      },
    });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
          <Layers size={16} className="text-blue-500" /> Module Configuration
        </h3>
        <div className="space-y-3">
          {(['listening', 'reading', 'writing', 'speaking'] as ModuleType[]).map((m) => {
            const section = config.sections[m];
            return (
              <div key={m} className={`bg-white border p-4 rounded-xl shadow-sm transition-all ${section.enabled ? 'border-blue-100' : 'opacity-60 border-gray-200'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <GripVertical size={16} className="text-gray-300" />
                    <div className={`w-8 h-8 rounded flex items-center justify-center font-bold text-xs ${section.enabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {m.charAt(0).toUpperCase()}
                    </div>
                    <input 
                      type="text" 
                      value={section.label}
                      onChange={(e) => updateSection(m, { label: e.target.value })}
                      className="font-bold text-gray-900 bg-transparent border-none focus:ring-0 p-0 text-sm"
                    />
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={section.enabled}
                      onChange={(e) => updateSection(m, { enabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                
                {section.enabled && (
                  <div className="space-y-4 mt-2 pt-4 border-t border-gray-50">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                          {m === 'reading' ? 'Passage Count' : m === 'listening' ? 'Part Count' : m === 'writing' ? 'Task Count' : 'Part Count'}
                        </label>
                        <input 
                          type="number" 
                          value={m === 'reading' ? ('passageCount' in section ? section.passageCount : 0) : m === 'listening' ? ('partCount' in section ? section.partCount : 0) : m === 'writing' ? ('tasks' in section ? section.tasks.length : 0) : ('parts' in section ? section.parts.length : 0)}
                          readOnly={m === 'writing'}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            if (m === 'reading') updateSection(m, { passageCount: val });
                            else if (m === 'listening') updateSection(m, { partCount: val });
                            else if (m === 'writing') {
                              return;
                            } else {
                              const currentParts = 'parts' in section ? section.parts : [];
                              const newParts = val > currentParts.length 
                                ? [...currentParts, ...Array(val - currentParts.length).fill(0).map((_, i) => ({ id: `part${currentParts.length + i + 1}`, label: `Part ${currentParts.length + i + 1}`, prepTime: 60, speakingTime: 120 }))]
                                : currentParts.slice(0, val);
                              updateSection(m, { parts: newParts });
                            }
                          }}
                          className={`w-full px-2 py-1 border border-gray-100 rounded text-xs outline-none ${m === 'writing' ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}
                        />
                        {m === 'writing' && (
                          <button
                            type="button"
                            onClick={addWritingTask}
                            className="mt-2 inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:bg-blue-100 transition-colors"
                          >
                            <Plus size={12} /> Add Task
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Order</label>
                        <input 
                          type="number" 
                          value={section.order}
                          onChange={(e) => updateSection(m, { order: parseInt(e.target.value) })}
                          className="w-full px-2 py-1 border border-gray-100 rounded text-xs outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Gap After (min)</label>
                        <input 
                          type="number" 
                          min={0}
                          value={section.gapAfterMinutes ?? 0}
                          onChange={(e) => updateSection(m, { gapAfterMinutes: parseInt(e.target.value) })}
                          className="w-full px-2 py-1 border border-gray-100 rounded text-xs outline-none"
                        />
                      </div>
                    </div>

                    {(m === 'reading' || m === 'listening') && (
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Allowed Question Types</label>
                        <div className="flex flex-wrap gap-2">
                          {ALL_QUESTION_TYPES.map(type => (
                            <button
                              key={type}
                              onClick={() => toggleQuestionType(m, type)}
                              className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-all ${
                                section.allowedQuestionTypes.includes(type)
                                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                                  : 'bg-white border-gray-100 text-gray-400 grayscale'
                              }`}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {m === 'listening' ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                              Candidate Audio Playback
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              Turn off to disable the audio player for candidates during Listening.
                            </p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                            <input
                              type="checkbox"
                              checked={(config.sections.listening.audioPlaybackEnabled ?? true) === true}
                              onChange={(e) =>
                                updateSection('listening', { audioPlaybackEnabled: e.target.checked })
                              }
                              className="sr-only peer"
                              aria-label="Enable listening audio playback"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                          </label>
                        </div>

                        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                            Staff Instructions (Listening)
                          </label>
                          <textarea
                            value={config.sections.listening.staffInstructions ?? ''}
                            onChange={(e) =>
                              updateSection('listening', { staffInstructions: e.target.value })
                            }
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                            rows={4}
                            placeholder="Optional message shown to candidates during Listening (e.g., 'Audio will be played by the invigilator. Do not use the on-screen controls.')"
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
