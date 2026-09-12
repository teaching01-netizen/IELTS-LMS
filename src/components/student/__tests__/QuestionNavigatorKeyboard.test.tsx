import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuestionNavigator } from '../QuestionNavigator';

/**
 * Phase 3 keyboard-only gate for the question navigator: focus a chip and
 * navigate with Enter — no pointer input. Kept Radix-free so jsdom's event
 * loop stays clean (see StudentKeyboardOnlyPath.test.tsx note).
 */

const questions = [
  {
    id: 'q1',
    number: 1,
    label: '1',
    groupId: 'g',
    groupLabel: 'Passage 1',
    rootId: 'q1',
    answerKey: 'q1',
    isMulti: false,
    answerType: 'scalar',
  },
  {
    id: 'q2',
    number: 2,
    label: '2',
    groupId: 'g',
    groupLabel: 'Passage 1',
    rootId: 'q2',
    answerKey: 'q2',
    isMulti: false,
    answerType: 'scalar',
  },
] as never[];

function NavigatorHarness({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return <button type="button">Navigator trigger</button>;
  }
  return (
    <QuestionNavigator
      questions={questions}
      answers={{}}
      flags={{}}
      currentQuestionId="q1"
      onNavigate={onNavigate}
      onClose={() => setOpen(false)}
    />
  );
}

describe('keyboard-only path: question navigator (P3 gate)', () => {
  it('focuses a question chip and navigates with Enter only', async () => {
    // jsdom's HTMLDialogElement lacks showModal/close; the component already
    // falls back to the open attribute. (jsdom also cannot emulate native
    // dialog Tab-order, so the chip is focused directly — the gate is
    // keyboard operation, not tab emulation.)
    if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function showModal() {
        this.setAttribute('open', '');
      };
      HTMLDialogElement.prototype.close = function close() {
        this.removeAttribute('open');
      };
    }
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<NavigatorHarness onNavigate={onNavigate} />);

    const chip = screen.getByRole('button', { name: /Question 1/ });
    chip.focus();
    expect(chip).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('q1');
  });
});
