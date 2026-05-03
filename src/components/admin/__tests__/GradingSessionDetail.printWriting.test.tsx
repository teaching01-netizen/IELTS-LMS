import React from 'react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GradingSessionDetail } from '../GradingSessionDetail';
import { gradingRepository } from '../../../services/gradingRepository';
import { gradingService } from '../../../services/gradingService';
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
    vi.restoreAllMocks();
  });

  test('prints all students writing without triggering a writing CSV download', async () => {
    render(
      <GradingSessionDetail
        sessionId="session-1"
        onBack={vi.fn()}
        onStudentSelect={vi.fn()}
      />,
    );

    const printButton = await screen.findByRole('button', { name: /print writing/i });
    fireEvent.click(printButton);

    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    expect(downloadCsvFile).not.toHaveBeenCalled();
    expect(gradingRepository.getWritingSubmissionsBySubmissionId).toHaveBeenCalledTimes(2);
    expect(printedSnapshot).toContain('Ada Student');
    expect(printedSnapshot).toContain('Ben Student');
    expect(printedSnapshot).toContain('Task 1');
    expect(printedSnapshot).toContain('Task 2');
    expect(printedSnapshot).toContain('Assessment Form');
    expect(document.querySelector('.session-writing-print-root')).toHaveTextContent('Ada Student');
    expect(document.querySelector('.session-writing-print-root')).toHaveTextContent('Ben Student');
    expect(document.querySelector('.session-writing-print-root')).toHaveTextContent('Task 1');
    expect(document.querySelector('.session-writing-print-root')).toHaveTextContent('Task 2');
    expect(document.querySelector('.session-writing-print-root')).toHaveTextContent('Assessment Form');
    expect(document.querySelector('.session-writing-print-root')).toHaveTextContent('No writing response recorded.');
    expect(document.querySelector('.session-writing-print-response')).toHaveTextContent('Ada response text');
    expect(document.querySelector('.session-writing-print-response strong')).toBeNull();
    expect(document.querySelectorAll('.session-writing-print-task-page')).toHaveLength(4);
    expect(document.querySelectorAll('.session-writing-print-page-header')).toHaveLength(4);
    const printStyle = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .find((text) => text.includes('.session-writing-print-root'));

    expect(printStyle).toContain('.session-writing-print-task-page');
    expect(printStyle).toContain('page-break-before: always');
    expect(printStyle).toContain('.session-writing-print-task-page-first');
    expect(printStyle).toContain('.session-writing-print-response');
    expect(printStyle).toContain('overflow-wrap: anywhere');
    expect(printStyle).toContain('word-break: break-word');
    expect(printStyle).not.toContain('break-inside: avoid');
  });
});
