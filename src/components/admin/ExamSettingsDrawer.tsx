/**
 * @deprecated This component has been replaced by the new exam flow redesign.
 * Configuration is now handled by ExamConfigRoute and publish logic by ExamReviewRoute.
 * This file is kept for backward compatibility during the migration period.
 */
import React, { useMemo, useRef, useState, memo } from 'react';
import { X, Settings, Layers, Clock, Shield, BarChart3, Info, GripVertical, CheckCircle2, GitCompare, RotateCcw, Upload, FileText, Eye, AlertCircle, Calendar, Lock, Unlock, Save, SlidersHorizontal, Plus, Trash2 } from 'lucide-react';
import { ExamConfig, ModuleType, QuestionType, WritingTaskConfig, SpeakingPartConfig } from '../../types';
import {
  ALL_QUESTION_TYPES,
  DEFAULT_LISTENING_BAND_TABLE,
  DEFAULT_READING_ACADEMIC_BAND_TABLE,
  DEFAULT_READING_GT_BAND_TABLE,
  syncConfigWithStandards,
} from '../../constants/examDefaults';
import { ExamEntity, ExamVersion, PublishReadiness } from '../../types/domain';
import { examDeliveryService } from '../../services/examDeliveryService';
import { BandScoreMatrix } from '../scoring/BandScoreMatrix';
import { isRubricDeviationHigh } from '../../utils/builderEnhancements';
import {
  validateBandScoreTable,
  validateRubricWeights,
  validateWordCountRanges,
} from '../../utils/validationHelpers';

interface ExamSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  config: ExamConfig;
  onChange: (config: ExamConfig) => void;
  exam?: ExamEntity | undefined;
  versions?: ExamVersion[] | undefined;
  publishReadiness?: PublishReadiness | undefined;
  onRestoreVersion?: ((versionId: string) => void) | undefined;
  onRepublishVersion?: ((versionId: string) => void) | undefined;
  onSaveDraft?: (() => void) | undefined;
  onPublish?: ((notes?: string) => void) | undefined;
  onSchedulePublish?: ((scheduledTime: string, notes?: string) => void) | undefined;
  onUnpublish?: ((reason?: string) => void) | undefined;
  onArchive?: (() => void) | undefined;
}

