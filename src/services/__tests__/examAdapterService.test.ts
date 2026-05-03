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

  it('clamps invalid passage/part counts to avoid crashing hydration', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    (config.sections.reading as any).passageCount = -5;
    (config.sections.listening as any).partCount = Number.NaN;

    expect(() => hydrateExamState({ config } as any)).not.toThrow();

    const hydrated = hydrateExamState({ config } as any);
    expect(hydrated.reading.passages.length).toBeGreaterThan(0);
    expect(hydrated.listening.parts.length).toBeGreaterThan(0);
  });

  it('normalizes legacy diagram image fields when imageUrl is empty', () => {
    const config = createDefaultConfig('Academic', 'Academic');

    const hydrated = hydrateExamState({
      config,
      title: 'Diagram Recovery Exam',
      type: 'Academic',
      reading: {
        passages: [],
      },
      listening: {
        parts: [
          {
            id: 'l1',
            title: 'Part 1',
            pins: [],
            blocks: [
              {
                id: 'd1',
                type: 'DIAGRAM_LABELING',
                title: 'Diagram one',
                instructions: '',
                imageUrl: '   ',
                imageSrc: ' /diagram-from-image-src.png ',
                labels: [{ id: 'label-1', x: 10, y: 20, correctAnswer: 'A' }],
              },
              {
                id: 'd2',
                type: 'DIAGRAM_LABELING',
                title: 'Diagram two',
                instructions: '',
                imageUrl: '',
                assetUrl: ' /diagram-from-asset-url.png ',
                labels: [{ id: 'label-2', x: 30, y: 40, correctAnswer: 'B' }],
              },
            ],
          },
        ],
      },
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

    const [diagramFromImageSrc, diagramFromAssetUrl] = hydrated.listening.parts[0].blocks as any[];
    expect(diagramFromImageSrc.imageUrl).toBe('/diagram-from-image-src.png');
    expect(diagramFromAssetUrl.imageUrl).toBe('/diagram-from-asset-url.png');
  });
});
