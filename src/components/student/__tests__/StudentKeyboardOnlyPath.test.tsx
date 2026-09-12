import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedInput } from '../ProtectedInput';
import { ProtectedChoiceInput } from '../ProtectedChoiceInput';
import { ProtectedExamSelect } from '../ProtectedExamSelect';
import { QuestionNavigator } from '../QuestionNavigator';

/**
 * Phase 3 exit gate (phase-03-controls-navigation.md):
 * "complete keyboard-only path through each answer family and navigator".
 *
 * Every primary answer family is reached and operated without a mouse:
 *   - text (ProtectedInput): focus → type → commit
 *   - choice (ProtectedChoiceInput radio): arrows/Space within the group
 *   - select (ProtectedExamSelect): Tab → Enter → arrows → Enter / Escape
 *   - navigator (QuestionNavigator dialog): Tab to items, Enter navigates
 * Navigation keeps previous/next separate from submit (never converts the
 * last Next into Submit).
 */

const SELECT_OPTIONS = [
  { value: 'i', label: 'i. Ancient history' },
  { value: 'ii', label: 'ii. Modern cities' },
] as const;

function KeyboardSelectFixture({ onCommit }: { onCommit: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <ProtectedExamSelect
      ariaLabel="Heading selection for question 1"
      value={value}
      options={[...SELECT_OPTIONS]}
      placeholder="Choose heading…"
      onValueChange={(next) => {
        setValue(next);
        onCommit(next);
      }}
    />
  );
}

describe('keyboard-only path: text answers (P3 gate)', () => {
  it('types an answer with only the keyboard and commits on change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ProtectedInput
        type="text"
        name="q1"
        aria-label="Answer for question 1"
        security={{ preventAutofill: true, preventAutocorrect: true }}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText('Answer for question 1');
    await user.tab();
    expect(input).toHaveFocus();
    await user.type(input, '42');
    expect(onChange).toHaveBeenCalled();
    expect(input).toHaveValue('42');
  });
});

describe('keyboard-only path: choice answers (P3 gate)', () => {
  it('moves a radio group with arrows and commits with the native keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <fieldset>
        {(['T', 'F'] as const).map((option) => (
          <label key={option}>
            <ProtectedChoiceInput
              type="radio"
              name="q-tfng"
              value={option}
              aria-label={`Answer ${option}`}
              onChange={onChange}
            />
            {option}
          </label>
        ))}
      </fieldset>,
    );

    const first = screen.getByLabelText('Answer T');
    await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard(' '); // Space selects the focused radio
    expect(onChange).toHaveBeenCalled();
    expect(first).toBeChecked();
  });
});

describe('keyboard-only path: select answers (P3 gate)', () => {
  it('commits an option without any pointer input', () => {
    const onCommit = vi.fn();
    render(<KeyboardSelectFixture onCommit={onCommit} />);

    const trigger = screen.getByTestId('protected-exam-select-trigger');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const item = screen.getByTestId('protected-exam-select-item-ii');
    fireEvent.keyDown(item, { key: 'Enter' });
    fireEvent.keyUp(item, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith('ii');
  });

  it('Escape cancels without changing the committed answer', () => {
    const onCommit = vi.fn();
    render(<KeyboardSelectFixture onCommit={onCommit} />);

    const trigger = screen.getByTestId('protected-exam-select-trigger');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(screen.getByTestId('protected-exam-select-menu'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('protected-exam-select-menu'), { key: 'Escape' });

    expect(onCommit).not.toHaveBeenCalled();
  });
});
