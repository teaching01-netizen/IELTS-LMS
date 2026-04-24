import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../services/gradingRepository', () => {
  return {
    gradingRepository: {
      getSubmissionById: vi.fn(),
      getSectionSubmissionsBySubmissionId: vi.fn(),
      getWritingSubmissionsBySubmissionId: vi.fn(),
      getReviewDraftBySubmission: vi.fn(),
    },
  };
});

vi.mock('../../../services/examRepository', () => {
  return {
    examRepository: {
      getVersionById: vi.fn(),
    },
  };
});

describe('StudentReviewWorkspace objective answers', () => {
  test('renders reading answers from backend bundle map', async () => {
    const { createInitialExamState } = await import('../../../services/examAdapterService');
    const { gradingRepository } = await import('../../../services/gradingRepository');
    const { examRepository } = await import('../../../services/examRepository');
    const { StudentReviewWorkspace } = await import('../StudentReviewWorkspace');

    const answerValue = 'student-ans-123';
    const questionId = 'q-1';

    const examState = createInitialExamState('Exam', 'Academic');
    examState.reading.passages = [
      {
        id: 'p1',
        title: 'Passage 1',
        content: 'Content',
        blocks: [
          {
            id: 'b1',
            type: 'SHORT_ANSWER',
            instruction: 'Answer',
            questions: [
              {
                id: questionId,
                prompt: 'What?',
                correctAnswer: 'correct',
                answerRule: 'ONE_WORD',
              },
            ],
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];

    (gradingRepository.getSubmissionById as any).mockResolvedValue({
      id: 'sub-1',
      submissionId: 'sub-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      publishedVersionId: 'ver-1',
      studentId: 'stu-1',
      studentName: 'Alice',
      studentEmail: 'alice@example.com',
      cohortName: 'Cohort',
      submittedAt: new Date().toISOString(),
      timeSpentSeconds: 0,
      gradingStatus: 'submitted',
      assignedTeacherId: undefined,
      assignedTeacherName: undefined,
      isFlagged: false,
      flagReason: undefined,
      isOverdue: false,
      dueDate: undefined,
      sectionStatuses: {
        listening: 'pending',
        reading: 'auto_graded',
        writing: 'needs_review',
        speaking: 'pending',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    (gradingRepository.getSectionSubmissionsBySubmissionId as any).mockResolvedValue([
      {
        id: 'sec-1',
        submissionId: 'sub-1',
        section: 'reading',
        answers: {
          type: 'reading',
          answers: {
            [questionId]: answerValue,
          },
        },
        autoGradingResults: undefined,
        gradingStatus: 'auto_graded',
        reviewedBy: undefined,
        reviewedAt: undefined,
        finalizedBy: undefined,
        finalizedAt: undefined,
        submittedAt: new Date().toISOString(),
      },
    ]);

    (gradingRepository.getWritingSubmissionsBySubmissionId as any).mockResolvedValue([]);
    (gradingRepository.getReviewDraftBySubmission as any).mockResolvedValue({
      id: 'draft-1',
      submissionId: 'sub-1',
      studentId: 'stu-1',
      teacherId: 't-1',
      releaseStatus: 'draft',
      sectionDrafts: {},
      annotations: [],
      drawings: [],
      overallFeedback: undefined,
      studentVisibleNotes: undefined,
      internalNotes: undefined,
      teacherSummary: { strengths: [], improvementPriorities: [], recommendedPractice: [] },
      checklist: {},
      hasUnsavedChanges: false,
      lastAutoSaveAt: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    (examRepository.getVersionById as any).mockResolvedValue({
      id: 'ver-1',
      contentSnapshot: examState,
    });

    render(
      <StudentReviewWorkspace
        submissionId="sub-1"
        onBack={() => {}}
        currentTeacherId="t-1"
        currentTeacherName="Teacher"
      />,
    );

    expect(await screen.findByText('Objective Answers')).toBeInTheDocument();
    expect(await screen.findByText(answerValue)).toBeInTheDocument();
  });

  test('does not crash when teacherSummary fields are missing', async () => {
    const { createInitialExamState } = await import('../../../services/examAdapterService');
    const { gradingRepository } = await import('../../../services/gradingRepository');
    const { examRepository } = await import('../../../services/examRepository');
    const { StudentReviewWorkspace } = await import('../StudentReviewWorkspace');

    const examState = createInitialExamState('Exam', 'Academic');
    examState.reading.passages = [];

    (gradingRepository.getSubmissionById as any).mockResolvedValue({
      id: 'sub-2',
      submissionId: 'sub-2',
      scheduleId: 'sched-2',
      examId: 'exam-2',
      publishedVersionId: 'ver-2',
      studentId: 'stu-2',
      studentName: 'Bob',
      studentEmail: 'bob@example.com',
      cohortName: 'Cohort',
      submittedAt: new Date().toISOString(),
      timeSpentSeconds: 0,
      gradingStatus: 'in_progress',
      assignedTeacherId: undefined,
      assignedTeacherName: undefined,
      isFlagged: false,
      flagReason: undefined,
      isOverdue: false,
      dueDate: undefined,
      sectionStatuses: {
        listening: 'pending',
        reading: 'pending',
        writing: 'pending',
        speaking: 'pending',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    (gradingRepository.getSectionSubmissionsBySubmissionId as any).mockResolvedValue([]);
    (gradingRepository.getWritingSubmissionsBySubmissionId as any).mockResolvedValue([]);
    (gradingRepository.getReviewDraftBySubmission as any).mockResolvedValue({
      id: 'draft-2',
      submissionId: 'sub-2',
      studentId: 'stu-2',
      teacherId: 't-1',
      releaseStatus: 'draft',
      sectionDrafts: {},
      annotations: [],
      drawings: [],
      overallFeedback: undefined,
      studentVisibleNotes: undefined,
      internalNotes: undefined,
      teacherSummary: {} as any,
      checklist: {},
      hasUnsavedChanges: false,
      lastAutoSaveAt: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    (examRepository.getVersionById as any).mockResolvedValue({
      id: 'ver-2',
      contentSnapshot: examState,
    });

    render(
      <StudentReviewWorkspace
        submissionId="sub-2"
        onBack={() => {}}
        currentTeacherId="t-1"
        currentTeacherName="Teacher"
      />,
    );

    expect(await screen.findByText('Teacher Summary')).toBeInTheDocument();
    expect(await screen.findByText('Strengths')).toBeInTheDocument();
  });
});
