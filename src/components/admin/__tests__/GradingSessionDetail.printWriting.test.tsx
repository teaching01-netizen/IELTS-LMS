import React from 'react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GradingSessionDetail } from '../GradingSessionDetail';
import { gradingRepository } from '../../../services/gradingRepository';
import { gradingService } from '../../../services/gradingService';
import { examRepository } from '../../../services/examRepository';
import { createInitialExamState } from '../../../services/examAdapterService';
import { downloadCsvFile } from '../gradingReviewUtils';
import type { GradingSession, SectionSubmission, StudentSubmission, WritingTaskSubmission } from '../../../types/grading';

vi.mock('../../../services/developmentFixtures', () => ({
  seedDevelopmentFixtures: vi.fn().mockResolvedValue(false),
}));

vi.mock('@services/developmentFixtures', () => ({
  seedDevelopmentFixtures: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../services/examRepository', () => ({
  examRepository: {
    getVersionById: vi.fn(),
  },
}));

vi.mock('../../../services/gradingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/gradingService')>();

  return {
    // The pure formatter is not worth faking: keeping the real one means the
    // alert copy exercised here cannot drift from the shipped helper.
    gradingErrorMessage: actual.gradingErrorMessage,
    gradingService: {
      getSessionStudentSubmissions: vi.fn(),
      getObjectiveGradingSource: vi.fn(),
    },
  };
});

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

