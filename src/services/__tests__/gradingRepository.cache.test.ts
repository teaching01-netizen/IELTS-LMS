import { beforeEach, describe, expect, it, vi } from 'vitest';

const { backendGet } = vi.hoisted(() => ({
  backendGet: vi.fn(),
}));

vi.mock('../backendBridge', () => ({
  backendGet,
  isBackendNotFound: () => false,
}));

import { gradingRepository } from '../gradingRepository';

function buildBundle(overrides: Record<string, unknown> = {}) {
  return {
    submission: {
      id: 'sub-1',
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
    },
    sections: [],
    writingTasks: [],
    reviewDraft: {
      id: 'draft-1',
      submissionId: 'sub-1',
      studentId: 'student-1',
      teacherId: 'grader-1',
      releaseStatus: 'draft',
      sectionDrafts: {},
      annotations: [],
      drawings: [],
      overallFeedback: 'Initial feedback',
      studentVisibleNotes: undefined,
      internalNotes: undefined,
      teacherSummary: { strengths: [], improvementPriorities: [], recommendedPractice: [] },
      checklist: {},
      hasUnsavedChanges: false,
      lastAutoSaveAt: undefined,
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z',
      revision: 0,
    },
    ...overrides,
  };
}

describe('gradingRepository bundle cache', () => {
  beforeEach(() => {
    backendGet.mockReset();
  });

  it('reloads a submission bundle after saving a review draft', async () => {
    const initialDraft = buildBundle().reviewDraft;
    const updatedDraft = {
      ...buildBundle().reviewDraft,
      overallFeedback: 'Updated feedback',
      revision: 1,
    };

    backendGet
      .mockResolvedValueOnce(initialDraft)
      .mockResolvedValueOnce(updatedDraft);

    const firstDraft = await gradingRepository.getReviewDraftBySubmission('sub-1');
    expect(firstDraft?.overallFeedback).toBe('Initial feedback');

    await gradingRepository.saveReviewDraft({
      id: 'draft-1',
      submissionId: 'sub-1',
    } as never);

    const secondDraft = await gradingRepository.getReviewDraftBySubmission('sub-1');
    expect(secondDraft?.overallFeedback).toBe('Updated feedback');
    expect(backendGet).toHaveBeenCalledTimes(2);
  });

  it('reloads section submissions after targeted invalidation', async () => {
    const section = {
      id: 'section-1',
      submissionId: 'sub-2',
      section: 'reading',
      answers: { type: 'reading', passages: [] },
      gradingStatus: 'auto_graded',
      submittedAt: '2026-01-01T09:00:00.000Z',
    };
    const updatedSection = { ...section, id: 'section-2' };

    backendGet.mockResolvedValueOnce([section]).mockResolvedValueOnce([updatedSection]);

    const initialSections = await gradingRepository.getSectionSubmissionsBySubmissionId('sub-2');
    gradingRepository.invalidateSubmissionBundle('sub-2');
    const refreshedSections = await gradingRepository.getSectionSubmissionsBySubmissionId('sub-2');

    expect(initialSections[0]?.id).toBe('section-1');
    expect(refreshedSections[0]?.id).toBe('section-2');
    expect(backendGet).toHaveBeenCalledTimes(2);
  });
});
