import React, { useMemo, useState } from 'react';
import type {
  CriterionBandScore,
  GradeHistoryEntry,
  RubricDefinition,
} from '../../types';
import { GradingRubricPanel } from './GradingRubricPanel';
import { calculateWeightedBandScore } from '../../utils/builderEnhancements';

interface GradingWorkspaceProps {
  deviationThreshold?: number;
  history: GradeHistoryEntry[];
  module: 'writing' | 'speaking';
  onSubmitGrade: (entry: GradeHistoryEntry) => void;
  rubric: RubricDefinition;
  submission: {
    text: string;
    timeSpentSeconds?: number;
    title: string;
    wordCount?: number;
  };
}

export function GradingWorkspace({
  deviationThreshold,
  history,
  module,
  onSubmitGrade,
  rubric,
  submission,
}: GradingWorkspaceProps) {
  const [assessment, setAssessment] = useState<CriterionBandScore[]>([]);

  const finalBand = useMemo(
    () =>
      calculateWeightedBandScore(
        rubric.criteria.map((criterion) => ({
          band: assessment.find((item) => item.criterionId === criterion.id)?.band ?? 0,
          weight: criterion.weight,
        })),
      ),
    [assessment, rubric.criteria],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,420px)]">
      <div className="rounded-[28px] border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-6 py-5">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-[0.2em]">
            Student Submission
          </h3>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
            <span>{submission.title}</span>
            {typeof submission.wordCount === 'number' && <span>· {submission.wordCount} words</span>}
            {typeof submission.timeSpentSeconds === 'number' && (
              <span>· {Math.floor(submission.timeSpentSeconds / 60)}m tracked</span>
            )}
          </div>
        </div>
        <div className="px-6 py-5 max-h-[560px] overflow-y-auto">
          <div className="rounded-3xl bg-gray-50 border border-gray-100 px-5 py-5 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
            {submission.text}
          </div>

          {history.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-black text-gray-400 uppercase tracking-[0.22em] mb-3">
                Grade History
              </p>
              <div className="space-y-3">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-2xl border border-gray-100 bg-white px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{entry.assessor}</p>
                        <p className="text-xs text-gray-500">{entry.createdAt}</p>
                      </div>
                      <span className="text-lg font-black text-gray-900">
                        {entry.finalBand.toFixed(1)}
                      </span>
                    </div>
                    {entry.note && <p className="text-sm text-gray-600 mt-2">{entry.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <GradingRubricPanel
          rubric={rubric}
          assessment={assessment}
          {...(deviationThreshold !== undefined ? { deviationThreshold } : {})}
          onAssessmentChange={setAssessment}
          enableScoring
          title={module === 'writing' ? 'Writing Rubric' : 'Speaking Rubric'}
        />
        <button
          onClick={() =>
            onSubmitGrade({
              id: `grade-${Date.now()}`,
              assessor: 'Builder Preview',
              createdAt: new Date().toLocaleString(),
              criteria: assessment,
              finalBand,
              note: 'Submitted from grading preview.',
            })
          }
          className="w-full rounded-2xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-black transition-colors"
        >
          Submit Grade
        </button>
      </div>
    </div>
  );
}
