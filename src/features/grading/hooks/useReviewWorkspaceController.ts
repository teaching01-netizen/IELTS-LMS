import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DrawingAnnotation,
  GradingChecklist,
  ReleaseStatus,
  ReviewDraft,
  RubricAssessment,
  SectionSubmission,
  StudentSubmission,
  WritingAnnotation,
  WritingTaskSubmission,
} from '../../../types/grading';
import type { ExamState } from '../../../types';
import { examRepository, hydrateExamState } from '../../exam-authoring/api/examAuthoringGateway';
import { logger } from '../../../utils/logger';
import {
  fetchReviewDraft,
  fetchReviewSections,
  fetchReviewSubmission,
  fetchReviewWritingTasks,
  gradingKeys,
} from '../api/gradingQueries';
import {
  createReviewDraftState,
  isReviewDraftDirty,
  reviewDraftReducer,
  type ReviewDraftAction,
  type ReviewDraftState,
} from '../domain/reviewDraftState';
import { gradingErrorMessage, gradingRepository, gradingService } from '../infrastructure/gradingGateway';

export type ReviewWorkflowAction =
  | 'mark_grading_complete'
  | 'mark_ready_to_release'
  | 'release_now'
  | 'schedule_release'
  | 'reopen';

type RubricSection = 'listening' | 'reading' | 'writing' | 'speaking';

/** Statuses for which opening the workspace starts the review on the server. */
const AUTO_START_STATUSES: ReadonlyArray<StudentSubmission['gradingStatus']> = ['submitted', 'in_progress', 'reopened'];

/** The review reads load once per visit; refetches are explicit (release, objective sync, retry). */
const reviewReadPolicy = { staleTime: 30_000, refetchOnWindowFocus: false } as const;

const FLUSH_FAILED_MESSAGE = 'Unsaved review changes could not be saved. Save the draft, then try again.';

function requiresExplicitReleaseOverride(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.includes('explicit grader override confirmation is required') ||
    normalized.includes('merge_incomplete_override_required')
  );
}

function errorText(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : fallback;
}

function withDefaultChecklist(draft: ReviewDraft): ReviewDraft {
  return {
    ...draft,
    releaseStatus: 'draft' as ReleaseStatus,
    drawings: [],
    checklist: {
      listeningReviewed: false,
      readingReviewed: false,
      writingTask1Reviewed: false,
      writingTask2Reviewed: false,
      speakingReviewed: false,
      overallFeedbackWritten: false,
      rubricComplete: false,
      annotationsComplete: false,
    },
  };
}

/** Synchronous draft store: commands read the latest state right after awaiting, not the last render. */
function useReviewDraftStore(submissionId: string) {
  const stateRef = useRef<ReviewDraftState>(createReviewDraftState(submissionId));
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const dispatch = useCallback((action: ReviewDraftAction) => {
    const next = reviewDraftReducer(stateRef.current, action);
    if (next !== stateRef.current) {
      stateRef.current = next;
      rerender();
    }
  }, []);
  return { stateRef, dispatch };
}

export interface ReviewWorkspaceControllerOptions {
  submissionId: string;
  teacherId: string;
  teacherName: string;
}

/**
 * Orchestration for the IELTS review workspace: feature-owned reads, the
 * entity-scoped draft, one review initialization per submission, and the
 * save/workflow commands. The view renders what this returns and calls its
 * named commands; it never talks to a service or repository itself.
 */
