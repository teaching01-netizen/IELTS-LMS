import React, { useState } from 'react';
import { Shield, Save, CheckSquare, Layers, Clock, BarChart3, Info, RotateCcw, Trash2 } from 'lucide-react';
import { ExamConfig, ModuleType, QuestionType, WritingTaskConfig, SpeakingPartConfig } from '../../types';
import { createDefaultConfig, ALL_QUESTION_TYPES } from '../../constants/examDefaults';

interface AdminSettingsProps {
  config: ExamConfig;
  onChange: (config: ExamConfig) => void;
}

export function AdminSettings({ config, onChange }: AdminSettingsProps) {
  const [activeTab, setActiveTab] = useState<'scoring' | 'time' | 'security' | 'general' | 'sections'>('scoring');

  const updateConfig = (section: keyof ExamConfig, value: Partial<ExamConfig[keyof ExamConfig]>) => {
    onChange({
      ...config,
      [section]: {
        ...config[section],
        ...value
      }
    });
  };

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

  const resetToBaseline = () => {
    if (confirm('Are you sure you want to reset all defaults to the seeded baseline? This will not affect existing exams.')) {
      onChange(createDefaultConfig('Academic', 'Academic'));
    }
  };

  const toggleQuestionType = (module: ModuleType, type: QuestionType) => {
    const currentTypes = config.sections[module].allowedQuestionTypes;
    const newTypes = currentTypes.includes(type)
      ? currentTypes.filter(t => t !== type)
      : [...currentTypes, type];
    updateSection(module, { allowedQuestionTypes: newTypes });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Global Exam Defaults</h1>
          <p className="text-sm text-gray-500 mt-1">Configure the default profile used for all newly created exams.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={resetToBaseline}
            className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-md font-medium transition-colors"
          >
            <RotateCcw size={18} />
            Reset Baseline
          </button>
          <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors shadow-sm">
            <Save size={18} />
            Save Profile
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="w-full md:w-64 flex-shrink-0">
          <nav className="space-y-1 bg-white p-2 rounded-xl border border-gray-200 shadow-sm">
            <button 
              onClick={() => setActiveTab('general')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-bold ${activeTab === 'general' ? 'bg-blue-600 text-white shadow-md shadow-blue-100' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Info size={18} /> General
            </button>
            <button 
              onClick={() => setActiveTab('sections')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-bold ${activeTab === 'sections' ? 'bg-blue-600 text-white shadow-md shadow-blue-100' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Layers size={18} /> Modules
            </button>
            <button 
              onClick={() => setActiveTab('scoring')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-bold ${activeTab === 'scoring' ? 'bg-blue-600 text-white shadow-md shadow-blue-100' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <BarChart3 size={18} /> Scoring Rules
            </button>
            <button 
              onClick={() => setActiveTab('time')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-bold ${activeTab === 'time' ? 'bg-blue-600 text-white shadow-md shadow-blue-100' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Clock size={18} /> Time & Progression
            </button>
            <button 
              onClick={() => setActiveTab('security')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-bold ${activeTab === 'security' ? 'bg-blue-600 text-white shadow-md shadow-blue-100' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Shield size={18} /> Security
            </button>
          </nav>
        </div>

        <div className="flex-1 space-y-6">
          {activeTab === 'general' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
                <Info size={20} className="text-blue-600" />
                <h2 className="text-lg font-bold text-gray-900">General Default Info</h2>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Default Summary</label>
                  <textarea 
                    value={config.general.summary}
                    onChange={(e) => updateConfig('general', { summary: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none h-24"
                    placeholder="Enter default exam summary..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Default Instructions for Candidates</label>
                  <textarea 
                    value={config.general.instructions}
                    onChange={(e) => updateConfig('general', { instructions: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none h-48 leading-relaxed"
                    placeholder="Enter instructions that will appear at the start of every new exam..."
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'sections' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
                <Layers size={20} className="text-blue-600" />
                <h2 className="text-lg font-bold text-gray-900">Module & Content Defaults</h2>
              </div>
              <div className="p-6 space-y-6">
                {(['listening', 'reading', 'writing', 'speaking'] as ModuleType[]).map((m) => {
                  const section = config.sections[m];
                  return (
                    <div key={m} className="p-4 rounded-2xl border border-gray-100 bg-gray-50/50 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center font-black text-blue-600">
                            {m.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <input 
                              type="text" 
                              value={section.label}
                              onChange={(e) => updateSection(m, { label: e.target.value })}
                              className="font-bold text-gray-900 bg-transparent border-none p-0 focus:ring-0 text-sm"
                            />
                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">{m} section</p>
                          </div>
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
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-100">
                          <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Default Content Counts</label>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-500 font-medium">{m === 'reading' ? 'Passages' : m === 'listening' ? 'Parts' : m === 'writing' ? 'Tasks' : 'Parts'}</span>
                              <input 
                                type="number" 
                                value={m === 'reading' ? ('passageCount' in section ? section.passageCount : 0) : m === 'listening' ? ('partCount' in section ? section.partCount : 0) : m === 'writing' ? ('tasks' in section ? section.tasks.length : 0) : ('parts' in section ? section.parts.length : 0)}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value);
                                  if (m === 'reading') updateSection(m, { passageCount: val });
                                  else if (m === 'listening') updateSection(m, { partCount: val });
                                }}
                                className="w-16 px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-bold text-center outline-none"
                              />
                            </div>
                          </div>
                          {(m === 'reading' || m === 'listening') && (
                            <div>
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Allowed Question Types</label>
                              <div className="flex flex-wrap gap-2">
                                {ALL_QUESTION_TYPES.map(type => (
                                  <button
                                    key={type}
                                    onClick={() => toggleQuestionType(m, type)}
                                    className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-all ${
                                      section.allowedQuestionTypes.includes(type)
                                        ? 'bg-blue-600 border-blue-600 text-white'
                                        : 'bg-white border-gray-200 text-gray-400'
                                    }`}
                                  >
                                    {type}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'scoring' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
                  <BarChart3 size={20} className="text-blue-600" />
                  <h2 className="text-lg font-bold text-gray-900">Scoring Standards</h2>
                </div>
                <div className="p-6 space-y-8">
                  <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6 flex items-center justify-between gap-4">
                    <div className="flex gap-4">
                      <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center text-blue-600 font-black text-xl flex-shrink-0">9.0</div>
                      <div>
                        <h3 className="font-bold text-blue-900">ACTIVE PROFILE: "IELTS Standard 2026"</h3>
                        <p className="text-sm text-blue-700/70 mt-1 leading-relaxed">Define how raw marks convert to band scores.</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-bold text-blue-900 uppercase">Rounding</label>
                      <select 
                        value={config.scoring.overallRounding}
                        onChange={(e) => updateConfig('scoring', { overallRounding: e.target.value as 'nearest-0.5' | 'floor' | 'ceil' })}
                        className="text-xs border border-blue-200 rounded-lg px-3 py-2 outline-none font-bold bg-white text-blue-900"
                      >
                        <option value="nearest-0.5">Nearest 0.5 (IELTS)</option>
                        <option value="floor">Floor</option>
                        <option value="ceil">Ceil</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <section>
                      <h4 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                        Listening Conversion
                      </h4>
                      <div className="border border-gray-100 rounded-2xl overflow-hidden divide-y divide-gray-50 shadow-sm max-h-[400px] overflow-y-auto no-scrollbar">
                        {Object.entries(config.sections.listening.bandScoreTable).sort((a, b) => parseInt(b[0]) - parseInt(a[0])).map(([raw, band]) => (
                          <div key={raw} className="flex justify-between items-center p-3 bg-white hover:bg-gray-50 transition-colors group">
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-bold text-gray-400">Score ≥</span>
                              <input 
                                type="number" 
                                value={raw}
                                onChange={(e) => {
                                  const newTable = { ...config.sections.listening.bandScoreTable };
                                  delete newTable[parseInt(raw)];
                                  newTable[parseInt(e.target.value)] = band;
                                  updateSection('listening', { bandScoreTable: newTable });
                                }}
                                className="w-8 bg-transparent border-none p-0 focus:ring-0 text-sm font-bold text-gray-700"
                              />
                            </div>
                            <div className="flex items-center gap-3">
                              <input 
                                type="number" 
                                step="0.5"
                                value={band}
                                onChange={(e) => {
                                  const newTable = { ...config.sections.listening.bandScoreTable, [raw]: parseFloat(e.target.value) };
                                  updateSection('listening', { bandScoreTable: newTable });
                                }}
                                className="w-10 text-right font-black text-blue-600 bg-transparent border-none p-0 focus:ring-0"
                              />
                              <button 
                                onClick={() => {
                                  const newTable = { ...config.sections.listening.bandScoreTable };
                                  delete newTable[parseInt(raw)];
                                  updateSection('listening', { bandScoreTable: newTable });
                                }}
                                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                        <button 
                          onClick={() => {
                            const newTable = { ...config.sections.listening.bandScoreTable, [0]: 1.0 };
                            updateSection('listening', { bandScoreTable: newTable });
                          }}
                          className="w-full py-3 bg-gray-50 text-[10px] font-bold text-blue-600 uppercase tracking-widest hover:bg-blue-50 transition-all"
                        >
                          + Add Row
                        </button>
                      </div>
                    </section>

                    <section>
                      <h4 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                        Academic Reading
                      </h4>
                      <div className="border border-gray-100 rounded-2xl overflow-hidden divide-y divide-gray-50 shadow-sm max-h-[400px] overflow-y-auto no-scrollbar">
                        {Object.entries(config.sections.reading.bandScoreTable).sort((a, b) => parseInt(b[0]) - parseInt(a[0])).map(([raw, band]) => (
                          <div key={raw} className="flex justify-between items-center p-3 bg-white hover:bg-gray-50 transition-colors group">
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-bold text-gray-400">Score ≥</span>
                              <input 
                                type="number" 
                                value={raw}
                                onChange={(e) => {
                                  const newTable = { ...config.sections.reading.bandScoreTable };
                                  delete newTable[parseInt(raw)];
                                  newTable[parseInt(e.target.value)] = band;
                                  updateSection('reading', { bandScoreTable: newTable });
                                }}
                                className="w-8 bg-transparent border-none p-0 focus:ring-0 text-sm font-bold text-gray-700"
                              />
                            </div>
                            <div className="flex items-center gap-3">
                              <input 
                                type="number" 
                                step="0.5"
                                value={band}
                                onChange={(e) => {
                                  const newTable = { ...config.sections.reading.bandScoreTable, [raw]: parseFloat(e.target.value) };
                                  updateSection('reading', { bandScoreTable: newTable });
                                }}
                                className="w-10 text-right font-black text-emerald-600 bg-transparent border-none p-0 focus:ring-0"
                              />
                              <button 
                                onClick={() => {
                                  const newTable = { ...config.sections.reading.bandScoreTable };
                                  delete newTable[parseInt(raw)];
                                  updateSection('reading', { bandScoreTable: newTable });
                                }}
                                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                        <button 
                          onClick={() => {
                            const newTable = { ...config.sections.reading.bandScoreTable, [0]: 1.0 };
                            updateSection('reading', { bandScoreTable: newTable });
                          }}
                          className="w-full py-3 bg-gray-50 text-[10px] font-bold text-emerald-600 uppercase tracking-widest hover:bg-emerald-50 transition-all"
                        >
                          + Add Row
                        </button>
                      </div>
                    </section>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
                  <CheckSquare size={20} className="text-blue-600" />
                  <h2 className="text-lg font-bold text-gray-900">Rubric Weighting</h2>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <h4 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-6">Writing Tasks</h4>
                      <div className="space-y-4">
                        {Object.entries(config.sections.writing.rubricWeights).map(([key, weight]) => (
                          <div key={key}>
                            <div className="flex justify-between mb-1.5">
                              <label className="text-xs font-bold text-gray-700 capitalize">{key.replace(/([A-Z])/g, ' $1')}</label>
                              <span className="text-xs font-black text-blue-600">{weight}%</span>
                            </div>
                            <input 
                              type="range" 
                              min="0" max="100" 
                              value={weight}
                              onChange={(e) => {
                                const newWeights = { ...config.sections.writing.rubricWeights, [key]: parseInt(e.target.value) };
                                updateSection('writing', { rubricWeights: newWeights });
                              }}
                              className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-6">Speaking Parts</h4>
                      <div className="space-y-4">
                        {Object.entries(config.sections.speaking.rubricWeights).map(([key, weight]) => (
                          <div key={key}>
                            <div className="flex justify-between mb-1.5">
                              <label className="text-xs font-bold text-gray-700 capitalize">{key.replace(/([A-Z])/g, ' $1')}</label>
                              <span className="text-xs font-black text-emerald-600">{weight}%</span>
                            </div>
                            <input 
                              type="range" 
                              min="0" max="100" 
                              value={weight}
                              onChange={(e) => {
                                const newWeights = { ...config.sections.speaking.rubricWeights, [key]: parseInt(e.target.value) };
                                updateSection('speaking', { rubricWeights: newWeights });
                              }}
                              className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'time' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
                <Clock size={20} className="text-blue-600" />
                <h2 className="text-lg font-bold text-gray-900">Module Timers & Rules</h2>
              </div>
              <div className="p-6 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {(['listening', 'reading', 'writing', 'speaking'] as ModuleType[]).map((m) => {
                    const section = config.sections[m];
                    return (
                      <div key={m} className="p-5 rounded-2xl border border-gray-100 shadow-sm bg-white hover:border-blue-100 transition-all group">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="font-black text-xs uppercase tracking-widest text-gray-400 group-hover:text-blue-600 transition-colors">{section.label}</h4>
                          <div className="flex items-center gap-2">
                            <input 
                              type="number" 
                              value={section.duration}
                              onChange={(e) => updateSection(m, { duration: parseInt(e.target.value) })}
                              className="w-16 px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg font-bold text-sm text-right outline-none focus:ring-2 focus:ring-blue-100"
                            />
                            <span className="text-[10px] font-bold text-gray-400 uppercase">min</span>
                          </div>
                        </div>
                        {m === 'writing' && (
                          <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-gray-50">
                            {'tasks' in section && section.tasks.map((task: WritingTaskConfig, idx: number) => (
                              <div key={task.id}>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{task.label}</p>
                                <div className="flex items-center gap-2">
                                  <input 
                                    type="number" 
                                    value={task.recommendedTime}
                                    onChange={(e) => {
                                      const newTasks = [...('tasks' in section ? section.tasks : [])];
                                      newTasks[idx] = { ...task, recommendedTime: parseInt(e.target.value) };
                                      updateSection('writing', { tasks: newTasks });
                                    }}
                                    className="w-10 bg-transparent border-none p-0 focus:ring-0 text-sm font-bold text-gray-700"
                                  />
                                  <span className="text-[9px] text-gray-400 font-bold">min /</span>
                                  <input 
                                    type="number" 
                                    value={task.minWords}
                                    onChange={(e) => {
                                      const newTasks = [...('tasks' in section ? section.tasks : [])];
                                      newTasks[idx] = { ...task, minWords: parseInt(e.target.value) };
                                      updateSection('writing', { tasks: newTasks });
                                    }}
                                    className="w-10 bg-transparent border-none p-0 focus:ring-0 text-sm font-bold text-gray-700"
                                  />
                                  <span className="text-[9px] text-gray-400 font-bold">w</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {m === 'speaking' && (
                          <div className="grid grid-cols-1 gap-2 mt-4 pt-4 border-t border-gray-50">
                            {'parts' in section && section.parts.map((part: SpeakingPartConfig, idx: number) => (
                              <div key={part.id} className="flex justify-between items-center">
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{part.label}</p>
                                <div className="flex items-center gap-2">
                                  {part.prepTime > 0 && (
                                    <>
                                      <input 
                                        type="number" 
                                        value={part.prepTime}
                                        onChange={(e) => {
                                          const newParts = [...('parts' in section ? section.parts : [])];
                                          newParts[idx] = { ...part, prepTime: parseInt(e.target.value) };
                                          updateSection('speaking', { parts: newParts });
                                        }}
                                        className="w-8 bg-transparent border-none p-0 focus:ring-0 text-xs font-bold text-gray-700 text-right"
                                      />
                                      <span className="text-[9px] text-gray-400 font-bold">s prep /</span>
                                    </>
                                  )}
                                  <input 
                                    type="number" 
                                    value={part.speakingTime}
                                    onChange={(e) => {
                                      const newParts = [...('parts' in section ? section.parts : [])];
                                      newParts[idx] = { ...part, speakingTime: parseInt(e.target.value) };
                                      updateSection('speaking', { parts: newParts });
                                    }}
                                    className="w-8 bg-transparent border-none p-0 focus:ring-0 text-xs font-bold text-gray-700 text-right"
                                  />
                                  <span className="text-[9px] text-gray-400 font-bold">s speak</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <section className="pt-8 border-t border-gray-100">
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-6">Default Progression Rules</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 cursor-pointer hover:bg-white hover:shadow-md transition-all group">
                      <div>
                        <p className="text-sm font-bold text-gray-900">Auto-advance on time up</p>
                        <p className="text-[10px] text-gray-500 font-medium mt-0.5">Server automatically advances the cohort when a section timer reaches 0</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={config.progression.autoSubmit}
                        onChange={(e) => updateConfig('progression', { autoSubmit: e.target.checked })}
                        className="w-5 h-5 rounded-lg border-gray-300 text-blue-600 focus:ring-blue-500" 
                      />
                    </label>
                    <label className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 cursor-pointer hover:bg-white hover:shadow-md transition-all">
                      <div>
                        <p className="text-sm font-bold text-gray-900">Lock After Submission</p>
                        <p className="text-[10px] text-gray-500 font-medium mt-0.5">Prevent students from going back</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={config.progression.lockAfterSubmit}
                        onChange={(e) => updateConfig('progression', { lockAfterSubmit: e.target.checked })}
                        className="w-5 h-5 rounded-lg border-gray-300 text-blue-600 focus:ring-blue-500" 
                      />
                    </label>
                    <label className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 cursor-pointer hover:bg-white hover:shadow-md transition-all">
                      <div>
                        <p className="text-sm font-bold text-gray-900">Proctoring Warnings</p>
                        <p className="text-[10px] text-gray-500 font-medium mt-0.5">Display violation alerts to candidates</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={config.progression.showWarnings}
                        onChange={(e) => updateConfig('progression', { showWarnings: e.target.checked })}
                        className="w-5 h-5 rounded-lg border-gray-300 text-blue-600 focus:ring-blue-500" 
                      />
                    </label>
                    {config.progression.showWarnings && (
                      <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-blue-100 shadow-sm">
                        <div>
                          <p className="text-sm font-bold text-blue-900">Warning Threshold</p>
                          <p className="text-[10px] text-blue-700/60 font-medium mt-0.5">Max warnings before termination</p>
                        </div>
                        <input 
                          type="number" 
                          value={config.progression.warningThreshold}
                          onChange={(e) => updateConfig('progression', { warningThreshold: parseInt(e.target.value) })}
                          className="w-12 px-2 py-1 bg-blue-50 border border-blue-100 rounded-lg font-bold text-sm text-center outline-none"
                        />
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
                <Shield size={20} className="text-blue-600" />
                <h2 className="text-lg font-bold text-gray-900">Security & Proctoring Defaults</h2>
              </div>
              <div className="p-6 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-6 bg-amber-50 rounded-3xl border border-amber-100">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="text-sm font-bold text-amber-900">Mandatory Fullscreen</p>
                        <p className="text-xs text-amber-700/70 mt-1 leading-relaxed">Browser will lock to the exam tab</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={config.security.requireFullscreen}
                        onChange={(e) => updateConfig('security', { requireFullscreen: e.target.checked })}
                        className="w-5 h-5 rounded-lg border-amber-300 text-amber-600 focus:ring-amber-500" 
                      />
                    </div>
                  </div>
                  <div className="p-6 bg-red-50 rounded-3xl border border-red-100">
                    <div>
                      <p className="text-sm font-bold text-red-900 mb-3">Tab Switch Rule</p>
                      <select 
                        value={config.security.tabSwitchRule}
                        onChange={(e) => updateConfig('security', { tabSwitchRule: e.target.value as 'none' | 'warn' | 'terminate' })}
                        className="w-full px-3 py-2 bg-white border border-red-200 rounded-xl text-sm font-bold text-red-900 focus:ring-2 focus:ring-red-200 outline-none"
                      >
                        <option value="none">Allow Switches</option>
                        <option value="warn">Warn (3 Threshold)</option>
                        <option value="terminate">Immediate Terminate</option>
                      </select>
                    </div>
                  </div>
                </div>

                <section className="pt-4">
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-6">Device Access Requirements</h4>
                  <div className="space-y-3">
                    {[
                      { key: 'webcam', label: 'Webcam Monitoring', icon: Info },
                      { key: 'audio', label: 'Continuous Audio Recording', icon: Info },
                      { key: 'screen', label: 'Remote Screen Monitoring', icon: Info },
                    ].map((flag) => (
                      <div key={flag.key} className="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md transition-all">
                        <span className="text-sm font-bold text-gray-700">{flag.label}</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={config.security.proctoringFlags[flag.key as keyof typeof config.security.proctoringFlags] || false}
                            onChange={(e) => {
                              const newFlags = { ...config.security.proctoringFlags, [flag.key]: e.target.checked };
                              updateConfig('security', { proctoringFlags: newFlags });
                            }}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
