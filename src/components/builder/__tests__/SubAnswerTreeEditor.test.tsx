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

function buildLegacyShortAnswerBlock(): QuestionBlock {
  return {
    id: 'short-block',
    type: 'SHORT_ANSWER',
    instruction: 'Answer questions',
    questions: [
      { id: 'q-1', prompt: 'Prompt 1', correctAnswer: 'alpha', answerRule: 'ONE_WORD', acceptedAnswers: ['alpha'] },
      { id: 'q-2', prompt: 'Prompt 2', correctAnswer: 'beta', answerRule: 'ONE_WORD', acceptedAnswers: ['beta'] },
      { id: 'q-3', prompt: 'Prompt 3', correctAnswer: 'gamma', answerRule: 'ONE_WORD', acceptedAnswers: ['gamma'] },
    ],
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

function LegacyHarness() {
  const [tree, setTree] = React.useState<SubAnswerTreeNode[]>([]);
  const [enabled, setEnabled] = React.useState(false);

  return (
    <SubAnswerTreeEditor
      block={{
        ...buildLegacyShortAnswerBlock(),
        subAnswerModeEnabled: enabled,
        answerTree: tree,
      } as QuestionBlock}
      startNumber={18}
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

  it('shows empty-state guidance when no sub-answer rows exist yet', () => {
    render(<Harness initialTree={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open tree editor' }));

    expect(
      screen.getByText('No sub-answer rows yet. Use the + icon on a question to add one.'),
    ).toBeInTheDocument();
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

  it('shows per-question quick add icons before enabling tree mode', () => {
    render(<LegacyHarness />);

    expect(screen.getByRole('button', { name: 'Add sub-answer to question 18.1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add sub-answer to question 19.1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add sub-answer to question 20.1' })).toBeInTheDocument();
  });

  it('adding sub-answer from one slot only shows edited question roots in tree editor', () => {
    render(<LegacyHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Add sub-answer to question 18.1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open tree editor' }));

    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.queryByText('19')).toBeNull();
    expect(screen.queryByText('20')).toBeNull();
  });
});
