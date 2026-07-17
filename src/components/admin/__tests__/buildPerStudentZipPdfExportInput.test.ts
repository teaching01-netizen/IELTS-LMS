import { describe, expect, test, vi } from 'vitest';

import type { GradingSession } from '../../../types/grading';
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
