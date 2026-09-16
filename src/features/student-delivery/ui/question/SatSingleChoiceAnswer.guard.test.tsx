import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSatSelectionGesture, markSatSelectionGestureEnded, SAT_SELECTION_GUARD_MS } from '../annotations/satSelectionDragGuard';
import { SatSingleChoiceAnswer } from './SatSingleChoiceAnswer';

const content = (id: string, text: string) => ({ version: 1 as const, nodes: [{ type: 'paragraph' as const, id, text }] });
const options = [
  { id: 'a', content: content('a', 'First answer') },
  { id: 'b', content: content('b', 'Second answer') },
];

function renderAnswer(onChange: (optionId: string) => void) {
  render(
    <SatSingleChoiceAnswer
      questionId="q1"
      options={options}
      eliminatedOptionIds={new Set()}
      eliminationMode={false}
      disabled={false}
      onChange={onChange}
      onToggleElimination={vi.fn()}
    />,
  );
}

afterEach(() => {
  clearSatSelectionGesture();
  vi.useRealTimers();
});

/**
 * The guard used to be armed from a `pointerdown` on the visually hidden radio,
 * which a real gesture never touches. These tests activate the option exactly
 * the way a student does — on its visible text — so the same wiring mistake
 * cannot pass again.
 */
describe('answer safety around a text-selection gesture', () => {
  it('ignores an option the selection gesture ended on, then accepts it after the window', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    renderAnswer(onChange);
    markSatSelectionGestureEnded(Date.now());
    fireEvent.click(screen.getByText('First answer'));
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SAT_SELECTION_GUARD_MS);
    fireEvent.click(screen.getByText('First answer'));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('never blocks an activation when no selection gesture happened', () => {
    const onChange = vi.fn();
    renderAnswer(onChange);
    fireEvent.click(screen.getByText('Second answer'));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
