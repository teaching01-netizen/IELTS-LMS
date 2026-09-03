import React from 'react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GradingSessionDetail } from '../GradingSessionDetail';
import { gradingRepository } from '../../../services/gradingRepository';
import { gradingService } from '../../../services/gradingService';
import { seedDevelopmentFixtures } from '../../../features/exam-authoring/infrastructure/examAuthoringGateway';
import { createInitialExamState } from '../../../services/examAdapterService';
import { examRepository } from '../../../services/examRepository';
import { downloadCsvFile } from '../gradingReviewUtils';
import type { GradingSession, StudentSubmission, WritingTaskSubmission } from '../../../types/grading';

vi.mock('../../../services/developmentFixtures', () => ({
  seedDevelopmentFixtures: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/examRepository', () => ({
  examRepository: {
    getVersionById: vi.fn(),
  },
}));

vi.mock('../../../services/gradingService', () => ({
  gradingService: {
    getSessionStudentSubmissions: vi.fn(),
    getObjectiveGradingSource: vi.fn().mockResolvedValue({ success: false }),
  },
}));

vi.mock('../../../services/gradingRepository', () => ({
  gradingRepository: {
    getSessionById: vi.fn(),
    getSubmissionsBySession: vi.fn(),
    getSectionSubmissionsBySubmissionId: vi.fn(),
    getWritingSubmissionsBySubmissionId: vi.fn(),
  },
}));

vi.mock('../gradingReviewUtils', async () => {
  const actual = await vi.importActual<typeof import('../gradingReviewUtils')>('../gradingReviewUtils');

  return {
    ...actual,
    downloadCsvFile: vi.fn(),
  };
});

const baseSession: GradingSession = {
  id: 'session-1',
  scheduleId: 'schedule-1',
  examId: 'exam-1',
  examTitle: 'IELTS Mock Test',
  publishedVersionId: 'version-1',
  cohortName: 'April Cohort',
  startTime: '2026-04-28T08:00:00.000Z',
  endTime: '2026-04-28T11:00:00.000Z',
  status: 'completed',
  totalStudents: 2,
  submittedCount: 2,
  pendingManualReviews: 0,
  inProgressReviews: 0,
  finalizedReviews: 0,
  overdueReviews: 0,
  assignedTeachers: [],
  createdAt: '2026-04-28T08:00:00.000Z',
  createdBy: 'teacher-1',
  updatedAt: '2026-04-28T11:00:00.000Z',
};

const makeSubmission = (id: string, studentName: string): StudentSubmission => ({
  id,
  submissionId: `attempt-${id}`,
  scheduleId: 'schedule-1',
  examId: 'exam-1',
  publishedVersionId: 'version-1',
  studentId: `student-${id}`,
  studentName,
  studentEmail: `${id}@example.com`,
  cohortName: 'April Cohort',
  submittedAt: '2026-04-28T10:30:00.000Z',
  timeSpentSeconds: 7200,
  gradingStatus: 'submitted',
  isFlagged: false,
  isOverdue: false,
  sectionStatuses: {
    listening: 'auto_graded',
    reading: 'auto_graded',
    writing: 'needs_review',
    speaking: 'pending',
  },
  createdAt: '2026-04-28T08:00:00.000Z',
  updatedAt: '2026-04-28T10:30:00.000Z',
});

const makeWritingTask = (submissionId: string, taskId: string, response: string): WritingTaskSubmission => ({
  id: `${submissionId}-${taskId}`,
  submissionId,
  taskId,
  taskLabel: taskId === 'task1' ? 'Task 1' : 'Task 2',
  prompt: '<p>Describe the chart.</p>',
  studentText: `<p><strong>${response}</strong></p>`,
  wordCount: response.split(/\s+/).length,
  annotations: [],
  gradingStatus: 'needs_review',
  submittedAt: '2026-04-28T10:30:00.000Z',
});