function ExamSettingsDrawerComponent({ 
  isOpen, 
  onClose, 
  config, 
  onChange, 
  exam, 
  versions, 
  publishReadiness,
  onRestoreVersion, 
  onRepublishVersion, 
  onSaveDraft, 
  onPublish,
  onSchedulePublish,
  onUnpublish,
  onArchive
}: ExamSettingsDrawerProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'sections' | 'standards' | 'timing' | 'scoring' | 'security' | 'publish'>('general');
  const [publishNotes, setPublishNotes] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [bandTableImportError, setBandTableImportError] = useState('');
  const bandTableImportRef = useRef<HTMLInputElement>(null);
  const sectionPlan = useMemo(() => examDeliveryService.buildSectionPlan(config), [config]);
  const standardsValidation = useMemo(() => ({
    passageWordCount: validateWordCountRanges(config.standards.passageWordCount),
    rubricWeights: {
      writing: validateRubricWeights(config.standards.rubricWeights.writing),
      speaking: validateRubricWeights(config.standards.rubricWeights.speaking),
    },
    bandScoreTables: {
      listening: validateBandScoreTable(config.standards.bandScoreTables.listening),
      readingAcademic: validateBandScoreTable(config.standards.bandScoreTables.readingAcademic),
      readingGeneralTraining: validateBandScoreTable(config.standards.bandScoreTables.readingGeneralTraining),
    },
  }), [config.standards]);
  const writingDeviationWarning = useMemo(
    () =>
      isRubricDeviationHigh(
        [
          { weight: config.standards.rubricWeights.writing.taskResponse, officialWeight: 25 },
          { weight: config.standards.rubricWeights.writing.coherence, officialWeight: 25 },
          { weight: config.standards.rubricWeights.writing.lexical, officialWeight: 25 },
          { weight: config.standards.rubricWeights.writing.grammar, officialWeight: 25 },
        ],
        config.standards.rubricDeviationThreshold,
      ),
    [config.standards.rubricDeviationThreshold, config.standards.rubricWeights.writing],
  );
  const speakingDeviationWarning = useMemo(
    () =>
      isRubricDeviationHigh(
        [
          { weight: config.standards.rubricWeights.speaking.fluency, officialWeight: 25 },
          { weight: config.standards.rubricWeights.speaking.lexical, officialWeight: 25 },
          { weight: config.standards.rubricWeights.speaking.grammar, officialWeight: 25 },
          { weight: config.standards.rubricWeights.speaking.pronunciation, officialWeight: 25 },
        ],
        config.standards.rubricDeviationThreshold,
      ),
    [config.standards.rubricDeviationThreshold, config.standards.rubricWeights.speaking],
  );

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
  const blockingPublishErrors = publishReadiness?.errors.filter((error) => error.severity === 'error') ?? [];
  const canScheduleRelease = Boolean(onSchedulePublish && exam?.status !== 'published' && exam?.status !== 'archived');
  const canShowReleaseActions = exam?.status === 'draft' || exam?.status === 'in_review' || exam?.status === 'approved' || exam?.status === 'rejected';
  const releaseDecisionTitle = exam?.status === 'published'
    ? 'Manage live release'
    : publishReadiness?.canPublish
      ? 'Ready to release'
      : 'Resolve publish blockers';
  const releaseDecisionSummary = exam?.status === 'published'
    ? 'This exam is live. You can unpublish it, keep an audit note, or archive it when it is no longer needed.'
    : publishReadiness?.canPublish
      ? 'Everything required for release is in place. Publish now or schedule a release for later.'
      : `Fix ${blockingPublishErrors.length} blocking issue${blockingPublishErrors.length === 1 ? '' : 's'} before publishing.`;
  const releasePrimaryLabel = exam?.status === 'published'
    ? 'Currently Published'
    : showSchedule && scheduledTime
      ? `Scheduled for ${new Date(scheduledTime).toLocaleDateString()}`
      : 'Publish Now';

  if (!isOpen) return null;

  const commitConfig = (nextConfig: ExamConfig) => {
    onChange(syncConfigWithStandards(nextConfig));
  };

  const updateConfig = (section: keyof ExamConfig, value: Partial<ExamConfig[keyof ExamConfig]>) => {
    commitConfig({
      ...config,
      [section]: {
        ...config[section],
        ...value
      }
    });
  };

  const updateSection = (module: ModuleType, value: Partial<ExamConfig['sections'][ModuleType]>) => {
    commitConfig({
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

  const updateStandards = (value: Partial<ExamConfig['standards']>) => {
    commitConfig({
      ...config,
      standards: {
        ...config.standards,
        ...value,
      },
    });
  };

  const updatePassageWordCount = (
    field: keyof ExamConfig['standards']['passageWordCount'],
    nextValue: number,
  ) => {
    updateStandards({
      passageWordCount: {
        ...config.standards.passageWordCount,
        [field]: nextValue,
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
    commitConfig({
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

    commitConfig({
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

  const updateRubricWeights = (
    module: 'writing' | 'speaking',
    key: string,
    nextValue: number,
  ) => {
    updateStandards({
      rubricWeights: {
        ...config.standards.rubricWeights,
        [module]: {
          ...config.standards.rubricWeights[module],
          [key]: nextValue,
        },
      },
    });
  };

  const updateBandScoreTable = (
    tableKey: keyof ExamConfig['standards']['bandScoreTables'],
    table: Record<number, number>,
  ) => {
    updateStandards({
      bandScoreTables: {
        ...config.standards.bandScoreTables,
        [tableKey]: table,
      },
    });
  };

  const resetBandScoreTables = () => {
    setBandTableImportError('');
    updateStandards({
      bandScoreTables: {
        listening: { ...DEFAULT_LISTENING_BAND_TABLE },
        readingAcademic: { ...DEFAULT_READING_ACADEMIC_BAND_TABLE },
        readingGeneralTraining: { ...DEFAULT_READING_GT_BAND_TABLE },
      },
    });
  };

  const exportBandTables = () => {
    const blob = new Blob([JSON.stringify(config.standards.bandScoreTables, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(config.general.title || 'exam').trim().toLowerCase().replace(/\s+/g, '-') || 'exam'}-band-tables.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleBandTableImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as Partial<ExamConfig['standards']['bandScoreTables']>;
      const nextTables = {
        listening: parsed.listening ?? {},
        readingAcademic: parsed.readingAcademic ?? {},
        readingGeneralTraining: parsed.readingGeneralTraining ?? {},
      };
      const errors = [
        ...validateBandScoreTable(nextTables.listening),
        ...validateBandScoreTable(nextTables.readingAcademic),
        ...validateBandScoreTable(nextTables.readingGeneralTraining),
      ];

      if (errors.length > 0) {
        setBandTableImportError(errors[0] ?? 'Invalid band table JSON file.');
        return;
      }

      setBandTableImportError('');
      updateStandards({ bandScoreTables: nextTables });
    } catch {
      setBandTableImportError('Invalid band table JSON file.');
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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="h-16 px-6 border-b border-gray-100 flex items-center justify-between bg-gray-50 flex-shrink-0">
          <div className="flex items-center gap-2 text-gray-900 font-bold text-lg">
            <Settings size={20} className="text-blue-600" />
            <span>Exam Settings</span>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all">
            <X size={20} />
          </button>
        </div>

        <div className="flex border-b border-gray-100 bg-white flex-shrink-0">
          {[
            { id: 'general', label: 'General', icon: Info },
            { id: 'sections', label: 'Sections', icon: Layers },
            { id: 'standards', label: 'Standards', icon: SlidersHorizontal },
            { id: 'timing', label: 'Timing', icon: Clock },
            { id: 'scoring', label: 'Scoring', icon: BarChart3 },
            { id: 'security', label: 'Security', icon: Shield },
            { id: 'publish', label: 'Publish', icon: Upload },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex-1 flex flex-col items-center py-3 gap-1 border-b-2 transition-all ${
                  isActive 
                    ? 'border-blue-600 text-blue-700 bg-blue-50/30 font-bold' 
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Icon size={18} />
                <span className="text-xs uppercase tracking-wider">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-gray-50/30">
          {activeTab === 'general' && (
            <div className="space-y-6">
              <section className="space-y-4">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <Info size={16} className="text-blue-500" /> Basic Information
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Preset</label>
                      <input 
                        type="text" 
                        value={config.general.preset} 
                        readOnly
                        className="w-full px-3 py-2 bg-gray-100 border border-gray-200 rounded text-sm text-gray-500 cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Standard Type</label>
                      <select 
                        value={config.general.type}
                        onChange={(e) => updateConfig('general', { type: e.target.value as 'Academic' | 'General Training' })}
                        className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <option value="Academic">Academic</option>
                        <option value="General Training">General Training</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Exam Title</label>
                    <input 
                      type="text" 
                      value={config.general.title}
                      onChange={(e) => updateConfig('general', { title: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                      placeholder="e.g. Academic Practice Test 5"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Exam Summary</label>
                    <textarea 
                      value={config.general.summary}
                      onChange={(e) => updateConfig('general', { summary: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      rows={3}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Candidate Instructions</label>
                    <textarea 
                      value={config.general.instructions}
                      onChange={(e) => updateConfig('general', { instructions: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none h-40"
                    />
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'sections' && (
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
                                      Turn off to disable the audio player for candidates (useful for test-day issues or accommodations).
                                    </p>
                                  </div>
                                  <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                                    <input
                                      type="checkbox"
                                      checked={(config.sections.listening.audioPlaybackEnabled ?? true) === true}
                                      onChange={(e) => updateSection('listening', { audioPlaybackEnabled: e.target.checked })}
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
                                    onChange={(e) => updateSection('listening', { staffInstructions: e.target.value })}
                                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                                    rows={4}
                                    placeholder="Optional message shown to candidates during the Listening section (e.g., 'Audio will be played by the invigilator. Do not use the on-screen controls.')"
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
          )}

          {activeTab === 'standards' && (
            <div className="space-y-6">
              <section className="space-y-4">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <SlidersHorizontal size={16} className="text-blue-500" /> Passage Word Count Validation
                </h3>

                {standardsValidation.passageWordCount.length > 0 && (
                  <div className="rounded-xl border border-red-100 bg-red-50 p-4 space-y-2">
                    {standardsValidation.passageWordCount.map((error) => (
                      <div key={error} className="flex items-start gap-2 text-sm text-red-800">
                        <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {[
                    ['optimalMin', 'Optimal Min'],
                    ['optimalMax', 'Optimal Max'],
                    ['warningMin', 'Warning Min'],
                    ['warningMax', 'Warning Max'],
                  ].map(([field, label]) => (
                    <div key={field} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                        {label}
                      </label>
                      <input
                        type="number"
                        aria-label={label}
                        value={config.standards.passageWordCount[field as keyof ExamConfig['standards']['passageWordCount']]}
                        onChange={(e) =>
                          updatePassageWordCount(
                            field as keyof ExamConfig['standards']['passageWordCount'],
                            parseInt(e.target.value),
                          )
                        }
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    <span>Color Preview</span>
                    <span>{config.standards.passageWordCount.warningMin}-{config.standards.passageWordCount.warningMax} words</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-4 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-red-600">Critical</p>
                      <p className="mt-1 text-xs text-red-700">
                        &lt; {config.standards.passageWordCount.warningMin} or &gt; {config.standards.passageWordCount.warningMax}
                      </p>
                    </div>
                    <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-4 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Warning</p>
                      <p className="mt-1 text-xs text-amber-800">
                        {config.standards.passageWordCount.warningMin}-{config.standards.passageWordCount.warningMax}
                      </p>
                    </div>
                    <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-4 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Optimal</p>
                      <p className="mt-1 text-xs text-emerald-800">
                        {config.standards.passageWordCount.optimalMin}-{config.standards.passageWordCount.optimalMax}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-4 pt-4 border-t border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <Clock size={16} className="text-blue-500" /> Writing Task Requirements
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  {([
                    ['task1', 'Task 1'],
                    ['task2', 'Task 2'],
                  ] as const).map(([taskKey, label]) => (
                    <div key={taskKey} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</p>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                          Minimum Words
                        </label>
                        <input
                          type="number"
                          aria-label={`${label} minimum words`}
                          value={config.standards.writingTasks[taskKey].minWords}
                          onChange={(e) => updateWritingTaskStandard(taskKey, 'minWords', parseInt(e.target.value))}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                          Recommended Time (min)
                        </label>
                        <input
                          type="number"
                          aria-label={`${label} recommended time`}
                          value={config.standards.writingTasks[taskKey].recommendedTime}
                          onChange={(e) => updateWritingTaskStandard(taskKey, 'recommendedTime', parseInt(e.target.value))}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-4 pt-4 border-t border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <BarChart3 size={16} className="text-blue-500" /> Rubric Settings
                </h3>

                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                    Deviation Threshold
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      aria-label="Rubric deviation threshold"
                      value={config.standards.rubricDeviationThreshold}
                      onChange={(e) =>
                        updateStandards({ rubricDeviationThreshold: parseInt(e.target.value) })
                      }
                      className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">points / percent</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {([
                    ['writing', 'Writing', config.standards.rubricWeights.writing, writingDeviationWarning, standardsValidation.rubricWeights.writing],
                    ['speaking', 'Speaking', config.standards.rubricWeights.speaking, speakingDeviationWarning, standardsValidation.rubricWeights.speaking],
                  ] as const).map(([module, label, weights, hasDeviation, errors]) => (
                    <div key={module} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</p>
                        {hasDeviation && (
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 border border-amber-100">
                            Above threshold
                          </span>
                        )}
                      </div>

                      {errors.length > 0 && (
                        <div className="rounded-lg border border-red-100 bg-red-50 p-3 space-y-1">
                          {errors.map((error) => (
                            <p key={error} className="text-xs text-red-700">{error}</p>
                          ))}
                        </div>
                      )}

                      {Object.entries(weights).map(([key, weight]) => (
                        <div key={key}>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 capitalize">
                            {key.replace(/([A-Z])/g, ' $1')}
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              aria-label={`${label} ${key} weight`}
                              value={weight}
                              onChange={(e) => updateRubricWeights(module, key, parseInt(e.target.value))}
                              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                            />
                            <span className="text-[10px] font-bold text-gray-400">%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                    <BarChart3 size={16} className="text-blue-500" /> Band Score Conversion Tables
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={exportBandTables}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
                    >
                      <FileText size={14} /> Export
                    </button>
                    <button
                      onClick={() => bandTableImportRef.current?.click()}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
                    >
                      <Upload size={14} /> Import
                    </button>
                    <button
                      onClick={resetBandScoreTables}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
                    >
                      <RotateCcw size={14} /> Reset to Official IELTS Standards
                    </button>
                  </div>
                </div>

                <input
                  ref={bandTableImportRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(event) => {
                    void handleBandTableImport(event);
                  }}
                />

                {bandTableImportError && (
                  <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">
                    {bandTableImportError}
                  </div>
                )}

                {Object.values(standardsValidation.bandScoreTables).some((errors) => errors.length > 0) && (
                  <div className="rounded-xl border border-red-100 bg-red-50 p-4 space-y-2">
                    {Object.entries(standardsValidation.bandScoreTables).flatMap(([tableKey, errors]) =>
                      errors.map((error) => (
                        <div key={`${tableKey}-${error}`} className="flex items-start gap-2 text-sm text-red-800">
                          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                          <span>{tableKey}: {error}</span>
                        </div>
                      )),
                    )}
                  </div>
                )}

                <div className="space-y-4">
                  <BandScoreMatrix
                    deviationThreshold={config.standards.rubricDeviationThreshold}
                    moduleLabel="Listening"
                    officialTable={DEFAULT_LISTENING_BAND_TABLE}
                    table={config.standards.bandScoreTables.listening}
                    onChange={(table) => updateBandScoreTable('listening', table)}
                  />
                  <BandScoreMatrix
                    deviationThreshold={config.standards.rubricDeviationThreshold}
                    moduleLabel="Reading Academic"
                    officialTable={DEFAULT_READING_ACADEMIC_BAND_TABLE}
                    table={config.standards.bandScoreTables.readingAcademic}
                    onChange={(table) => updateBandScoreTable('readingAcademic', table)}
                  />
                  <BandScoreMatrix
                    deviationThreshold={config.standards.rubricDeviationThreshold}
                    moduleLabel="Reading General Training"
                    officialTable={DEFAULT_READING_GT_BAND_TABLE}
                    table={config.standards.bandScoreTables.readingGeneralTraining}
                    onChange={(table) => updateBandScoreTable('readingGeneralTraining', table)}
                  />
                </div>
              </section>
            </div>
          )}

          {activeTab === 'timing' && (
            <div className="space-y-6">
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
                            {'tasks' in section && section.tasks.map((task: WritingTaskConfig, idx: number) => (
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
                            {'parts' in section && section.parts.map((part: SpeakingPartConfig, idx: number) => (
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
                    <div className="flex flex-wrap gap-2">
                      {config.delivery.allowedExtensionMinutes.map((minutes) => (
                        <span key={minutes} className="px-3 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold">
                          +{minutes} min
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-4 bg-white border border-gray-100 p-4 rounded-xl shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Auto-submit on time up</p>
                      <p className="text-[10px] text-gray-500">Automatically move to the next section or finish the exam</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={config.progression.autoSubmit}
                      onChange={(e) => updateConfig('progression', { autoSubmit: e.target.checked })}
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
          )}

          {activeTab === 'scoring' && (
            <div className="space-y-6">
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                    <BarChart3 size={16} className="text-blue-500" /> Scoring Rules
                  </h3>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-gray-500 uppercase">Rounding</label>
                    <select 
                      value={config.scoring.overallRounding}
                      onChange={(e) => updateConfig('scoring', { overallRounding: e.target.value as 'nearest-0.5' | 'floor' | 'ceil' })}
                      className="text-xs border border-gray-200 rounded px-2 py-1 outline-none font-medium bg-white"
                    >
                      <option value="nearest-0.5">Nearest 0.5 (IELTS)</option>
                      <option value="floor">Floor</option>
                      <option value="ceil">Ceil</option>
                    </select>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-start gap-3">
                    <Info size={16} className="mt-0.5 text-blue-500" />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Standards live in the Standards tab.</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Use that tab for word-count ranges, rubric weights, deviation threshold, and band score tables.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs text-gray-600">
                    <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-3">
                      <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">Writing Threshold</span>
                      <span className="mt-1 block font-semibold">
                        {config.standards.writingTasks.task1.minWords} / {config.standards.writingTasks.task2.minWords} words
                      </span>
                    </div>
                    <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-3">
                      <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">Rubric Deviation</span>
                      <span className="mt-1 block font-semibold">{config.standards.rubricDeviationThreshold}</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <section className="space-y-4">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <Shield size={16} className="text-blue-500" /> Proctoring Control
                </h3>
                <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                  <div className="p-4 border-b border-gray-50 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Require Fullscreen</p>
                      <p className="text-[10px] text-gray-500">Lock the browser window during the exam</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={config.security.requireFullscreen}
                      onChange={(e) => updateConfig('security', { requireFullscreen: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </div>
                  <div className="p-4 border-b border-gray-50 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Tab Switch Rule</p>
                      <p className="text-[10px] text-gray-500">Behavior when candidate leaves the tab</p>
                    </div>
                    <select 
                      value={config.security.tabSwitchRule}
                      onChange={(e) => updateConfig('security', { tabSwitchRule: e.target.value as 'none' | 'warn' | 'terminate' })}
                      className="text-xs border border-gray-200 rounded px-2 py-1 outline-none font-medium"
                    >
                      <option value="none">Allow Switches</option>
                      <option value="warn">Warn (3 Threshold)</option>
                      <option value="terminate">Immediate Terminate</option>
                    </select>
                  </div>
                  <div className="p-4 border-b border-gray-50 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Auto Re-enter Fullscreen</p>
                      <p className="text-[10px] text-gray-500">Automatically re-enter fullscreen on exit</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={config.security.fullscreenAutoReentry}
                      onChange={(e) => updateConfig('security', { fullscreenAutoReentry: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </div>
                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Max Fullscreen Violations</p>
                      <p className="text-[10px] text-gray-500">Terminate after this many violations</p>
                    </div>
                    <input 
                      type="number" 
                      min={1}
                      max={10}
                      value={config.security.fullscreenMaxViolations}
                      onChange={(e) => updateConfig('security', { fullscreenMaxViolations: parseInt(e.target.value) })}
                      className="w-16 px-2 py-1 border border-gray-200 rounded text-sm text-right outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-4 pt-4 border-t border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <Settings size={16} className="text-blue-500" /> Screen Detection
                </h3>
                <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                  <div className="p-4 border-b border-gray-50 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Detect Secondary Screens</p>
                      <p className="text-[10px] text-gray-500">Chrome 111+ only, requires user permission</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={config.security.detectSecondaryScreen}
                      onChange={(e) => updateConfig('security', { detectSecondaryScreen: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-4 pt-4 border-t border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <Lock size={16} className="text-blue-500" /> Input Field Protection
                </h3>
                <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                  <div className="p-4 border-b border-gray-50 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Prevent Autofill</p>
                      <p className="text-[10px] text-gray-500">Disable browser autofill on all inputs</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={config.security.preventAutofill}
                      onChange={(e) => updateConfig('security', { preventAutofill: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </div>
                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Prevent Autocorrect</p>
                      <p className="text-[10px] text-gray-500">Disable autocorrect and autocapitalize</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={config.security.preventAutocorrect}
                      onChange={(e) => updateConfig('security', { preventAutocorrect: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-4 pt-4 border-t border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <Settings size={16} className="text-blue-500" /> Device Access
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  {[
                    { key: 'webcam', label: 'Webcam Monitoring', icon: Info },
                    { key: 'audio', label: 'Continuous Audio Recording', icon: Info },
                    { key: 'screen', label: 'Remote Screen Monitoring', icon: Info },
                  ].map((flag) => (
                    <div key={flag.key} className="bg-white border border-gray-100 p-4 rounded-xl shadow-sm flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">{flag.label}</span>
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
                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'publish' && (
            <div className="space-y-6">
              {/* Release Status */}
              <section className="space-y-4">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <Upload size={16} className="text-green-500" /> Release Status
                </h3>
                <div className={`rounded-xl border p-4 shadow-sm space-y-4 ${
                  exam?.status === 'published'
                    ? 'bg-orange-50 border-orange-100'
                    : publishReadiness?.canPublish
                      ? 'bg-green-50 border-green-100'
                      : 'bg-white border-orange-200'
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-lg font-bold text-gray-900">{releaseDecisionTitle}</p>
                      <p className="text-sm text-gray-600">{releaseDecisionSummary}</p>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${
                      exam?.status === 'published'
                        ? 'bg-orange-100 text-orange-700'
                        : publishReadiness?.canPublish
                          ? 'bg-green-100 text-green-700'
                          : 'bg-orange-100 text-orange-700'
                    }`}>
                      {releasePrimaryLabel}
                    </span>
                  </div>

                  {publishReadiness && (
                    <>
                      {publishReadiness.errors.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-red-700 uppercase tracking-wider">What needs attention</p>
                          {publishReadiness.errors.map((error, idx) => (
                            <div key={idx} className="flex items-start gap-2 rounded border border-red-100 bg-red-50 p-2">
                              <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-red-600" />
                              <div>
                                <p className="text-xs font-medium text-red-900">{error.message}</p>
                                <p className="text-[10px] capitalize text-red-600">Field: {error.field}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {publishReadiness.warnings.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-orange-700 uppercase tracking-wider">Review before release</p>
                          {publishReadiness.warnings.map((warning, idx) => (
                            <div key={idx} className="flex items-start gap-2 rounded border border-orange-100 bg-orange-50 p-2">
                              <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-orange-600" />
                              <div>
                                <p className="text-xs font-medium text-orange-900">{warning.message}</p>
                                <p className="text-[10px] capitalize text-orange-600">Field: {warning.field}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className={`flex items-center gap-3 rounded-lg p-3 ${
                        publishReadiness.canPublish ? 'bg-green-100/70' : 'bg-orange-50'
                      }`}>
                        {publishReadiness.canPublish ? (
                          <CheckCircle2 size={20} className="text-green-600" />
                        ) : (
                          <AlertCircle size={20} className="text-orange-600" />
                        )}
                        <div>
                          <p className={`text-sm font-bold ${
                            publishReadiness.canPublish ? 'text-green-900' : 'text-orange-900'
                          }`}>
                            {publishReadiness.canPublish ? 'Ready to publish' : 'Needs fixes before publish'}
                          </p>
                          <p className="text-xs text-gray-600">
                            {publishReadiness.canPublish
                              ? 'All required validation checks passed.'
                              : `${blockingPublishErrors.length} blocking issue${blockingPublishErrors.length === 1 ? '' : 's'} still need attention.`}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 border-t border-gray-100 pt-3">
                        <div className="rounded-lg bg-white/80 p-3 text-center">
                          <p className="text-lg font-bold text-gray-900">{publishReadiness.questionCounts.reading}</p>
                          <p className="text-[10px] uppercase tracking-wider text-gray-500">Reading</p>
                        </div>
                        <div className="rounded-lg bg-white/80 p-3 text-center">
                          <p className="text-lg font-bold text-gray-900">{publishReadiness.questionCounts.listening}</p>
                          <p className="text-[10px] uppercase tracking-wider text-gray-500">Listening</p>
                        </div>
                        <div className="rounded-lg bg-white/80 p-3 text-center">
                          <p className="text-lg font-bold text-gray-900">{publishReadiness.questionCounts.total}</p>
                          <p className="text-[10px] uppercase tracking-wider text-gray-500">Total</p>
                        </div>
                      </div>
                    </>
                  )}

                  {canShowReleaseActions && onPublish && (
                    <button
                      onClick={() => onPublish(publishNotes)}
                      disabled={publishReadiness ? !publishReadiness.canPublish : false}
                      className={`w-full px-4 py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                        publishReadiness?.canPublish
                          ? 'bg-green-600 text-white hover:bg-green-700'
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      <Upload size={16} />
                      Publish Now
                    </button>
                  )}

                  {exam?.status === 'published' && onUnpublish && (
                    <button
                      onClick={() => {
                        const reason = prompt('Reason for unpublishing (optional):');
                        if (reason !== null) {
                          onUnpublish(reason || undefined);
                        }
                      }}
                      className="w-full px-4 py-3 bg-orange-600 text-white rounded-lg text-sm font-bold hover:bg-orange-700 transition-all flex items-center justify-center gap-2"
                    >
                      <Upload size={16} />
                      Unpublish
                    </button>
                  )}
                </div>
              </section>

              {/* Schedule Controls & Publish Notes */}
              {((canScheduleRelease || onPublish || onSchedulePublish)) && (
                <section className="space-y-4">
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                    <Calendar size={16} className="text-blue-500" /> Schedule & Notes
                  </h3>
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                    {canScheduleRelease && (
                      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showSchedule}
                            onChange={(e) => setShowSchedule(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium text-gray-700">Schedule for later</span>
                        </label>
                        {showSchedule && (
                          <div className="mt-4 space-y-3">
                            <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                                Scheduled Date & Time
                              </label>
                              <input
                                type="datetime-local"
                                value={scheduledTime}
                                onChange={(e) => setScheduledTime(e.target.value)}
                                min={new Date().toISOString().slice(0, 16)}
                                className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>
                            {onSchedulePublish && scheduledTime && (
                              <button
                                onClick={() => {
                                  onSchedulePublish(scheduledTime, publishNotes);
                                  setShowSchedule(false);
                                  setScheduledTime('');
                                }}
                                disabled={publishReadiness ? !publishReadiness.canPublish : false}
                                className={`w-full px-4 py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                                  publishReadiness?.canPublish
                                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                }`}
                              >
                                <Calendar size={16} />
                                Schedule Release
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {(onPublish || onSchedulePublish) && (
                      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <textarea
                          value={publishNotes}
                          onChange={(e) => setPublishNotes(e.target.value)}
                          placeholder="Add notes about this publish (e.g., 'Fixed reading passage 2', 'Updated band table')..."
                          className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                          rows={canScheduleRelease ? 5 : 3}
                        />
                        <p className="text-[10px] text-gray-400 mt-2">Optional: Notes will be saved with the published version for audit trail.</p>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Reference Details */}
              {exam && (
                <section className="space-y-4">
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                    <FileText size={16} className="text-blue-500" /> Reference Details
                  </h3>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-500">Status</span>
                        <span className={`text-sm font-bold capitalize ${
                          exam.status === 'published' ? 'text-green-600' :
                          exam.status === 'draft' ? 'text-blue-600' :
                          exam.status === 'archived' ? 'text-gray-500' :
                          'text-orange-600'
                        }`}>{exam.status.replace('_', ' ')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-500">Visibility</span>
                        <span className="text-sm font-bold text-gray-900 capitalize">{exam.visibility}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-500">Owner</span>
                        <span className="text-sm font-bold text-gray-900">{exam.owner}</span>
                      </div>
                      {exam.publishedAt && (
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-500">Last Published</span>
                          <span className="text-sm font-bold text-gray-900">{new Date(exam.publishedAt).toLocaleDateString()} at {new Date(exam.publishedAt).toLocaleTimeString()}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-500">Created</span>
                        <span className="text-sm font-bold text-gray-900">{new Date(exam.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {exam.canEdit ? <Unlock size={14} className="text-green-600" /> : <Lock size={14} className="text-gray-400" />}
                          <span className="text-sm text-gray-700">Can Edit</span>
                        </div>
                        <span className={`text-xs font-bold px-2 py-1 rounded ${exam.canEdit ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {exam.canEdit ? 'Yes' : 'No'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {exam.canPublish ? <Unlock size={14} className="text-green-600" /> : <Lock size={14} className="text-gray-400" />}
                          <span className="text-sm text-gray-700">Can Publish</span>
                        </div>
                        <span className={`text-xs font-bold px-2 py-1 rounded ${exam.canPublish ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {exam.canPublish ? 'Yes' : 'No'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {exam.canDelete ? <Unlock size={14} className="text-green-600" /> : <Lock size={14} className="text-gray-400" />}
                          <span className="text-sm text-gray-700">Can Delete</span>
                        </div>
                        <span className={`text-xs font-bold px-2 py-1 rounded ${exam.canDelete ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {exam.canDelete ? 'Yes' : 'No'}
                        </span>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Version History */}
              {versions && versions.length > 0 && (
                <section className="space-y-4">
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                    <GitCompare size={16} className="text-blue-500" /> Version History
                  </h3>
                  <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm max-h-64 overflow-y-auto">
                    {versions.slice().reverse().map((version) => (
                      <div key={version.id} className="p-4 border-b border-gray-50 last:border-0">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-900">v{version.versionNumber}</span>
                            {version.isPublished && (
                              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded">Published</span>
                            )}
                            {version.isDraft && (
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded">Draft</span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {onRestoreVersion && version.isDraft && (
                              <button
                                onClick={() => onRestoreVersion(version.id)}
                                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-all"
                                title="Restore as draft"
                              >
                                <RotateCcw size={14} />
                              </button>
                            )}
                            {onRepublishVersion && version.isPublished && (
                              <button
                                onClick={() => onRepublishVersion(version.id)}
                                className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded transition-all"
                                title="Republish version"
                              >
                                <Upload size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-gray-500 space-y-1">
                          <div className="flex items-center gap-2">
                            <span>Created by {version.createdBy}</span>
                            <span>•</span>
                            <span>{new Date(version.createdAt).toLocaleString()}</span>
                          </div>
                          {version.publishNotes && (
                            <div className="italic text-gray-400">"{version.publishNotes}"</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Editorial Actions - Save Draft */}
              <section className="space-y-4 pt-4 border-t border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <Save size={16} className="text-blue-500" /> Editorial Actions
                </h3>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                  <p className="text-xs text-blue-800 mb-3">Save your work without publishing. Creates a new draft version.</p>
                  {onSaveDraft && (
                    <button
                      onClick={() => {
                        onSaveDraft();
                      }}
                      className="w-full px-4 py-3 bg-white border border-blue-200 rounded-lg text-sm font-medium text-blue-700 hover:bg-blue-50 hover:border-blue-300 transition-all flex items-center justify-center gap-2"
                    >
                      <Save size={16} />
                      Save Draft
                    </button>
                  )}
                </div>
              </section>

              {/* Maintenance Actions */}
              <section className="space-y-4">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <Clock size={16} className="text-gray-500" /> Maintenance Actions
                </h3>
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-gray-600">Use these lower-frequency actions after the release decision is handled.</p>
                  {onArchive && exam?.status !== 'scheduled' && (
                    <button
                      onClick={() => {
                        if (confirm('Are you sure you want to archive this exam? It will no longer be visible in the library.')) {
                          onArchive();
                        }
                      }}
                      className="w-full px-4 py-3 bg-gray-600 text-white rounded-lg text-sm font-bold hover:bg-gray-700 transition-all flex items-center justify-center gap-2"
                    >
                      <Eye size={16} />
                      Archive Exam
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="h-20 px-6 border-t border-gray-100 flex items-center justify-between bg-white flex-shrink-0">
          <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
            <CheckCircle2 size={14} />
            <span>Config Validated</span>
          </div>
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-md shadow-blue-200 transition-all"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Export memoized version
export const ExamSettingsDrawer = memo(ExamSettingsDrawerComponent);
