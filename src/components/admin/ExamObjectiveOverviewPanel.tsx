import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useCoalescedReload } from '../../hooks/useCoalescedReload';
import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, FileCheck2, FileText, Filter, Layers, Users } from 'lucide-react';
import { Button, Dialog } from '@components/ui';
import type { ExamState } from '../../types';
import type {
  GradingScheduleObjectiveOverrideRow,
  GradingSession,
  ObjectiveIntegrityOverview,
  ObjectiveOverrideUpsertRequest,
} from '../../types/grading';
import { examRepository } from '../../features/exam-authoring/infrastructure/examAuthoringGateway';
import { gradingRepository, gradingService } from '../../features/grading/infrastructure/gradingGateway';
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
import { useOptionalAuthSession } from '../../features/auth/authSession';
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

interface OptimisticGroupDecision {
  readonly isCorrect: boolean;
  readonly actorId: string;
  readonly actorName: string;
  readonly updatedAt: string;
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
  const [overrides, setOverrides] = useState<readonly GradingScheduleObjectiveOverrideRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pendingGroupIds, setPendingGroupIds] = useState<Set<string>>(() => new Set());
  const [pendingDecision, setPendingDecision] = useState<PendingGroupDecision | null>(null);
  const [optimisticDecisions, setOptimisticDecisions] = useState<ReadonlyMap<string, OptimisticGroupDecision>>(
    () => new Map(),
  );
  const [resultFilter, setResultFilter] = useState<ExamObjectiveResultFilter>('incorrect');
  const { loading, inFlight, reload: runReload } = useCoalescedReload(true);
  const { session: authSession } = useOptionalAuthSession() ?? {};

  const loadOverview = useCallback((background = false, force = false): Promise<void> => {
    return runReload(async (isStale, isBackground) => {
      setError(null);
      if (!isBackground) {
        setIntegrityOverview(null);
        setIntegrityError(null);
        setOverrides([]);
      }
      try {
        const [nextSubmissions, sourceResult, integrityResult, overridesResult] = await Promise.all([
          gradingRepository.getSubmissionsBySession(session.id),
          session.scheduleId
            ? gradingService.getObjectiveGradingSource(session.scheduleId)
            : Promise.resolve(null),
          session.scheduleId
            ? gradingService.getObjectiveIntegrityOverview(session.scheduleId)
            : Promise.resolve(null),
          session.scheduleId
            ? gradingService.getObjectiveOverrides(session.scheduleId)
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
        if (isStale()) return;
        setBundles(nextBundles);
        setExamState(examVersion?.contentSnapshot ?? null);
        setSubmissionCount(nextBundles.length);
        if (integrityResult?.success && integrityResult.data) {
          setIntegrityOverview(integrityResult.data);
        } else if (integrityResult && !integrityResult.success) {
          setIntegrityError(integrityResult.error ?? 'Failed to load persisted integrity audit.');
        }
        if (overridesResult?.success && overridesResult.data) {
          setOverrides(overridesResult.data);
        }
      } catch (loadError) {
        if (isStale()) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load overall answer results.');
      }
    }, { background, force });
  }, [runReload, session.id, session.publishedVersionId, session.scheduleId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  // Refresh in the background so an external update never collapses the list
  // into a loading skeleton — only the initial mount shows one.
  useEffect(() => subscribeObjectiveGradingUpdates(session.examId, () => {
    void loadOverview(true);
  }), [loadOverview, session.examId]);

  const rows = useMemo(() => buildExamObjectiveOverviewRows(bundles, { examState }), [bundles, examState]);
  const groups = useMemo(() => groupExamObjectiveOverviewRows(rows), [rows]);
  const groupStatuses = useMemo(() => new Map(
    groups.map((group) => {
      const optimistic = optimisticDecisions.get(group.groupId);
      const status = optimistic
        ? (optimistic.isCorrect ? 'correct' : 'incorrect')
        : getGroupStatus(group);
      return [group.groupId, status] as const;
    }),
  ), [groups, optimisticDecisions]);
  const groupCounts = useMemo(() => {
    const counts: Record<ExamObjectiveOverviewGroupStatus, number> = {
      correct: 0,
      incorrect: 0,
    };
    for (const group of groups) {
      const status = groupStatuses.get(group.groupId) ?? getGroupStatus(group);
      counts[status] += 1;
    }
    return {
      all: groups.length,
      correct: counts.correct,
      incorrect: counts.incorrect,
    };
  }, [groupStatuses, groups]);
  const optimisticOverrideRows = useMemo(() => {
    const rows: GradingScheduleObjectiveOverrideRow[] = [];
    for (const group of groups) {
      const decision = optimisticDecisions.get(group.groupId);
      if (!decision) continue;
      for (const change of buildScheduleOverrideRequests(group, decision.isCorrect)) {
        rows.push({
          scheduleId: session.scheduleId,
          questionId: change.questionId,
          overrideJson: {
            correctAnswer: change.request.correctAnswer,
            acceptedAnswers: change.request.acceptedAnswers,
            excludedAnswers: change.request.excludedAnswers ?? [],
            correctOptionIds: change.request.correctOptionIds ?? [],
            scoringRule: change.request.scoringRule,
            maxScore: change.request.maxScore,
          },
          updatedByActorId: decision.actorId,
          updatedByActorName: decision.actorName,
          updatedAt: decision.updatedAt,
        });
      }
    }
    return rows;
  }, [groups, optimisticDecisions, session.scheduleId]);
  // Optimistic rows first so they win `find`-based decision resolution over
  // the previously saved server rows for the same question.
  const displayOverrides = useMemo(
    () => [...optimisticOverrideRows, ...overrides],
    [optimisticOverrideRows, overrides],
  );
  const visibleGroups = useMemo(() => groups.filter((group) => {
    // Keep a group that is being saved visible so its pending state stays in view.
    if (pendingGroupIds.has(group.groupId)) return true;
    const status = groupStatuses.get(group.groupId) ?? 'incorrect';
    return groupMatchesFilter(status, resultFilter);
  }), [groupStatuses, groups, pendingGroupIds, resultFilter]);

  const handleRequestGroupResult = (group: ExamObjectiveOverviewGroup, isCorrect: boolean) => {
    setError(null);
    setSuccessMessage(null);
    setPendingDecision({ group, isCorrect });
  };

  const handleConfirmGroupResult = async () => {
    if (!pendingDecision) return;
    const { group, isCorrect } = pendingDecision;
    const now = new Date().toISOString();
    const optimisticDecision: OptimisticGroupDecision = {
      isCorrect,
      actorId: authSession?.user?.id ?? '',
      actorName: authSession?.user?.displayName || 'You',
      updatedAt: now,
    };

    // Apply the decision immediately, then reconcile with the server below.
    setPendingGroupIds((current) => new Set(current).add(group.groupId));
    setOptimisticDecisions((current) => new Map(current).set(group.groupId, optimisticDecision));
    setPendingDecision(null);
    setError(null);
    setSuccessMessage(null);
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

      const submissionIds = new Set(bundles.map(({ submission }) => submission.id));
      for (const submissionId of submissionIds) {
        gradingRepository.invalidateSubmissionBundle(submissionId);
      }

      const studentCount = new Set(group.rows.map((row) => row.submissionId)).size;
      const questionCount = new Set(group.rows.map((row) => row.questionId)).size;
      // Notify first: the same-tab subscription starts the background reload,
      // which the await below shares instead of starting a second fetch. The
      // optimistic rows bridge the gap, so the list never flashes a skeleton.
      const reloadBeforeSave = inFlight.current;
      notifyObjectiveGradingUpdated(session.examId);
      const reloadPromise = loadOverview(true);
      await reloadPromise;
      // If the shared reload began before the save finished, its data may
      // predate the new override — refetch to guarantee post-save truth.
      if (reloadPromise === reloadBeforeSave) {
        await loadOverview(true, true);
      }
      // Server truth has replaced the optimistic rows; drop the local decision.
      setOptimisticDecisions((current) => {
        const next = new Map(current);
        next.delete(group.groupId);
        return next;
      });
      setSuccessMessage(
        isCorrect
          ? `Added “${group.studentAnswer}” to the answer key for ${questionCount} ${questionCount === 1 ? 'question' : 'questions'} and regraded ${studentCount} ${studentCount === 1 ? 'student' : 'students'}.`
          : `Kept “${group.studentAnswer}” incorrect for the exam and regraded ${studentCount} ${studentCount === 1 ? 'student' : 'students'}.`,
      );
    } catch (overrideError) {
      // Revert the optimistic update so the card reflects the saved state again.
      setOptimisticDecisions((current) => {
        const next = new Map(current);
        next.delete(group.groupId);
        return next;
      });
      setError(overrideError instanceof Error ? overrideError.message : 'Failed to update answer correctness.');
    } finally {
      setPendingGroupIds((current) => {
        const next = new Set(current);
        next.delete(group.groupId);
        return next;
      });
    }
  };

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
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600">
                <span className="inline-flex items-center gap-1.5">
                  <Users size={13} className="text-gray-500" aria-hidden="true" />
                  <span className="font-semibold tabular-nums text-gray-900">{submissionCount}</span>
                  {submissionCount === 1 ? 'student' : 'students'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Layers size={13} className="text-gray-500" aria-hidden="true" />
                  <span className="font-semibold tabular-nums text-gray-900">{groups.length}</span>
                  answer {groups.length === 1 ? 'group' : 'groups'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <FileText size={13} className="text-gray-500" aria-hidden="true" />
                  <span className="font-semibold tabular-nums text-gray-900">{rows.length}</span>
                  answer {rows.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>
            </div>
          </div>
          <div role="group" aria-label="Filter answer groups" className="flex flex-wrap gap-1 rounded-md bg-white/70 p-1">
            {filterOptions.map((option) => {
              const isSelected = resultFilter === option.value;
              const selectedClass = 'bg-blue-800 text-white shadow-sm';
              const idleClass = 'text-gray-700 hover:bg-blue-100';
              const buttonClass = isSelected ? selectedClass : idleClass;
              const selectedBadgeClass = 'bg-white/20 text-white';
              const idleBadgeClass = 'bg-gray-100 text-gray-600';
              const badgeClass = isSelected ? selectedBadgeClass : idleBadgeClass;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setResultFilter(option.value)}
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded-[3px] px-2.5 text-xs font-semibold transition-[scale,background-color,color] duration-150 ease-out active:scale-[0.96] focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1 ${buttonClass}`}
                >
                  {option.label}
                  <span className={`rounded-sm px-1.5 py-0.5 text-[10px] transition-colors duration-150 ease-out ${badgeClass}`}>
                    {option.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-gray-600">
          Typed answers that differ from the answer key only by capitalization or spacing. Decide each group once — the result applies to every matching student and question in this exam session.
        </p>
      </div>

      {successMessage ? (
        <div className="flex items-start justify-between gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 sm:px-6" role="status" aria-live="polite">
          <span className="flex items-start gap-2"><CheckCircle2 size={17} className="mt-0.5 shrink-0" aria-hidden="true" /> {successMessage}</span>
          <button type="button" onClick={() => setSuccessMessage(null)} className="shrink-0 rounded-sm px-2 py-1 text-xs font-semibold transition-[scale,background-color] duration-150 ease-out hover:bg-emerald-100 active:scale-[0.96] focus:outline-none focus:ring-2 focus:ring-emerald-300" aria-label="Dismiss save confirmation">
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:px-6" role="alert">
          <span className="flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" /> {error}</span>
          <button type="button" onClick={() => void loadOverview()} className="min-h-9 rounded-md border border-rose-300 bg-white px-3 py-1 text-xs font-semibold transition-[scale,background-color,border-color] duration-150 ease-out hover:bg-rose-100 active:scale-[0.96] focus:outline-none focus:ring-2 focus:ring-rose-300 focus:ring-offset-2">
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="px-4 py-8 sm:px-6" role="status" aria-live="polite">
          <p className="sr-only">Loading typed answer exceptions...</p>
          <div className="max-w-2xl space-y-3" aria-hidden="true">
            <div className="h-16 animate-pulse rounded-lg bg-gray-100/80" />
            <div className="h-16 animate-pulse rounded-lg bg-gray-100/60" />
            <div className="h-16 animate-pulse rounded-lg bg-gray-100/80" />
          </div>
        </div>
      ) : rows.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="px-4 py-12 text-center sm:px-6"
        >
          <div className="mx-auto flex max-w-sm flex-col items-center gap-2.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <FileCheck2 size={22} aria-hidden="true" />
            </div>
            <p className="mt-1 text-sm font-semibold text-gray-900">All typed answers check out</p>
            <p className="text-sm text-gray-600">No typed answers differ from their key only by letter case or whitespace.</p>
          </div>
        </motion.div>
      ) : visibleGroups.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="px-4 py-12 text-center sm:px-6"
        >
          <div className="mx-auto flex max-w-sm flex-col items-center gap-2.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100">
              <Filter size={22} aria-hidden="true" />
            </div>
            <p className="mt-1 text-sm font-semibold text-gray-900">No answer groups match this filter</p>
            <p className="text-sm text-gray-600">Choose “All” to see every answer variation in this exam session.</p>
          </div>
        </motion.div>
      ) : (
        <div>
          {visibleGroups.map((group) => (
            <ExamObjectiveOverviewGroupCard
              key={group.groupId}
              group={group}
              overrides={displayOverrides}
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
        onClose={() => setPendingDecision(null)}
        title={pendingDecision?.isCorrect ? 'Mark this answer correct for the whole exam?' : 'Keep this answer incorrect for the whole exam?'}
        size="md"
        footer={(
          <>
            <Button type="button" variant="secondary" size="sm" onClick={() => setPendingDecision(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={pendingDecision?.isCorrect ? 'primary' : 'danger'}
              size="sm"
              onClick={() => void handleConfirmGroupResult()}
            >
              {pendingDecision?.isCorrect ? 'Accept and regrade' : 'Keep incorrect and regrade'}
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
                : 'The answer will stay excluded from the answer key for the whole exam.'}
            </p>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
