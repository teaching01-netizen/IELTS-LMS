import React, { useMemo, useRef, useState } from 'react';
import { SlidersHorizontal, Clock, BarChart3, AlertCircle, FileText, Upload, RotateCcw } from 'lucide-react';
import type { ExamConfig } from '../../../types';
import {
  DEFAULT_LISTENING_BAND_TABLE,
  DEFAULT_READING_ACADEMIC_BAND_TABLE,
  DEFAULT_READING_GT_BAND_TABLE,
} from '../../../constants/examDefaults';
import { BandScoreMatrix } from '../../../components/scoring/BandScoreMatrix';
import { isRubricDeviationHigh } from '../../../utils/builderEnhancements';
import {
  validateBandScoreTable,
  validateRubricWeights,
  validateWordCountRanges,
} from '../../../utils/validationHelpers';

interface StandardsTabProps {
  config: ExamConfig;
  onChange: (config: ExamConfig) => void;
}

export function StandardsTab({ config, onChange }: StandardsTabProps) {
  const [bandTableImportError, setBandTableImportError] = useState('');
  const bandTableImportRef = useRef<HTMLInputElement>(null);

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

  const updateStandards = (value: Partial<ExamConfig['standards']>) => {
    onChange({
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
  ): void => {
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

  return (
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
  );
}
