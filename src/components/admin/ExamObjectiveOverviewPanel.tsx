import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileCheck2, LoaderCircle } from 'lucide-react';
import { Button, Dialog } from '@components/ui';
import type { ExamState } from '../../types';
import type {
  GradingSession,
  ObjectiveIntegrityOverview,
  ObjectiveOverrideUpsertRequest,
} from '../../types/grading';
import { examRepository } from '../../services/examRepository';
import { gradingRepository } from '../../services/gradingRepository';
import { gradingService } from '../../services/gradingService';
import { sanitizeAcceptedAnswers } from '../../utils/acceptedAnswers';
import type {
  ExamObjectiveOverviewBundle,
  ExamObjectiveOverviewGroup,
  ExamObjectiveOverviewGroupStatus,
  ExamObjectiveOverviewRow,
} from './examObjectiveOverviewUtils';
import {
  buildExamObjectiveOverviewRows,
  groupExamObjectiveOverviewRows,
} from './examObjectiveOverviewUtils';
import { resolveObjectiveGradingVersionId } from './gradingReviewUtils';
import { notifyObjectiveGradingUpdated, subscribeObjectiveGradingUpdates } from '../../utils/objectiveGradingSync';
import { ExamObjectiveOverviewGroupCard } from './ExamObjectiveOverviewGroupCard';
import { ObjectiveIntegrityAuditSection } from './ObjectiveIntegrityAuditSection';

interface ExamObjectiveOverviewPanelProps {
  readonly session: GradingSession;
  readonly onStudentSelect?: ((submissionId: string) => void) | undefined;
}

type ExamObjectiveResultFilter = 'all' | 'correct' | 'incorrect';

interface PendingGroupDecision {
  readonly group: ExamObjectiveOverviewGroup;
  readonly isCorrect: boolean;
}

function splitAnswerKeyVariants(value: string): string[] {
  return value.split('|').map((variant) => variant.trim()).filter(Boolean);
}

function getGroupStatus(group: ExamObjectiveOverviewGroup): ExamObjectiveOverviewGroupStatus {
  const results = group.rows.map((row) => row.manualOverride?.isCorrect ?? row.isCorrect);
  return results.every(Boolean) ? 'correct' : 'incorrect';
}

function groupMatchesFilter(
  status: ExamObjectiveOverviewGroupStatus,
  filter: ExamObjectiveResultFilter,
): boolean {
  if (filter === 'all') return true;
  return filter === status;
}

function buildScheduleOverrideRequests(
  group: ExamObjectiveOverviewGroup,
  isCorrect: boolean,
): Array<{ readonly questionId: string; readonly request: ObjectiveOverrideUpsertRequest }> {
  const rowsByQuestion = new Map<string, ExamObjectiveOverviewRow[]>();

  for (const row of group.rows) {
    const rows = rowsByQuestion.get(row.questionId) ?? [];
    rowsByQuestion.set(row.questionId, [...rows, row]);
  }

  return [...rowsByQuestion.entries()].map(([questionId, questionRows]) => {
    const representative = questionRows[0];
    if (!representative) {
      throw new Error(`No answer row found for question ${questionId}.`);
    }

    const answerKeyVariants = sanitizeAcceptedAnswers(
      questionRows.flatMap((row) => splitAnswerKeyVariants(row.correctAnswer)),
    );
    const observedVariants = sanitizeAcceptedAnswers(
      questionRows.map((row) => row.studentAnswer),
    );
    const acceptedAnswers = sanitizeAcceptedAnswers(
      isCorrect ? [...answerKeyVariants, ...observedVariants] : answerKeyVariants,
    );

    return {
      questionId,
      request: {
        correctAnswer: acceptedAnswers[0] ?? representative.correctAnswer.trim(),
        acceptedAnswers,
        excludedAnswers: isCorrect ? [] : observedVariants,
        correctOptionIds: [],
        scoringRule: representative.scoringRule,
        maxScore: questionRows.reduce((maxScore, row) => Math.max(maxScore, row.maxScore), 0),
        reason: `Overall exam answer check: mark “${group.studentAnswer}” ${isCorrect ? 'correct' : 'incorrect'} for the whole exam`,
      },
    };
  });
}

