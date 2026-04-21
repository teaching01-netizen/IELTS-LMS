import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
import { StudentListening } from '../StudentListening';

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
});

