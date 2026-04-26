import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Upload, Library, ChartColumnBig, Sparkles, Bold, Italic, Underline, AlignLeft, AlignCenter, List, Undo, Redo, BarChart3, Clock, Target, TrendingUp, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { ExamState, PromptTemplateRecord, RubricDefinition, WritingChartData, WritingTaskContent, WritingTaskType } from '../../types';
import { syncConfigWithStandards } from '../../constants/examDefaults';
import { PromptTemplateLibrary } from '../PromptTemplateLibrary';
import { GradingRubricPanel } from '../scoring/GradingRubricPanel';
import { buildWritingRubric, OFFICIAL_WRITING_RUBRIC } from '../../utils/builderEnhancements';
import {
  getWritingTaskContent,
  normalizeWritingTaskContents,
  updateWritingTaskContent,
} from '../../utils/writingTaskUtils';
import { WritingTaskPanel } from '../WritingTaskPanel';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { WritingChartPreview } from '../writing/WritingChartPreview';

const toDataUrl = (file: File) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });

const syncWritingRubricWeights = (state: ExamState, rubric: RubricDefinition): ExamState => {
  const nextConfig = syncConfigWithStandards({
    ...state.config,
    standards: {
      ...state.config.standards,
      rubricWeights: {
        ...state.config.standards.rubricWeights,
        writing: {
          taskResponse:
            rubric.criteria.find((criterion) => criterion.id === 'task-response')?.weight ??
            state.config.standards.rubricWeights.writing.taskResponse,
          coherence:
            rubric.criteria.find((criterion) => criterion.id === 'coherence')?.weight ??
            state.config.standards.rubricWeights.writing.coherence,
          lexical:
            rubric.criteria.find((criterion) => criterion.id === 'lexical')?.weight ??
            state.config.standards.rubricWeights.writing.lexical,
          grammar:
            rubric.criteria.find((criterion) => criterion.id === 'grammar')?.weight ??
            state.config.standards.rubricWeights.writing.grammar,
        },
      },
    },
  });

  return {
    ...state,
    config: nextConfig,
    writing: {
      ...state.writing,
      rubric: buildWritingRubric(nextConfig, rubric),
    },
  };
};

