import React, { useEffect, useMemo } from 'react';
import type { CriterionBandScore, RubricDefinition } from '../../types';
import {
  calculateWeightedBandScore,
  isRubricDeviationHigh,
} from '../../utils/builderEnhancements';
import { DEFAULT_RUBRIC_DEVIATION_THRESHOLD } from '../../constants/examDefaults';

interface GradingRubricPanelProps {
  assessment: CriterionBandScore[];
  deviationThreshold?: number;
  editableWeights?: boolean;
  enableScoring?: boolean;
  onAssessmentChange: (assessment: CriterionBandScore[]) => void;
  onRubricChange?: (rubric: RubricDefinition) => void;
  rubric: RubricDefinition;
  title?: string;
}

const bandOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function GradingRubricPanel({
  assessment,
  deviationThreshold = DEFAULT_RUBRIC_DEVIATION_THRESHOLD,
  editableWeights = false,
  enableScoring = false,
  onAssessmentChange,
  onRubricChange,
  rubric,
  title,
}: GradingRubricPanelProps) {
  useEffect(() => {
    if (assessment.length > 0) {
      return;
    }

    onAssessmentChange(
      rubric.criteria.map((criterion) => ({
        criterionId: criterion.id,
        band: 0,
        comment: '',
      })),
    );
  }, [assessment.length, onAssessmentChange, rubric.criteria]);

  const assessmentMap = useMemo(
    () =>
      new Map(
        assessment.map((item) => [
          item.criterionId,
          item,
        ]),
      ),
    [assessment],
  );

  const finalBand = calculateWeightedBandScore(
    rubric.criteria.map((criterion) => ({
      band: assessmentMap.get(criterion.id)?.band ?? 0,
      weight: criterion.weight,
    })),
  );
  const deviationWarning = isRubricDeviationHigh(rubric.criteria, deviationThreshold);

  return (
    <div className="rounded-[28px] border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-6 py-5">
        <p className="text-sm font-black text-gray-900 uppercase tracking-[0.2em]">
          {title ?? rubric.title}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {enableScoring ? 'Score each criterion, then submit the final band.' : 'Adjust rubric weights and descriptions.'}
        </p>
      </div>

      {deviationWarning && (
        <div className="border-b border-amber-100 bg-amber-50 px-6 py-3 text-sm text-amber-800">
          Weighting differs by more than {deviationThreshold} points from official IELTS weighting.
        </div>
      )}

      <div className="space-y-4 px-6 py-5">
        {rubric.criteria.map((criterion) => {
          const criterionAssessment = assessmentMap.get(criterion.id);

          return (
            <div
              key={criterion.id}
              className="rounded-3xl border border-gray-100 bg-gray-50 px-4 py-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{criterion.label}</p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    {criterion.description}
                  </p>
                </div>
                {editableWeights && onRubricChange ? (
                  <input
                    type="number"
                    value={criterion.weight}
                    onChange={(event) =>
                      onRubricChange({
                        ...rubric,
                        criteria: rubric.criteria.map((item) =>
                          item.id === criterion.id
                            ? { ...item, weight: Number(event.target.value) }
                            : item,
                        ),
                      })
                    }
                    className="w-20 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                ) : (
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-gray-500 border border-gray-200">
                    {criterion.weight}%
                  </span>
                )}
              </div>

              {enableScoring && (
                <div className="mt-4 grid gap-3">
                  <div className="grid gap-3 md:grid-cols-[150px_1fr]">
                    <select
                      value={criterionAssessment?.band ?? 0}
                      onChange={(event) =>
                        onAssessmentChange(
                          rubric.criteria.map((item) => {
                            const current = assessmentMap.get(item.id) ?? {
                              criterionId: item.id,
                              band: 0,
                              comment: '',
                            };

                            return item.id === criterion.id
                              ? { ...current, band: Number(event.target.value) }
                              : current;
                          }),
                        )
                      }
                      className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500"
                    >
                      <option value={0}>Select band</option>
                      {bandOptions.map((band) => (
                        <option key={band} value={band}>
                          Band {band}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={criterionAssessment?.comment ?? ''}
                      onChange={(event) =>
                        onAssessmentChange(
                          rubric.criteria.map((item) => {
                            const current = assessmentMap.get(item.id) ?? {
                              criterionId: item.id,
                              band: 0,
                              comment: '',
                            };

                            return item.id === criterion.id
                              ? { ...current, comment: event.target.value }
                              : current;
                          }),
                        )
                      }
                      placeholder="Criterion comments"
                      className="min-h-24 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 resize-none"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {enableScoring && (
        <div className="border-t border-gray-100 px-6 py-4 bg-gray-50 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-600">Auto-calculated final band</span>
          <span className="text-2xl font-black text-gray-900">{finalBand.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}
