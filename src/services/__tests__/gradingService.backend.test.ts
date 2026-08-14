import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gradingRepository } from '../gradingRepository';
import { gradingService } from '../gradingService';
import type { ReviewDraft } from '../../types/grading';

const originalFetch = global.fetch;

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function buildSession() {
  return {
    id: 'sched-1',
    scheduleId: 'sched-1',
    examId: 'exam-1',
    examTitle: 'Mock Exam',
    publishedVersionId: 'ver-1',
    cohortName: 'Cohort A',
    institution: 'Center',
    startTime: '2026-01-01T09:00:00.000Z',
    endTime: '2026-01-01T12:00:00.000Z',
    status: 'completed',
    totalStudents: 1,
    submittedCount: 1,
    pendingManualReviews: 1,
    inProgressReviews: 0,
    finalizedReviews: 0,
    overdueReviews: 0,
    assignedTeachers: ['grader-1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'Admin',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function buildSubmission() {
  return {
    id: 'sub-1',
    attemptId: 'attempt-1',
    scheduleId: 'sched-1',
    examId: 'exam-1',
    publishedVersionId: 'ver-1',
    studentId: 'alice',
    studentName: 'Alice Roe',
    studentEmail: 'alice@example.com',
    cohortName: 'Cohort A',
    submittedAt: '2026-01-01T11:59:00.000Z',
    timeSpentSeconds: 7200,
    gradingStatus: 'submitted',
    assignedTeacherId: null,
    assignedTeacherName: null,
    isFlagged: false,
    flagReason: null,
    isOverdue: false,
    dueDate: null,
    sectionStatuses: {
      listening: 'auto_graded',
      reading: 'auto_graded',
      writing: 'needs_review',
      speaking: 'needs_review',
    },
    createdAt: '2026-01-01T11:59:00.000Z',
    updatedAt: '2026-01-01T11:59:00.000Z',
  };
}

function buildDraft(revision = 0) {
  return {
    id: 'draft-1',
    submissionId: 'sub-1',
    studentId: 'alice',
    teacherId: 'grader-1',
    releaseStatus: 'draft',
    sectionDrafts: {
      writing: {
        task1: {
          taskResponseBand: 6,
          coherenceBand: 6,
          lexicalBand: 6,
          grammarBand: 6,
          overallBand: 6,
          wordCount: 120,
          gradingStatus: 'in_review',
        },
      },
    },
    annotations: [],
    drawings: [],
    overallFeedback: 'Keep tightening task response.',
    studentVisibleNotes: null,
    internalNotes: null,
    teacherSummary: {
      strengths: ['Clear structure'],
      improvementPriorities: ['More detail'],
      recommendedPractice: ['Timed writing drills'],
    },
    checklist: {
      listeningReviewed: true,
      readingReviewed: true,
      writingTask1Reviewed: true,
      writingTask2Reviewed: false,
      speakingReviewed: false,
      overallFeedbackWritten: true,
      rubricComplete: true,
      annotationsComplete: false,
    },
    hasUnsavedChanges: false,
    lastAutoSaveAt: '2026-01-01T12:05:00.000Z',
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:05:00.000Z',
    revision,
  };
}

function buildBundle(reviewDraft: Record<string, unknown> | null = buildDraft()) {
  return {
    submission: buildSubmission(),
    sections: [
      {
        id: 'sec-1',
        submissionId: 'sub-1',
        section: 'writing',
        answers: {
          type: 'writing',
          tasks: [
            {
              taskId: 'task1',
              taskLabel: 'Task 1',
              text: 'Task response',
              wordCount: 120,
              prompt: 'Summarise the chart.',
            },
          ],
        },
        autoGradingResults: null,
        gradingStatus: 'needs_review',
        reviewedBy: null,
        reviewedAt: null,
        finalizedBy: null,
        finalizedAt: null,
        submittedAt: '2026-01-01T11:59:00.000Z',
      },
    ],
    writingTasks: [
      {
        id: 'wrt-1',
        sectionSubmissionId: 'sec-1',
        submissionId: 'sub-1',
        taskId: 'task1',
        taskLabel: 'Task 1',
        prompt: 'Summarise the chart.',
        studentText: 'Task response',
        wordCount: 120,
        rubricAssessment: null,
        annotations: [],
        overallFeedback: null,
        studentVisibleNotes: null,
        gradingStatus: 'needs_review',
        submittedAt: '2026-01-01T11:59:00.000Z',
        gradedBy: null,
        gradedAt: null,
        finalizedBy: null,
        finalizedAt: null,
      },
    ],
    reviewDraft,
  };
}

describe('gradingService backend mode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('loads grading sessions and submission bundles from the backend', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_GRADING', 'true');
    const bundle = buildBundle();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/grading/sessions') {
        return jsonResponse([buildSession()]);
      }
      if (url === '/api/v1/grading/sessions/sched-1?page=1&pageSize=100') {
        return jsonResponse({
          session: buildSession(),
          submissions: [buildSubmission()],
          pagination: { page: 1, pageSize: 100, total: 1, hasMore: false },
        });
      }
      if (url === '/api/v1/grading/submissions/sub-1') {
        return jsonResponse({
          submission: bundle.submission,
          reviewDraft: {
            id: 'draft-1',
            submissionId: 'sub-1',
            teacherId: 'grader-1',
            releaseStatus: 'draft',
            hasUnsavedChanges: false,
            lastAutoSaveAt: '2026-01-01T12:05:00.000Z',
            updatedAt: '2026-01-01T12:05:00.000Z',
            revision: 0,
          },
        });
      }
      if (url === '/api/v1/grading/submissions/sub-1/sections') {
        return jsonResponse(bundle.sections);
      }
      if (url === '/api/v1/grading/submissions/sub-1/writing-tasks') {
        return jsonResponse(bundle.writingTasks);
      }
      if (url === '/api/v1/grading/submissions/sub-1/review-draft') {
        return jsonResponse(buildDraft(0));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const queueResult = await gradingService.getSessionQueue();
    expect(queueResult.success).toBe(true);
    expect(queueResult.data).toEqual([
      expect.objectContaining({
        id: 'sched-1',
        totalStudents: 1,
        pendingManualReviews: 1,
      }),
    ]);

    const submissionsResult = await gradingService.getSessionStudentSubmissions('sched-1');
    expect(submissionsResult.success).toBe(true);
    expect(submissionsResult.data).toEqual([
      expect.objectContaining({
        id: 'sub-1',
        studentId: 'alice',
        gradingStatus: 'submitted',
      }),
    ]);

    const submission = await gradingRepository.getSubmissionById('sub-1');
    const sections = await gradingRepository.getSectionSubmissionsBySubmissionId('sub-1');
    const writingTasks = await gradingRepository.getWritingSubmissionsBySubmissionId('sub-1');
    const reviewDraft = await gradingRepository.getReviewDraftBySubmission('sub-1');

    expect(submission).toMatchObject({
      id: 'sub-1',
      studentName: 'Alice Roe',
    });
    expect(sections).toEqual([
      expect.objectContaining({
        id: 'sec-1',
        section: 'writing',
      }),
    ]);
    expect(writingTasks).toEqual([
      expect.objectContaining({
        id: 'wrt-1',
        taskId: 'task1',
      }),
    ]);
    expect(reviewDraft).toMatchObject({
      id: 'draft-1',
      submissionId: 'sub-1',
      teacherId: 'grader-1',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/grading/sessions',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/grading/sessions/sched-1?page=1&pageSize=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/grading/submissions/sub-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/grading/submissions/sub-1/sections',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/grading/submissions/sub-1/writing-tasks',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/grading/submissions/sub-1/review-draft',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('loads a paginated session queue page with server-side search', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_GRADING', 'true');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/grading/sessions?page=2&pageSize=10&search=cambridge') {
        return jsonResponse({
          sessions: [buildSession()],
          pagination: { page: 2, pageSize: 10, total: 23, hasMore: true },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await gradingService.getSessionQueuePage({
      page: 2,
      pageSize: 10,
      searchQuery: 'cambridge',
    });

    expect(result.success).toBe(true);
    expect(result.data?.sessions).toEqual([
      expect.objectContaining({ id: 'sched-1', examTitle: 'Mock Exam' }),
    ]);
    expect(result.data?.pagination).toEqual({ page: 2, pageSize: 10, total: 23, hasMore: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/grading/sessions?page=2&pageSize=10&search=cambridge',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('saves review drafts through the backend review-draft endpoint', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_GRADING', 'true');
    const initialDraft = buildDraft(0) as ReviewDraft;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(buildDraft(0)))
      .mockResolvedValueOnce(
        jsonResponse({
          ...buildDraft(1),
          overallFeedback: 'Updated feedback from the backend.',
        }),
      );
    global.fetch = fetchMock as typeof fetch;

    const startResult = await gradingService.startReview('sub-1', 'grader-1', 'Taylor Grader');
    expect(startResult.success).toBe(true);
    expect(startResult.data?.teacherId).toBe('grader-1');

    const saveResult = await gradingService.saveReviewDraft(
      {
        ...initialDraft,
        overallFeedback: 'Updated feedback from the backend.',
      },
      'grader-1',
      'Taylor Grader',
    );

    expect(saveResult.success).toBe(true);
    expect(saveResult.data).toMatchObject({
      id: 'draft-1',
      overallFeedback: 'Updated feedback from the backend.',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/grading/submissions/sub-1/start-review',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/grading/submissions/sub-1/review-draft',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual(
      expect.objectContaining({
        teacherId: 'grader-1',
        overallFeedback: 'Updated feedback from the backend.',
        revision: 0,
      }),
    );
  });

  it('schedules result release through the backend schedule-release endpoint', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_GRADING', 'true');
    const releaseAt = '2026-01-02T09:00:00.000Z';
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        ...buildDraft(2),
        releaseStatus: 'ready_to_release',
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const result = await gradingService.scheduleRelease(
      'sub-1',
      releaseAt,
      'grader-1',
      'Taylor Grader',
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      id: 'draft-1',
      releaseStatus: 'ready_to_release',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/grading/submissions/sub-1/schedule-release',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      expect.objectContaining({
        actorId: 'grader-1',
        teacherName: 'Taylor Grader',
        releaseAt,
      }),
    );
  });

  it('sends explicit grader override confirmation when releasing flagged submissions', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_GRADING', 'true');
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        id: 'result-1',
        submissionId: 'sub-1',
        studentId: 'student-1',
        studentName: 'Student One',
        releaseStatus: 'released',
        releasedAt: '2026-01-02T00:00:00.000Z',
        releasedBy: 'grader-1',
        overallBand: 6.5,
        sectionBands: {
          listening: 6.5,
          reading: 6.5,
          writing: 6.5,
          speaking: 6.5,
        },
        writingResults: {},
        teacherSummary: {
          strengths: [],
          improvementPriorities: [],
          recommendedPractice: [],
        },
        version: 1,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const result = await gradingService.releaseResult(
      'sub-1',
      'grader-1',
      'Taylor Grader',
      true,
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/grading/submissions/sub-1/release-now',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      expect.objectContaining({
        actorId: 'grader-1',
        graderOverrideConfirmed: true,
      }),
    );
  });

  it('surfaces backend grading failures instead of silently loading local queue data', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_GRADING', 'true');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'grading offline' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const result = await gradingService.getSessionQueue();

    expect(result.success).toBe(false);
    expect(result.error).toContain('grading offline');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/grading/sessions',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('upserts and deletes objective overrides through the backend override endpoints', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_GRADING', 'true');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            scheduleId: 'sched-1',
            questionId: 'q-reading-1',
            overrideJson: { correctAnswer: 'Top', scoringRule: 'ONE_WORD', maxScore: 1 },
            updatedByActorId: 'grader-1',
            updatedByActorName: 'Taylor Grader',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          overrideRow: {
            scheduleId: 'sched-1',
            questionId: 'q-reading-1',
            overrideJson: { correctAnswer: 'top', scoringRule: 'ONE_WORD', maxScore: 2 },
            updatedByActorId: 'grader-1',
            updatedByActorName: 'Taylor Grader',
            updatedAt: '2026-01-01T00:01:00.000Z',
          },
          regradeReport: {
            attemptsScanned: 1,
            submissionsMatched: 1,
            submissionsMissing: 0,
            sectionsChecked: 2,
            sectionsNeedingUpdate: 1,
            sectionsUpdated: 1,
            submissionsUpdated: 1,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          deleted: true,
          regradeReport: {
            attemptsScanned: 1,
            submissionsMatched: 1,
            submissionsMissing: 0,
            sectionsChecked: 2,
            sectionsNeedingUpdate: 1,
            sectionsUpdated: 1,
            submissionsUpdated: 1,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          draftVersionId: 'draft-123',
          regradeReport: {
            attemptsScanned: 1,
            submissionsMatched: 1,
            submissionsMissing: 0,
            sectionsChecked: 2,
            sectionsNeedingUpdate: 2,
            sectionsUpdated: 2,
            submissionsUpdated: 1,
          },
        }),
      );

    global.fetch = fetchMock as typeof fetch;

    const listResult = await gradingService.getObjectiveOverrides('sched-1');
    expect(listResult.success).toBe(true);

    const upsertResult = await gradingService.upsertObjectiveOverride('sched-1', 'q-reading-1', {
      correctAnswer: 'top',
      acceptedAnswers: [],
      correctOptionIds: [],
      scoringRule: 'ONE_WORD',
      maxScore: 2,
      reason: 'Case-sensitive correction',
    });
    expect(upsertResult.success).toBe(true);

    const deleteResult = await gradingService.deleteObjectiveOverride('sched-1', 'q-reading-1', {
      reason: 'Revert override',
    });
    expect(deleteResult.success).toBe(true);

    const regradeResult = await gradingService.regradeObjectiveLatestDraft('sched-1', {
      reason: 'Use latest draft snapshot',
    });
    expect(regradeResult.success).toBe(true);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/grading/schedules/sched-1/objective-overrides',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/grading/schedules/sched-1/objective-overrides/q-reading-1',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual(
      expect.objectContaining({
        correctAnswer: 'top',
        scoringRule: 'ONE_WORD',
        maxScore: 2,
        reason: 'Case-sensitive correction',
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/grading/schedules/sched-1/objective-overrides/q-reading-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual(
      expect.objectContaining({
        reason: 'Revert override',
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/grading/schedules/sched-1/objective-regrade-latest-draft',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual(
      expect.objectContaining({
        reason: 'Use latest draft snapshot',
      }),
    );
  });
});
