import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../backendBridge', () => ({
  backendPost: vi.fn(),
  backendPut: vi.fn(),
  isBackendGradingEnabled: vi.fn(() => false),
}));

vi.mock('../gradingRepository', () => ({
  gradingRepository: {
    getAllSessions: vi.fn(),
    getReviewDraftBySubmission: vi.fn(),
    getSubmissionById: vi.fn(),
    getWritingSubmissionsBySubmissionId: vi.fn(),
    getStudentResultsBySubmission: vi.fn(),
    saveStudentResult: vi.fn(),
    saveSubmission: vi.fn(),
    saveReviewDraft: vi.fn(),
    deleteReviewDraft: vi.fn(),
    getSessionById: vi.fn(),
    getSubmissionsBySession: vi.fn(),
    saveSession: vi.fn(),
    saveReviewEvent: vi.fn(),
    saveReleaseEvent: vi.fn(),
    saveWritingSubmission: vi.fn(),
  },
}));

import { gradingRepository } from '../gradingRepository';

function buildSubmission() {
  return {
    id: 'sub-1',
    submissionId: 'sub-1',
    scheduleId: 'sched-1',
    examId: 'exam-1',
    publishedVersionId: 'ver-1',
    studentId: 'student-1',
    studentName: 'Amina Khan',
    studentEmail: 'amina@example.com',
    cohortName: 'Cohort A',
    submittedAt: '2026-01-01T09:00:00.000Z',
    timeSpentSeconds: 3600,
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
      speaking: 'pending',
    },
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T09:00:00.000Z',
  };
}

function buildDraft() {
  return {
    id: 'draft-1',
    submissionId: 'sub-1',
    studentId: 'student-1',
    teacherId: 'grader-1',
    releaseStatus: 'draft',
    sectionDrafts: {
      writing: {
        task1: {
          taskResponseBand: 6,
          coherenceBand: 6.5,
          lexicalBand: 6,
          grammarBand: 5.5,
          overallBand: 6,
          wordCount: 143,
          gradingStatus: 'in_review',
          taskResponseNotes: 'Good response.',
          coherenceNotes: 'Clear progression.',
          lexicalNotes: 'Some repetition.',
          grammarNotes: 'Check articles.',
        },
      },
    },
    annotations: [
      {
        id: 'anno-1',
        taskId: 'task1',
        type: 'inline_comment',
        startOffset: 0,
        endOffset: 4,
        selectedText: 'Task',
        comment: 'Good opening',
        visibility: 'student_visible',
        createdBy: 'grader-1',
        createdAt: '2026-01-01T10:00:00.000Z',
      },
    ],
    drawings: [],
    overallFeedback: 'Solid effort.',
    studentVisibleNotes: null,
    internalNotes: null,
    teacherSummary: {
      strengths: ['Clear structure'],
      improvementPriorities: ['Add detail'],
      recommendedPractice: ['Timed essays'],
    },
    checklist: {
      listeningReviewed: true,
      readingReviewed: true,
      writingTask1Reviewed: true,
      writingTask2Reviewed: false,
      speakingReviewed: false,
      overallFeedbackWritten: true,
      rubricComplete: true,
      annotationsComplete: true,
    },
    hasUnsavedChanges: false,
    lastAutoSaveAt: '2026-01-01T10:15:00.000Z',
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:15:00.000Z',
  };
}

function buildWritingTasks() {
  return [
    {
      id: 'wrt-1',
      sectionSubmissionId: 'sec-1',
      submissionId: 'sub-1',
      taskId: 'task1',
      taskLabel: 'Task 1',
      prompt: 'Summarise the chart.',
      studentText: 'The chart shows a steady increase.',
      wordCount: 143,
      rubricAssessment: null,
      annotations: [],
      overallFeedback: null,
      studentVisibleNotes: null,
      gradingStatus: 'needs_review',
      submittedAt: '2026-01-01T09:00:00.000Z',
      gradedBy: null,
      gradedAt: null,
      finalizedBy: null,
      finalizedAt: null,
    },
  ];
}