export function WritingWorkspace({
  state,
  setState,
}: {
  state: ExamState;
  setState: (state: ExamState) => void;
}) {
  const writingConfig = state.config.sections.writing;
  const writingRubric = buildWritingRubric(state.config, state.writing.rubric ?? OFFICIAL_WRITING_RUBRIC);
  const [templateTarget, setTemplateTarget] = useState<string | null>(null);
  const [activePromptEditor, setActivePromptEditor] = useState<string | null>(null);
  const [showModelAnswer, setShowModelAnswer] = useState<Record<string, boolean>>({});
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [isTaskPanelCollapsed, setIsTaskPanelCollapsed] = useState(() => {
    const saved = localStorage.getItem('writing-task-panel-collapsed');
    return saved === 'true';
  });
  const promptEditorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const writingTaskContents = useMemo(
    () => normalizeWritingTaskContents(state.writing, writingConfig.tasks),
    [state.writing, writingConfig.tasks],
  );
  const writingTaskContentMap = useMemo(
    () => new Map(writingTaskContents.map((task) => [task.taskId, task])),
    [writingTaskContents],
  );

  const wordTargets = useMemo(
    () => new Map(writingConfig.tasks.map((task) => [task.id, `${task.minWords} words · ${task.recommendedTime} min`])),
    [writingConfig.tasks],
  );

  const handlePromptFormat = (taskId: string, command: string, value?: string) => {
    document.execCommand(command, false, value);
    const editor = promptEditorRefs.current[taskId];
    if (editor) {
      const htmlContent = editor.innerHTML;
      updateTask(taskId, (currentTask) => ({ ...currentTask, prompt: htmlContent }));
    }
  };

  const handlePromptInput = (taskId: string) => {
    const editor = promptEditorRefs.current[taskId];
    if (editor) {
      const htmlContent = editor.innerHTML;
      updateTask(taskId, (currentTask) => ({ ...currentTask, prompt: htmlContent }));
    }
  };

  // Sync prompt editor content when task content changes externally
  useEffect(() => {
    writingConfig.tasks.forEach((task) => {
      const editor = promptEditorRefs.current[task.id];
      const content = writingTaskContentMap.get(task.id);
      if (editor && content && content.prompt !== editor.innerHTML) {
        editor.innerHTML = content.prompt;
      }
    });
  }, [writingTaskContentMap, writingConfig.tasks]);

  useEffect(() => {
    localStorage.setItem('writing-task-panel-collapsed', isTaskPanelCollapsed.toString());
  }, [isTaskPanelCollapsed]);

  const handleUpdateTasks = (tasks: typeof writingConfig.tasks) => {
    setState({
      ...state,
      config: {
        ...state.config,
        sections: {
          ...state.config.sections,
          writing: {
            ...writingConfig,
            tasks,
          },
        },
      },
    });
  };

  const handleAddTask = (taskType: WritingTaskType) => {
    const nextTasks = [...writingConfig.tasks];
    const nextIndex = nextTasks.length + 1;
    const defaultConfig = taskType === 'task2-essay' 
      ? { minWords: 250, recommendedTime: 40 }
      : { minWords: 150, recommendedTime: 20 };
    
    nextTasks.push({
      id: `task${nextIndex}`,
      label: `Task ${nextIndex}`,
      taskType,
      ...defaultConfig,
    });
    handleUpdateTasks(nextTasks);
  };

  const handleDeleteTask = (taskId: string) => {
    const nextTasks = writingConfig.tasks.filter(t => t.id !== taskId);
    handleUpdateTasks(nextTasks);
  };

  const handleEditTask = (taskId: string) => {
    // This will scroll to the task in the main view
    const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
    if (taskElement) {
      taskElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const toggleModelAnswer = (taskId: string) => {
    setShowModelAnswer(prev => ({
      ...prev,
      [taskId]: !prev[taskId]
    }));
  };

  const handleModelAnswerChange = (taskId: string, value: string) => {
    updateTask(taskId, (currentTask) => ({ ...currentTask, modelAnswer: value }));
  };

  // Analytics calculations
  const analytics = useMemo(() => {
    const totalMinWords = writingConfig.tasks.reduce((sum, task) => sum + (task.minWords || 0), 0);
    const totalOptimalMin = writingConfig.tasks.reduce((sum, task) => sum + (task.optimalMin || Math.ceil(task.minWords * 1.1)), 0);
    const totalOptimalMax = writingConfig.tasks.reduce((sum, task) => sum + (task.optimalMax || Math.ceil(task.minWords * 1.5)), 0);
    const totalRecommendedTime = writingConfig.tasks.reduce((sum, task) => sum + (task.recommendedTime || 0), 0);

    const tasksWithModelAnswers = writingConfig.tasks.filter(task => {
      const content = writingTaskContentMap.get(task.id);
      return content?.modelAnswer && content.modelAnswer.trim().length > 0;
    }).length;

    const tasksWithCharts = writingConfig.tasks.filter(task => {
      const content = writingTaskContentMap.get(task.id);
      return content?.chart;
    }).length;

    const rubricWeightTotal = writingRubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);

    return {
      totalMinWords,
      totalOptimalRange: `${totalOptimalMin}-${totalOptimalMax}`,
      totalRecommendedTime,
      tasksWithModelAnswers,
      tasksWithCharts,
      totalTasks: writingConfig.tasks.length,
      rubricWeightTotal,
      completionRate: Math.round((tasksWithModelAnswers / writingConfig.tasks.length) * 100),
    };
  }, [writingConfig.tasks, writingTaskContentMap, writingRubric]);

  const updateTask = (
    taskId: string,
    updater: (task: WritingTaskContent) => WritingTaskContent,
  ) => {
    setState({
      ...state,
      writing: updateWritingTaskContent(state.writing, writingConfig.tasks, taskId, updater),
    });
  };

  return (
    <div className="flex-1 flex overflow-hidden relative">
      <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,_#fffbeb_0%,_#f8fafc_55%)]">
        <div className="flex-1 p-8 flex justify-center no-scrollbar">
        <div className="w-full max-w-5xl space-y-8">
          {writingConfig.tasks.map((task, index) => {
            const taskContent =
              writingTaskContentMap.get(task.id) ?? getWritingTaskContent(state.writing, writingConfig.tasks, task.id);

            return (
            <div key={task.id} data-task-id={task.id} className="bg-white border border-gray-200 rounded-[32px] shadow-sm overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
              <div className="bg-amber-50 border-b border-amber-100 px-8 py-5 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-black">
                    {index + 1}
                  </div>
                  <div>
                    <h2 className="font-black text-amber-900 uppercase tracking-widest">{task.label}</h2>
                    <p className="text-xs text-amber-700 mt-1">{wordTargets.get(task.id)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTemplateTarget(task.id)}
                    className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50 transition-colors flex items-center gap-2"
                  >
                    <Library size={14} /> Templates
                  </button>
                  <span className="bg-white/80 backdrop-blur-sm px-3 py-2 rounded-full text-[10px] font-black text-amber-700 border border-amber-200 uppercase tracking-widest">
                    {task.taskType === 'task1-academic' ? 'Task 1 Academic' : task.taskType === 'task1-general' ? 'Task 1 General' : 'Task 2 Essay'}
                  </span>
                </div>
              </div>
              <div className="p-8 space-y-8">
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4">
                      Prompt & Instructions
                    </label>
                    <div className="border-2 border-gray-100 rounded-[28px] overflow-hidden focus-within:border-amber-400 transition-all">
                      <div className="border-b border-gray-100 p-2 flex items-center gap-1 bg-gray-50">
                        <button
                          onClick={() => handlePromptFormat(task.id, 'bold')}
                          className="p-1.5 text-gray-400 hover:bg-white hover:text-gray-900 hover:shadow-sm rounded-lg transition-all flex-shrink-0"
                          title="Bold"
                        >
                          <Bold size={14} />
                        </button>
                        <button
                          onClick={() => handlePromptFormat(task.id, 'italic')}
                          className="p-1.5 text-gray-400 hover:bg-white hover:text-gray-900 hover:shadow-sm rounded-lg transition-all flex-shrink-0"
                          title="Italic"
                        >
                          <Italic size={14} />
                        </button>
                        <button
                          onClick={() => handlePromptFormat(task.id, 'underline')}
                          className="p-1.5 text-gray-400 hover:bg-white hover:text-gray-900 hover:shadow-sm rounded-lg transition-all flex-shrink-0"
                          title="Underline"
                        >
                          <Underline size={14} />
                        </button>
                        <div className="w-px h-5 bg-gray-200 mx-1 flex-shrink-0"></div>
                        <button
                          onClick={() => handlePromptFormat(task.id, 'justifyLeft')}
                          className="p-1.5 text-gray-400 hover:bg-white hover:text-gray-900 hover:shadow-sm rounded-lg transition-all flex-shrink-0"
                          title="Align Left"
                        >
                          <AlignLeft size={14} />
                        </button>
                        <button
                          onClick={() => handlePromptFormat(task.id, 'justifyCenter')}
                          className="p-1.5 text-gray-400 hover:bg-white hover:text-gray-900 hover:shadow-sm rounded-lg transition-all flex-shrink-0"
                          title="Align Center"
                        >
                          <AlignCenter size={14} />
                        </button>
                        <div className="w-px h-5 bg-gray-200 mx-1 flex-shrink-0"></div>
                        <button
                          onClick={() => handlePromptFormat(task.id, 'insertUnorderedList')}
                          className="p-1.5 text-gray-400 hover:bg-white hover:text-gray-900 hover:shadow-sm rounded-lg transition-all flex-shrink-0"
                          title="Bullet List"
                        >
                          <List size={14} />
                        </button>
                        <div className="w-px h-5 bg-gray-200 mx-1 flex-1"></div>
                        <button
                          onClick={() => handlePromptFormat(task.id, 'undo')}
                          className="p-1.5 text-gray-400 hover:bg-white hover:text-gray-900 hover:shadow-sm rounded-lg transition-all flex-shrink-0"
                          title="Undo"
                        >
                          <Undo size={14} />
                        </button>
                        <button
                          onClick={() => handlePromptFormat(task.id, 'redo')}
                          className="p-1.5 text-gray-400 hover:bg-white hover:text-gray-900 hover:shadow-sm rounded-lg transition-all flex-shrink-0"
                          title="Redo"
                        >
                          <Redo size={14} />
                        </button>
                      </div>
                      <div
                        ref={(el) => {
                          promptEditorRefs.current[task.id] = el;
                        }}
                        contentEditable
                        onInput={() => handlePromptInput(task.id)}
                        className="p-6 text-lg text-gray-800 min-h-[200px] outline-none font-serif leading-relaxed prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(taskContent.prompt) }}
                      />
                    </div>
                  </div>

                  {/* Model Answer Section */}
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <p className="text-xs font-black text-gray-400 uppercase tracking-[0.2em]">
                          Model Answer
                        </p>
                        <p className="text-sm text-gray-500 mt-1">Attach a reference answer for grading.</p>
                      </div>
                      <button
                        onClick={() => toggleModelAnswer(task.id)}
                        className="text-blue-600 hover:text-blue-700 text-sm font-semibold"
                      >
                        {showModelAnswer[task.id] ? 'Hide' : 'Show'}
                      </button>
                    </div>

                    {showModelAnswer[task.id] && (
                      <textarea
                        className="w-full border border-gray-200 rounded-xl p-4 text-sm text-gray-800 h-40 outline-none focus:border-amber-500 transition-all font-serif leading-relaxed resize-none"
                        value={taskContent.modelAnswer || ''}
                        onChange={(e) => handleModelAnswerChange(task.id, e.target.value)}
                        placeholder={`Enter a model answer for ${task.label}... This will be available to graders as a reference.`}
                      />
                    )}
                  </div>

                  {task.taskType === 'task1-academic' && (
                    <div className="space-y-4">
                      <div className="rounded-[28px] border border-gray-200 bg-gray-50 p-5">
                        <div className="flex items-center justify-between gap-3 mb-4">
                          <div>
                            <p className="text-xs font-black text-gray-400 uppercase tracking-[0.2em]">
                              Chart Builder
                            </p>
                            <p className="text-sm text-gray-500 mt-1">Upload a chart or build a simple one.</p>
                          </div>
                          <ChartColumnBig className="text-amber-500" size={18} />
                        </div>

                        <div className="grid gap-3">
                          <label className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-4 text-sm text-gray-600 hover:border-amber-300 cursor-pointer flex items-center gap-3">
                            <Upload size={16} />
                            Upload chart image
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={async (event) => {
                                const file = event.target.files?.[0];
                                if (!file) {
                                  return;
                                }

                                const imageSrc = await toDataUrl(file);
                                updateTask(task.id, (currentTask) => ({
                                  ...currentTask,
                                  chart: {
                                    id: currentTask.chart?.id ?? 'task1-chart',
                                    title: file.name,
                                    type: currentTask.chart?.type ?? 'bar',
                                    labels: currentTask.chart?.labels ?? ['A', 'B', 'C'],
                                    values: currentTask.chart?.values ?? [3, 5, 4],
                                    imageSrc,
                                  },
                                }));
                              }}
                            />
                          </label>

                          <input
                            value={taskContent.chart?.title ?? 'Task 1 chart'}
                            onChange={(event) =>
                              updateTask(task.id, (currentTask) => ({
                                ...currentTask,
                                chart: {
                                  id: currentTask.chart?.id ?? 'task1-chart',
                                  title: event.target.value,
                                  type: currentTask.chart?.type ?? 'bar',
                                  labels: currentTask.chart?.labels ?? ['Category 1', 'Category 2', 'Category 3'],
                                  values: currentTask.chart?.values ?? [3, 6, 4],
                                  imageSrc: currentTask.chart?.imageSrc,
                                },
                              }))
                            }
                            className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-amber-500"
                          />

                          <div className="grid grid-cols-2 gap-3">
                            <select
                              value={taskContent.chart?.type ?? 'bar'}
                              onChange={(event) =>
                                updateTask(task.id, (currentTask) => ({
                                  ...currentTask,
                                  chart: {
                                    id: currentTask.chart?.id ?? 'task1-chart',
                                    title: currentTask.chart?.title ?? 'Task 1 chart',
                                    type: event.target.value as WritingChartData['type'],
                                    labels: currentTask.chart?.labels ?? ['Category 1', 'Category 2', 'Category 3'],
                                    values: currentTask.chart?.values ?? [3, 6, 4],
                                    imageSrc: currentTask.chart?.imageSrc,
                                  },
                                }))
                              }
                              className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-amber-500"
                            >
                              <option value="bar">Bar</option>
                              <option value="line">Line</option>
                              <option value="pie">Pie</option>
                              <option value="table">Table</option>
                            </select>
                            <input
                              value={(taskContent.chart?.labels ?? ['A', 'B', 'C']).join(', ')}
                              onChange={(event) =>
                                updateTask(task.id, (currentTask) => ({
                                  ...currentTask,
                                  chart: {
                                    id: currentTask.chart?.id ?? 'task1-chart',
                                    title: currentTask.chart?.title ?? 'Task 1 chart',
                                    type: currentTask.chart?.type ?? 'bar',
                                    labels: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                                    values: currentTask.chart?.values ?? [3, 6, 4],
                                    imageSrc: currentTask.chart?.imageSrc,
                                  },
                                }))
                              }
                              placeholder="Labels: A, B, C"
                              className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-amber-500"
                            />
                          </div>

                          <input
                            value={(taskContent.chart?.values ?? [3, 6, 4]).join(', ')}
                            onChange={(event) =>
                              updateTask(task.id, (currentTask) => ({
                                ...currentTask,
                                chart: {
                                  id: currentTask.chart?.id ?? 'task1-chart',
                                  title: currentTask.chart?.title ?? 'Task 1 chart',
                                  type: currentTask.chart?.type ?? 'bar',
                                  labels: currentTask.chart?.labels ?? ['A', 'B', 'C'],
                                  values: event.target.value
                                    .split(',')
                                    .map((item) => Number(item.trim()))
                                    .filter((value) => !Number.isNaN(value)),
                                  imageSrc: currentTask.chart?.imageSrc,
                                },
                              }))
                            }
                            placeholder="Values: 3, 6, 4"
                            className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>

                      {taskContent.chart?.imageSrc ? (
                        <div className="rounded-[28px] border border-gray-200 bg-white p-4 shadow-sm">
                          <img src={taskContent.chart.imageSrc} alt={taskContent.chart.title} className="w-full rounded-2xl object-contain max-h-72" />
                        </div>
                      ) : (
                        <WritingChartPreview chart={taskContent.chart} variant="builder" />
                      )}
                    </div>
                  )}

                  {task.taskType === 'task1-general' && (
                    <div className="rounded-[28px] border border-gray-200 bg-gray-50 p-5">
                      <div className="flex items-center justify-between gap-3 mb-4">
                        <div>
                          <p className="text-xs font-black text-gray-400 uppercase tracking-[0.2em]">
                            Letter Settings
                          </p>
                          <p className="text-sm text-gray-500 mt-1">Configure letter type and recipient.</p>
                        </div>
                        <Library className="text-amber-500" size={18} />
                      </div>

                      <div className="grid gap-3">
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-500 mb-2">Letter Type</label>
                          <select
                            value={taskContent.letterType || 'formal'}
                            onChange={(e) =>
                              updateTask(task.id, (currentTask) => ({
                                ...currentTask,
                                letterType: e.target.value as 'formal' | 'informal' | 'semi-formal',
                              }))
                            }
                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-amber-500"
                          >
                            <option value="formal">Formal</option>
                            <option value="semi-formal">Semi-formal</option>
                            <option value="informal">Informal</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-500 mb-2">Recipient (optional)</label>
                          <input
                            value={taskContent.recipient || ''}
                            onChange={(e) =>
                              updateTask(task.id, (currentTask) => ({
                                ...currentTask,
                                recipient: e.target.value,
                              }))
                            }
                            placeholder="e.g., The Manager, Dear John, etc."
                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-amber-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-500 mb-2">Purpose (optional)</label>
                          <input
                            value={taskContent.letterPurpose || ''}
                            onChange={(e) =>
                              updateTask(task.id, (currentTask) => ({
                                ...currentTask,
                                letterPurpose: e.target.value,
                              }))
                            }
                            placeholder="e.g., Complaint, Request, Information, etc."
                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 group hover:bg-white hover:shadow-md transition-all">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Word Requirement</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        value={task.minWords}
                        onChange={(e) => {
                          if (task.id === 'task1' || task.id === 'task2') {
                            const standardKey = task.id;
                            const nextConfig = syncConfigWithStandards({
                              ...state.config,
                              standards: {
                                ...state.config.standards,
                                writingTasks: {
                                  ...state.config.standards.writingTasks,
                                  [standardKey]: {
                                    ...state.config.standards.writingTasks[standardKey],
                                    minWords: Number(e.target.value),
                                  },
                                },
                              },
                            });
                            setState({
                              ...state,
                              config: nextConfig,
                            });
                            return;
                          }

                          const nextTasks = writingConfig.tasks.map((currentTask) =>
                            currentTask.id === task.id
                              ? { ...currentTask, minWords: Number(e.target.value) }
                              : currentTask,
                          );

                          setState({
                            ...state,
                            config: {
                              ...state.config,
                              sections: {
                                ...state.config.sections,
                                writing: {
                                  ...writingConfig,
                                  tasks: nextTasks,
                                },
                              },
                            },
                          });
                        }}
                        className="bg-transparent font-black text-2xl text-gray-900 w-24 outline-none"
                      />
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Words min.</span>
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 group hover:bg-white hover:shadow-md transition-all">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Target Duration</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        value={task.recommendedTime}
                        onChange={(e) => {
                          if (task.id === 'task1' || task.id === 'task2') {
                            const standardKey = task.id;
                            const nextConfig = syncConfigWithStandards({
                              ...state.config,
                              standards: {
                                ...state.config.standards,
                                writingTasks: {
                                  ...state.config.standards.writingTasks,
                                  [standardKey]: {
                                    ...state.config.standards.writingTasks[standardKey],
                                    recommendedTime: Number(e.target.value),
                                  },
                                },
                              },
                            });
                            setState({
                              ...state,
                              config: nextConfig,
                            });
                            return;
                          }

                          const nextTasks = writingConfig.tasks.map((currentTask) =>
                            currentTask.id === task.id
                              ? { ...currentTask, recommendedTime: Number(e.target.value) }
                              : currentTask,
                          );

                          setState({
                            ...state,
                            config: {
                              ...state.config,
                              sections: {
                                ...state.config.sections,
                                writing: {
                                  ...writingConfig,
                                  tasks: nextTasks,
                                },
                              },
                            },
                          });
                        }}
                        className="bg-transparent font-black text-2xl text-gray-900 w-24 outline-none"
                      />
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Minutes</span>
                    </div>
                  </div>
                </div>

                {/* Word Count Guidance Settings */}
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                  <p className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4">
                    Word Count Guidance
                  </p>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-2">Optimal Min</label>
                      <input
                        type="number"
                        value={task.optimalMin || ''}
                        onChange={(e) => {
                          const nextTasks = writingConfig.tasks.map((currentTask) =>
                            currentTask.id === task.id
                              ? { ...currentTask, optimalMin: Number(e.target.value) || undefined }
                              : currentTask,
                          );
                          setState({
                            ...state,
                            config: {
                              ...state.config,
                              sections: {
                                ...state.config.sections,
                                writing: {
                                  ...writingConfig,
                                  tasks: nextTasks,
                                },
                              },
                            },
                          });
                        }}
                        placeholder="Auto"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-2">Optimal Max</label>
                      <input
                        type="number"
                        value={task.optimalMax || ''}
                        onChange={(e) => {
                          const nextTasks = writingConfig.tasks.map((currentTask) =>
                            currentTask.id === task.id
                              ? { ...currentTask, optimalMax: Number(e.target.value) || undefined }
                              : currentTask,
                          );
                          setState({
                            ...state,
                            config: {
                              ...state.config,
                              sections: {
                                ...state.config.sections,
                                writing: {
                                  ...writingConfig,
                                  tasks: nextTasks,
                                },
                              },
                            },
                          });
                        }}
                        placeholder="Auto"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-2">Max Limit</label>
                      <input
                        type="number"
                        value={task.maxWords || ''}
                        onChange={(e) => {
                          const nextTasks = writingConfig.tasks.map((currentTask) =>
                            currentTask.id === task.id
                              ? { ...currentTask, maxWords: Number(e.target.value) || undefined }
                              : currentTask,
                          );
                          setState({
                            ...state,
                            config: {
                              ...state.config,
                              sections: {
                                ...state.config.sections,
                                writing: {
                                  ...writingConfig,
                                  tasks: nextTasks,
                                },
                              },
                            },
                          });
                        }}
                        placeholder="No limit"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            );
          })}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-6">
              <GradingRubricPanel
                rubric={writingRubric}
                assessment={[]}
                deviationThreshold={state.config.standards.rubricDeviationThreshold}
                onAssessmentChange={() => {}}
                editableWeights
                onRubricChange={(rubric) => setState(syncWritingRubricWeights(state, { ...rubric, custom: true }))}
                title="Writing Rubric Attachment"
              />

              {/* Analytics Dashboard */}
              <div className="rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-start gap-3">
                    <BarChart3 size={20} className="text-amber-500 mt-0.5" />
                    <div>
                      <p className="text-sm font-black text-gray-900 uppercase tracking-[0.2em]">
                        Writing Analytics
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        Overview of task configuration and completion.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowAnalytics(!showAnalytics)}
                    className="text-blue-600 hover:text-blue-700 text-sm font-semibold"
                  >
                    {showAnalytics ? 'Hide' : 'Show'}
                  </button>
                </div>

                {showAnalytics && (
                  <div className="space-y-4">
                    {/* Word Count Metrics */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Target size={14} className="text-blue-500" />
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Min Words</span>
                        </div>
                        <p className="text-2xl font-black text-gray-900">{analytics.totalMinWords}</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp size={14} className="text-emerald-500" />
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Optimal Range</span>
                        </div>
                        <p className="text-lg font-black text-gray-900">{analytics.totalOptimalRange}</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Clock size={14} className="text-amber-500" />
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Time</span>
                        </div>
                        <p className="text-2xl font-black text-gray-900">{analytics.totalRecommendedTime}m</p>
                      </div>
                    </div>

                    {/* Completion Metrics */}
                    <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Task Completion</p>
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl font-black text-gray-900">{analytics.tasksWithModelAnswers}</span>
                              <span className="text-xs text-gray-500">/ {analytics.totalTasks} tasks</span>
                            </div>
                            <span className="text-sm font-semibold text-emerald-600">{analytics.completionRate}%</span>
                          </div>
                        </div>
                        <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 transition-all"
                            style={{ width: `${analytics.completionRate}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Resource Metrics */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-blue-50 border border-blue-100 p-4">
                        <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1">Model Answers</p>
                        <p className="text-xl font-black text-blue-900">{analytics.tasksWithModelAnswers} attached</p>
                      </div>
                      <div className="rounded-xl bg-amber-50 border border-amber-100 p-4">
                        <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-1">Charts/Stimuli</p>
                        <p className="text-xl font-black text-amber-900">{analytics.tasksWithCharts} configured</p>
                      </div>
                    </div>

                    {/* Rubric Weight Summary */}
                    <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Rubric Weight Distribution</p>
                      <div className="space-y-2">
                        {writingRubric.criteria.map((criterion) => (
                          <div key={criterion.id} className="flex items-center gap-3">
                            <span className="text-xs text-gray-600 w-24">{criterion.label}</span>
                            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 transition-all"
                                style={{ width: `${(criterion.weight / analytics.rubricWeightTotal) * 100}%` }}
                              />
                            </div>
                            <span className="text-xs font-black text-gray-900 w-8 text-right">{criterion.weight}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm space-y-4">
              <div className="flex items-start gap-3">
                <Sparkles size={18} className="text-amber-500 mt-0.5" />
                <div>
                  <p className="text-sm font-black text-gray-900 uppercase tracking-[0.2em]">
                    Grader Preview
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Current rubric flows into the grading workspace preview.
                  </p>
                </div>
              </div>
              <input
                value={writingRubric.title}
                onChange={(event) =>
                  setState(
                    syncWritingRubricWeights(state, {
                      ...writingRubric,
                      custom: true,
                      title: event.target.value,
                    }),
                  )
                }
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-amber-500"
                placeholder="Institution rubric name"
              />
              <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
                <p className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-2">
                  Official Criteria
                </p>
                <div className="space-y-2">
                  {writingRubric.criteria.map((criterion) => (
                    <div key={criterion.id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{criterion.label}</span>
                      <span className="font-black text-gray-900">{criterion.weight}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>

      {!isTaskPanelCollapsed && <div className="w-px bg-gray-200" />}

      {/* Writing Task Panel with Collapse Toggle */}
      <div className={`flex-shrink-0 transition-all duration-300 ease-in-out ${isTaskPanelCollapsed ? 'w-0 overflow-hidden' : 'w-[380px]'}`}>
        <WritingTaskPanel
          tasks={writingConfig.tasks}
          updateTasks={handleUpdateTasks}
          onAddTask={handleAddTask}
          onDeleteTask={handleDeleteTask}
          onEditTask={handleEditTask}
        />
      </div>

      {!isTaskPanelCollapsed && (
        <>
          {/* Task Panel Collapse Toggle Button */}
          <button
            onClick={() => setIsTaskPanelCollapsed(true)}
            className="absolute right-[380px] top-1/2 -translate-y-1/2 z-20 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-l-md p-1 group"
            style={{ right: '23.75rem' }}
            aria-label="Collapse task panel"
          >
            <ChevronRight size={16} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
          </button>
        </>
      )}

      {isTaskPanelCollapsed && (
        <button
          onClick={() => setIsTaskPanelCollapsed(false)}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-l-md p-1 group"
          aria-label="Expand task panel"
        >
          <ChevronLeft size={16} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
        </button>
      )}

      <PromptTemplateLibrary
        isOpen={templateTarget !== null}
        onClose={() => setTemplateTarget(null)}
        currentPrompt={
          templateTarget
            ? getWritingTaskContent(state.writing, writingConfig.tasks, templateTarget).prompt
            : ''
        }
        customTemplates={state.writing.customPromptTemplates ?? []}
        onInsert={(template: PromptTemplateRecord) =>
          templateTarget
            ? setState({
                ...state,
                writing: updateWritingTaskContent(
                  state.writing,
                  writingConfig.tasks,
                  templateTarget,
                  (task) => ({ ...task, prompt: template.prompt }),
                ),
              })
            : undefined
        }
        onSaveCustom={(template) =>
          setState({
            ...state,
            writing: {
              ...state.writing,
              customPromptTemplates: [...(state.writing.customPromptTemplates ?? []), template],
            },
          })
        }
        onUpdateCustom={(template) =>
          setState({
            ...state,
            writing: {
              ...state.writing,
              customPromptTemplates: (state.writing.customPromptTemplates ?? []).map(t =>
                t.id === template.id ? template : t
              ),
            },
          })
        }
        onDeleteCustom={(templateId) =>
          setState({
            ...state,
            writing: {
              ...state.writing,
              customPromptTemplates: (state.writing.customPromptTemplates ?? []).filter(t => t.id !== templateId),
            },
          })
        }
      />
    </div>
  );
}
