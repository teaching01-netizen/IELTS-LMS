import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Users,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@components/ui';
import type {
  ExamObjectiveOverviewGroup,
  ExamObjectiveOverviewGroupStatus,
} from './examObjectiveOverviewUtils';

interface ExamObjectiveOverviewGroupCardProps {
  readonly group: ExamObjectiveOverviewGroup;
  readonly onStudentSelect?: ((submissionId: string) => void) | undefined;
  readonly onRequestResult: (group: ExamObjectiveOverviewGroup, isCorrect: boolean) => void;
  readonly pending: boolean;
  readonly status: ExamObjectiveOverviewGroupStatus;
}

const statusCopy: Record<ExamObjectiveOverviewGroupStatus, {
  readonly label: string;
  readonly className: string;
  readonly Icon: LucideIcon;
}> = {
  correct: {
    label: 'Correct',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    Icon: CheckCircle2,
  },
  incorrect: {
    label: 'Incorrect',
    className: 'border-rose-200 bg-rose-50 text-rose-800',
    Icon: XCircle,
  },
};

function ResultBadge({ isCorrect }: { readonly isCorrect: boolean }) {
  return isCorrect ? (
    <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
      <CheckCircle2 size={13} aria-hidden="true" /> Correct
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-sm bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-800">
      <XCircle size={13} aria-hidden="true" /> Incorrect
    </span>
  );
}

function StatusPill({ status }: { readonly status: ExamObjectiveOverviewGroupStatus }) {
  const { label, className, Icon } = statusCopy[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] font-semibold ${className}`} role="status" aria-label={label}>
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

export function ExamObjectiveOverviewGroupCard({
  group,
  onStudentSelect,
  onRequestResult,
  pending,
  status,
}: ExamObjectiveOverviewGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const studentCount = new Set(group.rows.map((row) => row.submissionId)).size;
  const questionCount = new Set(group.rows.map((row) => row.questionId)).size;
  const answerKeys = useMemo(() => [...new Set(
    group.rows.map((row) => row.correctAnswer.trim()).filter(Boolean),
  )], [group.rows]);
  const currentKeySummary = answerKeys.length === 1
    ? answerKeys[0]
    : `${answerKeys.length} current keys across ${questionCount} questions`;
  const headingId = `exam-answer-group-${group.rows[0]?.rowId ?? group.groupId}`;
  const detailsId = `${headingId}-details`;

  return (
    <section className="border-b border-gray-200 last:border-b-0" aria-labelledby={headingId}>
      <div className="px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="grid min-w-0 flex-1 gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Student answer</p>
                <StatusPill status={status} />
              </div>
              <h3 id={headingId} className="mt-2 whitespace-pre-wrap break-words font-mono text-base font-semibold text-gray-900">
                {group.studentAnswer || 'Blank answer'}
              </h3>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1"><Users size={13} aria-hidden="true" /> {studentCount} {studentCount === 1 ? 'student' : 'students'}</span>
                <span className="inline-flex items-center gap-1"><ListChecks size={13} aria-hidden="true" /> {questionCount} {questionCount === 1 ? 'question' : 'questions'}</span>
                <span>{group.rows.length} answer {group.rows.length === 1 ? 'entry' : 'entries'}</span>
              </p>
            </div>
            <div className="min-w-0 border-gray-200 md:border-l md:pl-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Current answer key</p>
              <p className="mt-2 break-words text-sm font-medium text-gray-800">{currentKeySummary || 'No answer key configured'}</p>
              <p className="mt-2 text-xs text-blue-700">
                {status === 'correct'
                  ? 'This answer is currently correct for this exam.'
                  : 'This answer is currently incorrect for this exam.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:max-w-[420px] xl:justify-end">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={pending}
              leftIcon={<CheckCircle2 size={15} aria-hidden="true" />}
              onClick={() => onRequestResult(group, true)}
            >
              Accept and add to key
            </Button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onRequestResult(group, false)}
              className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[3px] border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-800 transition-colors hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
            >
              <XCircle size={15} aria-hidden="true" /> Reject for exam
            </button>
            {pending ? <span className="text-xs text-gray-500" aria-live="polite">Saving…</span> : null}
          </div>
        </div>

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((current) => !current)}
          className="mt-4 inline-flex min-h-8 items-center gap-1.5 rounded-[3px] px-2 text-xs font-semibold text-blue-800 transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2"
        >
          {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          {expanded ? 'Hide students and questions' : `View ${studentCount} ${studentCount === 1 ? 'student' : 'students'} and ${questionCount} ${questionCount === 1 ? 'question' : 'questions'}`}
        </button>
      </div>

      {expanded ? (
        <div id={detailsId} className="border-t border-gray-200 bg-gray-50/60 px-4 py-3 sm:px-6">
          <div className="overflow-x-auto">
            <table className="min-w-[840px] w-full text-left text-sm">
              <caption className="sr-only">Students and questions for answer {group.studentAnswer || 'blank answer'}</caption>
              <thead className="text-[11px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Student</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Student answer</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Section</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Question</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Answer key</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {group.rows.map((row) => (
                  <tr key={row.rowId} className="align-top hover:bg-gray-50">
                    <td className="px-3 py-3">
                      {onStudentSelect ? (
                        <button type="button" onClick={() => onStudentSelect(row.submissionId)} className="font-semibold text-blue-800 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2">
                          {row.studentName}
                        </button>
                      ) : <span className="font-semibold text-gray-900">{row.studentName}</span>}
                    </td>
                    <td className="max-w-56 whitespace-pre-wrap break-words px-3 py-3 font-mono text-xs text-gray-700">{row.studentAnswer || '—'}</td>
                    <td className="px-3 py-3 capitalize text-gray-700">{row.section}</td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-600">{row.questionNumberLabel}</td>
                    <td className="max-w-56 whitespace-pre-wrap break-words px-3 py-3 text-gray-700">{row.correctAnswer || '—'}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <ResultBadge isCorrect={row.isCorrect} />
                        <span className="text-xs text-gray-500">{row.awardedScore} / {row.maxScore}</span>
                        {row.manualOverride ? <span className="rounded-sm bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800">Student override</span> : null}
                        {!row.manualOverride && row.hasOverride ? <span className="rounded-sm bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800">Exam key</span> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
