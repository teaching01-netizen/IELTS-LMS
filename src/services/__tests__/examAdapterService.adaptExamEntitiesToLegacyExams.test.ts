import { describe, expect, it } from 'vitest';

import { adaptExamEntitiesToLegacyExams } from '../examAdapterService';
import type { ExamEntity } from '../../types/domain';

describe('adaptExamEntitiesToLegacyExams', () => {
  it('skips exams without a draft/published version id instead of rejecting', async () => {
    const entity = {
      id: 'exam-1',
      title: 'Broken exam',
      type: 'Academic',
      status: 'draft',
      owner: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      currentDraftVersionId: null,
      currentPublishedVersionId: null,
    } as unknown as ExamEntity;

    const exams = await adaptExamEntitiesToLegacyExams([entity], {
      getVersionById: async () => null,
    });

    expect(exams).toEqual([]);
  });
});

