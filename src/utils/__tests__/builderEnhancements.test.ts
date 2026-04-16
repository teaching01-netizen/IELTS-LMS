import { describe, expect, it } from 'vitest';
import {
  buildSpeakingRubric,
  buildWritingRubric,
  calculateWeightedBandScore,
  getPassageMetrics,
  isRubricDeviationHigh,
} from '../builderEnhancements';
import { createDefaultConfig } from '../../constants/examDefaults';

const repeatWord = (count: number) => Array.from({ length: count }, () => 'word').join(' ');

describe('builderEnhancements', () => {
  it('classifies passage length using IELTS guidance bands', () => {
    expect(getPassageMetrics(repeatWord(820)).status).toBe('optimal');
    expect(getPassageMetrics(repeatWord(650)).status).toBe('warning');
    expect(getPassageMetrics(repeatWord(1300)).status).toBe('critical');
  });

  it('classifies passage length using custom guidance bands', () => {
    const ranges = {
      optimalMin: 100,
      optimalMax: 200,
      warningMin: 80,
      warningMax: 220,
    };

    expect(getPassageMetrics(repeatWord(150), ranges).status).toBe('optimal');
    expect(getPassageMetrics(repeatWord(90), ranges).status).toBe('warning');
    expect(getPassageMetrics(repeatWord(300), ranges).status).toBe('critical');
  });

  it('counts words from rich text without HTML tags', () => {
    const metrics = getPassageMetrics('<h1>Title</h1><p>Hello <strong>IELTS</strong> world.</p>');

    expect(metrics.words).toBe(4);
    expect(metrics.characters).toBeGreaterThan(0);
  });

  it('calculates weighted rubric bands to the nearest half band', () => {
    const score = calculateWeightedBandScore([
      { weight: 25, band: 7 },
      { weight: 25, band: 8 },
      { weight: 25, band: 7 },
      { weight: 25, band: 8 },
    ]);

    expect(score).toBe(7.5);
  });

  it('flags rubric weight changes beyond 10 percent from official weights', () => {
    expect(
      isRubricDeviationHigh([
        { weight: 30, officialWeight: 25 },
        { weight: 20, officialWeight: 25 },
      ]),
    ).toBe(false);

    expect(
      isRubricDeviationHigh([
        { weight: 40, officialWeight: 25 },
        { weight: 10, officialWeight: 25 },
      ]),
    ).toBe(true);
  });

  it('respects a custom rubric deviation threshold', () => {
    expect(
      isRubricDeviationHigh(
        [
          { weight: 32, officialWeight: 25 },
          { weight: 18, officialWeight: 25 },
        ],
        8,
      ),
    ).toBe(false);

    expect(
      isRubricDeviationHigh(
        [
          { weight: 35, officialWeight: 25 },
          { weight: 15, officialWeight: 25 },
        ],
        8,
      ),
    ).toBe(true);
  });

  it('builds rubric weights from config standards', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.standards.rubricWeights.writing.taskResponse = 35;
    config.standards.rubricWeights.speaking.fluency = 30;

    const writingRubric = buildWritingRubric(config);
    const speakingRubric = buildSpeakingRubric(config);

    expect(writingRubric.criteria.find((criterion) => criterion.id === 'task-response')?.weight).toBe(35);
    expect(speakingRubric.criteria.find((criterion) => criterion.id === 'fluency')?.weight).toBe(30);
  });
});
