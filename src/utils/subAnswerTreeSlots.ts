import type { QuestionBlock, QuestionType, SubAnswerTreeNode } from '../types';
import { resolveAcceptedAnswers } from './acceptedAnswers';
import { createId } from './idUtils';
import { normalizeSubAnswerTree } from './subAnswerTree';
import { getCanonicalTableCells } from './tableCompletion';

export const SUB_ANSWER_SUPPORTED_BLOCK_TYPES = new Set<QuestionType>([
  'CLOZE',
  'MAP',
  'SHORT_ANSWER',
  'SENTENCE_COMPLETION',
  'DIAGRAM_LABELING',
  'FLOW_CHART',
  'TABLE_COMPLETION',
  'NOTE_COMPLETION',
  'CLASSIFICATION',
  'MATCHING_FEATURES',
]);

export interface SubAnswerSlotSeed {
  slotIndex: number;
  numberLabel: string;
  prompt: string;
  acceptedAnswers: string[];
}

function toAcceptedAnswers(value: unknown): string[] {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw.length > 0 ? [raw] : [];
}

export function isTreeCapableBlockType(type: QuestionType): boolean {
  return SUB_ANSWER_SUPPORTED_BLOCK_TYPES.has(type);
}

export function buildSubAnswerSlotSeeds(block: QuestionBlock, startNumber: number): SubAnswerSlotSeed[] {
  let slotNumber = startNumber;
  const seeds: SubAnswerSlotSeed[] = [];

  const pushSeed = (prompt: string, acceptedAnswers: string[]) => {
    seeds.push({
      slotIndex: seeds.length,
      numberLabel: `${slotNumber}.1`,
      prompt: prompt.trim(),
      acceptedAnswers,
    });
    slotNumber += 1;
  };

  switch (block.type) {
    case 'CLOZE':
      block.questions.forEach((question) => {
        pushSeed(question.prompt ?? '', resolveAcceptedAnswers(question));
      });
      break;
    case 'MAP':
      block.questions.forEach((question) => {
        pushSeed(question.label ?? '', toAcceptedAnswers(question.correctAnswer));
      });
      break;
    case 'SHORT_ANSWER':
      block.questions.forEach((question) => {
        pushSeed(question.prompt ?? '', resolveAcceptedAnswers(question));
      });
      break;
    case 'SENTENCE_COMPLETION':
      block.questions.forEach((question) => {
        question.blanks.forEach((blank, blankIndex) => {
          pushSeed(`${question.sentence ?? ''} (blank ${blankIndex + 1})`, resolveAcceptedAnswers(blank));
        });
      });
      break;
    case 'DIAGRAM_LABELING':
      block.labels.forEach((label, labelIndex) => {
        pushSeed(label.prompt ?? `Label ${labelIndex + 1}`, toAcceptedAnswers(label.correctAnswer));
      });
      break;
    case 'FLOW_CHART':
      block.steps.forEach((step) => {
        pushSeed(step.label ?? '', toAcceptedAnswers(step.correctAnswer));
      });
      break;
    case 'TABLE_COMPLETION':
      getCanonicalTableCells(block).forEach((cell) => {
        pushSeed(`Row ${cell.row + 1}, Col ${cell.col + 1}`, resolveAcceptedAnswers(cell));
      });
      break;
    case 'NOTE_COMPLETION':
      block.questions.forEach((question) => {
        question.blanks.forEach((blank, blankIndex) => {
          pushSeed(`Note (blank ${blankIndex + 1})`, resolveAcceptedAnswers(blank));
        });
      });
      break;
    case 'CLASSIFICATION':
      block.items.forEach((item) => {
        pushSeed(item.text ?? '', toAcceptedAnswers(item.correctCategory));
      });
      break;
    case 'MATCHING_FEATURES':
      block.features.forEach((feature) => {
        pushSeed(feature.text ?? '', toAcceptedAnswers(feature.correctMatch));
      });
      break;
    default:
      break;
  }

  if (seeds.length === 0) {
    seeds.push({
      slotIndex: 0,
      numberLabel: `${startNumber}.1`,
      prompt: '',
      acceptedAnswers: [],
    });
  }

  return seeds;
}

function buildSeededRoot(seed: SubAnswerSlotSeed): SubAnswerTreeNode {
  return {
    id: createId('root'),
    label: '',
    required: true,
    children: [
      {
        id: createId('leaf'),
        label: seed.prompt,
        acceptedAnswers: seed.acceptedAnswers,
        required: true,
      },
    ],
  };
}

function syncCanonicalRootWithSeed(root: SubAnswerTreeNode, seed: SubAnswerSlotSeed): SubAnswerTreeNode {
  const rootLabel = typeof root.label === 'string' ? root.label.trim() : '';
  if (rootLabel.length > 0) {
    return root;
  }

  const children = Array.isArray(root.children) ? [...root.children] : [];
  const firstChild = children[0];
  if (!firstChild) {
    return {
      ...root,
      children: [
        {
          id: `${root.id}::seed-leaf`,
          label: seed.prompt,
          acceptedAnswers: seed.acceptedAnswers,
          required: true,
        },
      ],
    };
  }

  const firstChildHasChildren = Array.isArray(firstChild.children) && firstChild.children.length > 0;
  if (firstChildHasChildren) {
    return root;
  }

  children[0] = {
    ...firstChild,
    label: seed.prompt,
    acceptedAnswers: seed.acceptedAnswers,
  };

  return {
    ...root,
    children,
  };
}

export function healSubAnswerTreeForBlock(
  block: QuestionBlock,
  startNumber: number,
  answerTree: readonly SubAnswerTreeNode[] | undefined,
): SubAnswerTreeNode[] {
  const normalized = normalizeSubAnswerTree(answerTree);
  const seeds = buildSubAnswerSlotSeeds(block, startNumber);

  const canonicalRoots = seeds.map((seed, index) => {
    const existingRoot = normalized[index];
    if (!existingRoot) {
      return buildSeededRoot(seed);
    }
    return syncCanonicalRootWithSeed(existingRoot, seed);
  });
  const extraRoots = normalized.slice(seeds.length);

  return [...canonicalRoots, ...extraRoots];
}

export function appendSubAnswerLeafAtSlot(
  block: QuestionBlock,
  startNumber: number,
  answerTree: readonly SubAnswerTreeNode[] | undefined,
  slotIndex: number,
): SubAnswerTreeNode[] {
  const healed = healSubAnswerTreeForBlock(block, startNumber, answerTree);
  if (slotIndex < 0 || slotIndex >= healed.length) {
    return healed;
  }

  return healed.map((root, index) => {
    if (index !== slotIndex) return root;

    const { acceptedAnswers: _unused, ...rest } = root;
    const seedLabel = root.children?.[0]?.label ?? '';
    return {
      ...rest,
      children: [
        ...(root.children ?? []),
        {
          id: createId('leaf'),
          label: seedLabel,
          acceptedAnswers: [],
          required: true,
        },
      ],
    };
  });
}
