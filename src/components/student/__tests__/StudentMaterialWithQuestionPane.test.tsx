import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StudentMaterialWithQuestionPane } from '../StudentMaterialWithQuestionPane';

function renderPane(
  layoutMode: 'compact' | 'wide' = 'compact',
  materialPane: React.ReactNode = <div data-testid="material-content">Passage</div>,
) {
  return render(
    <StudentMaterialWithQuestionPane
      isTabletMode={false}
      layoutMode={layoutMode}
      workspaceRef={React.createRef<HTMLDivElement>()}
      splitPaneStyle={undefined}
      leftWidth={50}
      onDividerPointerDown={() => undefined}
      onDividerKeyDown={() => undefined}
      workspaceTestId="student-material-workspace"
      dividerAriaLabel="Resize panes"
      dividerTestId="pane-resizer"
      materialPane={materialPane}
      questionPanel={{
        blocks: [],
        allQuestions: [],
        answers: {},
        onAnswerChange: () => undefined,
        currentQuestionId: null,
        onNavigate: () => undefined,
        flags: {},
        answerCompact: false,
        highlightEnabled: false,
        highlightColor: 'yellow',
        questionContainerRef: React.createRef<HTMLDivElement>(),
        contentZoomStyle: undefined,
        panelTestId: 'question-content',
        getBlockStartQuestionNumber: () => 1,
        renderBlockInstruction: () => null,
      }}
    />,
  );
}

describe('StudentMaterialWithQuestionPane', () => {
  it('uses a single compact pane and lets the student switch between passage and questions', () => {
    renderPane();

    expect(screen.getByTestId('material-content')).toBeVisible();
    expect(screen.queryByTestId('question-content')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show questions' }));

    expect(screen.queryByTestId('material-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('question-content')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Show passage' }));
    expect(screen.getByTestId('material-content')).toBeVisible();
  });

  it('restores material scroll position after compact pane switching', () => {
    const materialScrollNodes: HTMLDivElement[] = [];

    renderPane(
      'compact',
      <div
        data-testid="material-content"
        data-student-zoom-scroll
        ref={(node) => {
          if (node) materialScrollNodes.push(node);
        }}
      >
        Passage
      </div>,
    );

    const initialMaterialScroll = materialScrollNodes[0];
    expect(initialMaterialScroll).toBeDefined();
    initialMaterialScroll.scrollTop = 137;

    fireEvent.click(screen.getByRole('button', { name: 'Show questions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show passage' }));

    const restoredMaterialScroll = materialScrollNodes[materialScrollNodes.length - 1];
    expect(restoredMaterialScroll).not.toBe(initialMaterialScroll);
    expect(restoredMaterialScroll.scrollTop).toBe(137);
  });

  it('keeps the existing split presentation outside compact mode', () => {
    renderPane('wide');

    expect(screen.getByTestId('material-content')).toBeVisible();
    expect(screen.getByTestId('question-content')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Show questions' })).not.toBeInTheDocument();
  });
});
