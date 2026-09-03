import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminResults } from '../AdminResults';

const { getActScienceReports, getAllStudentResults } = vi.hoisted(() => ({
  getActScienceReports: vi.fn(),
  getAllStudentResults: vi.fn(),
}));

vi.mock('../../../features/grading/infrastructure/gradingGateway', () => ({
  gradingService: {
    getActScienceReports,
  },
  gradingRepository: {
    getAllStudentResults,
  },
}));

describe('AdminResults', () => {
  beforeEach(() => {
    getActScienceReports.mockReset();
    getAllStudentResults.mockReset();
  });

  it('shows IELTS results and ACT Science reports from their shared backend grading data', async () => {
    getAllStudentResults.mockResolvedValue([
      {
        id: 'ielts-result-1',
        submissionId: 'ielts-submission-1',
        studentId: 'ielts-student-1',
        studentName: 'IELTS Student',
        releaseStatus: 'released',
        overallBand: 7.5,
        sectionBands: { listening: 8, reading: 7.5, writing: 7, speaking: 7.5 },
        writingResults: {},
        teacherSummary: {
          strengths: [],
          improvementPriorities: [],
          recommendedPractice: [],
        },
        version: 1,
        createdAt: '2026-08-28T08:00:00.000Z',
        updatedAt: '2026-08-28T08:00:00.000Z',
      },
    ]);
    getActScienceReports.mockResolvedValue({
      success: true,
      data: [
        {
          submissionId: 'submission-1',
          scheduleId: 'schedule-1',
          examId: 'exam-1',
          publishedVersionId: 'version-1',
          examTitle: 'ACT Science Practice',
          cohortName: 'August Cohort',
          studentId: 'best-1',
          studentName: 'Best Student',
          submittedAt: '2026-08-29T08:00:00.000Z',
          gradingStatus: 'submitted',
          score: {
            section: 'science',
            correctCount: 8,
            totalQuestions: 10,
            percentage: 80,
          },
        },
      ],
    });

    render(<AdminResults />);

    await waitFor(() => expect(screen.getByText('IELTS Student')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Best Student')).toBeInTheDocument());
    expect(screen.getAllByText('IELTS Results')).toHaveLength(2);
    expect(screen.getByText('ACT Science Reports')).toBeInTheDocument();
    expect(screen.getByText('ACT Science Practice')).toBeInTheDocument();
    expect(screen.getByText('8/10')).toBeInTheDocument();
    expect(screen.getAllByText('80.00%')).toHaveLength(2);

    fireEvent.change(screen.getByPlaceholderText('Search results...'), {
      target: { value: 'Best Student' },
    });
    expect(screen.getByText('Best Student')).toBeInTheDocument();
    expect(screen.queryByText('IELTS Student')).not.toBeInTheDocument();
  });
});
