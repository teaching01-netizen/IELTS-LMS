import { describe, expect, test, vi } from 'vitest';

import type { GradingSession, SectionSubmission } from '../../../types/grading';
import { createInitialExamState } from '../../../services/examAdapterService';
import { buildPerStudentZipPdfExportInput } from '../buildPerStudentZipPdfExportInput';

describe('buildPerStudentZipPdfExportInput', () => {
  test('resolves objective answer keys from the schedule grading source', async () => {
    const resolveExamState = vi.fn().mockResolvedValue(null);
    const session = {
      id: 'session-1',
      scheduleId: 'schedule-1',
      publishedVersionId: 'published-version-1',
      examTitle: 'Exam',
      cohortName: 'Cohort',
    } as GradingSession;

    await buildPerStudentZipPdfExportInput(
      {
        session,
        selectedSubmissions: [],
        selectedSections: ['reading'],
        pdfMode: 'combined',
        pdfFilenameTemplate: '{studentName}',
      },
      {
        getSectionSubmissionsBySubmissionId: vi.fn().mockResolvedValue([]),
        getWritingSubmissionsBySubmissionId: vi.fn().mockResolvedValue([]),
        resolveExamState,
      },
    );

    expect(resolveExamState).toHaveBeenCalledWith(
      'schedule-1',
      'published-version-1',
    );
  });
});

describe('buildPerStudentZipPdfExportInput version pinning', () => {
  function examWithShortAnswer(answer: string, title: string) {
    const state = createInitialExamState(title, 'Academic');
    state.reading.passages[0]!.blocks = [{
      id: 'short-block',
      type: 'SHORT_ANSWER',
      instruction: '',
      questions: [{ id: 'q-1', prompt: 'Name it', correctAnswer: answer, answerRule: 'ONE_WORD' }],
    }];
    return state;
  }

  test('resolves the objective source from the saved section result, not the session published version', async () => {
    const resolveExamState = vi.fn().mockResolvedValue(examWithShortAnswer('Published', 'Published version'));
    const resolveExamStateByVersionId = vi.fn().mockImplementation(async (versionId: string) => (
      versionId === 'draft-version-2'
        ? examWithShortAnswer('Draft', 'Draft version')
        : examWithShortAnswer('Published', 'Published version')
    ));
    const session = {
      id: 'session-1',
      scheduleId: 'schedule-1',
      publishedVersionId: 'published-version-1',
      examTitle: 'Exam',
      cohortName: 'Cohort',
    } as GradingSession;
    const sectionSubmission = {
      id: 'section-1',
      submissionId: 'submission-1',
      section: 'reading',
      answers: { type: 'reading', answers: { 'q-1': 'Draft' } },
      autoGradingResults: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalScore: 1,
        maxScore: 1,
        percentage: 100,
        integrity: { gradingSourceVersionId: 'draft-version-2' },
        questionResults: [{
          questionId: 'q-1',
          studentAnswer: 'Draft',
          correctAnswer: 'Draft',
          isCorrect: true,
          awardedScore: 1,
          maxScore: 1,
          scoringRule: 'one_word',
          hasOverride: false,
        }],
      },
      gradingStatus: 'auto_graded',
      submittedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as SectionSubmission;

    const result = await buildPerStudentZipPdfExportInput(
      {
        session,
        selectedSubmissions: [{
          id: 'submission-1',
          scheduleId: 'schedule-1',
          studentName: 'Student',
          studentId: 'student-1',
          cohortName: 'Cohort',
          submittedAt: '2026-01-01T00:00:00.000Z',
        } as never],
        selectedSections: ['reading'],
        pdfMode: 'combined',
        pdfFilenameTemplate: '{studentName}',
      },
      {
        getSectionSubmissionsBySubmissionId: vi.fn().mockResolvedValue([sectionSubmission]),
        getWritingSubmissionsBySubmissionId: vi.fn().mockResolvedValue([]),
        resolveExamState,
        resolveExamStateByVersionId,
      },
    );

    expect(resolveExamStateByVersionId).toHaveBeenCalledWith('draft-version-2');
    expect(resolveExamState).not.toHaveBeenCalled();
    const sectionData = result.students[0]?.sectionData.reading as
      | { row: Record<string, unknown> | null }
      | undefined;
    expect(sectionData?.row?.['rightAnswer:q-1']).toBe('Draft');
  });
});
