import React, { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
import { StudentListening } from '../StudentListening';
import { StudentHighlightPersistenceProvider } from '../highlightV2Persistence';
import { readPersistedSurfaceRanges } from '../highlight/highlightStore';
import { StudentUIProvider, useStudentUI } from '../providers/StudentUIProvider';

function HighlightMode({ children }: { children: React.ReactNode }) {
  const { actions: { setHighlightToolMode } } = useStudentUI();
  useEffect(() => setHighlightToolMode('highlight'), [setHighlightToolMode]);
  return children;
}

function createExamState(): ExamState {
  const config = createDefaultConfig('Academic', 'Academic');
  return {
    title: 'Test Exam',
    type: 'Academic',
    activeModule: 'listening',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config,
    reading: { passages: [] },
    listening: {
      parts: [
        {
          id: 'l1',
          title: 'Part 1',
          audioUrl: 'https://example.test/audio.mp3',
          pins: [],
          blocks: [],
        } as any,
      ],
    },
    writing: {
      task1Prompt: 'Task 1 prompt',
      task2Prompt: 'Task 2 prompt',
      tasks: [],
      customPromptTemplates: [],
    },
    speaking: {
      part1Topics: [],
      cueCard: '',
      part3Discussion: [],
    },
  };
}

describe('StudentListening a11y', () => {
  it('adds aria-labels to rewind/forward icon buttons', () => {
    render(
      <StudentListening
        state={createExamState()}
        answers={{}}
        onAnswerChange={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    expect(screen.getByLabelText(/rewind/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/forward/i)).toBeInTheDocument();
  });

  it('renders transcript HTML content as rich text instead of escaped tags', () => {
    const state = createExamState();
    state.listening.parts[0] = {
      ...state.listening.parts[0],
      transcript: '<p>Reference <strong>highlight</strong> line.</p>',
    } as any;

    const { container } = render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    expect(screen.getByText(/transcript \/ reference/i)).toBeInTheDocument();
    expect(screen.getByText('highlight')).toBeInTheDocument();
    expect(container.querySelector('strong')).not.toBeNull();
    expect(screen.queryByText(/<strong>/i)).not.toBeInTheDocument();
  });

  it('persists block instruction highlights under the owning listening block id', () => {
    const state = createExamState();
    state.listening.parts[0] = {
      ...state.listening.parts[0],
      blocks: [{
        id: 'listening-block',
        type: 'SHORT_ANSWER',
        instruction: 'Listen and answer.',
        questions: [{ id: 'listening-q1', prompt: 'Who speaks?', correctAnswer: 'Sam' }],
      }],
    } as any;
    render(
      <StudentHighlightPersistenceProvider namespace="test:listening-instruction">
        <StudentUIProvider>
          <HighlightMode>
            <StudentListening
              state={state}
              answers={{}}
              onAnswerChange={() => undefined}
              currentQuestionId="listening-q1"
              onNavigate={() => undefined}
              highlightEnabled
            />
          </HighlightMode>
        </StudentUIProvider>
      </StudentHighlightPersistenceProvider>,
    );
    const textNode = screen.getByText('Listen and answer.').firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 6);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event('pointerup'));

    expect(
      readPersistedSurfaceRanges(
        'test:listening-instruction',
        'question:listening:listening-block:instruction',
      )?.ranges,
    ).toHaveLength(1);
  });
});
