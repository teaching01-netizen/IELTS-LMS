import React, { useMemo } from 'react';
import { Clock, Settings, AlertCircle, Plus, Trash2 } from 'lucide-react';
import type { ExamConfig, ModuleType } from '../../../types';
import { examDeliveryService } from '../../../services/examDeliveryService';
import { syncConfigWithStandards } from '../../../constants/examDefaults';

interface TimingTabProps {
  config: ExamConfig;
  onChange: (config: ExamConfig) => void;
}

export function TimingTab({ config, onChange }: TimingTabProps) {
  const sectionPlan = useMemo(() => examDeliveryService.buildSectionPlan(config), [config]);
  const isIeltsMode = Boolean(config.general.ieltsMode);

  const timingValidation = useMemo(() => {
    const errors: Array<{ field: string; message: string }> = [];
    const enabledSections = (['listening', 'reading', 'writing', 'speaking'] as ModuleType[])
      .map((module) => config.sections[module])
      .filter(section => section.enabled);

    if (enabledSections.length === 0) {
      errors.push({ field: 'sections', message: 'At least one section must be enabled.' });
    }

    const orderCounts = new Map<number, number>();
    (['listening', 'reading', 'writing', 'speaking'] as ModuleType[]).forEach((module) => {
      const section = config.sections[module];
      if (!section.enabled) return;

      if (section.duration <= 0) {
        errors.push({ field: `sections.${module}.duration`, message: `${section.label} duration must be greater than 0.` });
      }

      if (section.gapAfterMinutes < 0) {
        errors.push({ field: `sections.${module}.gapAfterMinutes`, message: `${section.label} gap cannot be negative.` });
      }

      orderCounts.set(section.order, (orderCounts.get(section.order) || 0) + 1);
    });

    orderCounts.forEach((count, order) => {
      if (count > 1) {
        errors.push({ field: 'sections.order', message: `Duplicate section order ${order} detected.` });
      }
    });

    return errors;
  }, [config]);

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

  const updateIeltsMode = (enabled: boolean) => {
    onChange(
      syncConfigWithStandards({
        ...config,
        general: {
          ...config.general,
          ieltsMode: enabled,
        },
      }),
    );
  };

  const toggleAllowedExtensionMinute = (minutes: number) => {
    const current = Array.isArray(config.delivery.allowedExtensionMinutes)
      ? config.delivery.allowedExtensionMinutes
      : [];
    const next = current.includes(minutes)
      ? current.filter((value) => value !== minutes)
      : [...current, minutes].sort((a, b) => a - b);

    onChange(
      syncConfigWithStandards({
        ...config,
        delivery: {
          ...config.delivery,
          allowedExtensionMinutes: next,
        },
      }),
    );
  };

  const updateStandards = (value: Partial<ExamConfig['standards']>) => {
    onChange({
      ...config,
      standards: {
        ...config.standards,
        ...value,
      },
    });
  };

  const updateWritingTaskStandard = (
    taskKey: keyof ExamConfig['standards']['writingTasks'],
    field: 'minWords' | 'recommendedTime',
    nextValue: number,
  ) => {
    updateStandards({
      writingTasks: {
        ...config.standards.writingTasks,
        [taskKey]: {
          ...config.standards.writingTasks[taskKey],
          [field]: nextValue,
        },
      },
    });
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

  const updateConfig = (section: keyof ExamConfig, value: Partial<ExamConfig[keyof ExamConfig]>) => {
    onChange(syncConfigWithStandards({
      ...config,
      [section]: {
        ...config[section],
        ...value
      }
    }));
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-amber-100 bg-amber-50/60 p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-amber-800">Authentic IELTS Mode</p>
            <p className="mt-1 text-sm font-semibold text-amber-950">
              Lock timing and runtime controls to match official IELTS expectations.
            </p>
            <p className="mt-1 text-[11px] text-amber-800">
              When enabled: fixed L/R/W durations, no gaps, auto-submit on time up, no cohort pause, and no
              section extensions or proctor section overrides.
            </p>
          </div>
          <label className="flex items-center gap-2">
            <span className="text-xs font-bold text-amber-900">{isIeltsMode ? 'ON' : 'OFF'}</span>
            <input
              type="checkbox"
              checked={isIeltsMode}
              onChange={(e) => updateIeltsMode(e.target.checked)}
              className="h-4 w-4 rounded border-amber-300 text-amber-700 focus:ring-amber-500"
            />
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
          <Clock size={16} className="text-blue-500" /> Section Flow
        </h3>

        {timingValidation.length > 0 && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-red-700">Validation</p>
            {timingValidation.map((error) => (
              <div key={`${error.field}-${error.message}`} className="flex items-start gap-2 text-sm text-red-800">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{error.message}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {sectionPlan.sections.map((section) => (
            <div key={section.sectionKey} className="px-3 py-2 rounded-full bg-blue-50 text-blue-800 border border-blue-100 text-xs font-bold uppercase tracking-wider">
              {section.label}
            </div>
          ))}
        </div>

        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-50 shadow-sm">
          {(['listening', 'reading', 'writing', 'speaking'] as ModuleType[]).map((m) => {
            const section = config.sections[m];
            if (!section.enabled) return null;
            const planItem = sectionPlan.sections.find(item => item.sectionKey === m);
            return (
              <div key={m} className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-500">
                      {m.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-700 block">{section.label}</span>
                      <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                        {planItem ? `Planned start offset ${planItem.startOffsetMinutes} min` : 'Projected from session start'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input 
                      type="number" 
                      value={section.order}
                      onChange={(e) => updateSection(m, { order: parseInt(e.target.value) })}
                      disabled={isIeltsMode}
                      className="w-14 px-2 py-1 border border-gray-200 rounded text-sm text-right outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    <span className="text-xs text-gray-400 font-medium uppercase">Order</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[9px] font-bold text-gray-400 uppercase mb-1">Duration (min)</label>
                    <input 
                      type="number" 
                      min={1}
                      value={section.duration}
                      onChange={(e) => updateSection(m, { duration: parseInt(e.target.value) })}
                      disabled={isIeltsMode}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-sm outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-gray-400 uppercase mb-1">Gap After (min)</label>
                    <input 
                      type="number" 
                      min={0}
                      value={section.gapAfterMinutes ?? 0}
                      onChange={(e) => updateSection(m, { gapAfterMinutes: parseInt(e.target.value) })}
                      disabled={isIeltsMode}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-sm outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-gray-400 uppercase mb-1">Projected End</label>
                    <div className="w-full px-2 py-1 border border-dashed border-gray-200 rounded text-sm text-gray-500 bg-gray-50">
                      {planItem ? `${planItem.endOffsetMinutes} min` : 'Derived'}
                    </div>
                  </div>
                </div>

                {m === 'writing' && (
                  <div className="pl-2 space-y-3">
                    {'tasks' in section && section.tasks.map((task, idx: number) => (
                      <div key={task.id} className="grid grid-cols-[minmax(0,1fr)_120px_120px_auto] gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100 items-end">
                        <div>
                          <label className="block text-[9px] font-bold text-gray-400 uppercase mb-1">Label</label>
                          <input 
                            type="text" 
                            value={task.label}
                            onChange={(e) => {
                              const newTasks = [...('tasks' in section ? section.tasks : [])];
                              newTasks[idx] = { ...task, label: e.target.value };
                              updateSection('writing', { tasks: newTasks });
                            }}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-[10px] outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-gray-400 uppercase mb-1">Min Words</label>
                          <input 
                            type="number" 
                            value={task.minWords}
                            onChange={(e) => {
                              if (task.id === 'task1' || task.id === 'task2') {
                                updateWritingTaskStandard(
                                  task.id,
                                  'minWords',
                                  parseInt(e.target.value),
                                );
                                return;
                              }

                              const newTasks = [...('tasks' in section ? section.tasks : [])];
                              newTasks[idx] = { ...task, minWords: parseInt(e.target.value) };
                              updateSection('writing', { tasks: newTasks });
                            }}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-[10px] outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-gray-400 uppercase mb-1">Rec. Time (m)</label>
                          <input 
                            type="number" 
                            value={task.recommendedTime}
                            onChange={(e) => {
                              if (task.id === 'task1' || task.id === 'task2') {
                                updateWritingTaskStandard(
                                  task.id,
                                  'recommendedTime',
                                  parseInt(e.target.value),
                                );
                                return;
                              }

                              const newTasks = [...('tasks' in section ? section.tasks : [])];
                              newTasks[idx] = { ...task, recommendedTime: parseInt(e.target.value) };
                              updateSection('writing', { tasks: newTasks });
                            }}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-[10px] outline-none"
                          />
                        </div>
                        <div className="flex justify-end">
                          {task.id !== 'task1' && task.id !== 'task2' ? (
                            <button
                              type="button"
                              onClick={() => removeWritingTask(task.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 size={12} /> Remove
                            </button>
                          ) : (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-gray-300">Default</span>
                          )}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addWritingTask}
                      className="inline-flex items-center gap-1 rounded-md border border-dashed border-blue-200 bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:bg-blue-50 transition-colors"
                    >
                      <Plus size={12} /> Add Task
                    </button>
                  </div>
                )}

                {m === 'speaking' && (
                  <div className="pl-2 space-y-3">
                    {'parts' in section && section.parts.map((part, idx: number) => (
                      <div key={part.id} className="grid grid-cols-3 gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                        <div className="col-span-1">
                          <label className="block text-[9px] font-bold text-gray-400 uppercase mb-1">Label</label>
                          <input 
                            type="text" 
                            value={part.label}
                            onChange={(e) => {
                              const newParts = [...('parts' in section ? section.parts : [])];
                              newParts[idx] = { ...part, label: e.target.value };
                              updateSection('speaking', { parts: newParts });
                            }}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-[10px] outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-gray-400 uppercase mb-1">Prep (s)</label>
                          <input 
                            type="number" 
                            value={part.prepTime}
                            onChange={(e) => {
                              const newParts = [...('parts' in section ? section.parts : [])];
                              newParts[idx] = { ...part, prepTime: parseInt(e.target.value) };
                              updateSection('speaking', { parts: newParts });
                            }}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-[10px] outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-gray-400 uppercase mb-1">Speak (s)</label>
                          <input 
                            type="number" 
                            value={part.speakingTime}
                            onChange={(e) => {
                              const newParts = [...('parts' in section ? section.parts : [])];
                              newParts[idx] = { ...part, speakingTime: parseInt(e.target.value) };
                              updateSection('speaking', { parts: newParts });
                            }}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-[10px] outline-none"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="p-4 bg-blue-50/30 flex items-center justify-between border-t border-blue-50">
            <span className="text-sm font-bold text-blue-900">Total Planned Duration</span>
            <span className="text-sm font-bold text-blue-900">{sectionPlan.plannedDurationMinutes} min</span>
          </div>
        </div>
        <p className="text-xs text-gray-500 italic">Actual clock times are derived from session start.</p>
      </section>

      <section className="space-y-4 pt-4 border-t border-gray-100">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
          <Settings size={16} className="text-blue-500" /> Runtime Policy
        </h3>

        <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Launch Mode</p>
              <p className="text-sm font-semibold text-gray-900 capitalize">{config.delivery.launchMode}</p>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Transition Mode</p>
              <p className="text-sm font-semibold text-gray-900 capitalize">{config.delivery.transitionMode.replace(/_/g, ' ')}</p>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Allowed Extension Minutes</p>
            {isIeltsMode ? (
              <p className="text-xs font-semibold text-gray-600">Disabled (IELTS mode)</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {[5, 10, 15].map((minutes) => {
                    const selected = config.delivery.allowedExtensionMinutes.includes(minutes);
                    return (
                      <button
                        key={minutes}
                        type="button"
                        onClick={() => toggleAllowedExtensionMinute(minutes)}
                        className={`px-3 py-1 rounded-full border text-xs font-bold transition-colors ${
                          selected
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        +{minutes} min
                      </button>
                    );
                  })}
                </div>
                {config.delivery.allowedExtensionMinutes.length === 0 ? (
                  <p className="text-[11px] text-gray-500">No extensions allowed.</p>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 bg-white border border-gray-100 p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Auto-advance on time up</p>
              <p className="text-[10px] text-gray-500">Server automatically advances the cohort when a section timer reaches 0</p>
            </div>
            <input 
              type="checkbox" 
              checked={config.progression.autoSubmit}
              onChange={(e) => updateConfig('progression', { autoSubmit: e.target.checked })}
              disabled={isIeltsMode}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Lock section after submit</p>
              <p className="text-[10px] text-gray-500">Prevent candidates from returning to finished sections</p>
            </div>
            <input 
              type="checkbox" 
              checked={config.progression.lockAfterSubmit}
              onChange={(e) => updateConfig('progression', { lockAfterSubmit: e.target.checked })}
              disabled={isIeltsMode}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Allow cohort pause</p>
              <p className="text-[10px] text-gray-500">Pause and resume the active section without resetting the timer</p>
            </div>
            <input 
              type="checkbox" 
              checked={config.progression.allowPause}
              onChange={(e) => updateConfig('progression', { allowPause: e.target.checked })}
              disabled={isIeltsMode}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Show proctoring warnings</p>
              <p className="text-[10px] text-gray-500">Display overlays when violations occur</p>
            </div>
            <input 
              type="checkbox" 
              checked={config.progression.showWarnings}
              onChange={(e) => updateConfig('progression', { showWarnings: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>
          {config.progression.showWarnings && (
            <div className="flex items-center justify-between pt-2 pl-4 border-l-2 border-blue-50">
              <div>
                <p className="text-sm font-semibold text-gray-900">Warning Threshold</p>
                <p className="text-[10px] text-gray-500">Number of warnings before termination</p>
              </div>
              <input 
                type="number" 
                value={config.progression.warningThreshold}
                onChange={(e) => updateConfig('progression', { warningThreshold: parseInt(e.target.value) })}
                className="w-16 px-2 py-1 border border-gray-200 rounded text-sm text-right outline-none"
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
