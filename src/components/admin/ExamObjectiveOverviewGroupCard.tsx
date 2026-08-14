import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@components/ui';
import type { GradingScheduleObjectiveOverrideRow } from '../../types/grading';
import type {
  ExamObjectiveOverviewGroup,
  ExamObjectiveOverviewGroupStatus,
} from './examObjectiveOverviewUtils';
import { resolveGroupOverrideDecision } from './examObjectiveOverviewUtils';
import { StudentAnswerExplanation } from './StudentAnswerExplanation';
import { StudentAnswerCaseHighlight } from './StudentAnswerCaseHighlight';
import { getClosestAcceptedAnswer, getStudentAnswerComparison } from './studentAnswerComparison';

interface ExamObjectiveOverviewGroupCardProps {
  readonly group: ExamObjectiveOverviewGroup;
  readonly overrides: readonly GradingScheduleObjectiveOverrideRow[];
  readonly onStudentSelect?: ((submissionId: string) => void) | undefined;
  readonly onRequestResult: (group: ExamObjectiveOverviewGroup, isCorrect: boolean) => void;
  readonly pending: boolean;
  readonly status: ExamObjectiveOverviewGroupStatus;
}

const decisionDateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

function formatDecisionDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? decisionDateFormatter.format(date) : value;
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

function StatusPill({ status }: { readonly status: ExamObjectiveOverviewGroupStatus }) {
  const { label, className, Icon } = statusCopy[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] font-semibold ${className}`} role="status" aria-label={label}>
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

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

export function ExamObjectiveOverviewGroupCard({
  group,
  overrides,
  onStudentSelect,
  onRequestResult,
  pending,
  status,
}: ExamObjectiveOverviewGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const decision = useMemo(
    () => resolveGroupOverrideDecision(group, overrides),
    [group, overrides],
  );
  const studentCount = new Set(group.rows.map((row) => row.submissionId)).size;
  const questionCount = new Set(group.rows.map((row) => row.questionId)).size;
  const answerKeyEntries = useMemo(() => [...new Set(
    group.rows.map((row) => row.correctAnswer.trim()).filter(Boolean),
  )], [group.rows]);
  const answerKeyVariants = useMemo(() => [...new Set(
    answerKeyEntries.flatMap((entry) => entry.split('|').map((variant) => variant.trim()).filter(Boolean)),
  )], [answerKeyEntries]);
  const primaryAnswerKeys = useMemo(() => [...new Set(
    group.rows.map((row) => row.primaryCorrectAnswer.trim()).filter(Boolean),
  )], [group.rows]);
  const comparisonAnswerKey = primaryAnswerKeys.length === 1 ? primaryAnswerKeys[0] ?? '' : '';
  const closestAcceptedAnswer = comparisonAnswerKey
    ? getClosestAcceptedAnswer(group.studentAnswer, comparisonAnswerKey, answerKeyVariants)
    : '';
  const comparison = comparisonAnswerKey
    ? getStudentAnswerComparison(group.studentAnswer, comparisonAnswerKey, answerKeyVariants)
    : null;
  const otherAcceptedAnswers = answerKeyVariants.filter((variant) => variant !== closestAcceptedAnswer);
  const headingId = `exam-answer-group-${group.rows[0]?.rowId ?? group.groupId}`;
  const detailsId = `${headingId}-details`;

  return (
    <section className="border-b border-gray-200 last:border-b-0" aria-labelledby={headingId}>
      <div className="px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h3
                id={headingId}
                aria-label={group.studentAnswer || 'Blank answer'}
                className="whitespace-pre-wrap break-words font-sans text-base font-semibold text-gray-900"
              >
                <StudentAnswerCaseHighlight
                  studentAnswer={group.studentAnswer}
                  answerKey={comparison?.expectedAnswer ?? closestAcceptedAnswer}
                  answerKeyVariants={answerKeyVariants}
                />
              </h3>
              <StatusPill status={status} />
            </div>

            <div className="mt-2">
              {closestAcceptedAnswer ? (
                <>
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-500">Expected</span>
                    <span className="mx-1.5 text-gray-300" aria-hidden="true">·</span>
                    <span className="font-medium text-gray-800">{closestAcceptedAnswer}</span>
                  </p>
                  {otherAcceptedAnswers.length > 0 ? (
                    <details className="mt-1.5 text-xs text-gray-600">
                      <summary className="cursor-pointer font-semibold text-blue-800 hover:text-blue-900">
                        +{otherAcceptedAnswers.length} other accepted {otherAcceptedAnswers.length === 1 ? 'answer' : 'answers'}
                      </summary>
                      <ul className="mt-1.5 space-y-1 border-l-2 border-gray-200 pl-3">
                        {otherAcceptedAnswers.map((variant) => <li key={variant} className="break-words">{variant}</li>)}
                      </ul>
                    </details>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-gray-600">
                  <span className="font-semibold text-gray-500">Answer key</span>
                  <span className="mx-1.5 text-gray-300" aria-hidden="true">·</span>
                  <span className="font-medium text-gray-800">
                    {answerKeyEntries.length === 1 ? answerKeyEntries[0] : `${answerKeyEntries.length} current keys across ${questionCount} questions`}
                  </span>
                </p>
              )}
            </div>

            {status === 'incorrect' ? (
              <StudentAnswerExplanation comparison={comparison} studentAnswer={group.studentAnswer} />
            ) : null}

            {decision ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-600">
                {decision.isCorrect ? (
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                ) : (
                  <XCircle size={13} className="mt-0.5 shrink-0 text-rose-600" aria-hidden="true" />
                )}
                <span>
                  <span className="font-semibold text-gray-700">
                    {decision.isCorrect ? 'Accepted' : 'Kept incorrect'}
                  </span>
                  {' by '}
                  {decision.actorName || 'a grader'}
                  {' · '}
                  {formatDecisionDate(decision.updatedAt)}
                </span>
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={pending}
            leftIcon={<CheckCircle2 size={15} aria-hidden="true" />}
            onClick={() => onRequestResult(group, true)}
          >
            Accept for whole exam
          </Button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onRequestResult(group, false)}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[3px] border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-800 transition-colors hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
          >
            <XCircle size={15} aria-hidden="true" /> Keep incorrect
          </button>
          {pending ? <span className="text-xs text-gray-500" aria-live="polite">Saving…</span> : null}
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((current) => !current)}
            className="ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-[3px] px-2 text-xs font-semibold text-blue-800 transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2"
          >
            {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
            {expanded
              ? 'Hide students and questions'
              : `View ${studentCount} ${studentCount === 1 ? 'student' : 'students'} and ${questionCount} ${questionCount === 1 ? 'question' : 'questions'}`}
          </button>
        </div>
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
                    <td className="max-w-56 whitespace-pre-wrap break-words px-3 py-3 font-sans text-xs text-gray-700">{row.studentAnswer || '—'}</td>
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
