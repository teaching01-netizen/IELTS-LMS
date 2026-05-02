import { describe, expect, it } from 'vitest';
import type { QuestionBlock, SubAnswerTreeNode } from '../../types';
import {
  appendSubAnswerLeafAtSlot,
  buildSubAnswerSlotSeeds,
  healSubAnswerTreeForBlock,
} from '../subAnswerTreeSlots';

function asBlock<T extends QuestionBlock>(block: T): QuestionBlock {
  return block as unknown as QuestionBlock;
}

describe('subAnswerTreeSlots', () => {
  it('derives deterministic canonical slots for tree-capable block types', () => {
    const cases: Array<{ name: string; block: QuestionBlock; count: number }> = [
      {
        name: 'CLOZE',
        block: asBlock({
          id: 'b1',
          type: 'CLOZE',
          instruction: '',
          answerRule: 'ONE_WORD',
          questions: [
            { id: 'q1', prompt: 'One', correctAnswer: 'a' },
            { id: 'q2', prompt: 'Two', correctAnswer: 'b' },
          ],
        }),
        count: 2,
      },
      {
        name: 'MAP',
        block: asBlock({
          id: 'b2',
          type: 'MAP',
          instruction: '',
          assetUrl: '',
          questions: [{ id: 'q1', label: 'A', correctAnswer: 'x', x: 0, y: 0 }],
        }),
        count: 1,
      },
      {
        name: 'SHORT_ANSWER',
        block: asBlock({
          id: 'b3',
          type: 'SHORT_ANSWER',
          instruction: '',
          questions: [{ id: 'q1', prompt: 'Prompt', correctAnswer: 'x', answerRule: 'ONE_WORD' }],
        }),
        count: 1,
      },
      {
        name: 'SENTENCE_COMPLETION',
        block: asBlock({
          id: 'b4',
          type: 'SENTENCE_COMPLETION',
          instruction: '',
          questions: [
            {
              id: 'q1',
              sentence: 'A ____ B ____',
              answerRule: 'ONE_WORD',
              blanks: [
                { id: 'b1', correctAnswer: 'x', position: 0 },
                { id: 'b2', correctAnswer: 'y', position: 1 },
              ],
            },
          ],
        }),
        count: 2,
      },
      {
        name: 'DIAGRAM_LABELING',
        block: asBlock({
          id: 'b5',
          type: 'DIAGRAM_LABELING',
          instruction: '',
          imageUrl: '',
          labels: [{ id: 'l1', x: 0, y: 0, correctAnswer: 'x' }],
        }),
        count: 1,
      },
      {
        name: 'FLOW_CHART',
        block: asBlock({
          id: 'b6',
          type: 'FLOW_CHART',
          instruction: '',
          steps: [{ id: 's1', label: 'Step', correctAnswer: 'x' }],
        }),
        count: 1,
      },
      {
        name: 'TABLE_COMPLETION',
        block: asBlock({
          id: 'b7',
          type: 'TABLE_COMPLETION',
          instruction: '',
          answerRule: 'ONE_WORD',
          headers: ['H1', 'H2'],
          rows: [['Name', '____'], ['City', '____']],
          cells: [
            { id: 'c1', row: 0, col: 1, correctAnswer: 'a' },
            { id: 'c2', row: 1, col: 1, correctAnswer: 'b' },
          ],
        }),
        count: 2,
      },
      {
        name: 'NOTE_COMPLETION',
        block: asBlock({
          id: 'b8',
          type: 'NOTE_COMPLETION',
          instruction: '',
          questions: [
            {
              id: 'n1',
              noteText: 'X ____ Y ____',
              answerRule: 'ONE_WORD',
              blanks: [
                { id: 'b1', correctAnswer: 'x', position: 0 },
                { id: 'b2', correctAnswer: 'y', position: 1 },
              ],
            },
          ],
        }),
        count: 2,
      },
      {
        name: 'CLASSIFICATION',
        block: asBlock({
          id: 'b9',
          type: 'CLASSIFICATION',
          instruction: '',
          categories: ['A', 'B'],
          items: [{ id: 'i1', text: 'Item', correctCategory: 'A' }],
        }),
        count: 1,
      },
      {
        name: 'MATCHING_FEATURES',
        block: asBlock({
          id: 'b10',
          type: 'MATCHING_FEATURES',
          instruction: '',
          options: ['A', 'B'],
          features: [{ id: 'f1', text: 'Feature', correctMatch: 'A' }],
        }),
        count: 1,
      },
    ];

    cases.forEach(({ block, count, name }) => {
      const seeds = buildSubAnswerSlotSeeds(block, 18);
      expect(seeds.length, name).toBe(count);
      expect(seeds[0]?.numberLabel, name).toBe('18.1');
    });
  });

  it('heals a collapsed tree from one root to all legacy slots and preserves existing subtree', () => {
    const block = asBlock({
      id: 'short-1',
      type: 'SHORT_ANSWER',
      instruction: '',
      questions: [
        { id: 'q1', prompt: 'P1', correctAnswer: 'a', answerRule: 'ONE_WORD', acceptedAnswers: ['a'] },
        { id: 'q2', prompt: 'P2', correctAnswer: 'b', answerRule: 'ONE_WORD', acceptedAnswers: ['b'] },
        { id: 'q3', prompt: 'P3', correctAnswer: 'c', answerRule: 'ONE_WORD', acceptedAnswers: ['c'] },
      ],
      subAnswerModeEnabled: true,
    });

    const collapsed: SubAnswerTreeNode[] = [
      {
        id: 'root-a',
        label: 'Keep me',
        children: [{ id: 'leaf-a', label: 'Leaf A', acceptedAnswers: ['cat'], required: true }],
      },
    ];

    const healed = healSubAnswerTreeForBlock(block, 18, collapsed);

    expect(healed).toHaveLength(3);
    expect(healed[0]?.id).toBe('root-a');
    expect(healed[0]?.children?.[0]?.label).toBe('Leaf A');
    expect(healed[1]?.children?.[0]?.label).toBe('P2');
    expect(healed[2]?.children?.[0]?.acceptedAnswers).toEqual(['c']);
  });

  it('keeps extra user-created roots after canonical roots', () => {
    const block = asBlock({
      id: 'short-2',
      type: 'SHORT_ANSWER',
      instruction: '',
      questions: [{ id: 'q1', prompt: 'P1', correctAnswer: 'a', answerRule: 'ONE_WORD' }],
      subAnswerModeEnabled: true,
    });

    const raw: SubAnswerTreeNode[] = [
      { id: 'root-a', label: '', children: [{ id: 'leaf-a', label: 'A', acceptedAnswers: ['a'] }] },
      { id: 'root-extra', label: 'Extra', children: [{ id: 'leaf-extra', label: 'E', acceptedAnswers: ['e'] }] },
    ];

    const healed = healSubAnswerTreeForBlock(block, 12, raw);
    expect(healed).toHaveLength(2);
    expect(healed[1]?.id).toBe('root-extra');
  });

  it('appendSubAnswerLeafAtSlot heals first and appends only to the targeted slot', () => {
    const block = asBlock({
      id: 'short-3',
      type: 'SHORT_ANSWER',
      instruction: '',
      questions: [
        { id: 'q1', prompt: 'P1', correctAnswer: 'a', answerRule: 'ONE_WORD' },
        { id: 'q2', prompt: 'P2', correctAnswer: 'b', answerRule: 'ONE_WORD' },
      ],
      subAnswerModeEnabled: true,
    });

    const raw: SubAnswerTreeNode[] = [
      { id: 'root-a', label: '', children: [{ id: 'leaf-a', label: 'A', acceptedAnswers: ['a'] }] },
    ];

    const next = appendSubAnswerLeafAtSlot(block, 18, raw, 0);

    expect(next).toHaveLength(2);
    expect(next[0]?.children?.length).toBe(2);
    expect(next[1]?.children?.length).toBe(1);
    expect(next[0]?.children?.[1]?.label).toBe('P1');
  });

  it('syncs canonical root first leaf content from slot seeds when root label is empty', () => {
    const block = asBlock({
      id: 'short-4',
      type: 'SHORT_ANSWER',
      instruction: '',
      questions: [
        { id: 'q1', prompt: 'Updated prompt 1', correctAnswer: 'a', answerRule: 'ONE_WORD', acceptedAnswers: ['a1'] },
        { id: 'q2', prompt: 'Updated prompt 2', correctAnswer: 'b', answerRule: 'ONE_WORD', acceptedAnswers: ['b1', 'b2'] },
      ],
      subAnswerModeEnabled: true,
    });

    const raw: SubAnswerTreeNode[] = [
      {
        id: 'root-a',
        label: '',
        children: [{ id: 'leaf-a', label: '', acceptedAnswers: [], required: true }],
      },
      {
        id: 'root-b',
        label: '',
        children: [{ id: 'leaf-b', label: 'stale', acceptedAnswers: ['old'], required: true }],
      },
    ];

    const healed = healSubAnswerTreeForBlock(block, 21, raw);

    expect(healed[0]?.children?.[0]?.label).toBe('Updated prompt 1');
    expect(healed[0]?.children?.[0]?.acceptedAnswers).toEqual(['a1']);
    expect(healed[1]?.children?.[0]?.label).toBe('Updated prompt 2');
    expect(healed[1]?.children?.[0]?.acceptedAnswers).toEqual(['b1', 'b2']);
  });
});