describe('GradingSessionDetail print writing', () => {
  const studentOne = makeSubmission('sub-1', 'Ada Student');
  const studentTwo = makeSubmission('sub-2', 'Ben Student');
  let printedSnapshot = '';
  const printSpy = vi.fn(() => {
    printedSnapshot = document.querySelector('.session-writing-print-root')?.textContent ?? '';
  });

  beforeEach(() => {
    vi.resetAllMocks();
    printedSnapshot = '';
    vi.spyOn(window, 'print').mockImplementation(printSpy);
    (seedDevelopmentFixtures as any).mockResolvedValue(undefined);
    (gradingService.getObjectiveGradingSource as any).mockResolvedValue({ success: false });
    (examRepository.getVersionById as any).mockResolvedValue(null);

    (gradingRepository.getSessionById as any).mockResolvedValue(baseSession);
    (gradingService.getSessionStudentSubmissions as any).mockResolvedValue({
      success: true,
      data: [studentOne, studentTwo],
    });
    (gradingRepository.getSubmissionsBySession as any).mockResolvedValue([studentOne, studentTwo]);
    (gradingRepository.getWritingSubmissionsBySubmissionId as any).mockImplementation((submissionId: string) =>
      Promise.resolve([
        makeWritingTask(submissionId, 'task1', submissionId === 'sub-1' ? 'Ada response text' : 'Ben response text'),
      ]),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

test('prints writing document from grading session detail', async () => {
    render(
      <GradingSessionDetail
        sessionId="session-1"
        onBack={vi.fn()}
        onStudentSelect={vi.fn()}
      />,
    );

    const exportButton = await screen.findByRole('button', { name: 'Export' });
    fireEvent.click(exportButton);
    const printAllWritingButton = await screen.findByRole('menuitem', { name: /print all writing/i });
    fireEvent.click(printAllWritingButton);

    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    expect(downloadCsvFile).not.toHaveBeenCalled();
    expect(gradingRepository.getWritingSubmissionsBySubmissionId).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Science')).not.toBeInTheDocument();
  });

  test('shows the ACT Science status only when the session contains ACT submissions', async () => {
    (gradingRepository.getSessionById as any).mockResolvedValue({
      ...baseSession,
      examTitle: 'ACT Science Practice',
    });
    (gradingService.getSessionStudentSubmissions as any).mockResolvedValue({
      success: true,
      data: [
        {
          ...studentOne,
          studentName: 'Best Student',
          sectionStatuses: {
            ...studentOne.sectionStatuses,
            science: 'auto_graded',
          },
        },
      ],
    });

    render(
      <GradingSessionDetail
        sessionId="session-1"
        onBack={vi.fn()}
        onStudentSelect={vi.fn()}
      />,
    );

    const actStudent = await screen.findByText('Best Student');
    expect(actStudent).toBeInTheDocument();
    expect(screen.getByText('Science')).toBeInTheDocument();
    const actRow = actStudent.closest('tr') as HTMLElement;
    expect(within(actRow).getAllByText('NA')).toHaveLength(4);
    expect(within(actRow).getAllByText('Auto')).toHaveLength(1);
  });

  test('downloads ACT Science answers and scores from the session export menu', async () => {
    const examState = createInitialExamState('ACT Science Practice', 'ACT', 'ACT Science');
    examState.science.stimuli = [{
      id: 'stimulus-1',
      title: 'Water experiment',
      content: 'Experiment results',
      blocks: [{
        id: 'science-block-1',
        type: 'SINGLE_MCQ',
        instruction: 'Choose the best answer.',
        stem: 'Use the experiment results.',
        questions: [{
          id: 'science-q1',
          stem: 'What happened to the water?',
          skillCategory: 'interpretation_of_data',
          options: [
            { id: 'option-a', text: 'water increased', isCorrect: true },
            { id: 'option-b', text: 'water decreased', isCorrect: false },
          ],
        }],
      }],
      images: [],
    }] as any;
    const actStudent = {
      ...studentOne,
      sectionStatuses: {
        ...studentOne.sectionStatuses,
        science: 'auto_graded',
      },
    };

    (gradingRepository.getSessionById as any).mockResolvedValue({
      ...baseSession,
      examTitle: 'ACT Science Practice',
    });
    (gradingService.getSessionStudentSubmissions as any).mockResolvedValue({
      success: true,
      data: [actStudent],
    });
    (gradingRepository.getSubmissionsBySession as any).mockResolvedValue([actStudent]);
    (gradingRepository.getSectionSubmissionsBySubmissionId as any).mockResolvedValue([{
      id: 'science-section-1',
      submissionId: actStudent.id,
      section: 'science',
      answers: {
        type: 'science',
        answers: { 'science-q1': 'option-b' },
      },
      autoGradingResults: {
        generatedAt: '2026-04-28T10:30:00.000Z',
        totalScore: 0,
        maxScore: 1,
        percentage: 0,
        questionResults: [{
          questionId: 'science-q1',
          studentAnswer: 'option-b',
          correctAnswer: 'option-a',
          isCorrect: false,
          awardedScore: 0,
          maxScore: 1,
          scoringRule: 'single_choice',
          hasOverride: false,
        }],
      },
      gradingStatus: 'auto_graded',
      submittedAt: actStudent.submittedAt,
    }]);
    (examRepository.getVersionById as any).mockResolvedValue({
      id: actStudent.publishedVersionId,
      contentSnapshot: examState,
    });

    render(
      <GradingSessionDetail
        sessionId="session-1"
        onBack={vi.fn()}
        onStudentSelect={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /act science answers & scores/i }));

    await waitFor(() => expect(gradingRepository.getSubmissionsBySession).toHaveBeenCalledWith('session-1'));
    expect(gradingService.getObjectiveGradingSource).toHaveBeenCalledWith('schedule-1');
    expect(examRepository.getVersionById).toHaveBeenCalledWith('version-1');
    await waitFor(() => expect(downloadCsvFile).toHaveBeenCalledWith(
      expect.stringContaining('science'),
      expect.stringContaining('B. water decreased'),
    ));
  });

  test('keeps the IELTS section statuses for an IELTS submission', async () => {
    render(
      <GradingSessionDetail
        sessionId="session-1"
        onBack={vi.fn()}
        onStudentSelect={vi.fn()}
      />,
    );

    const ieltsStudent = await screen.findByText('Ada Student');
    const ieltsRow = ieltsStudent.closest('tr') as HTMLElement;
    expect(within(ieltsRow).queryByText('NA')).not.toBeInTheDocument();
    expect(within(ieltsRow).getAllByText('Auto')).toHaveLength(2);
    expect(within(ieltsRow).getAllByText('Review')).toHaveLength(2);
    expect(within(ieltsRow).getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText('Science')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.queryByRole('menuitem', { name: /act science answers & scores/i })).not.toBeInTheDocument();
  });
});