export function useReviewWorkspaceController({ submissionId, teacherId, teacherName }: ReviewWorkspaceControllerOptions) {
  const queryClient = useQueryClient();
  const currentSubmissionRef = useRef(submissionId);
  currentSubmissionRef.current = submissionId;
  const isCurrent = useCallback((id: string) => currentSubmissionRef.current === id, []);

  // ------------------------------------------------------------------ reads
  // Independent resources load concurrently; each keeps its own failure.
  const submissionQuery = useQuery({
    queryKey: gradingKeys.submission(submissionId),
    queryFn: () => fetchReviewSubmission(submissionId),
    enabled: submissionId.length > 0,
    ...reviewReadPolicy,
  });
  const draftQuery = useQuery({
    queryKey: gradingKeys.reviewDraft(submissionId),
    queryFn: () => fetchReviewDraft(submissionId),
    enabled: submissionId.length > 0,
    ...reviewReadPolicy,
  });
  const sectionsQuery = useQuery({
    queryKey: gradingKeys.sections(submissionId),
    queryFn: () => fetchReviewSections(submissionId),
    enabled: submissionId.length > 0,
    ...reviewReadPolicy,
  });
  const writingQuery = useQuery({
    queryKey: gradingKeys.writingTasks(submissionId),
    queryFn: () => fetchReviewWritingTasks(submissionId),
    enabled: submissionId.length > 0,
    ...reviewReadPolicy,
  });

  const submission: StudentSubmission | null = submissionQuery.data ?? null;
  // Published-first pinning (S2-C13): the student took the published version,
  // so traceback resolves to it.
  const publishedVersionId = submission?.publishedVersionId ?? '';
  const versionQuery = useQuery({
    queryKey: gradingKeys.publishedVersion(publishedVersionId),
    queryFn: () => examRepository.getVersionById(publishedVersionId),
    enabled: publishedVersionId.length > 0,
    ...reviewReadPolicy,
  });
  const examState = useMemo<ExamState | null>(
    () => (versionQuery.data ? hydrateExamState(versionQuery.data.contentSnapshot as ExamState) : null),
    [versionQuery.data],
  );
  const examError = versionQuery.isError
    ? errorText(versionQuery.error, 'Failed to load exam version.')
    : versionQuery.isSuccess && !versionQuery.data
      ? 'Exam version not found for this submission.'
      : null;

  // ------------------------------------------------------------------ draft
  const { stateRef, dispatch } = useReviewDraftStore(submissionId);
  const draftState = stateRef.current;
  const reviewDraft = draftState.submissionId === submissionId ? draftState.local : null;
  const saving = draftState.submissionId === submissionId && draftState.pendingSave !== null;

  useEffect(() => {
    dispatch({ type: 'reset', submissionId });
  }, [dispatch, submissionId]);

  // Server reads only become the draft when that cannot discard local edits.
  useEffect(() => {
    if (draftQuery.data) dispatch({ type: 'loaded', submissionId, draft: draftQuery.data });
  }, [dispatch, draftQuery.data, submissionId]);

  // One review initialization per submission and mount: Strict Mode effect
  // replays and refetches never become a second writer. The server owns
  // idempotency for the start itself.
  const startedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (draftQuery.data !== null || !submission) return;
    if (!AUTO_START_STATUSES.includes(submission.gradingStatus)) return;
    if (startedForRef.current === submissionId) return;
    startedForRef.current = submissionId;
    void (async () => {
      try {
        const result = await gradingService.startReview(submissionId, teacherId, teacherName);
        if (result.success && result.data) {
          queryClient.setQueryData(gradingKeys.reviewDraft(submissionId), withDefaultChecklist(result.data));
        } else if (startedForRef.current === submissionId) {
          startedForRef.current = null;
        }
      } catch (error) {
        logger.error('Failed to start review:', error);
        if (startedForRef.current === submissionId) startedForRef.current = null;
      }
    })();
  }, [draftQuery.data, queryClient, submission, submissionId, teacherId, teacherName]);

  const editDraft = useCallback(
    (update: (draft: ReviewDraft) => ReviewDraft) => dispatch({ type: 'edited', submissionId, update }),
    [dispatch, submissionId],
  );

  const updateRubricAssessment = useCallback(
    (section: RubricSection, assessment: Partial<RubricAssessment>, taskId?: string) => {
      editDraft((previous) => {
        if (section === 'writing' && taskId) {
          const writing = previous.sectionDrafts.writing ?? {};
          const task = taskId as 'task1' | 'task2';
          return {
            ...previous,
            sectionDrafts: {
              ...previous.sectionDrafts,
              writing: { ...writing, [task]: { ...writing[task], ...assessment } as RubricAssessment },
            },
          };
        }
        return {
          ...previous,
          sectionDrafts: {
            ...previous.sectionDrafts,
            [section]: { ...previous.sectionDrafts[section], ...assessment } as RubricAssessment,
          },
        };
      });
    },
    [editDraft],
  );

  const updateChecklist = useCallback(
    (updates: Partial<GradingChecklist>) =>
      editDraft((previous) => ({ ...previous, checklist: { ...previous.checklist, ...updates } })),
    [editDraft],
  );

  const addAnnotation = useCallback((annotation: WritingAnnotation) => {
    if (!annotation.taskId || stateRef.current.local?.annotations.some((candidate) => candidate.id === annotation.id)) return;
    editDraft((previous) =>
      previous.annotations.some((candidate) => candidate.id === annotation.id)
        ? previous
        : { ...previous, annotations: [...previous.annotations, annotation] },
    );
  }, [editDraft, stateRef]);

  // Canvas update path: replace the annotation in place (undo/redo restore).
  const updateAnnotation = useCallback((annotation: WritingAnnotation) => {
    if (!annotation.taskId) return;
    editDraft((previous) => ({
      ...previous,
      annotations: previous.annotations.map((candidate) => (candidate.id === annotation.id ? annotation : candidate)),
    }));
  }, [editDraft]);

  const deleteAnnotation = useCallback((annotationId: string) => {
    editDraft((previous) => ({
      ...previous,
      annotations: previous.annotations.filter((candidate) => candidate.id !== annotationId),
    }));
  }, [editDraft]);

  const addDrawing = useCallback((drawing: DrawingAnnotation) => {
    if (!drawing.taskId || stateRef.current.local?.drawings.some((candidate) => candidate.id === drawing.id)) return;
    editDraft((previous) =>
      previous.drawings.some((candidate) => candidate.id === drawing.id)
        ? previous
        : { ...previous, drawings: [...previous.drawings, drawing] },
    );
  }, [editDraft, stateRef]);

  const deleteDrawing = useCallback((drawingId: string) => {
    if (!drawingId) return;
    editDraft((previous) => ({
      ...previous,
      drawings: previous.drawings.filter((candidate) => candidate.id !== drawingId),
    }));
  }, [editDraft]);

  // ------------------------------------------------------------------ save
  const saveOperationSeq = useRef(0);
  const pendingSaveRef = useRef<{ submissionId: string; operationId: number; promise: Promise<boolean> } | null>(null);

  /** One overlapping save per submission; its acknowledgement never erases newer edits. */
  const saveDraft = useCallback((): Promise<boolean> => {
    const pending = pendingSaveRef.current;
    if (pending?.submissionId === submissionId) return pending.promise;
    const state = stateRef.current;
    const draft = state.submissionId === submissionId ? state.local : null;
    if (!draft) return Promise.resolve(false);
    const operationId = (saveOperationSeq.current += 1);
    const savedFor = submissionId;
    dispatch({ type: 'saveStarted', submissionId: savedFor, operationId });
    const promise = (async () => {
      try {
        const result = await gradingService.saveReviewDraft(draft, teacherId, teacherName);
        if (result.success && result.data) {
          dispatch({ type: 'saveAcknowledged', submissionId: savedFor, operationId, draft: result.data });
          queryClient.setQueryData(gradingKeys.reviewDraft(savedFor), result.data);
          return true;
        }
        dispatch({ type: 'saveFailed', submissionId: savedFor, operationId });
        return false;
      } catch (error) {
        logger.error('Failed to save review draft:', error);
        dispatch({ type: 'saveFailed', submissionId: savedFor, operationId });
        return false;
      } finally {
        if (pendingSaveRef.current?.operationId === operationId) pendingSaveRef.current = null;
      }
    })();
    pendingSaveRef.current = { submissionId: savedFor, operationId, promise };
    return promise;
  }, [dispatch, queryClient, stateRef, submissionId, teacherId, teacherName]);

  /** Persist the current draft before a workflow step relies on it. */
  const flushDraft = useCallback(async (): Promise<boolean> => {
    const pending = pendingSaveRef.current;
    if (pending?.submissionId === submissionId && !(await pending.promise)) return false;
    if (!isReviewDraftDirty(stateRef.current)) return true;
    return saveDraft();
  }, [saveDraft, stateRef, submissionId]);

  // ------------------------------------------------------------------ workflow
  const [releaseAction, setReleaseAction] = useState<ReviewWorkflowAction | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  useEffect(() => {
    setReleaseAction(null);
    setReleaseError(null);
  }, [submissionId]);

  /** After release: the submission, its draft and answers, the queue, and results views. */
  const refreshAfterRelease = useCallback(async (releasedFor: string) => {
    gradingRepository.invalidateSubmissionBundle(releasedFor);
    void queryClient.invalidateQueries({ queryKey: gradingKeys.sessions() });
    // Every session's submission list (['grading', sessionId, 'submissions']).
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === 'grading' && query.queryKey[2] === 'submissions',
    });
    void queryClient.invalidateQueries({ queryKey: ['results'] });
    await Promise.all([
      queryClient.refetchQueries({ queryKey: gradingKeys.submission(releasedFor) }),
      queryClient.refetchQueries({ queryKey: gradingKeys.reviewDraft(releasedFor) }),
      queryClient.refetchQueries({ queryKey: gradingKeys.sections(releasedFor) }),
      queryClient.refetchQueries({ queryKey: gradingKeys.writingTasks(releasedFor) }),
    ]);
  }, [queryClient]);

  const runTransition = useCallback(
    async (
      action: Exclude<ReviewWorkflowAction, 'release_now'>,
      fallback: string,
      call: () => Promise<{ success: boolean; data?: ReviewDraft | undefined; error?: unknown }>,
      flushFirst: boolean,
    ) => {
      if (!stateRef.current.local) return;
      const forSubmission = submissionId;
      setReleaseAction(action);
      setReleaseError(null);
      try {
        if (flushFirst && !(await flushDraft())) throw new Error(FLUSH_FAILED_MESSAGE);
        const result = await call();
        if (!(result.success && result.data)) throw new Error(gradingErrorMessage(result.error, fallback));
        dispatch({ type: 'transitioned', submissionId: forSubmission, draft: result.data });
        queryClient.setQueryData(gradingKeys.reviewDraft(forSubmission), result.data);
      } catch (error) {
        logger.error(`${fallback}:`, error);
        if (isCurrent(forSubmission)) setReleaseError(error instanceof Error ? error.message : `${fallback}.`);
      } finally {
        if (isCurrent(forSubmission)) setReleaseAction(null);
      }
    },
    [dispatch, flushDraft, isCurrent, queryClient, stateRef, submissionId],
  );

  const markGradingComplete = useCallback(
    () => runTransition('mark_grading_complete', 'Failed to mark grading complete', () =>
      gradingService.markGradingComplete(submissionId, teacherId, teacherName), true),
    [runTransition, submissionId, teacherId, teacherName],
  );

  const markReadyToRelease = useCallback(
    () => runTransition('mark_ready_to_release', 'Failed to mark ready to release', () =>
      gradingService.markReadyToRelease(submissionId, teacherId, teacherName), true),
    [runTransition, submissionId, teacherId, teacherName],
  );

  const scheduleRelease = useCallback(
    (date: string) => runTransition('schedule_release', 'Failed to schedule release', () =>
      gradingService.scheduleRelease(submissionId, date, teacherId, teacherName), true),
    [runTransition, submissionId, teacherId, teacherName],
  );

  const reopen = useCallback(
    () => runTransition('reopen', 'Failed to reopen review', () =>
      gradingService.reopenReview(submissionId, teacherId, teacherName, 'Manual reopen'), false),
    [runTransition, submissionId, teacherId, teacherName],
  );

  /**
   * Release the persisted current draft. Resolves `override_required` when
   * the server asks for explicit grader confirmation (the view confirms in an
   * app modal and calls again with `override`).
   */
  const releaseNow = useCallback(
    async (override = false): Promise<'released' | 'override_required' | 'failed'> => {
      if (!stateRef.current.local) return 'failed';
      const forSubmission = submissionId;
      setReleaseAction('release_now');
      setReleaseError(null);
      try {
        if (!(await flushDraft())) throw new Error(FLUSH_FAILED_MESSAGE);
        const result = await gradingService.releaseResult(forSubmission, teacherId, teacherName, override);
        if (!result.success) {
          const message = gradingErrorMessage(result.error, 'Failed to release result');
          if (!override && requiresExplicitReleaseOverride(message)) return 'override_required';
          throw new Error(message);
        }
        await refreshAfterRelease(forSubmission);
        return 'released';
      } catch (error) {
        logger.error('Failed to release result:', error);
        if (isCurrent(forSubmission)) setReleaseError(error instanceof Error ? error.message : 'Failed to release result.');
        return 'failed';
      } finally {
        if (isCurrent(forSubmission)) setReleaseAction(null);
      }
    },
    [flushDraft, isCurrent, refreshAfterRelease, stateRef, submissionId, teacherId, teacherName],
  );

  // ------------------------------------------------------------------ objective answers
  const [objectiveOverrideError, setObjectiveOverrideError] = useState<string | null>(null);
  const [pendingObjectiveOverrideQuestionIds, setPendingObjectiveOverrideQuestionIds] = useState<Set<string>>(() => new Set());
  const [objectiveReloading, setObjectiveReloading] = useState(false);

  useEffect(() => {
    setObjectiveOverrideError(null);
    setPendingObjectiveOverrideQuestionIds(new Set());
    setObjectiveReloading(false);
  }, [submissionId]);

  const overrideObjective = useCallback(
    async (section: 'reading' | 'listening', questionId: string, isCorrect: boolean) => {
      const forSubmission = submissionId;
      setPendingObjectiveOverrideQuestionIds((current) => new Set(current).add(questionId));
      setObjectiveOverrideError(null);
      try {
        const result = await gradingService.overrideObjectiveQuestion(forSubmission, section, questionId, {
          isCorrect,
          reason: 'Manual grader correctness decision',
        });
        if (result.success && result.data) {
          const updated = result.data;
          queryClient.setQueryData<SectionSubmission[]>(gradingKeys.sections(forSubmission), (current) =>
            current?.map((sectionSubmission) => (sectionSubmission.id === updated.id ? updated : sectionSubmission)),
          );
        } else if (isCurrent(forSubmission)) {
          setObjectiveOverrideError(gradingErrorMessage(result.error, 'Failed to update answer correctness.'));
        }
      } catch (error) {
        if (isCurrent(forSubmission)) {
          setObjectiveOverrideError(error instanceof Error ? error.message : 'Failed to update answer correctness.');
        }
      } finally {
        if (isCurrent(forSubmission)) {
          setPendingObjectiveOverrideQuestionIds((current) => {
            const next = new Set(current);
            next.delete(questionId);
            return next;
          });
        }
      }
    },
    [isCurrent, queryClient, submissionId],
  );

  /** Re-read objective answers after another grader's correctness change. */
  const reloadSections = useCallback(async () => {
    const forSubmission = submissionId;
    gradingRepository.invalidateSubmissionBundle(forSubmission);
    setObjectiveReloading(true);
    try {
      await queryClient.refetchQueries({ queryKey: gradingKeys.sections(forSubmission) });
    } finally {
      if (isCurrent(forSubmission)) setObjectiveReloading(false);
    }
  }, [isCurrent, queryClient, submissionId]);

  const sectionSubmissions: SectionSubmission[] = sectionsQuery.data ?? [];
  const writingSubmissions: WritingTaskSubmission[] = writingQuery.data ?? [];

  return {
    submission,
    reviewDraft,
    sectionSubmissions,
    writingSubmissions,
    examState,
    loading: submissionQuery.isPending,
    sectionsLoading: sectionsQuery.isPending || objectiveReloading,
    sectionsError: sectionsQuery.isError ? errorText(sectionsQuery.error, 'Failed to load section answers.') : null,
    writingLoading: writingQuery.isPending,
    writingError: writingQuery.isError ? errorText(writingQuery.error, 'Failed to load writing payload.') : null,
    draftError: draftQuery.isError ? errorText(draftQuery.error, 'Failed to load review draft.') : null,
    examLoading: publishedVersionId.length > 0 && versionQuery.isPending,
    examError,
    saving,
    releaseAction,
    releaseError,
    objectiveOverrideError,
    pendingObjectiveOverrideQuestionIds,
    editDraft,
    updateRubricAssessment,
    updateChecklist,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    addDrawing,
    deleteDrawing,
    saveDraft,
    markGradingComplete,
    markReadyToRelease,
    scheduleRelease,
    reopen,
    releaseNow,
    overrideObjective,
    reloadSections,
  };
}

export type ReviewWorkspaceController = ReturnType<typeof useReviewWorkspaceController>;
