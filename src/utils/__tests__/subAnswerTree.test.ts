import { describe, expect, it } from 'vitest';
import {
  evaluateSubAnswerRootUnordered,
  flattenSubAnswerTree,
  normalizeSubAnswerTree,
  SUB_ANSWER_TREE_MAX_DEPTH,
  validateSubAnswerTree,
} from '../subAnswerTree';

describe('subAnswerTree', () => {
  it('builds dot labels recursively up to depth 3', () => {
    const flattened = flattenSubAnswerTree(
      'block-1',
      [
        {
          id: 'root-1',
          label: 'Root 1',
          children: [
            {
              id: 'node-1',
              label: 'Node 1',
              children: [
                {
                  id: 'leaf-1',
                  label: 'Leaf 1',
                  acceptedAnswers: ['A'],
                },
              ],
            },
            {
              id: 'leaf-2',
              label: 'Leaf 2',
              acceptedAnswers: ['B'],
            },
          ],
        },
      ],
      21,
    );

    expect(flattened.roots[0]?.numberLabel).toBe('21');
    expect(flattened.leaves.map((leaf) => leaf.numberLabel)).toEqual(['21.1.1', '21.2']);
    expect(flattened.nextRootNumber).toBe(22);
  });

  it('normalizes legacy nodes with missing or duplicate ids', () => {
    const normalized = normalizeSubAnswerTree([
      {
        id: 'dup',
        label: 'Root',
        children: [
          { id: 'dup', label: 'Leaf A', acceptedAnswers: ['A'] },
          { id: '', label: 'Leaf B', acceptedAnswers: ['B'] },
        ],
      } as any,
    ]);

    const root = normalized[0];
    expect(root?.id).toBe('dup');
    expect(root?.children).toHaveLength(2);
    const childIds = (root?.children ?? []).map((child) => child.id);
    expect(new Set(childIds).size).toBe(2);
    expect(childIds.every((id) => id.trim().length > 0)).toBe(true);
  });

  it('keeps empty leaf labels as empty prompts when flattening', () => {
    const flattened = flattenSubAnswerTree(
      'block-blank',
      [
        {
          id: 'root-1',
          label: '',
          children: [
            {
              id: 'leaf-1',
              label: '   ',
              acceptedAnswers: ['A'],
            },
          ],
        },
      ],
      3,
    );

    expect(flattened.leaves).toHaveLength(1);
    expect(flattened.leaves[0]?.prompt).toBe('');
  });

  it('rejects trees that exceed depth guard', () => {
    const deepLeaf = { id: 'n11', label: 'n11', acceptedAnswers: ['ok'] };
    const level10 = { id: 'n10', label: 'n10', children: [deepLeaf] };
    const level9 = { id: 'n9', label: 'n9', children: [level10] };
    const level8 = { id: 'n8', label: 'n8', children: [level9] };
    const level7 = { id: 'n7', label: 'n7', children: [level8] };
    const level6 = { id: 'n6', label: 'n6', children: [level7] };
    const level5 = { id: 'n5', label: 'n5', children: [level6] };
    const level4 = { id: 'n4', label: 'n4', children: [level5] };
    const level3 = { id: 'n3', label: 'n3', children: [level4] };
    const level2 = { id: 'n2', label: 'n2', children: [level3] };
    const level1 = { id: 'n1', label: 'n1', children: [level2] };

    const errors = validateSubAnswerTree([level1]);
    expect(errors.some((error) => error.message.includes(String(SUB_ANSWER_TREE_MAX_DEPTH)))).toBe(true);
  });

  it('rejects duplicate node ids and required empty answers', () => {
    const errors = validateSubAnswerTree([
      {
        id: 'root-1',
        label: 'Root',
        children: [
          { id: 'dup', label: 'Leaf A', acceptedAnswers: [] },
          { id: 'dup', label: 'Leaf B', acceptedAnswers: ['ok'] },
        ],
      },
    ]);

    expect(errors.some((error) => error.message.includes('Duplicate node id'))).toBe(true);
    expect(
      errors.some((error) =>
        error.message.includes('must define at least one accepted answer'),
      ),
    ).toBe(true);
  });

  it('matches unordered pooled answers across leaf slots', () => {
    const leaves = [
      {
        id: 'leaf-a',
        rootId: 'root-1',
        rootNodeId: 'root-1',
        rootLabel: 'Root',
        rootNumber: 21,
        numberLabel: '21.1',
        nodeId: 'a',
        prompt: 'A',
        acceptedAnswers: ['cat'],
        required: true,
        depth: 1,
      },
      {
        id: 'leaf-b',
        rootId: 'root-1',
        rootNodeId: 'root-1',
        rootLabel: 'Root',
        rootNumber: 21,
        numberLabel: '21.2',
        nodeId: 'b',
        prompt: 'B',
        acceptedAnswers: ['dog'],
        required: true,
        depth: 1,
      },
    ];

    const result = evaluateSubAnswerRootUnordered(leaves, {
      'leaf-a': 'dog',
      'leaf-b': 'cat',
    });

    expect(result.rootCorrect).toBe(true);
    expect(result.leafCorrectness).toEqual({
      'leaf-a': true,
      'leaf-b': true,
    });
  });
});
