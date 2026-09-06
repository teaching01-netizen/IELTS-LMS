/**
 * gradingService pure/deterministic unit tests.
 *
 * Scope: only branches testable with stubbed imports (vi.mock of
 * backendBridge / gradingRepository / examRepository). The real
 * gradingFilters and preview-cohort helpers are used (no stubs), so
 * preview exclusion, filtering delegation and sort order assert real behavior.
 *
 * Deliberately NOT covered here (see existing suites):
 * - gradingService.backend.test.ts: backend transport for getSessionQueue,
 *   getSessionStudentSubmissions, getSessionQueuePage search, startReview,
 *   saveReviewDraft, scheduleRelease, releaseResult, objective
 *   override upsert/delete/regrade + failure surfacing.
 * - gradingFilters.test.ts: filterGradingSessions / filterStudentSubmissions /
 *   mapScheduleStatusToGradingStatus in isolation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  backendGet,
  backendPost,
  backendPut,
  backendDeleteWithBody,
  gradingRepo,
  examRepo,
} = vi.hoisted(() => ({
  backendGet: vi.fn(),
  backendPost: vi.fn(),
  backendPut: vi.fn(),
  backendDeleteWithBody: vi.fn(),
  gradingRepo: {
    getAllSessions: vi.fn(),
    getSessionById: vi.fn(),
    saveSession: vi.fn(),
    getSessionQueuePage: vi.fn(),
    getSubmissionsBySession: vi.fn(),
    getSubmissionById: vi.fn(),
    saveSubmission: vi.fn(),
    getSectionSubmissionsBySubmissionId: vi.fn(),
    saveSectionSubmission: vi.fn(),
    getAllWritingSubmissions: vi.fn(),
    getWritingSubmissionsBySubmissionId: vi.fn(),
    saveWritingSubmission: vi.fn(),
    getReviewDraftBySubmission: vi.fn(),
    saveReviewDraft: vi.fn(),
    deleteReviewDraft: vi.fn(),
    saveReviewEvent: vi.fn(),
    getStudentResultById: vi.fn(),
    saveStudentResult: vi.fn(),
  },
  examRepo: {
    getAllSchedules: vi.fn(),
  },
}));

vi.mock('../backendBridge', () => ({
  backendGet,
  backendPost,
  backendPut,
  backendDeleteWithBody,
}));

vi.mock('../gradingRepository', () => ({
  gradingRepository: gradingRepo,
  getReviewDraftRevision: () => undefined,
}));

vi.mock('../examRepository', () => ({
  examRepository: examRepo,
}));

import { gradingService } from '../gradingService';

const PREVIEW_COHORT = '__preview_runtime__:exam-1:admin:reading';

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    scheduleId: 'sched-1',
    examId: 'exam-1',
    examTitle: 'IELTS Mock',
    publishedVersionId: 'ver-1',
    cohortName: 'Cohort A',
    institution: 'Test Center',
    startTime: '2026-02-01T09:00:00.000Z',
    endTime: '2026-02-01T12:00:00.000Z',
    status: 'completed',
    totalStudents: 0,
    submittedCount: 0,
    pendingManualReviews: 0,
    inProgressReviews: 0,
    finalizedReviews: 0,
    overdueReviews: 0,
    assignedTeachers: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildSubmission(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    submissionId: 'sub-1',
    scheduleId: 'sched-1',
    examId: 'exam-1',
    publishedVersionId: 'ver-1',
    studentId: 'stu-1',
    studentName: 'Alice Roe',
    studentEmail: 'alice@example.com',
    cohortName: 'Cohort A',
    submittedAt: '2026-02-01T11:00:00.000Z',
    timeSpentSeconds: 3600,
    gradingStatus: 'submitted',
    assignedTeacherId: undefined,
    assignedTeacherName: undefined,
    isFlagged: false,
    isOverdue: false,
    sectionStatuses: {
      listening: 'pending',
      reading: 'pending',
      writing: 'pending',
      speaking: 'pending',
    },
    createdAt: '2026-02-01T11:00:00.000Z',
    updatedAt: '2026-02-01T11:00:00.000Z',
    ...overrides,
  };
}

function buildSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sched-9',
    examId: 'exam-1',
    providerKey: 'ielts',
    examTitle: 'IELTS Mock',
    proctorDisplayName: 'IELTS Mock (Proctor)',
    gradingDisplayName: 'IELTS Mock (Graded)',
    publishedVersionId: 'ver-1',
    cohortName: 'Cohort A',
    institution: 'Test Center',
    startTime: '2026-02-01T09:00:00.000Z',
    endTime: '2026-02-01T12:00:00.000Z',
    plannedDurationMinutes: 180,
    deliveryMode: 'proctor_start',
    autoStart: true,
    autoStop: false,
    status: 'live',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildAnnotation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ann-1',
    taskId: 'task1',
    type: 'inline_comment',
    startOffset: 0,
    endOffset: 5,
    selectedText: 'Hello',
    comment: 'Good opening.',
    visibility: 'student_visible',
    createdBy: 'grader-1',
    createdAt: '2026-02-01T12:00:00.000Z',
    ...overrides,
  };
}

function resetAllMocks() {
  for (const fn of [backendGet, backendPost, backendPut, backendDeleteWithBody]) {
    fn.mockReset();
  }
  for (const fn of Object.values(gradingRepo)) {
    (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  examRepo.getAllSchedules.mockReset();
}

beforeEach(() => {
  resetAllMocks();
  localStorage.clear();
});

describe('getSessionQueueSummary (score math)', () => {
  it('sums counters across sessions', async () => {
    gradingRepo.getAllSessions.mockResolvedValue([
      buildSession({
        id: 's1',
        totalStudents: 3,
        pendingManualReviews: 2,
        inProgressReviews: 1,
        finalizedReviews: 0,
        overdueReviews: 1,
      }),
      buildSession({
        id: 's2',
        totalStudents: 5,
        pendingManualReviews: 1,
        inProgressReviews: 2,
        finalizedReviews: 4,
        overdueReviews: 0,
      }),
    ]);

    const result = await gradingService.getSessionQueueSummary();

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      totalSessions: 2,
      totalStudents: 8,
      pendingManualReviews: 3,
      inProgressReviews: 3,
      finalizedReviews: 4,
      overdueReviews: 1,
    });
  });

  it('excludes preview-runtime cohorts from the summary', async () => {
    gradingRepo.getAllSessions.mockResolvedValue([
      buildSession({ id: 'real', totalStudents: 2, pendingManualReviews: 2 }),
      buildSession({
        id: 'preview',
        cohortName: PREVIEW_COHORT,
        totalStudents: 100,
        pendingManualReviews: 100,
        inProgressReviews: 100,
        finalizedReviews: 100,
        overdueReviews: 100,
      }),
    ]);

    const result = await gradingService.getSessionQueueSummary();

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      totalSessions: 1,
      totalStudents: 2,
      pendingManualReviews: 2,
      inProgressReviews: 0,
      finalizedReviews: 0,
      overdueReviews: 0,
    });
  });

  it('returns zeros for an empty queue', async () => {
    gradingRepo.getAllSessions.mockResolvedValue([]);

    const result = await gradingService.getSessionQueueSummary();

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      totalSessions: 0,
      totalStudents: 0,
      pendingManualReviews: 0,
      inProgressReviews: 0,
      finalizedReviews: 0,
      overdueReviews: 0,
    });
  });

  it('wraps repository failures', async () => {
    gradingRepo.getAllSessions.mockRejectedValue(new Error('db down'));

    const result = await gradingService.getSessionQueueSummary();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to get queue summary');
  });
});

describe('getSessionQueue (filter + sort)', () => {
  it('excludes preview cohorts and sorts most-recent-first', async () => {
    gradingRepo.getAllSessions.mockResolvedValue([
      buildSession({ id: 'old', startTime: '2026-01-01T09:00:00.000Z' }),
      buildSession({ id: 'preview-newest', cohortName: PREVIEW_COHORT, startTime: '2026-03-01T09:00:00.000Z' }),
      buildSession({ id: 'new', startTime: '2026-02-01T09:00:00.000Z' }),
    ]);

    const result = await gradingService.getSessionQueue();

    expect(result.success).toBe(true);
    expect(result.data?.map((s) => s.id)).toEqual(['new', 'old']);
  });

  it('applies queue filters after preview exclusion', async () => {
    gradingRepo.getAllSessions.mockResolvedValue([
      buildSession({ id: 'a', cohortName: 'Cohort A' }),
      buildSession({ id: 'b', cohortName: 'Cohort B' }),
    ]);

    const result = await gradingService.getSessionQueue({ cohort: ['Cohort B'] });

    expect(result.success).toBe(true);
    expect(result.data?.map((s) => s.id)).toEqual(['b']);
  });

  it('sorts sessions with missing or invalid timestamps last', async () => {
    gradingRepo.getAllSessions.mockResolvedValue([
      buildSession({ id: 'no-time', startTime: undefined }),
      buildSession({ id: 'bad-time', startTime: 'not-a-date' }),
      buildSession({ id: 'valid', startTime: '2026-02-01T09:00:00.000Z' }),
    ]);

    const result = await gradingService.getSessionQueue();

    expect(result.success).toBe(true);
    expect(result.data?.[0]?.id).toBe('valid');
    expect(result.data).toHaveLength(3);
  });

  it('wraps repository failures', async () => {
    gradingRepo.getAllSessions.mockRejectedValue(new Error('db down'));

    const result = await gradingService.getSessionQueue();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to get session queue');
  });
});

describe('getSessionQueuePage (pagination clamping)', () => {
  it('clamps page and pageSize into server bounds', async () => {
    gradingRepo.getSessionQueuePage.mockResolvedValue({
      sessions: [],
      pagination: { page: 1, pageSize: 100, total: 0, hasMore: false },
    });

    await gradingService.getSessionQueuePage({ page: 0, pageSize: 500 });

    expect(gradingRepo.getSessionQueuePage).toHaveBeenCalledWith(1, 100, undefined);
  });

  it('floors fractional input and defaults an empty call', async () => {
    gradingRepo.getSessionQueuePage.mockResolvedValue({
      sessions: [],
      pagination: { page: 2, pageSize: 10, total: 0, hasMore: false },
    });

    await gradingService.getSessionQueuePage({ page: 2.9, pageSize: 10.9, searchQuery: 'cambridge' });

    expect(gradingRepo.getSessionQueuePage).toHaveBeenCalledWith(2, 10, 'cambridge');

    await gradingService.getSessionQueuePage();

    expect(gradingRepo.getSessionQueuePage).toHaveBeenCalledWith(1, 10, undefined);
  });

  it('returns the repository page on success', async () => {
    const page = {
      sessions: [buildSession()],
      pagination: { page: 2, pageSize: 10, total: 23, hasMore: true },
    };
    gradingRepo.getSessionQueuePage.mockResolvedValue(page);

    const result = await gradingService.getSessionQueuePage({ page: 2, pageSize: 10 });

    expect(result.success).toBe(true);
    expect(result.data).toEqual(page);
  });

  it('wraps repository failures', async () => {
    gradingRepo.getSessionQueuePage.mockRejectedValue(new Error('db down'));

    const result = await gradingService.getSessionQueuePage({ page: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to load grading session queue');
  });
});

describe('getSessionStudentSubmissions (filter + sort)', () => {
  it('sorts most-recent-first without filters', async () => {
    gradingRepo.getSubmissionsBySession.mockResolvedValue([
      buildSubmission({ id: 'older', submittedAt: '2026-02-01T10:00:00.000Z' }),
      buildSubmission({ id: 'newer', submittedAt: '2026-02-01T11:00:00.000Z' }),
    ]);

    const result = await gradingService.getSessionStudentSubmissions('sched-1');

    expect(result.success).toBe(true);
    expect(result.data?.map((s) => s.id)).toEqual(['newer', 'older']);
  });

  it('applies status filters', async () => {
    gradingRepo.getSubmissionsBySession.mockResolvedValue([
      buildSubmission({ id: 's-submitted', gradingStatus: 'submitted' }),
      buildSubmission({ id: 's-released', gradingStatus: 'released' }),
    ]);

    const result = await gradingService.getSessionStudentSubmissions('sched-1', {
      status: ['released'],
    });

    expect(result.success).toBe(true);
    expect(result.data?.map((s) => s.id)).toEqual(['s-released']);
  });

  it('wraps repository failures', async () => {
    gradingRepo.getSubmissionsBySession.mockRejectedValue(new Error('db down'));

    const result = await gradingService.getSessionStudentSubmissions('sched-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to get session submissions');
  });
});

describe('getNextUngradedStudent', () => {
  it('returns the first submitted student', async () => {
    gradingRepo.getSubmissionsBySession.mockResolvedValue([
      buildSubmission({ id: 'done', gradingStatus: 'released' }),
      buildSubmission({ id: 'first-waiting', gradingStatus: 'submitted' }),
      buildSubmission({ id: 'second-waiting', gradingStatus: 'submitted' }),
    ]);

    const result = await gradingService.getNextUngradedStudent('sched-1');

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe('first-waiting');
  });

  it('skips submissions assigned to another teacher but keeps unassigned ones', async () => {
    gradingRepo.getSubmissionsBySession.mockResolvedValue([
      buildSubmission({ id: 'other-teacher', gradingStatus: 'submitted', assignedTeacherId: 't-other' }),
      buildSubmission({ id: 'unassigned', gradingStatus: 'submitted' }),
    ]);

    const result = await gradingService.getNextUngradedStudent('sched-1', 't-mine');

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe('unassigned');
  });

  it('returns null when nothing is awaiting grading', async () => {
    gradingRepo.getSubmissionsBySession.mockResolvedValue([
      buildSubmission({ id: 'done', gradingStatus: 'released' }),
    ]);

    const result = await gradingService.getNextUngradedStudent('sched-1');

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('wraps repository failures', async () => {
    gradingRepo.getSubmissionsBySession.mockRejectedValue(new Error('db down'));

    const result = await gradingService.getNextUngradedStudent('sched-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to get next ungraded student');
  });
});

describe('addWritingAnnotation (validation + fan-out)', () => {
  it('rejects annotations for unknown writing tasks without writing anything', async () => {
    gradingRepo.getWritingSubmissionsBySubmissionId.mockResolvedValue([
      { id: 'wrt-1', submissionId: 'sub-1', taskId: 'task1', annotations: [] },
    ]);
    const annotation = buildAnnotation({ taskId: 'task2' });

    const result = await gradingService.addWritingAnnotation('sub-1', annotation as never, 'grader-1', 'Taylor');

    expect(result.success).toBe(false);
    expect(result.error).toContain('task2');
    expect(result.error).toContain('sub-1');
    expect(gradingRepo.saveWritingSubmission).not.toHaveBeenCalled();
    expect(gradingRepo.saveReviewDraft).not.toHaveBeenCalled();
    expect(gradingRepo.saveReviewEvent).not.toHaveBeenCalled();
  });

  it('appends the annotation to the writing task, draft and audit log', async () => {
    gradingRepo.getWritingSubmissionsBySubmissionId.mockResolvedValue([
      { id: 'wrt-1', submissionId: 'sub-1', taskId: 'task1', annotations: [] },
    ]);
    gradingRepo.getReviewDraftBySubmission.mockResolvedValue({
      id: 'draft-1',
      submissionId: 'sub-1',
      annotations: [],
      hasUnsavedChanges: false,
    });
    const annotation = buildAnnotation();

    const result = await gradingService.addWritingAnnotation('sub-1', annotation as never, 'grader-1', 'Taylor');

    expect(result.success).toBe(true);
    expect(result.data).toEqual(annotation);
    expect(gradingRepo.saveWritingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wrt-1', annotations: [annotation] }),
    );
    expect(gradingRepo.saveReviewDraft).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'draft-1', annotations: [annotation], hasUnsavedChanges: true }),
    );
    expect(gradingRepo.saveReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: 'sub-1',
        teacherId: 'grader-1',
        teacherName: 'Taylor',
        action: 'comment_added',
        payload: { annotationId: 'ann-1', taskId: 'task1' },
      }),
    );
  });

  it('succeeds without a draft while still logging the event', async () => {
    gradingRepo.getWritingSubmissionsBySubmissionId.mockResolvedValue([
      { id: 'wrt-1', submissionId: 'sub-1', taskId: 'task1', annotations: [] },
    ]);
    gradingRepo.getReviewDraftBySubmission.mockResolvedValue(null);
    const annotation = buildAnnotation();

    const result = await gradingService.addWritingAnnotation('sub-1', annotation as never, 'grader-1', 'Taylor');

    expect(result.success).toBe(true);
    expect(gradingRepo.saveWritingSubmission).toHaveBeenCalled();
    expect(gradingRepo.saveReviewDraft).not.toHaveBeenCalled();
    expect(gradingRepo.saveReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'comment_added' }),
    );
  });
});

describe('finalizeReview (state transition)', () => {
  it('rejects finalizing a missing submission', async () => {
    gradingRepo.getSubmissionById.mockResolvedValue(null);

    const result = await gradingService.finalizeReview('missing', 'grader-1', 'Taylor');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Submission not found');
    expect(gradingRepo.saveSubmission).not.toHaveBeenCalled();
  });

  it('releases the submission, finalizes sections/writings and deletes the draft', async () => {
    gradingRepo.getSubmissionById.mockResolvedValue(buildSubmission({ gradingStatus: 'submitted' }));
    gradingRepo.getSectionSubmissionsBySubmissionId.mockResolvedValue([
      { id: 'sec-w', submissionId: 'sub-1', section: 'writing', gradingStatus: 'in_review' },
      { id: 'sec-r', submissionId: 'sub-1', section: 'reading', gradingStatus: 'auto_graded' },
    ]);
    gradingRepo.getAllWritingSubmissions.mockResolvedValue([
      { id: 'wrt-mine', submissionId: 'sub-1', gradingStatus: 'needs_review' },
      { id: 'wrt-other', submissionId: 'sub-2', gradingStatus: 'needs_review' },
    ]);
    gradingRepo.getReviewDraftBySubmission.mockResolvedValue({ id: 'draft-9', submissionId: 'sub-1' });

    const result = await gradingService.finalizeReview('sub-1', 'grader-1', 'Taylor');

    expect(result.success).toBe(true);
    expect(gradingRepo.saveSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub-1', gradingStatus: 'released', updatedAt: expect.any(String) }),
    );
    expect(gradingRepo.saveSectionSubmission).toHaveBeenCalledTimes(2);
    expect(gradingRepo.saveSectionSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sec-w', gradingStatus: 'finalized', finalizedBy: 'grader-1', finalizedAt: expect.any(String) }),
    );
    expect(gradingRepo.saveSectionSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sec-r', gradingStatus: 'finalized', finalizedBy: 'grader-1' }),
    );
    expect(gradingRepo.saveWritingSubmission).toHaveBeenCalledTimes(1);
    expect(gradingRepo.saveWritingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wrt-mine', gradingStatus: 'finalized', finalizedBy: 'grader-1' }),
    );
    expect(gradingRepo.deleteReviewDraft).toHaveBeenCalledWith('draft-9');
  });

  it('finalizes without a draft', async () => {
    gradingRepo.getSubmissionById.mockResolvedValue(buildSubmission());
    gradingRepo.getSectionSubmissionsBySubmissionId.mockResolvedValue([]);
    gradingRepo.getAllWritingSubmissions.mockResolvedValue([]);
    gradingRepo.getReviewDraftBySubmission.mockResolvedValue(null);

    const result = await gradingService.finalizeReview('sub-1', 'grader-1', 'Taylor');

    expect(result.success).toBe(true);
    expect(gradingRepo.deleteReviewDraft).not.toHaveBeenCalled();
  });

  it('wraps repository failures', async () => {
    gradingRepo.getSubmissionById.mockRejectedValue(new Error('db down'));

    const result = await gradingService.finalizeReview('sub-1', 'grader-1', 'Taylor');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to finalize review');
  });
});

describe('reopenReleasedResult (state transition)', () => {
  function seedResultAndSubmission() {
    gradingRepo.getStudentResultById.mockResolvedValue({
      id: 'res-1',
      submissionId: 'sub-1',
      studentId: 'stu-1',
      studentName: 'Alice Roe',
      releaseStatus: 'released',
      teacherSummary: {
        strengths: ['Clear structure'],
        improvementPriorities: ['Cohesion'],
        recommendedPractice: ['Timed drills'],
      },
      updatedAt: '2026-02-01T11:00:00.000Z',
    });
    gradingRepo.getSubmissionById.mockResolvedValue(
      buildSubmission({ id: 'sub-1', studentId: 'stu-1', gradingStatus: 'released' }),
    );
  }

  it('rejects unknown results', async () => {
    gradingRepo.getStudentResultById.mockResolvedValue(null);

    const result = await gradingService.reopenReleasedResult('missing', 'sub-1', 'grader-1', 'Taylor', 'fix band');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Result not found');
  });

  it('rejects missing submissions', async () => {
    gradingRepo.getStudentResultById.mockResolvedValue({ id: 'res-1' });
    gradingRepo.getSubmissionById.mockResolvedValue(null);

    const result = await gradingService.reopenReleasedResult('res-1', 'missing', 'grader-1', 'Taylor', 'fix band');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Submission not found');
  });

  it('reopens result and submission and seeds a fresh draft with a reset checklist', async () => {
    seedResultAndSubmission();

    const result = await gradingService.reopenReleasedResult('res-1', 'sub-1', 'grader-1', 'Taylor', 'fix band');

    expect(result.success).toBe(true);
    expect(gradingRepo.saveStudentResult).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'res-1', releaseStatus: 'reopened' }),
    );
    expect(gradingRepo.saveSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub-1', gradingStatus: 'reopened' }),
    );
    expect(gradingRepo.saveReviewDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: 'sub-1',
        studentId: 'stu-1',
        teacherId: 'grader-1',
        releaseStatus: 'reopened',
        hasUnsavedChanges: false,
        teacherSummary: {
          strengths: ['Clear structure'],
          improvementPriorities: ['Cohesion'],
          recommendedPractice: ['Timed drills'],
        },
      }),
    );
    const draftArg = gradingRepo.saveReviewDraft.mock.calls[0]?.[0] as {
      id: string;
      checklist: Record<string, boolean>;
    };
    expect(draftArg.id.startsWith('draft-')).toBe(true);
    expect(draftArg.checklist).toEqual({
      listeningReviewed: false,
      readingReviewed: false,
      writingTask1Reviewed: false,
      writingTask2Reviewed: false,
      speakingReviewed: false,
      overallFeedbackWritten: false,
      rubricComplete: false,
      annotationsComplete: false,
    });
    expect(result.data).toMatchObject({ submissionId: 'sub-1', releaseStatus: 'reopened' });
  });
});

describe('buildGradingSessions (schedule grouping)', () => {
  it('skips preview schedules and reuses existing sessions without saving', async () => {
    examRepo.getAllSchedules.mockResolvedValue([
      buildSchedule({ id: 'sched-preview', cohortName: PREVIEW_COHORT }),
      buildSchedule({ id: 'sched-2', cohortName: 'Cohort B', status: 'completed' }),
    ]);
    const existing = buildSession({ id: 'sched-2', scheduleId: 'sched-2', cohortName: 'Cohort B' });
    gradingRepo.getSessionById.mockResolvedValue(existing);

    const result = await gradingService.buildGradingSessions();

    expect(result.success).toBe(true);
    expect(result.data).toEqual([existing]);
    expect(gradingRepo.saveSession).not.toHaveBeenCalled();
  });

  it('creates and persists sessions for new schedules with mapped status', async () => {
    examRepo.getAllSchedules.mockResolvedValue([
      buildSchedule({ id: 'sched-9', status: 'live', cohortName: 'Cohort A' }),
    ]);
    gradingRepo.getSessionById.mockResolvedValue(null);

    const result = await gradingService.buildGradingSessions();

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(gradingRepo.saveSession).toHaveBeenCalledTimes(1);
    expect(gradingRepo.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sched-9',
        scheduleId: 'sched-9',
        examId: 'exam-1',
        examTitle: 'IELTS Mock (Graded)',
        cohortName: 'Cohort A',
        status: 'live',
        totalStudents: 0,
        submittedCount: 0,
        pendingManualReviews: 0,
        inProgressReviews: 0,
        finalizedReviews: 0,
        overdueReviews: 0,
        assignedTeachers: [],
      }),
    );
    expect(result.data?.[0]).toMatchObject({ id: 'sched-9', status: 'live' });
  });

  it('wraps schedule loading failures', async () => {
    examRepo.getAllSchedules.mockRejectedValue(new Error('db down'));

    const result = await gradingService.buildGradingSessions();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to build grading sessions');
  });
});

describe('createStudentSubmission (creation + auto-grading)', () => {
  it('creates the submission and auto-grades objective sections with zeroed scores', async () => {
    const result = await gradingService.createStudentSubmission(
      'sched-1',
      'exam-1',
      'ver-1',
      'stu-1',
      'Alice Roe',
      'alice@example.com',
      'Cohort A',
      {
        listening: { type: 'listening', parts: [{ partId: 'p1', questions: [] }] },
        reading: { type: 'reading', passages: [{ passageId: 'r1', questions: [] }] },
      },
    );

    expect(result.success).toBe(true);
    expect(gradingRepo.saveSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 'sched-1',
        examId: 'exam-1',
        studentId: 'stu-1',
        studentName: 'Alice Roe',
        gradingStatus: 'submitted',
        sectionStatuses: {
          listening: 'pending',
          reading: 'pending',
          writing: 'pending',
          speaking: 'pending',
        },
      }),
    );
    const sectionCalls = gradingRepo.saveSectionSubmission.mock.calls.map((call) => call[0]) as Array<{
      section: string;
      gradingStatus: string;
      autoGradingResults?: Record<string, unknown>;
    }>;
    const listeningGrades = sectionCalls.filter((s) => s.section === 'listening');
    const readingGrades = sectionCalls.filter((s) => s.section === 'reading');
    expect(listeningGrades.at(-1)).toMatchObject({
      gradingStatus: 'auto_graded',
      autoGradingResults: { totalScore: 0, maxScore: 0, percentage: 0, questionResults: [] },
    });
    expect(readingGrades.at(-1)).toMatchObject({ gradingStatus: 'auto_graded' });
    expect(result.data).toMatchObject({ scheduleId: 'sched-1', studentId: 'stu-1' });
  });

  it('creates needs_review writing tasks and leaves speaking pending', async () => {
    const result = await gradingService.createStudentSubmission(
      'sched-1',
      'exam-1',
      'ver-1',
      'stu-1',
      'Alice Roe',
      'alice@example.com',
      'Cohort A',
      {
        writing: {
          type: 'writing',
          tasks: [
            { taskId: 'task1', taskLabel: 'Task 1', text: 'Essay one', wordCount: 150, prompt: 'Prompt 1' },
            { taskId: 'task2', taskLabel: 'Task 2', text: 'Essay two', wordCount: 250, prompt: 'Prompt 2' },
          ],
        },
        speaking: { type: 'speaking', part1Answers: ['answer'] },
      },
    );

    expect(result.success).toBe(true);
    expect(gradingRepo.saveWritingSubmission).toHaveBeenCalledTimes(2);
    expect(gradingRepo.saveWritingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task1', studentText: 'Essay one', wordCount: 150, gradingStatus: 'needs_review' }),
    );
    expect(gradingRepo.saveWritingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task2', wordCount: 250, gradingStatus: 'needs_review' }),
    );
    const sectionCalls = gradingRepo.saveSectionSubmission.mock.calls.map((call) => call[0]) as Array<{
      section: string;
      gradingStatus: string;
    }>;
    expect(sectionCalls.filter((s) => s.section === 'speaking')).toHaveLength(1);
    expect(sectionCalls.find((s) => s.section === 'speaking')).toMatchObject({ gradingStatus: 'pending' });
    expect(sectionCalls.some((s) => s.section === 'speaking' && s.gradingStatus === 'auto_graded')).toBe(false);
  });

  it('wraps persistence failures', async () => {
    gradingRepo.saveSubmission.mockRejectedValue(new Error('db down'));

    const result = await gradingService.createStudentSubmission(
      'sched-1',
      'exam-1',
      'ver-1',
      'stu-1',
      'Alice Roe',
      'alice@example.com',
      'Cohort A',
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to create submission');
  });
});

describe('backend endpoints without existing coverage', () => {
  it('marks grading complete and caches the draft', async () => {
    const draft = { id: 'draft-1', submissionId: 'sub-1', releaseStatus: 'grading_complete' };
    backendPost.mockResolvedValue(draft);

    const result = await gradingService.markGradingComplete('sub-1', 'grader-1', 'Taylor');

    expect(result.success).toBe(true);
    expect(result.data).toEqual(draft);
    expect(backendPost).toHaveBeenCalledWith('/v1/grading/submissions/sub-1/mark-grading-complete', {
      actorId: 'grader-1',
      teacherName: 'Taylor',
    });
    expect(gradingRepo.saveReviewDraft).toHaveBeenCalledWith(draft);
  });

  it('reopens a review through the backend with the reason', async () => {
    const draft = { id: 'draft-1', submissionId: 'sub-1', releaseStatus: 'reopened' };
    backendPost.mockResolvedValue(draft);

    const result = await gradingService.reopenReview('sub-1', 'grader-1', 'Taylor', 'recheck writing');

    expect(result.success).toBe(true);
    expect(backendPost).toHaveBeenCalledWith('/v1/grading/submissions/sub-1/reopen-review', {
      actorId: 'grader-1',
      teacherName: 'Taylor',
      reason: 'recheck writing',
    });
    expect(gradingRepo.saveReviewDraft).toHaveBeenCalledWith(draft);
  });

  it('loads the objective integrity overview', async () => {
    const overview = { studentCount: 2, integrityStatus: 'verified', issues: [] };
    backendGet.mockResolvedValue(overview);

    const result = await gradingService.getObjectiveIntegrityOverview('sched-1');

    expect(result.success).toBe(true);
    expect(result.data).toEqual(overview);
    expect(backendGet).toHaveBeenCalledWith('/v1/grading/schedules/sched-1/objective-integrity');
  });

  it('overrides an objective question and persists the returned section', async () => {
    const section = { id: 'sec-1', submissionId: 'sub-1', section: 'reading', gradingStatus: 'finalized' };
    backendPut.mockResolvedValue(section);

    const result = await gradingService.overrideObjectiveQuestion('sub-1', 'reading', 'q-1', {
      isCorrect: true,
      reason: 'accept alternative',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual(section);
    expect(backendPut).toHaveBeenCalledWith(
      '/v1/grading/submissions/sub-1/sections/reading/questions/q-1/override',
      { isCorrect: true, reason: 'accept alternative' },
    );
    expect(gradingRepo.saveSectionSubmission).toHaveBeenCalledWith(section);
  });

  it('wraps backend failures for the release workflow', async () => {
    backendPost.mockRejectedValue(new Error('offline'));

    const result = await gradingService.markReadyToRelease('sub-1', 'grader-1', 'Taylor');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to mark ready to release');
  });
});
