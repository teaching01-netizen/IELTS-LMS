import {
  DEFAULT_PASSAGE_WORD_COUNT,
  DEFAULT_RUBRIC_DEVIATION_THRESHOLD,
  DEFAULT_LISTENING_BAND_TABLE,
  DEFAULT_READING_ACADEMIC_BAND_TABLE,
} from '../constants/examDefaults';
import type {
  ExamConfig,
  PassageWordCountStandards,
  SpeakingRubricWeights,
  WritingRubricWeights,
} from '../types';

export type PassageMetricStatus = 'optimal' | 'warning' | 'critical';

export interface PassageMetrics {
  words: number;
  characters: number;
  status: PassageMetricStatus;
  tone: 'green' | 'yellow' | 'red';
  tooltip: string;
}

export interface WeightedBandInput {
  band: number;
  weight: number;
}

export interface RubricDeviationInput {
  weight: number;
  officialWeight: number;
}

export interface PromptTemplate {
  id: string;
  title: string;
  topic: 'Education' | 'Technology' | 'Environment' | 'Health' | 'Society';
  category: 'Task 1 Academic' | 'Task 1 General Training' | 'Task 2 Essay';
  prompt: string;
  source: 'official' | 'custom';
}

export interface RubricCriterionDefinition {
  id: string;
  label: string;
  description: string;
  weight: number;
  officialWeight: number;
}

export interface RubricDefinition {
  id: string;
  title: string;
  module: 'writing' | 'speaking';
  criteria: RubricCriterionDefinition[];
}

export const PROMPT_TEMPLATE_LIBRARY: PromptTemplate[] = [
  {
    id: 'w1-education-line',
    title: 'Education Trends',
    topic: 'Education',
    category: 'Task 1 Academic',
    prompt: 'The line graph below shows tertiary enrolment rates in five countries between 2000 and 2025.',
    source: 'official',
  },
  {
    id: 'w1-technology-letter',
    title: 'Faulty Device Complaint',
    topic: 'Technology',
    category: 'Task 1 General Training',
    prompt: 'You recently bought a device online, but it arrived damaged. Write a letter to the seller explaining the problem and asking for a solution.',
    source: 'official',
  },
  {
    id: 'w2-environment-balance',
    title: 'Climate Responsibility',
    topic: 'Environment',
    category: 'Task 2 Essay',
    prompt: 'Some people think individuals should change their lifestyle to protect the environment, while others think governments and large companies should bear the main responsibility. Discuss both views and give your opinion.',
    source: 'official',
  },
  {
    id: 'w2-health-screen-time',
    title: 'Digital Health',
    topic: 'Health',
    category: 'Task 2 Essay',
    prompt: 'In many countries, children spend more time using screens than playing outside. Why is this happening, and what can be done about it?',
    source: 'official',
  },
  {
    id: 'w2-society-remote-work',
    title: 'Remote Work Society',
    topic: 'Society',
    category: 'Task 2 Essay',
    prompt: 'Remote work has become common in many industries. Do the advantages of this development outweigh the disadvantages?',
    source: 'official',
  },
];

export const OFFICIAL_WRITING_RUBRIC: RubricDefinition = {
  id: 'ielts-writing-official',
  title: 'IELTS Writing',
  module: 'writing',
  criteria: [
    {
      id: 'task-response',
      label: 'Task Achievement / Response',
      description: 'Addresses the task, selects key features, and develops a clear position.',
      weight: 25,
      officialWeight: 25,
    },
    {
      id: 'coherence',
      label: 'Coherence & Cohesion',
      description: 'Organizes ideas logically and links information clearly.',
      weight: 25,
      officialWeight: 25,
    },
    {
      id: 'lexical',
      label: 'Lexical Resource',
      description: 'Uses a flexible range of vocabulary with precision and control.',
      weight: 25,
      officialWeight: 25,
    },
    {
      id: 'grammar',
      label: 'Grammatical Range & Accuracy',
      description: 'Controls grammar and punctuation across simple and complex structures.',
      weight: 25,
      officialWeight: 25,
    },
  ],
};

export const OFFICIAL_SPEAKING_RUBRIC: RubricDefinition = {
  id: 'ielts-speaking-official',
  title: 'IELTS Speaking',
  module: 'speaking',
  criteria: [
    {
      id: 'fluency',
      label: 'Fluency & Coherence',
      description: 'Speaks at length, links ideas, and maintains clear progression.',
      weight: 25,
      officialWeight: 25,
    },
    {
      id: 'lexical',
      label: 'Lexical Resource',
      description: 'Uses precise vocabulary, paraphrase, and topic control.',
      weight: 25,
      officialWeight: 25,
    },
    {
      id: 'grammar',
      label: 'Grammatical Range & Accuracy',
      description: 'Uses varied sentence forms with consistent accuracy.',
      weight: 25,
      officialWeight: 25,
    },
    {
      id: 'pronunciation',
      label: 'Pronunciation',
      description: 'Maintains intelligibility through stress, rhythm, and sound control.',
      weight: 25,
      officialWeight: 25,
    },
  ],
};

