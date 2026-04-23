import React, { useMemo } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, FileText, Hash } from 'lucide-react';
import type { ExamState } from '../../types';
import type { SectionSubmission } from '../../types/grading';
import {
  buildQuestionTracebackGroups,
  type ObjectiveTracebackGroup,
} from './gradingReviewUtils';

interface QuestionTracebackPanelProps {
  section: 'reading' | 'listening';
  examState: ExamState | null;
  sectionSubmission: SectionSubmission | null;
  examLoading: boolean;
  examError: string | null;
}

function QuestionStatusBadge({ correctness }: { correctness: boolean | null }) {
  if (correctness === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
        Not scored
      </span>
    );
  }

  return correctness ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
      <CheckCircle2 size={12} />
      Correct
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
      <AlertTriangle size={12} />
      Incorrect
    </span>
  );
}

function renderGroup(group: ObjectiveTracebackGroup, index: number) {
  return (
    <section key={group.groupId} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
            <BookOpen size={18} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400">
              Traceback Group {index + 1}
            </p>
            <h3 className="text-base font-semibold text-gray-900">{group.groupLabel}</h3>
          </div>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
          {group.items.length} question{group.items.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid gap-4 px-5 py-5">
        {group.items.map((item) => (
          <article
            key={item.questionId}
            className={`rounded-2xl border px-4 py-4 shadow-sm ${
              item.correctness === true
                ? 'border-emerald-200 bg-emerald-50/40'
                : item.correctness === false
                  ? 'border-rose-200 bg-rose-50/30'
                  : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
                  <Hash size={12} />
                  {item.numberLabel || item.questionId}
                </div>
                <h4 className="text-sm font-semibold text-gray-900">
                  {item.prompt || 'Question prompt unavailable'}
                </h4>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <QuestionStatusBadge correctness={item.correctness} />
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                  Score {item.awardedScore ?? '—'} / {item.maxScore ?? '—'}
                </span>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
                  Student answer
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">
                  {item.studentAnswer || '—'}
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
                  Correct answer
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">
                  {item.correctAnswer || '—'}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function QuestionTracebackPanel({
  section,
  examState,
  sectionSubmission,
  examLoading,
  examError,
}: QuestionTracebackPanelProps) {
  const groups = useMemo(
    () => buildQuestionTracebackGroups(examState, sectionSubmission, section),
    [examState, section, sectionSubmission],
  );

  const objectiveAnswerMap = sectionSubmission ? sectionSubmission.answers : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-blue-600" />
          <div>
            <h3 className="font-bold text-gray-900">Traceback View</h3>
            <p className="text-xs text-gray-500 capitalize">
              {section} section answer replay
            </p>
          </div>
        </div>
        {examLoading ? <span className="text-xs font-medium text-gray-500">Loading exam...</span> : null}
      </div>

      {examError ? (
        <div className="px-6 py-5 border-b border-gray-200 bg-red-50 text-sm text-red-800">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 text-red-700" />
            <div>
              <p className="font-medium">Could not load exam content</p>
              <p className="mt-1">{examError}</p>
              <p className="mt-2 text-red-700">Showing raw answers from the submission bundle:</p>
            </div>
          </div>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-red-200 bg-white p-3 text-xs text-gray-800">
            {JSON.stringify(objectiveAnswerMap, null, 2)}
          </pre>
        </div>
      ) : null}

      {!examError && !examLoading && groups.length === 0 ? (
        <div className="px-6 py-6 text-sm text-gray-700">
          <p className="font-medium text-gray-900">No question schema available</p>
          <p className="mt-1 text-gray-600">
            The exam version loaded, but no questions were found for this section. Showing raw answers:
          </p>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
            {JSON.stringify(objectiveAnswerMap, null, 2)}
          </pre>
        </div>
      ) : null}

      {!examError && groups.length > 0 ? <div className="space-y-4 p-4 md:p-6">{groups.map(renderGroup)}</div> : null}
    </div>
  );
}
