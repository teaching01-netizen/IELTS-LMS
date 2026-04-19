import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../constants/examDefaults';
import { hydrateExamState } from '../examAdapterService';

describe('hydrateExamState', () => {
  it('fills missing exam sections when a corrupted draft only contains config', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.general.title = 'Recovered Exam';

    const hydrated = hydrateExamState({ config } as any);

    expect(hydrated.title).toBe('Recovered Exam');
    expect(hydrated.reading.passages).toHaveLength(config.sections.reading.passageCount);
    expect(hydrated.listening.parts).toHaveLength(config.sections.listening.partCount);
    expect(hydrated.writing.customPromptTemplates).toEqual([]);
    expect(hydrated.speaking.part1Topics.length).toBeGreaterThan(0);
  });

  it('fills missing reading and listening containers when partial content omits them', () => {
    const config = createDefaultConfig('Academic', 'Academic');

    const hydrated = hydrateExamState({
      config,
      title: 'Recovered Exam',
      type: 'Academic',
      writing: {
        task1Prompt: '',
        task2Prompt: '',
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: [],
      },
    } as any);

    expect(Array.isArray(hydrated.reading.passages)).toBe(true);
    expect(Array.isArray(hydrated.listening.parts)).toBe(true);
    expect(hydrated.reading.passages).toHaveLength(config.sections.reading.passageCount);
    expect(hydrated.listening.parts).toHaveLength(config.sections.listening.partCount);
  });
});