export const OFFICIAL_BAND_SCORE_MATRICES = {
  listening: DEFAULT_LISTENING_BAND_TABLE,
  reading: DEFAULT_READING_ACADEMIC_BAND_TABLE,
};

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(content: string): number {
  const text = stripHtml(content);
  return text ? text.split(/\s+/).length : 0;
}

export function getPassageMetrics(
  content: string,
  ranges: PassageWordCountStandards = DEFAULT_PASSAGE_WORD_COUNT,
): PassageMetrics {
  const text = stripHtml(content);
  const words = text ? text.split(/\s+/).length : 0;
  const characters = text.length;
  const optimalRangeLabel = `${ranges.optimalMin}-${ranges.optimalMax}`;

  if (words >= ranges.optimalMin && words <= ranges.optimalMax) {
    return {
      words,
      characters,
      status: 'optimal',
      tone: 'green',
      tooltip: `Optimal passage length (${optimalRangeLabel} words).`,
    };
  }

  if (
    (words >= ranges.warningMin && words < ranges.optimalMin) ||
    (words > ranges.optimalMax && words <= ranges.warningMax)
  ) {
    return {
      words,
      characters,
      status: 'warning',
      tone: 'yellow',
      tooltip: `Usable, but outside the ideal ${optimalRangeLabel} word range.`,
    };
  }

  return {
    words,
    characters,
    status: 'critical',
    tone: 'red',
    tooltip: `Outside recommended ${ranges.warningMin}-${ranges.warningMax} word range.`,
  };
}

export function calculateWeightedBandScore(criteria: WeightedBandInput[]): number {
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (totalWeight === 0) {
    return 0;
  }

  const average =
    criteria.reduce((sum, criterion) => sum + criterion.band * criterion.weight, 0) /
    totalWeight;

  return Math.round(average * 2) / 2;
}

export function isRubricDeviationHigh(
  criteria: RubricDeviationInput[],
  threshold = DEFAULT_RUBRIC_DEVIATION_THRESHOLD,
): boolean {
  return criteria.some(
    (criterion) => Math.abs(criterion.weight - criterion.officialWeight) > threshold,
  );
}

const applyRubricWeights = (
  rubric: RubricDefinition,
  weights: Record<string, number>,
): RubricDefinition => ({
  ...rubric,
  criteria: rubric.criteria.map((criterion) => ({
    ...criterion,
    weight: weights[criterion.id] ?? criterion.weight,
  })),
});

const toWritingWeightMap = (weights: WritingRubricWeights): Record<string, number> => ({
  'task-response': weights.taskResponse,
  coherence: weights.coherence,
  lexical: weights.lexical,
  grammar: weights.grammar,
});

const toSpeakingWeightMap = (weights: SpeakingRubricWeights): Record<string, number> => ({
  fluency: weights.fluency,
  lexical: weights.lexical,
  grammar: weights.grammar,
  pronunciation: weights.pronunciation,
});

export function buildWritingRubric(
  config: Pick<ExamConfig, 'standards'>,
  rubric: RubricDefinition = OFFICIAL_WRITING_RUBRIC,
): RubricDefinition {
  return applyRubricWeights(rubric, toWritingWeightMap(config.standards.rubricWeights.writing));
}

export function buildSpeakingRubric(
  config: Pick<ExamConfig, 'standards'>,
  rubric: RubricDefinition = OFFICIAL_SPEAKING_RUBRIC,
): RubricDefinition {
  return applyRubricWeights(rubric, toSpeakingWeightMap(config.standards.rubricWeights.speaking));
}

export function createBandScoreRows(table: Record<number, number>, maxRaw = 40) {
  return Array.from({ length: maxRaw + 1 }, (_, index) => {
    const raw = maxRaw - index;
    const exact = table[raw];
    if (typeof exact === 'number') {
      return { raw, band: exact };
    }

    const fallback = Object.keys(table)
      .map(Number)
      .sort((left, right) => right - left)
      .find((score) => raw >= score);

    return {
      raw,
      band: typeof fallback === 'number' ? table[fallback] : 0,
    };
  });
}
