import React, { useState } from 'react';
import { ExamState, WritingTaskConfig, WritingTaskType } from '../types';
import { Plus, Trash2, ChevronUp, ChevronDown, Edit, ChartColumnBig, Library, Sparkles, Clock, Target } from 'lucide-react';

interface WritingTaskPanelProps {
  tasks: WritingTaskConfig[];
  updateTasks: (tasks: WritingTaskConfig[]) => void;
  onAddTask: (taskType: WritingTaskType) => void;
  onDeleteTask: (taskId: string) => void;
  onEditTask: (taskId: string) => void;
}

export function WritingTaskPanel({
  tasks,
  updateTasks,
  onAddTask,
  onDeleteTask,
  onEditTask,
}: WritingTaskPanelProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const moveTask = (taskId: string, direction: 'up' | 'down') => {
    const index = tasks.findIndex(t => t.id === taskId);
    if (index < 0) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === tasks.length - 1) return;

    const newTasks = [...tasks];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    const currentTask = newTasks[index];
    const swapTask = newTasks[swapIndex];
    if (!currentTask || !swapTask) return;

    newTasks[index] = swapTask;
    newTasks[swapIndex] = currentTask;
    updateTasks(newTasks);
  };

  const updateTaskConfig = (taskId: string, updates: Partial<WritingTaskConfig>) => {
    const newTasks = tasks.map(t => 
      t.id === taskId ? { ...t, ...updates } : t
    );
    updateTasks(newTasks);
  };

  const getTaskTypeIcon = (taskType: WritingTaskType) => {
    switch (taskType) {
      case 'task1-academic':
        return <ChartColumnBig size={16} className="text-blue-600" />;
      case 'task1-general':
        return <Library size={16} className="text-green-600" />;
      case 'task2-essay':
        return <Sparkles size={16} className="text-purple-600" />;
    }
  };

  const getTaskTypeLabel = (taskType: WritingTaskType) => {
    switch (taskType) {
      case 'task1-academic':
        return 'Task 1 Academic';
      case 'task1-general':
        return 'Task 1 General';
      case 'task2-essay':
        return 'Task 2 Essay';
    }
  };

  const getTaskTypeColor = (taskType: WritingTaskType) => {
    switch (taskType) {
      case 'task1-academic':
        return 'bg-blue-50 border-blue-200';
      case 'task1-general':
        return 'bg-green-50 border-green-200';
      case 'task2-essay':
        return 'bg-purple-50 border-purple-200';
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden relative h-full min-h-0">
      <div className="border-b border-gray-100 bg-white flex-shrink-0">
        <div className="px-4 py-2">
          <h2 className="font-semibold text-gray-900 text-sm">Writing Tasks</h2>
        </div>
        <div className="px-4 py-2 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="bg-blue-800 text-white hover:bg-blue-700 px-3 py-1.5 rounded-sm text-xs font-medium flex items-center gap-1 transition-colors shadow-sm"
          >
            <Plus size={14} /> Add Task
          </button>
        </div>
      </div>

      {showAddMenu && (
        <div className="px-4 py-3 bg-white border-b border-gray-100">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Choose task type</p>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={() => {
                onAddTask('task1-academic');
                setShowAddMenu(false);
              }}
              className="flex items-center gap-3 p-2 bg-white border border-gray-200 rounded-sm hover:border-blue-700 hover:bg-blue-50/50 transition-all text-sm font-medium text-gray-800 shadow-sm"
            >
              <div className="w-8 h-8 bg-blue-100 text-blue-800 rounded-sm flex items-center justify-center flex-shrink-0">
                <ChartColumnBig size={16} />
              </div>
              <div className="text-left">
                <div>Task 1 Academic</div>
                <div className="text-xs text-gray-500 font-normal">Describe a chart, graph, or diagram</div>
              </div>
            </button>
            <button
              onClick={() => {
                onAddTask('task1-general');
                setShowAddMenu(false);
              }}
              className="flex items-center gap-3 p-2 bg-white border border-gray-200 rounded-sm hover:border-green-700 hover:bg-green-50/50 transition-all text-sm font-medium text-gray-800 shadow-sm"
            >
              <div className="w-8 h-8 bg-green-100 text-green-800 rounded-sm flex items-center justify-center flex-shrink-0">
                <Library size={16} />
              </div>
              <div className="text-left">
                <div>Task 1 General</div>
                <div className="text-xs text-gray-500 font-normal">Write a formal or informal letter</div>
              </div>
            </button>
            <button
              onClick={() => {
                onAddTask('task2-essay');
                setShowAddMenu(false);
              }}
              className="flex items-center gap-3 p-2 bg-white border border-gray-200 rounded-sm hover:border-purple-700 hover:bg-purple-50/50 transition-all text-sm font-medium text-gray-800 shadow-sm"
            >
              <div className="w-8 h-8 bg-purple-100 text-purple-800 rounded-sm flex items-center justify-center flex-shrink-0">
                <Sparkles size={16} />
              </div>
              <div className="text-left">
                <div>Task 2 Essay</div>
                <div className="text-xs text-gray-500 font-normal">Write an essay on a given topic</div>
              </div>
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {tasks.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-white border border-gray-100 rounded-sm shadow-sm p-8">
            <p className="font-medium text-gray-900 mb-2 text-base">No tasks added yet.</p>
            <p className="text-sm text-gray-600 mb-4">Start by adding a writing task.</p>
            <button 
              onClick={() => setShowAddMenu(true)} 
              className="text-blue-800 font-semibold hover:underline text-sm flex items-center gap-1 justify-center mx-auto"
            >
              <Plus size={14} /> Add your first task
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task, index) => (
              <div
                key={task.id}
                className={`bg-white border rounded-sm shadow-sm overflow-hidden ${getTaskTypeColor(task.taskType)}`}
              >
                <div className="px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-white rounded-sm flex items-center justify-center text-xs font-bold text-gray-700">
                      {index + 1}
                    </div>
                    {getTaskTypeIcon(task.taskType)}
                    <span className="text-sm font-medium text-gray-800">{task.label}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveTask(task.id, 'up')}
                      disabled={index === 0}
                      className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Move up"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      onClick={() => moveTask(task.id, 'down')}
                      disabled={index === tasks.length - 1}
                      className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Move down"
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      onClick={() => setEditingTaskId(editingTaskId === task.id ? null : task.id)}
                      className="p-1 text-gray-400 hover:text-blue-700 transition-colors"
                      title="Configure"
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      onClick={() => onDeleteTask(task.id)}
                      className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                      title="Delete task"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {editingTaskId === task.id && (
                  <div className="px-3 py-3 bg-white border-t border-gray-100 space-y-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-1">Label</label>
                      <input
                        type="text"
                        value={task.label}
                        onChange={(e) => updateTaskConfig(task.id, { label: e.target.value })}
                        className="w-full border border-gray-200 rounded-sm px-2 py-1 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-1">Task Type</label>
                      <select
                        value={task.taskType}
                        onChange={(e) => updateTaskConfig(task.id, { taskType: e.target.value as WritingTaskType })}
                        className="w-full border border-gray-200 rounded-sm px-2 py-1 text-sm outline-none focus:border-blue-500"
                      >
                        <option value="task1-academic">Task 1 Academic</option>
                        <option value="task1-general">Task 1 General</option>
                        <option value="task2-essay">Task 2 Essay</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1">Min Words</label>
                        <input
                          type="number"
                          value={task.minWords}
                          onChange={(e) => updateTaskConfig(task.id, { minWords: Number(e.target.value) })}
                          className="w-full border border-gray-200 rounded-sm px-2 py-1 text-sm outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1">Time (min)</label>
                        <input
                          type="number"
                          value={task.recommendedTime}
                          onChange={(e) => updateTaskConfig(task.id, { recommendedTime: Number(e.target.value) })}
                          className="w-full border border-gray-200 rounded-sm px-2 py-1 text-sm outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1">Optimal Min</label>
                        <input
                          type="number"
                          value={task.optimalMin || ''}
                          onChange={(e) => updateTaskConfig(task.id, { optimalMin: Number(e.target.value) || undefined })}
                          placeholder="Auto"
                          className="w-full border border-gray-200 rounded-sm px-2 py-1 text-sm outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1">Optimal Max</label>
                        <input
                          type="number"
                          value={task.optimalMax || ''}
                          onChange={(e) => updateTaskConfig(task.id, { optimalMax: Number(e.target.value) || undefined })}
                          placeholder="Auto"
                          className="w-full border border-gray-200 rounded-sm px-2 py-1 text-sm outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1">Max Limit</label>
                        <input
                          type="number"
                          value={task.maxWords || ''}
                          onChange={(e) => updateTaskConfig(task.id, { maxWords: Number(e.target.value) || undefined })}
                          placeholder="No limit"
                          className="w-full border border-gray-200 rounded-sm px-2 py-1 text-sm outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-600">
                  <div className="flex items-center gap-1">
                    <Target size={12} className="text-gray-400" />
                    <span>{task.minWords} words min</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock size={12} className="text-gray-400" />
                    <span>{task.recommendedTime} min</span>
                  </div>
                  <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                    {getTaskTypeLabel(task.taskType)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