export function ExamObjectiveOverviewPanel({
  session,
  onStudentSelect,
}: ExamObjectiveOverviewPanelProps) {
  const [bundles, setBundles] = useState<ExamObjectiveOverviewBundle[]>([]);
  const [examState, setExamState] = useState<ExamState | null>(null);
  const [submissionCount, setSubmissionCount] = useState(0);
  const [integrityOverview, setIntegrityOverview] = useState<ObjectiveIntegrityOverview | null>(null);
  const [integrityError, setIntegrityError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pendingGroupIds, setPendingGroupIds] = useState<Set<string>>(() => new Set());
  const [pendingDecision, setPendingDecision] = useState<PendingGroupDecision | null>(null);
  const [resultFilter, setResultFilter] = useState<ExamObjectiveResultFilter>('incorrect');
  const loadRequestId = useRef(0);

  const loadOverview = useCallback(async () => {
    const requestId = loadRequestId.current + 1;
    loadRequestId.current = requestId;
    setLoading(true);
    setError(null);
    setIntegrityOverview(null);
    setIntegrityError(null);
    try {
      const [nextSubmissions, sourceResult, integrityResult] = await Promise.all([
        gradingRepository.getSubmissionsBySession(session.id),
        session.scheduleId
          ? gradingService.getObjectiveGradingSource(session.scheduleId)
          : Promise.resolve(null),
        session.scheduleId
          ? gradingService.getObjectiveIntegrityOverview(session.scheduleId)
          : Promise.resolve(null),
      ]);
      const versionId = resolveObjectiveGradingVersionId(
        session.publishedVersionId,
        sourceResult?.success ? sourceResult.data?.draftVersionId : null,
      );
      const examVersion = versionId ? await examRepository.getVersionById(versionId) : null;
      const nextBundles = await Promise.all(
        nextSubmissions.map(async (submission) => ({
          submission: { id: submission.id, studentName: submission.studentName },
          sections: await gradingRepository.getSectionSubmissionsBySubmissionId(submission.id),
        })),
      );
      if (loadRequestId.current !== requestId) return;
      setBundles(nextBundles);
      setExamState(examVersion?.contentSnapshot ?? null);
      setSubmissionCount(nextBundles.length);
      if (integrityResult?.success && integrityResult.data) {
        setIntegrityOverview(integrityResult.data);
      } else if (integrityResult && !integrityResult.success) {
        setIntegrityError(integrityResult.error ?? 'Failed to load persisted integrity audit.');
      }
    } catch (loadError) {
      if (loadRequestId.current !== requestId) return;
      setError(loadError instanceof Error ? loadError.message : 'Failed to load overall answer results.');
    } finally {
      if (loadRequestId.current === requestId) {
        setLoading(false);
      }
    }
  }, [session.id, session.publishedVersionId, session.scheduleId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => subscribeObjectiveGradingUpdates(session.examId, () => {
    void loadOverview();
  }), [loadOverview, session.examId]);

  const rows = useMemo(() => buildExamObjectiveOverviewRows(bundles, { examState }), [bundles, examState]);
  const groups = useMemo(() => groupExamObjectiveOverviewRows(rows), [rows]);
  const groupStatuses = useMemo(() => new Map(
    groups.map((group) => [group.groupId, getGroupStatus(group)] as const),
  ), [groups]);
  const groupCounts = useMemo(() => {
    const counts: Record<ExamObjectiveOverviewGroupStatus, number> = {
      correct: 0,
      incorrect: 0,
    };
    for (const group of groups) {
      counts[getGroupStatus(group)] += 1;
    }
    return {
      all: groups.length,
      correct: counts.correct,
      incorrect: counts.incorrect,
    };
  }, [groups]);
  const visibleGroups = useMemo(() => groups.filter((group) => {
    const status = groupStatuses.get(group.groupId) ?? 'incorrect';
    return groupMatchesFilter(status, resultFilter);
  }), [groupStatuses, groups, resultFilter]);

  const handleRequestGroupResult = (group: ExamObjectiveOverviewGroup, isCorrect: boolean) => {
    setError(null);
    setSuccessMessage(null);
    setPendingDecision({ group, isCorrect });
  };

  const handleConfirmGroupResult = async () => {
    if (!pendingDecision) return;
    const { group, isCorrect } = pendingDecision;
    setPendingGroupIds((current) => new Set(current).add(group.groupId));
    setError(null);
    try {
      for (const change of buildScheduleOverrideRequests(group, isCorrect)) {
        const result = await gradingService.upsertObjectiveOverride(
          session.scheduleId,
          change.questionId,
          change.request,
        );
        if (!result.success || !result.data) {
          throw new Error(result.error ?? 'Failed to update answer key for the whole exam.');
        }
      }

      const studentCount = new Set(group.rows.map((row) => row.submissionId)).size;
      const questionCount = new Set(group.rows.map((row) => row.questionId)).size;
      await loadOverview();
      notifyObjectiveGradingUpdated(session.examId);
      setSuccessMessage(
        isCorrect
          ? `Added “${group.studentAnswer}” to the answer key for ${questionCount} ${questionCount === 1 ? 'question' : 'questions'} and regraded ${studentCount} ${studentCount === 1 ? 'student' : 'students'}.`
          : `Rejected “${group.studentAnswer}” for this exam and regraded ${studentCount} ${studentCount === 1 ? 'student' : 'students'}.`,
      );
      setPendingDecision(null);
    } catch (overrideError) {
      setError(overrideError instanceof Error ? overrideError.message : 'Failed to update answer correctness.');
    } finally {
      setPendingGroupIds((current) => {
        const next = new Set(current);
        next.delete(group.groupId);
        return next;
      });
    }
  };

  const pendingMutation = pendingDecision ? pendingGroupIds.has(pendingDecision.group.groupId) : false;
  const pendingQuestionCount = pendingDecision
    ? new Set(pendingDecision.group.rows.map((row) => row.questionId)).size
    : 0;
  const pendingStudentCount = pendingDecision
    ? new Set(pendingDecision.group.rows.map((row) => row.submissionId)).size
    : 0;
  const filterOptions: Array<{ readonly value: ExamObjectiveResultFilter; readonly label: string; readonly count: number }> = [
    { value: 'all', label: 'All', count: groupCounts.all },
    { value: 'correct', label: 'Correct', count: groupCounts.correct },
    { value: 'incorrect', label: 'Incorrect', count: groupCounts.incorrect },
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm">
      <div className="border-b border-blue-100 bg-blue-50/50 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <FileCheck2 size={19} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Overall exam answer check</h2>
              <p className="mt-1 text-sm text-gray-600">
                {session.examTitle} · typed answers only · grouped across this exam session
              </p>
            </div>
          </div>
          <p className="max-w-xl text-xs leading-relaxed text-gray-600">
            Review each answer variation once. Your decision updates the answer key or result for every matching submission in this exam session.
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-blue-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-medium text-gray-600">
            {submissionCount} students · {groups.length} answer groups · {rows.length} answer {rows.length === 1 ? 'entry' : 'entries'}
          </p>
          <div role="group" aria-label="Filter answer groups" className="flex flex-wrap gap-1 rounded-md bg-white/70 p-1">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={resultFilter === option.value}
                onClick={() => setResultFilter(option.value)}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-[3px] px-2.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1 ${resultFilter === option.value ? 'bg-blue-800 text-white shadow-sm' : 'text-gray-700 hover:bg-blue-100'}`}
              >
                {option.label}
                <span className={`rounded-sm px-1.5 py-0.5 text-[10px] ${resultFilter === option.value ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {option.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {successMessage ? (
        <div className="flex items-start justify-between gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 sm:px-6" role="status" aria-live="polite">
          <span className="flex items-start gap-2"><CheckCircle2 size={17} className="mt-0.5 shrink-0" aria-hidden="true" /> {successMessage}</span>
          <button type="button" onClick={() => setSuccessMessage(null)} className="shrink-0 rounded-sm px-2 py-1 text-xs font-semibold hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-300" aria-label="Dismiss save confirmation">
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:px-6" role="alert">
          <span className="flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" /> {error}</span>
          <button type="button" onClick={() => void loadOverview()} className="min-h-9 rounded-md border border-rose-300 bg-white px-3 py-1 text-xs font-semibold hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:ring-offset-2">
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-gray-600 sm:px-6" role="status" aria-live="polite">
          <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> Loading typed answer exceptions...
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-sm text-gray-600 sm:px-6">No typed answers differ from their key only by letter case or whitespace.</div>
      ) : visibleGroups.length === 0 ? (
        <div className="px-4 py-10 text-center sm:px-6">
          <p className="text-sm font-semibold text-gray-800">No answer groups match this filter.</p>
          <p className="mt-1 text-sm text-gray-600">Choose “All” to see every answer variation in this exam session.</p>
        </div>
      ) : (
        <div>
          {visibleGroups.map((group) => (
            <ExamObjectiveOverviewGroupCard
              key={group.groupId}
              group={group}
              onStudentSelect={onStudentSelect}
              onRequestResult={handleRequestGroupResult}
              pending={pendingGroupIds.has(group.groupId)}
              status={groupStatuses.get(group.groupId) ?? 'incorrect'}
            />
          ))}
        </div>
      )}

      {session.scheduleId ? (
        <ObjectiveIntegrityAuditSection
          loading={loading}
          overview={integrityOverview}
          error={integrityError}
        />
      ) : null}

      <Dialog
        isOpen={Boolean(pendingDecision)}
        onClose={() => {
          if (!pendingMutation) setPendingDecision(null);
        }}
        title={pendingDecision?.isCorrect ? 'Accept answer for this exam?' : 'Reject answer for this exam?'}
        size="md"
        preventCloseOnOverlayClick={pendingMutation}
        closeOnEscape={!pendingMutation}
        footer={(
          <>
            <Button type="button" variant="secondary" size="sm" disabled={pendingMutation} onClick={() => setPendingDecision(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={pendingDecision?.isCorrect ? 'primary' : 'danger'}
              size="sm"
              isLoading={pendingMutation}
              onClick={() => void handleConfirmGroupResult()}
            >
              {pendingDecision?.isCorrect ? 'Accept and regrade' : 'Reject and regrade'}
            </Button>
          </>
        )}
      >
        {pendingDecision ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-gray-700">
              This decision will apply to every matching answer in the selected exam session.
            </p>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Student answer</p>
              <p className="mt-2 break-words font-sans text-base font-semibold text-gray-900">{pendingDecision.group.studentAnswer || 'Blank answer'}</p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-gray-200 p-3">
                <dt className="text-xs font-semibold text-gray-500">Students affected</dt>
                <dd className="mt-1 text-lg font-bold text-gray-900">{pendingStudentCount}</dd>
              </div>
              <div className="rounded-md border border-gray-200 p-3">
                <dt className="text-xs font-semibold text-gray-500">Questions affected</dt>
                <dd className="mt-1 text-lg font-bold text-gray-900">{pendingQuestionCount}</dd>
              </div>
            </dl>
            <p className={`text-sm leading-relaxed ${pendingDecision.isCorrect ? 'text-emerald-800' : 'text-rose-800'}`}>
              {pendingDecision.isCorrect
                ? 'The student answer will be added to the accepted answer key automatically.'
                : 'The current answer key will stay unchanged, and this answer will be excluded for the exam.'}
            </p>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