describe('GradingSessionDetail exports', () => {
  const studentOne = makeSubmission('sub-1', 'Ada Student');
  const studentTwo = makeSubmission('sub-2', 'Ben Student');
  let printedSnapshot = '';
  const printSpy = vi.fn(() => {
    printedSnapshot = document.querySelector('.session-writing-print-root')?.textContent ?? '';
  });

  beforeEach(() => {
    vi.clearAllMocks();
    printedSnapshot = '';
    vi.spyOn(window, 'print').mockImplementation(printSpy);

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
    vi.clearAllMocks();
    vi.mocked(window.print).mockRestore();
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
    expect(printedSnapshot).toContain('Describe the chart.');
    expect(printedSnapshot).toContain('Ada response text');
    expect(printedSnapshot).toContain('Ben response text');
  });

  test('prints writing when a task has missing prompt or response text', async () => {
    const incompleteTask = {
      ...makeWritingTask('sub-1', 'task1', 'Ada response text'),
      prompt: undefined,
      studentText: undefined,
    } as unknown as WritingTaskSubmission;
    (gradingRepository.getWritingSubmissionsBySubmissionId as any).mockImplementation((submissionId: string) =>
      Promise.resolve(submissionId === 'sub-1' ? [incompleteTask] : []),
    );

    render(
      <GradingSessionDetail
        sessionId="session-1"
        onBack={vi.fn()}
        onStudentSelect={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /print all writing/i }));

    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    expect(printedSnapshot).toContain('Prompt unavailable.');
    expect(printedSnapshot).toContain('No writing response recorded.');
  });

  test.each([
    ['reading', 'answers & scores'],
    ['listening', 'answers & scores'],
    ['reading', 'manual check sheet'],
    ['listening', 'manual check sheet'],
  ] as const)('exports %s %s with each submission’s grading key', async (section, menuItem) => {
    const makeExam = (answer: string, regraded: boolean) => {
      const exam = createInitialExamState('IELTS Mock Test', 'Academic');
      const bands = { 0: 1, 1: regraded ? 4.5 : 4 };
      exam.config.standards.bandScoreTables.readingAcademic = bands;
      exam.config.standards.bandScoreTables.listening = bands;
      const block = {
        id: 'short-block',
        type: 'SHORT_ANSWER' as const,
        instruction: '',
        questions: [
          { id: 'q-1', prompt: 'Name it', correctAnswer: answer, answerRule: 'ONE_WORD' as const },
          ...(regraded ? [{ id: 'q-2', prompt: 'Second word', correctAnswer: 'Extra', answerRule: 'ONE_WORD' as const }] : []),
        ],
      };
      if (section === 'reading') exam.reading.passages[0]!.blocks = [block];
      else exam.listening.parts[0]!.blocks = [block];
      return exam;
    };
    const makeSection = (submission: StudentSubmission, answer: string, versionId?: string): SectionSubmission => ({
      id: `section-${submission.id}`,
      submissionId: submission.id,
      section,
      answers: section === 'reading' ? { type: section, passages: [] } : { type: section, parts: [] },
      autoGradingResults: {
        generatedAt: submission.submittedAt,
        totalScore: 1,
        maxScore: versionId ? 2 : 1,
        percentage: versionId ? 50 : 100,
        ...(versionId ? {
          integrity: {
            section,
            expectedQuestionCount: 2,
            verifiedCorrectCount: 1,
            verifiedIncorrectCount: 0,
            verifiedUnansweredCount: 1,
            unresolvedCount: 0,
            invalidCount: 0,
            unknownAnswerCount: 0,
            integrityStatus: 'verified',
            gradingSourceVersionId: versionId,
            questions: [],
          },
        } : {}),
        questionResults: [{
          questionId: 'q-1',
          studentAnswer: answer,
          correctAnswer: answer,
          isCorrect: true,
          awardedScore: 1,
          maxScore: 1,
          scoringRule: 'one_word',
          hasOverride: false,
        }],
      },
      gradingStatus: 'auto_graded',
      submittedAt: submission.submittedAt,
    });
    const published = makeExam('Original', false);
    const regraded = makeExam('Updated', true);
    vi.mocked(gradingService.getObjectiveGradingSource).mockResolvedValue({
      success: true,
      data: { draftVersionId: 'version-2' },
    });
    vi.mocked(examRepository.getVersionById).mockImplementation(async (id) => {
      const isDraft = id === 'version-2';
      const contentSnapshot = isDraft ? regraded : published;
      return {
        id,
        examId: baseSession.examId,
        versionNumber: isDraft ? 2 : 1,
        parentVersionId: isDraft ? baseSession.publishedVersionId : null,
        contentSnapshot,
        configSnapshot: contentSnapshot.config,
        createdBy: baseSession.createdBy,
        createdAt: baseSession.createdAt,
        isDraft,
        isPublished: !isDraft,
      };
    });
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId).mockImplementation(async (id) => [
      id === studentOne.id
        ? makeSection(studentOne, 'Original')
        : makeSection(studentTwo, 'Updated', 'version-2'),
    ]);

    render(<GradingSessionDetail sessionId={baseSession.id} onBack={vi.fn()} onStudentSelect={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(`${section} ${menuItem}`, 'i') }));
    await waitFor(() => expect(downloadCsvFile).toHaveBeenCalled());

    const csv = vi.mocked(downloadCsvFile).mock.calls[0]![1];
    const [headers, ...rows] = csv.split('\r\n').map((line) => line.split(','));
    const cell = (row: string[], header: string) => row[headers!.indexOf(header)];
    const manual = menuItem === 'manual check sheet';
    const keyLabel = manual ? 'Right Answer/Answer Key' : 'Right Answer';
    expect(rows.map((row) => cell(row, 'Student Name'))).toEqual(['Ada Student', 'Ben Student']);
    expect(rows.map((row) => cell(row, `Q1 ${keyLabel}`))).toEqual(['Original', 'Updated']);
    expect(rows.map((row) => cell(row, `Q2 ${keyLabel}`))).toEqual(['', 'Extra']);
    expect(rows.map((row) => cell(row, 'Total Score'))).toEqual(manual ? ['', ''] : ['1', '1']);
    if (manual) {
      expect(rows.map((row) => cell(row, 'Correct Q1'))).toEqual(['', '']);
    } else {
      expect(rows.map((row) => cell(row, 'Q1 Score'))).toEqual(['1', '1']);
      expect(rows.map((row) => cell(row, 'IELTS Band Score'))).toEqual(['4', '4.5']);
    }
  });

  test('downloads ACT Science CSV from the session export menu', async () => {
    const examState = createInitialExamState('ACT Science Practice', 'ACT', 'ACT Science');
    examState.science.stimuli = [
      {
        id: 'stimulus-1',
        title: 'Water experiment',
        content: 'Experiment results',
        blocks: [
          {
            id: 'science-block-1',
            type: 'SINGLE_MCQ',
            instruction: 'Choose the best answer.',
            stem: 'Use the experiment results.',
            questions: [
              {
                id: 'science-q1',
                stem: 'What happened to the water?',
                skillCategory: 'interpretation_of_data',
                options: [
                  { id: 'option-a', text: 'water increased', isCorrect: true },
                  { id: 'option-b', text: 'water decreased', isCorrect: false },
                ],
              },
            ],
          },
        ],
        images: [],
      },
    ] as any;
    const actStudent = {
      ...studentOne,
      sectionStatuses: { ...studentOne.sectionStatuses, science: 'auto_graded' },
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
    (gradingService.getObjectiveGradingSource as any).mockResolvedValue({
      success: true,
      data: { draftVersionId: 'version-1' },
    });
    (gradingRepository.getSectionSubmissionsBySubmissionId as any).mockResolvedValue([
      {
        id: 'science-section-1',
        submissionId: actStudent.id,
        section: 'science',
        answers: { type: 'science', answers: { 'science-q1': 'option-b' } },
        autoGradingResults: {
          generatedAt: '2026-04-28T10:30:00.000Z',
          totalScore: 0,
          maxScore: 1,
          percentage: 0,
          questionResults: [
            {
              questionId: 'science-q1',
              studentAnswer: 'option-b',
              correctAnswer: 'option-a',
              isCorrect: false,
              awardedScore: 0,
              maxScore: 1,
              scoringRule: 'single_choice',
              hasOverride: false,
            },
          ],
        },
        gradingStatus: 'auto_graded',
        submittedAt: actStudent.submittedAt,
      },
    ]);
    (examRepository.getVersionById as any).mockResolvedValue({
      id: 'version-1',
      contentSnapshot: examState,
    });

    render(
      <GradingSessionDetail sessionId="session-1" onBack={vi.fn()} onStudentSelect={vi.fn()} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /act science answers & scores/i }));

    await waitFor(() =>
      expect(downloadCsvFile).toHaveBeenCalledWith(
        expect.stringContaining('science'),
        expect.stringContaining('B. water decreased'),
      ),
    );
    const csv = vi.mocked(downloadCsvFile).mock.calls.at(-1)?.[1] ?? '';
    expect(csv).toContain('Interpretation of Data (IOD)');
    expect(csv).toContain('IOD correct');
  });
});
