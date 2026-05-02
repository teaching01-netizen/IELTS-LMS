import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QuestionBlock, SubAnswerTreeNode } from '../../../types';
import { SubAnswerTreeEditor } from '../SubAnswerTreeEditor';

function buildBlock(answerTree: SubAnswerTreeNode[]): QuestionBlock {
  return {
    id: 'block-1',
    type: 'SHORT_ANSWER',
    instruction: 'Tree mode',
    questions: [],
    subAnswerModeEnabled: true,
    answerTree,
  } as unknown as QuestionBlock;
}

function Harness({ initialTree }: { initialTree: SubAnswerTreeNode[] }) {
  const [tree, setTree] = React.useState<SubAnswerTreeNode[]>(initialTree);
  const [enabled, setEnabled] = React.useState(true);

  return (
    <SubAnswerTreeEditor
      block={buildBlock(tree)}
      startNumber={1}
      enabled={enabled}
      onToggle={setEnabled}
      onChangeTree={setTree}
    />
  );
}

describe('SubAnswerTreeEditor', () => {
  it('does not render a visible Node ID field', () => {
    render(
      <SubAnswerTreeEditor
        block={buildBlock([
          {
            id: 'root-a',
            label: 'Root',
            children: [{ id: 'leaf-a', label: 'Leaf', acceptedAnswers: ['cat'] }],
          },
        ])}
        startNumber={1}
        enabled
        onToggle={() => {}}
        onChangeTree={() => {}}
      />,
    );

    expect(screen.queryByPlaceholderText('Node ID')).toBeNull();
  });

  it('creates new roots and leaves with empty labels', () => {
    render(<Harness initialTree={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add root' }));

    const promptInputs = screen.getAllByPlaceholderText('Prompt / label') as HTMLInputElement[];
    expect(promptInputs.length).toBeGreaterThanOrEqual(2);
    expect(promptInputs.every((input) => input.value === '')).toBe(true);
  });

  it('auto-repairs missing and duplicate legacy node ids on mount', () => {
    const onChangeTree = vi.fn();

    render(
      <SubAnswerTreeEditor
        block={buildBlock([
          {
            id: 'dup',
            label: 'Root',
            children: [
              { id: 'dup', label: 'Leaf A', acceptedAnswers: ['a'] },
              { id: '', label: 'Leaf B', acceptedAnswers: ['b'] },
            ],
          } as any,
        ])}
        startNumber={1}
        enabled
        onToggle={() => {}}
        onChangeTree={onChangeTree}
      />,
    );

    expect(onChangeTree).toHaveBeenCalled();
    const repairedTree = onChangeTree.mock.calls[0]?.[0] as SubAnswerTreeNode[];
    const childIds = repairedTree[0]?.children?.map((child) => child.id) ?? [];

    expect(new Set(childIds).size).toBe(childIds.length);
    expect(childIds.every((id) => id.trim().length > 0)).toBe(true);
  });
});
