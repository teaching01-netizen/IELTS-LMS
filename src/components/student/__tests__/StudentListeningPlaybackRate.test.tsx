import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
        },
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

describe('StudentListening playback speed', () => {
  it('renders the speed group with the active rate pressed', () => {
    render(
      <StudentListening
        state={createExamState()}
        answers={{}}
        onAnswerChange={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
        playbackRate={1.25}
        onPlaybackRateChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('group', { name: /playback speed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /0\.75/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /1\.25/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /1\.5/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports speed changes through onPlaybackRateChange', () => {
    const onPlaybackRateChange = vi.fn();
    render(
      <StudentListening
        state={createExamState()}
        answers={{}}
        onAnswerChange={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
        playbackRate={1}
        onPlaybackRateChange={onPlaybackRateChange}
      />,
    );

    screen.getByRole('button', { name: /1\.25/ }).click();
    expect(onPlaybackRateChange).toHaveBeenCalledWith(1.25);
  });

  it('applies the rate to the audio element and re-applies on change', () => {
    const { container, rerender } = render(
      <StudentListening
        state={createExamState()}
        answers={{}}
        onAnswerChange={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
        playbackRate={1.25}
        onPlaybackRateChange={vi.fn()}
      />,
    );

    const audio = container.querySelector('audio') as HTMLMediaElement | null;
    expect(audio).not.toBeNull();
    expect(audio!.playbackRate).toBe(1.25);

    rerender(
      <StudentListening
        state={createExamState()}
        answers={{}}
        onAnswerChange={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
        playbackRate={1.5}
        onPlaybackRateChange={vi.fn()}
      />,
    );

    expect(audio!.playbackRate).toBe(1.5);
  });

  it('defaults to 1x when no rate is provided', () => {
    const { container } = render(
      <StudentListening
        state={createExamState()}
        answers={{}}
        onAnswerChange={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    const audio = container.querySelector('audio') as HTMLMediaElement | null;
    expect(audio!.playbackRate).toBe(1);
  });

  it('hides the speed controls when audio playback is disabled', () => {
    const state = createExamState();
    state.config.sections.listening = {
      ...state.config.sections.listening,
      audioPlaybackEnabled: false,
    };

    const { container } = render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
        playbackRate={1}
        onPlaybackRateChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('group', { name: /playback speed/i })).not.toBeInTheDocument();
    expect(container.querySelector('audio')).toBeNull();
  });
});
