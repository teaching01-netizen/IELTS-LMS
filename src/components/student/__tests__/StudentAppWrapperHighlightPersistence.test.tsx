import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
import type { StudentAttempt } from '../../../types/studentAttempt';
import { FormattedText } from '../FormattedText';
import { StudentAppWrapper } from '../StudentAppWrapper';
import { readPersistedSurfaceRanges } from '../highlight/highlightStore';

const appMounts = vi.hoisted(() => ({ count: 0 }));

vi.mock('../StudentApp', () => ({
  StudentApp: () => {
    const [visible, setVisible] = useState(true);
    const [mountId] = useState(() => ++appMounts.count);
    return (
      <>
        <output data-testid="student-app-mount">{mountId}</output>
        <button onClick={() => setVisible((current) => !current)}>Toggle surface</button>
        {visible ? (
          <FormattedText
            text="Persistent question copy"
            highlightEnabled
            highlightToolMode="highlight"
            highlightSurfaceId="question:block-1:q1:prompt"
          />
        ) : null}
      </>
    );
  },
}));

const state = {
  title: 'Highlight test',
  type: 'Academic',
  activeModule: 'reading',
  activePassageId: null,
  activeListeningPartId: null,
  config: createDefaultConfig('Academic', 'Academic'),
  reading: { passages: [] },
  listening: { parts: [] },
  writing: { task1Prompt: '', task2Prompt: '' },
  speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
} as ExamState;

function createAttempt(id: string): StudentAttempt {
  return {
    id,
    scheduleId: 'schedule-highlight-1',
    studentKey: `student-${id}`,
    examId: 'exam-highlight-1',
    examTitle: 'Highlight test',
    candidateId: `candidate-${id}`,
    candidateName: 'Highlight Candidate',
    candidateEmail: 'highlight@example.test',
    phase: 'exam',
    currentModule: 'reading',
    currentQuestionId: null,
    answers: {},
    writingAnswers: {},
    flags: {},
    violations: [],
    proctorStatus: 'active',
    proctorNote: null,
    proctorUpdatedAt: null,
    proctorUpdatedBy: null,
    lastWarningId: null,
    lastAcknowledgedWarningId: null,
    integrity: {
      preCheck: null,
      deviceFingerprintHash: null,
      clientSessionId: null,
      lastDisconnectAt: null,
      lastReconnectAt: null,
      lastHeartbeatAt: null,
      lastHeartbeatStatus: 'idle',
    },
    recovery: {
      lastRecoveredAt: null,
      lastLocalMutationAt: null,
      lastPersistedAt: null,
      lastDroppedMutations: null,
      pendingMutationCount: 0,
      serverAcceptedThroughSeq: 0,
      clientSessionId: null,
      syncState: 'saved',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('StudentAppWrapper highlight persistence', () => {
  it('retains a real highlight after its surface unmounts and remounts for the same attempt', () => {
    render(
      <StudentAppWrapper
        state={state}
        onExit={() => undefined}
        attemptSnapshot={createAttempt('attempt-highlight-1')}
        enableMonitoring={false}
        persistenceEnabled={false}
      />,
    );
    const surface = screen.getByText('Persistent question copy');
    const textNode = surface.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 10);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event('pointerup'));
    expect(document.querySelector('mark[data-highlighted="true"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle surface' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle surface' }));

    expect(document.querySelector('mark[data-highlighted="true"]')).toHaveTextContent('Persistent');
    window.getSelection()?.removeAllRanges();
  });

  it('does not carry in-memory highlight state from attempt A into attempt B', () => {
    const { rerender } = render(
      <StudentAppWrapper
        state={state}
        onExit={() => undefined}
        attemptSnapshot={createAttempt('attempt-highlight-a')}
        enableMonitoring={false}
        persistenceEnabled={false}
      />,
    );
    const textNode = screen.getByText('Persistent question copy').firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 10);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event('pointerup'));
    expect(document.querySelector('mark[data-highlighted="true"]')).not.toBeNull();
    const attemptAMount = screen.getByTestId('student-app-mount').textContent;
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    rerender(
      <StudentAppWrapper
        state={state}
        onExit={() => undefined}
        attemptSnapshot={createAttempt('attempt-highlight-b')}
        enableMonitoring={false}
        persistenceEnabled={false}
      />,
    );

    expect(document.querySelector('mark[data-highlighted="true"]')).toBeNull();
    expect(screen.getByTestId('student-app-mount')).not.toHaveTextContent(attemptAMount ?? '');
    expect(
      readPersistedSurfaceRanges(
        'attempt:attempt-highlight-a',
        'question:block-1:q1:prompt',
      )?.ranges,
    ).toHaveLength(1);
    expect(
      readPersistedSurfaceRanges(
        'attempt:attempt-highlight-b',
        'question:block-1:q1:prompt',
      ),
    ).toBeNull();
    expect(
      setItemSpy.mock.calls.some(([key]) => String(key).includes('attempt:attempt-highlight-b')),
    ).toBe(false);
    setItemSpy.mockRestore();
    window.getSelection()?.removeAllRanges();
  });
});
