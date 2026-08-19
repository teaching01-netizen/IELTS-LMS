import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExamState } from '../../../types';
import { StudentListening } from '../StudentListening';
import { StudentWriting } from '../StudentWriting';

function createListeningState(): ExamState {
  return {
    title: 'Listening Test',
    type: 'Academic',
    activeModule: 'listening',
    activePassageId: 'p1',
    activeListeningPartId: 'part-1',
    config: {
      type: 'Academic',
      delivery: {
        launchMode: 'proctor_start',
        transitionMode: 'auto_with_proctor_override',
        allowedExtensionMinutes: [5],
      },
      sections: {
        listening: {
          enabled: true,
          order: 1,
          duration: 30,
          autoContinue: true,
          allowedQuestionTypes: ['SHORT_ANSWER'],
        },
        reading: {
          enabled: false,
          order: 2,
          duration: 60,
          autoContinue: true,
          allowedQuestionTypes: ['SHORT_ANSWER'],
        },
        writing: {
          enabled: false,
          order: 3,
          duration: 60,
          autoContinue: true,
          allowedQuestionTypes: ['SHORT_ANSWER'],
          tasks: [],
          rubricWeights: { taskResponse: 25, coherence: 25, lexical: 25, grammar: 25 },
        },
        speaking: {
          enabled: false,
          order: 4,
          duration: 15,
          autoContinue: true,
          allowedQuestionTypes: ['SHORT_ANSWER'],
          parts: [],
          rubricWeights: { fluency: 25, lexical: 25, grammar: 25, pronunciation: 25 },
        },
      },
    } as ExamState['config'],
    reading: { passages: [] },
    listening: {
      parts: [
        {
          id: 'part-1',
          title: 'Part 1',
          pins: [],
          transcript: 'Speaker **one** mentions details.',
          blocks: [
            {
              id: 'lq-block',
              type: 'SHORT_ANSWER',
              instruction: 'Answer.',
              questions: [
                { id: 'lq1', prompt: 'What did speaker one say?', correctAnswer: 'details', answerRule: 'ONE_WORD' },
              ],
            },
          ],
        },
      ],
    },
    writing: { task1Prompt: '', task2Prompt: '' },
    speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
  } as ExamState;
}

function createWritingState(): ExamState {
  return {
    title: 'Writing Test',
    type: 'Academic',
    activeModule: 'writing',
    activePassageId: 'p1',
    activeListeningPartId: 'part-1',
    config: {
      type: 'Academic',
      delivery: {
        launchMode: 'proctor_start',
        transitionMode: 'auto_with_proctor_override',
        allowedExtensionMinutes: [5],
      },
      sections: {
        listening: {
          enabled: false,
          order: 1,
          duration: 30,
          autoContinue: true,
          allowedQuestionTypes: ['SHORT_ANSWER'],
        },
        reading: {
          enabled: false,
          order: 2,
          duration: 60,
          autoContinue: true,
          allowedQuestionTypes: ['SHORT_ANSWER'],
        },
        writing: {
          enabled: true,
          order: 3,
          duration: 60,
          autoContinue: true,
          allowedQuestionTypes: ['SHORT_ANSWER'],
          tasks: [
            {
              id: 'task1',
              label: 'Task 1',
              prompt: '<h2>Chart <strong>Overview</strong></h2><p><em>Summarize</em> key trends.</p>',
              minWords: 150,
              suggestedMinutes: 20,
            },
          ],
          rubricWeights: { taskResponse: 25, coherence: 25, lexical: 25, grammar: 25 },
        },
        speaking: {
          enabled: false,
          order: 4,
          duration: 15,
          autoContinue: true,
          allowedQuestionTypes: ['SHORT_ANSWER'],
          parts: [],
          rubricWeights: { fluency: 25, lexical: 25, grammar: 25, pronunciation: 25 },
        },
      },
    } as ExamState['config'],
    reading: { passages: [] },
    listening: { parts: [] },
    writing: { task1Prompt: '', task2Prompt: '' },
    speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
  } as ExamState;
}

describe('Listening/Writing stimulus readability controls', () => {
  it('does not render listening stimulus controls and keeps question pane sizing unchanged', () => {
    const onIncrease = vi.fn();
    const onDecrease = vi.fn();
    const onReset = vi.fn();

    render(
      <StudentListening
        state={createListeningState()}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="lq1"
        onNavigate={() => {}}
      />,
    );

    expect(screen.queryByTestId('listening-stimulus-readability-controls')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /increase listening stimulus text size/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /decrease listening stimulus text size/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset listening stimulus readability/i })).not.toBeInTheDocument();

    expect(onIncrease).not.toHaveBeenCalled();
    expect(onDecrease).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();

    const questionPane = screen.getByTestId('listening-question-scroll');
    expect(questionPane).not.toHaveStyle({ fontSize: 'var(--student-passage-font-size)' });
  });

  it('does not render writing stimulus controls and does not affect writing editor sizing', () => {
    render(
      <StudentWriting
        state={createWritingState()}
        writingAnswers={{}}
        onWritingChange={() => {}}
        onSubmit={() => {}}
        currentQuestionId="task1"
        onNavigate={() => {}}
      />,
    );

    expect(screen.queryByTestId('writing-stimulus-readability-controls')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /increase writing stimulus text size/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /decrease writing stimulus text size/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset writing stimulus readability/i })).not.toBeInTheDocument();

    const prompt = screen.getByTestId('writing-task-prompt');
    expect(prompt.className).toContain('student-stimulus-content');

    const editor = screen.getByRole('textbox', { name: /writing response/i });
    expect(editor).not.toHaveStyle({ fontSize: 'var(--student-passage-font-size)' });
  });
});
