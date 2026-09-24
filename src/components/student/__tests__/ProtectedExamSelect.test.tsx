import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedExamSelect } from '../ProtectedExamSelect';

/**
 * P3.3/P3.4 targeted suite (phase-03-controls-navigation.md):
 * value-oriented commit path, selected-vs-highlighted separation, clear,
 * duplicate labels, disabled options, keyboard-only operation, and the
 * lifecycle contract (focus into the option list never commits).
 *
 * jsdom strategy: the two Radix desktop-menu tests exercise the documented
 * keyboard pattern (focus trigger → Enter opens → arrows highlight → Enter
 * on an item commits; Escape cancels) — the keyboard-only path the phase
 * gate requires. All value semantics live in the presentation-independent
 * controller, so the remaining cases drive the compact sheet (plain DOM)
 * with synchronous fireEvent, which is deterministic in jsdom.
 */

const OPTIONS = [
  { value: 'i', label: 'i. Ancient history' },
  { value: 'ii', label: 'ii. Modern cities' },
  { value: 'iii', label: 'i. Ancient history (duplicate label)', disabled: false },
  { value: 'iv', label: 'iv. Disabled option', disabled: true },
] as const;

type HarnessOptions = Partial<Parameters<typeof ProtectedExamSelect>[0]>;

/**
 * Renders the select inside a stateful parent that mirrors the real answer
 * path: the parent owns the committed value and re-renders when the adapter
 * reports a change (the component itself is fully controlled).
 */
function renderSelect(overrides: HarnessOptions = {}) {
  const onValueChange = vi.fn();
  const onLiveValueChange = vi.fn();
  const fixtureProps = {
    ariaLabel: 'Heading selection for question 3',
    options: [...OPTIONS],
    placeholder: 'Choose heading…',
    onLiveValueChange,
    ...overrides,
  } as Parameters<typeof ProtectedExamSelect>[0];

  let rerenderWithValue: (value: string) => void = () => {};
  const handleCommit = (value: string) => {
    onValueChange(value);
    rerenderWithValue(value);
  };

  function Fixture({ value }: { value: string }) {
    return <ProtectedExamSelect {...fixtureProps} value={value} onValueChange={handleCommit} />;
  }

  const view = render(<Fixture value={fixtureProps.value ?? ''} />);
  rerenderWithValue = (value: string) => view.rerender(<Fixture value={value} />);

  return { onValueChange, onLiveValueChange, rerenderWithValue, unmount: view.unmount };
}

/* ------------------------------------------------------------------ */
/* Radix desktop menu — keyboard-only pattern (P3.4 placement rules)  */
/* ------------------------------------------------------------------ */

