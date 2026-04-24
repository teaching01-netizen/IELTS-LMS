import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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

  test('shows both writing tasks in the student preview with the correct labels and bands', async () => {
    const { createInitialExamState } = await import('../../../services/examAdapterService');
    const { gradingRepository } = await import('../../../services/gradingRepository');
    const { examRepository } = await import('../../../services/examRepository');
    const { StudentReviewWorkspace } = await import('../StudentReviewWorkspace');

    const examState = createInitialExamState('Exam', 'Academic');
    examState.writing.tasks = [
      { taskId: 'task1', prompt: 'Describe the chart.' } as any,
      { taskId: 'task2', prompt: 'Discuss the opinion.' } as any,
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

    (gradingRepository.getSectionSubmissionsBySubmissionId as any).mockResolvedValue([]);
    (gradingRepository.getWritingSubmissionsBySubmissionId as any).mockResolvedValue([
      {
        id: 'write-1',
        submissionId: 'sub-1',
        taskId: 'task1',
        taskLabel: 'Task 1',
        prompt: 'Describe the chart.',
        studentText: 'Task 1 response',
        wordCount: 3,
        rubricAssessment: null,
        annotations: [],
        overallFeedback: null,
        studentVisibleNotes: null,
        gradingStatus: 'needs_review',
        submittedAt: new Date().toISOString(),
        gradedBy: undefined,
        gradedAt: undefined,
        finalizedBy: undefined,
        finalizedAt: undefined,
      },
      {
        id: 'write-2',
        submissionId: 'sub-1',
        taskId: 'task2',
        taskLabel: 'Task 2',
        prompt: 'Discuss the opinion.',
        studentText: 'Task 2 response',
        wordCount: 3,
        rubricAssessment: null,
        annotations: [],
        overallFeedback: null,
        studentVisibleNotes: null,
        gradingStatus: 'needs_review',
        submittedAt: new Date().toISOString(),
        gradedBy: undefined,
        gradedAt: undefined,
        finalizedBy: undefined,
        finalizedAt: undefined,
      },
    ]);
    (gradingRepository.getReviewDraftBySubmission as any).mockResolvedValue({
      id: 'draft-1',
      submissionId: 'sub-1',
      studentId: 'stu-1',
      teacherId: 't-1',
      releaseStatus: 'ready_to_release',
      sectionDrafts: {
        writing: {
          task1: {
            taskResponseBand: 6,
            coherenceBand: 6.5,
            lexicalBand: 6,
            grammarBand: 5.5,
            overallBand: 6,
            wordCount: 3,
            gradingStatus: 'in_review',
            taskResponseNotes: 'Task 1 note',
            coherenceNotes: 'Task 1 coherence',
            lexicalNotes: 'Task 1 lexical',
            grammarNotes: 'Task 1 grammar',
          },
          task2: {
            taskResponseBand: 7,
            coherenceBand: 7,
            lexicalBand: 7.5,
            grammarBand: 7,
            overallBand: 7.5,
            wordCount: 3,
            gradingStatus: 'in_review',
            taskResponseNotes: 'Task 2 note',
            coherenceNotes: 'Task 2 coherence',
            lexicalNotes: 'Task 2 lexical',
            grammarNotes: 'Task 2 grammar',
          },
        },
      },
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

    fireEvent.click(await screen.findByRole('button', { name: /preview as student/i }));

    expect(await screen.findByText('Student Report Preview')).toBeInTheDocument();
    expect(await screen.findByText('Writing Task 2')).toBeInTheDocument();
    expect(screen.getByText('Band 7.5')).toBeInTheDocument();
    expect(screen.getByText('Task 2 response')).toBeInTheDocument();
  });
});