describe('gradingService local mode', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_GRADING', 'false');
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('releases writing results with the original prompt and response text', async () => {
    const { gradingService } = await import('../gradingService');
    const submission = buildSubmission();
    const draft = buildDraft();

    (gradingRepository.getSubmissionById as any).mockResolvedValue(submission);
    (gradingRepository.getReviewDraftBySubmission as any).mockResolvedValue(draft);
    (gradingRepository.getWritingSubmissionsBySubmissionId as any).mockResolvedValue(buildWritingTasks());
    (gradingRepository.getStudentResultsBySubmission as any).mockResolvedValue([]);
    (gradingRepository.getSessionById as any).mockResolvedValue({
      id: 'sched-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Exam',
      publishedVersionId: 'ver-1',
      cohortName: 'Cohort A',
      institution: 'Center',
      startTime: '2026-01-01T08:00:00.000Z',
      endTime: '2026-01-01T12:00:00.000Z',
      status: 'completed',
      totalStudents: 1,
      submittedCount: 1,
      pendingManualReviews: 1,
      inProgressReviews: 0,
      finalizedReviews: 0,
      overdueReviews: 0,
      assignedTeachers: [],
      createdAt: '2026-01-01T08:00:00.000Z',
      createdBy: 'Admin',
      updatedAt: '2026-01-01T08:00:00.000Z',
    });
    (gradingRepository.getSubmissionsBySession as any).mockResolvedValue([submission]);

    const result = await gradingService.releaseResult('sub-1', 'grader-1', 'Taylor Grader');

    expect(result.success).toBe(true);
    expect(result.data?.writingResults.task1).toMatchObject({
      taskId: 'task1',
      prompt: 'Summarise the chart.',
      studentText: 'The chart shows a steady increase.',
      wordCount: 143,
      rubricScores: {
        taskResponse: 6,
        coherence: 6.5,
        lexical: 6,
        grammar: 5.5,
      },
    });
    expect(result.data?.writingResults.task1?.criterionFeedback).toMatchObject({
      taskResponse: 'Good response.',
      coherence: 'Clear progression.',
      lexical: 'Some repetition.',
      grammar: 'Check articles.',
    });
    expect(gradingRepository.saveStudentResult).toHaveBeenCalled();
  });

  it('sorts sessions with invalid timestamps last', async () => {
    const { gradingService } = await import('../gradingService');
    (gradingRepository.getAllSessions as any).mockResolvedValue([
      {
        id: 'sched-bad',
        startTime: 'not-a-date',
      },
      {
        id: 'sched-good',
        startTime: '2026-01-02T09:00:00.000Z',
      },
      {
        id: 'sched-missing',
        startTime: undefined,
      },
    ]);

    const result = await gradingService.getSessionQueue();

    expect(result.success).toBe(true);
    expect(result.data?.map((session) => session.id)).toEqual([
      'sched-good',
      'sched-bad',
      'sched-missing',
    ]);
  });

  it('routes annotations to the matching writing task', async () => {
    const { gradingService } = await import('../gradingService');
    const submission = buildSubmission();
    const draft = buildDraft();
    const annotation = {
      id: 'anno-2',
      taskId: 'task1',
      type: 'inline_comment',
      startOffset: 5,
      endOffset: 9,
      selectedText: 'text',
      comment: 'Check this phrase',
      visibility: 'student_visible',
      createdBy: 'grader-1',
      createdAt: '2026-01-01T10:05:00.000Z',
    } as const;

    (gradingRepository.getSubmissionById as any).mockResolvedValue(submission);
    (gradingRepository.getReviewDraftBySubmission as any).mockResolvedValue(draft);
    (gradingRepository.getWritingSubmissionsBySubmissionId as any).mockResolvedValue(buildWritingTasks());

    const result = await gradingService.addWritingAnnotation('sub-1', annotation, 'grader-1', 'Taylor Grader');

    expect(result.success).toBe(true);
    expect(gradingRepository.saveWritingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task1',
        annotations: expect.arrayContaining([annotation]),
      }),
    );
    expect(gradingRepository.saveReviewDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        annotations: expect.arrayContaining([annotation]),
        hasUnsavedChanges: true,
      }),
    );
  });
});