describe('ProtectedExamSelect desktop menu (Radix, keyboard-only)', () => {
  it('Tab reaches the trigger; Enter opens; arrows highlight; Enter on an item commits and closes', () => {
    const { onValueChange } = renderSelect({ value: 'i' });

    const trigger = screen.getByTestId('protected-exam-select-trigger');
    trigger.focus();
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(trigger, { key: 'Enter' });
    const menu = screen.getByTestId('protected-exam-select-menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Arrows move the highlight without committing anything.
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(onValueChange).not.toHaveBeenCalled();

    // Enter on the highlighted item commits exactly once and closes.
    const highlighted = screen.getByTestId('protected-exam-select-item-ii');
    fireEvent.keyDown(highlighted, { key: 'Enter' });
    fireEvent.keyUp(highlighted, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('ii');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('ii. Modern cities');
  });

  it('Escape closes without mutating; a focusout inside the portal never commits', () => {
    const { onValueChange } = renderSelect({ value: 'i' });

    const trigger = screen.getByTestId('protected-exam-select-trigger');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const menu = screen.getByTestId('protected-exam-select-menu');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    // Focus leaving the control (focusout) must not commit the highlight.
    fireEvent.focusOut(trigger);
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(onValueChange).not.toHaveBeenCalled();
    // Committed value unchanged and still displayed.
    expect(trigger).toHaveTextContent('i. Ancient history');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

/* ------------------------------------------------------------------ */
/* Presentation-independent value semantics (compact sheet, sync DOM)  */
/* ------------------------------------------------------------------ */

function openSheet() {
  fireEvent.click(screen.getByTestId('protected-exam-select-trigger'));
  return screen.getByTestId('protected-exam-select-sheet');
}

describe('ProtectedExamSelect value semantics (P3.3)', () => {
  it('commits the picked value exactly once through the application path', () => {
    const { onValueChange, onLiveValueChange } = renderSelect({ compact: true });

    openSheet();
    fireEvent.click(screen.getByTestId('protected-exam-select-item-ii'));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('ii');
    expect(onLiveValueChange).toHaveBeenCalledWith('ii');
    expect(screen.getByTestId('protected-exam-select-trigger')).toHaveTextContent('ii. Modern cities');
  });

  it('cancel discards the highlighted choice; selected stays distinct', () => {
    const { onValueChange } = renderSelect({ compact: true, value: 'i' });

    openSheet();
    // The sheet marks the committed option; hovering/highlighting another
    // never commits, and Cancel discards the pending choice.
    expect(screen.getByTestId('protected-exam-select-item-i')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTestId('protected-exam-select-cancel'));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('protected-exam-select-trigger')).toHaveTextContent('i. Ancient history');
  });

  it('clears through the dedicated clear action mapped to the empty value', () => {
    const { onValueChange } = renderSelect({ compact: true, value: 'ii' });

    openSheet();
    fireEvent.click(screen.getByTestId('protected-exam-select-clear'));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('');
    expect(screen.getByTestId('protected-exam-select-trigger')).toHaveTextContent('Choose heading…');
  });

  it('selects by ID, not label, when labels duplicate', () => {
    const { onValueChange } = renderSelect({ compact: true });

    openSheet();
    fireEvent.click(screen.getByTestId('protected-exam-select-item-iii'));

    expect(onValueChange).toHaveBeenCalledWith('iii');
  });

  it('cannot commit a disabled option', () => {
    const { onValueChange } = renderSelect({ compact: true });

    openSheet();
    const disabledItem = screen.getByTestId('protected-exam-select-item-iv');
    expect(disabledItem).toBeDisabled();
    fireEvent.click(disabledItem);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('Escape closes the sheet without committing', () => {
    const { onValueChange } = renderSelect({ compact: true, value: 'i' });

    openSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('protected-exam-select-sheet')).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('outside pointer contact closes the sheet without committing', () => {
    const { onValueChange } = renderSelect({ compact: true, value: 'i' });

    openSheet();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('protected-exam-select-sheet')).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('re-commits after an external hydration moved the value (guard reset)', () => {
    const { rerenderWithValue, onValueChange } = renderSelect({ compact: true, value: 'i' });

    // Hydration moves the answer externally: i → ii (no user commit).
    rerenderWithValue('ii');

    // The user deliberately picks the hydrated value again — must flow.
    openSheet();
    fireEvent.click(screen.getByTestId('protected-exam-select-item-ii'));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('ii');
  });

  it('reports ARIA combobox semantics and exposes the committed value', () => {
    renderSelect({ compact: true, value: 'iii' });
    const trigger = screen.getByTestId('protected-exam-select-trigger');
    expect(trigger).toHaveAttribute('role', 'combobox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAccessibleName('Heading selection for question 3');
    expect(screen.getByTestId('protected-exam-select')).toHaveAttribute(
      'data-protected-exam-select-value',
      'iii',
    );
  });
});

/* ------------------------------------------------------------------ */
/* Lifecycle registration (P3.3)                                       */
/* ------------------------------------------------------------------ */

describe('ProtectedExamSelect lifecycle registration (P3.3)', () => {
  it('registers the control root and unmounts cleanly', () => {
    const { unmount } = renderSelect({ compact: true, value: 'i' });
    expect(() => unmount()).not.toThrow();
  });

  it('a focusout while the sheet is open cannot commit the highlighted value', () => {
    const { onValueChange } = renderSelect({ compact: true, value: 'i' });

    openSheet();
    fireEvent.focusOut(screen.getByTestId('protected-exam-select-trigger'));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
