import { describe, expect, it } from 'vitest';
import { createInitialExamState } from '../../services/examAdapterService';
import { createAcademicSampleExamState } from '../academicSampleExam';
import { getListeningTotalQuestions, getReadingTotalQuestions, validateListeningModule, validateReadingModule } from '../examUtils';
import { getExamIdCollisionIssues } from '../examIdCollisionCheck';

describe('createAcademicSampleExamState', () => {
  it('builds a valid Academic sample with 40 listening and 40 reading questions', () => {
    const base = createInitialExamState('Base', 'Academic', 'Academic');
    const seeded = createAcademicSampleExamState(base);

    expect(seeded.type).toBe('Academic');
    expect(seeded.config.sections.speaking.enabled).toBe(false);
    expect(seeded.config.sections.listening.enabled).toBe(true);
    expect(seeded.config.sections.reading.enabled).toBe(true);
    expect(seeded.config.sections.writing.enabled).toBe(true);

    expect(getListeningTotalQuestions(seeded.listening.parts)).toBe(40);
    expect(getReadingTotalQuestions(seeded.reading.passages)).toBe(40);

    const listeningErrors = validateListeningModule(seeded.listening.parts).filter((e) => e.type === 'error');
    const readingErrors = validateReadingModule(seeded.reading.passages).filter((e) => e.type === 'error');
    expect(listeningErrors).toHaveLength(0);
    expect(readingErrors).toHaveLength(0);

    const integrityErrors = getExamIdCollisionIssues(seeded).filter((issue) => issue.severity === 'error');
    expect(integrityErrors).toHaveLength(0);
  });
});

