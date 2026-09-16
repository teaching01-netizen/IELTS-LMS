import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ProtectedInput } from '../ProtectedInput';

const saveStudentAuditEventMock = vi.fn();
const flushAnswerDurabilityNowMock = vi.fn();

vi.mock('../../../services/studentAuditService', () => ({
  saveStudentAuditEvent: (...args: unknown[]) => saveStudentAuditEventMock(...args),
}));

vi.mock('../providers/StudentAttemptProvider', () => ({
  useOptionalStudentAttempt: () => ({
    state: {
      attempt: { scheduleId: 'sched-ctx' },
      attemptId: 'attempt-ctx',
    },
    actions: {
      flushAnswerDurabilityNow: (...args: unknown[]) => flushAnswerDurabilityNowMock(...args),
    },
  }),
  useOptionalStudentAttemptControls: () => ({
    getScheduleId: () => 'sched-ctx',
    getAttemptId: () => 'attempt-ctx',
    flushAnswerDurabilityNow: (...args: unknown[]) => flushAnswerDurabilityNowMock(...args),
  }),
}));

describe('ProtectedInput', () => {
  afterEach(() => {
    saveStudentAuditEventMock.mockReset();
    flushAnswerDurabilityNowMock.mockReset();
    vi.restoreAllMocks();
  });

  it('shares lifecycle listeners across protected text inputs', () => {
    const documentAddSpy = vi.spyOn(document, 'addEventListener');
    const windowAddSpy = vi.spyOn(window, 'addEventListener');

    const { unmount } = render(
      <>
        <ProtectedInput security={{ preventAutofill: true, preventAutocorrect: true } as any} name="a" />
        <ProtectedInput security={{ preventAutofill: true, preventAutocorrect: true } as any} name="b" />
        <ProtectedInput security={{ preventAutofill: true, preventAutocorrect: true } as any} name="c" />
      </>,
    );

    const documentLifecycleAdds = documentAddSpy.mock.calls.filter(([eventName]) =>
      ['focusout', 'visibilitychange', 'freeze'].includes(String(eventName)),
    );
    const windowLifecycleAdds = windowAddSpy.mock.calls.filter(([eventName]) =>
      ['pagehide', 'beforeunload'].includes(String(eventName)),
    );

    expect(documentLifecycleAdds.filter(([eventName]) => eventName === 'focusout')).toHaveLength(1);
    expect(documentLifecycleAdds.filter(([eventName]) => eventName === 'visibilitychange')).toHaveLength(1);
    expect(documentLifecycleAdds.filter(([eventName]) => eventName === 'freeze')).toHaveLength(1);
    expect(windowLifecycleAdds.filter(([eventName]) => eventName === 'pagehide')).toHaveLength(1);
    expect(windowLifecycleAdds.filter(([eventName]) => eventName === 'beforeunload')).toHaveLength(1);

    unmount();
  });

  it('does not emit paste audit events (clipboard enforcement lives at document level)', () => {
    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        sessionId="sched-1"
        studentId="attempt-1"
      />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.paste(input);

    expect(saveStudentAuditEventMock).not.toHaveBeenCalled();
  });

  it('emits live value callback on native input', () => {
    const onLiveValueChange = vi.fn();
    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        onLiveValueChange={onLiveValueChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'abc' } });
    expect(onLiveValueChange).toHaveBeenCalledWith('abc');
  });

  it('defaults audit IDs from attempt context when props are omitted', () => {
    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
      />,
    );

    const input = screen.getByRole('textbox');
    const event = new Event('beforeinput', { bubbles: true, cancelable: true });
    Object.assign(event, { inputType: 'insertReplacementText', data: 'x' });
    fireEvent(input, event);

    expect(saveStudentAuditEventMock).toHaveBeenCalledWith(
      'sched-ctx',
      'AUTOFILL_SUSPECTED',
      expect.any(Object),
      'attempt-ctx',
    );
  });

  it('commits the latest DOM value on pagehide (iPad/Safari last-keystroke protection)', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="abc"
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;

    // Simulate the iOS/Safari failure mode: the DOM has a newer value than React state,
    // but no input/change event was delivered before the page is backgrounded.
    input.value = 'abcd';

    fireEvent(window, new Event('pagehide'));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((handleChange.mock.calls[0]?.[0] as { target?: { value?: unknown } }).target?.value).toBe('abcd');
  });

  it('forces immediate answer durability flush after pagehide DOM rescue commit', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="abc"
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.value = 'abcd';

    fireEvent(window, new Event('pagehide'));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });

  it('commits the latest DOM value on focusout when controlled state is stale', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="abc"
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.value = 'abcd';

    fireEvent(input, new FocusEvent('focusout', { bubbles: true }));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((handleChange.mock.calls[0]?.[0] as { target?: { value?: unknown } }).target?.value).toBe('abcd');
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });

  it('commits the latest DOM value on beforeunload when controlled state is stale', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="abc"
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.value = 'abcd';

    fireEvent(window, new Event('beforeunload'));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((handleChange.mock.calls[0]?.[0] as { target?: { value?: unknown } }).target?.value).toBe('abcd');
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes DOM rescue commits across sequential lifecycle events for the same value', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="abc"
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.value = 'abcd';

    fireEvent(input, new FocusEvent('focusout', { bubbles: true }));
    fireEvent(window, new Event('pagehide'));
    fireEvent(window, new Event('beforeunload'));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });

  it('commits a deferred focusout rescue when iPad applies a late DOM value after blur', async () => {
    vi.useFakeTimers();
    const handleChange = vi.fn();

    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="abc"
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.value = 'abcd';
    fireEvent(input, new FocusEvent('focusout', { bubbles: true }));
    expect(handleChange).toHaveBeenCalledTimes(1);

    input.value = 'abcde';
    vi.advanceTimersByTime(0);
    await Promise.resolve();

    expect(handleChange).toHaveBeenCalledTimes(2);
    expect((handleChange.mock.calls[1]?.[0] as { target?: { value?: unknown } }).target?.value).toBe(
      'abcde',
    );
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('blocks historyUndo in beforeinput and emits undo-blocked telemetry', () => {
    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="LATEST"
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    const undoBeforeInput = new Event('beforeinput', { bubbles: true, cancelable: true });
    Object.assign(undoBeforeInput, { inputType: 'historyUndo' });
    const preventDefaultSpy = vi.spyOn(undoBeforeInput, 'preventDefault');
    const stopPropagationSpy = vi.spyOn(undoBeforeInput, 'stopPropagation');

    fireEvent(input, undoBeforeInput);

    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    expect(stopPropagationSpy).toHaveBeenCalledTimes(1);
    expect(saveStudentAuditEventMock).toHaveBeenCalledWith(
      'sched-ctx',
      'UNDO_BLOCKED',
      expect.objectContaining({
        surface: 'objective',
        targetName: 'answer',
        via: 'beforeinput',
      }),
      'attempt-ctx',
    );
  });

  it('blocks keyboard undo shortcuts and emits undo-blocked telemetry', () => {
    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="LATEST"
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    const undoShortcut = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      metaKey: true,
    });
    const preventDefaultSpy = vi.spyOn(undoShortcut, 'preventDefault');
    const stopPropagationSpy = vi.spyOn(undoShortcut, 'stopPropagation');

    fireEvent(input, undoShortcut);

    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    expect(stopPropagationSpy).toHaveBeenCalledTimes(1);
    expect(saveStudentAuditEventMock).toHaveBeenCalledWith(
      'sched-ctx',
      'UNDO_BLOCKED',
      expect.objectContaining({
        surface: 'objective',
        targetName: 'answer',
        via: 'keydown',
      }),
      'attempt-ctx',
    );
  });

  it('restores latest snapshot on historyUndo input fallback and flushes durability', async () => {
    const handleChange = vi.fn();
    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="LATEST"
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.value = 'older-browser-history-value';

    const undoBeforeInput = new Event('beforeinput', { bubbles: true, cancelable: false });
    Object.assign(undoBeforeInput, { inputType: 'historyUndo' });
    fireEvent(input, undoBeforeInput);

    const undoInput = new Event('input', { bubbles: true, cancelable: false });
    Object.assign(undoInput, { inputType: 'historyUndo' });
    fireEvent(input, undoInput);
    await Promise.resolve();

    expect(input.value).toBe('LATEST');
    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
    expect(saveStudentAuditEventMock).toHaveBeenCalledWith(
      'sched-ctx',
      'UNDO_RESTORED',
      expect.objectContaining({
        surface: 'objective',
        targetName: 'answer',
        via: 'input',
      }),
      'attempt-ctx',
    );
  });

  it('ignores stray historyUndo input events without a trusted precursor', async () => {
    const handleChange = vi.fn();
    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="LATEST"
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.value = 'abcdefghijklmnop';

    const undoInput = new Event('input', { bubbles: true, cancelable: false });
    Object.assign(undoInput, { inputType: 'historyUndo' });
    fireEvent(input, undoInput);
    await Promise.resolve();

    expect(input.value).toBe('abcdefghijklmnop');
    expect(handleChange).not.toHaveBeenCalled();
    expect(flushAnswerDurabilityNowMock).not.toHaveBeenCalled();
    expect(
      saveStudentAuditEventMock.mock.calls.some((call) => call[1] === 'UNDO_RESTORED'),
    ).toBe(false);
  });

  it('keeps long unbroken typing text intact during normal input', () => {
    const onLiveValueChange = vi.fn();
    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        onLiveValueChange={onLiveValueChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    const longWord = 'abcdefghijklmnop';
    fireEvent.input(input, { target: { value: longWord } });

    expect(input.value).toBe(longWord);
    expect(onLiveValueChange).toHaveBeenLastCalledWith(longWord);
  });
});

/**
 * Bug 3 preservation: a native edit React never observed must survive an
 * unrelated parent render — which re-applies the controlled value over the DOM
 * — and still reach the answer owner on blur/lifecycle. A genuine controlled
 * value change (hydration) must still win, so stale rescue text is never
 * replayed over a fresh server value (FIX-02).
 */
describe('ProtectedInput native intent retention (Bug 3 preservation)', () => {
  afterEach(() => {
    saveStudentAuditEventMock.mockReset();
    flushAnswerDurabilityNowMock.mockReset();
    vi.restoreAllMocks();
  });

  function renderControlledInput(initialValue: string) {
    const commits: string[] = [];
    let redraw: () => void = () => undefined;

    function Harness() {
      const [answer, setAnswer] = React.useState(initialValue);
      const [renderCount, setRenderCount] = React.useState(0);
      redraw = () => setRenderCount((count) => count + 1);
      return (
        <ProtectedInput
          security={{ preventAutofill: true, preventAutocorrect: true } as any}
          name="answer"
          value={answer}
          data-render={renderCount}
          onChange={(event) => {
            commits.push(event.target.value);
            setAnswer(event.target.value);
          }}
        />
      );
    }

    render(<Harness />);
    return { commits, redraw };
  }

  it('commits a DOM-ahead native edit after an unrelated parent render resets the input', () => {
    const { commits, redraw } = renderControlledInput('base');
    const input = screen.getByRole('textbox') as HTMLInputElement;
    const typed = 'base plus unseen typing';

    // Native-only edit: the DOM advances while React never sees a change.
    input.value = typed;
    act(() => redraw());
    fireEvent.blur(input);

    expect(commits).toEqual([typed]);
    expect(input.value).toBe(typed);
  });

  it('commits the retained native edit on pagehide after an unrelated parent render', () => {
    const { commits, redraw } = renderControlledInput('base');
    const input = screen.getByRole('textbox') as HTMLInputElement;

    input.value = 'lifecycle recovery';
    act(() => redraw());
    fireEvent(window, new Event('pagehide'));

    expect(commits).toEqual(['lifecycle recovery']);
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });

  it('commits a native clear of the answer after an unrelated parent render', () => {
    const { commits, redraw } = renderControlledInput('previous answer');
    const input = screen.getByRole('textbox') as HTMLInputElement;

    input.value = '';
    act(() => redraw());
    fireEvent.blur(input);

    expect(commits).toEqual(['']);
    expect(input.value).toBe('');
  });

  it('never replays a retained edit onto a reused control for another question', () => {
    const commits: string[] = [];

    function SlotHarness({ name, value }: { name: string; value: string }) {
      return (
        <ProtectedInput
          security={{ preventAutofill: true, preventAutocorrect: true } as any}
          name={name}
          value={value}
          onChange={(event) => {
            commits.push(`${name}:${event.target.value}`);
          }}
        />
      );
    }

    const view = render(<SlotHarness name="q1" value="same" />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.value = 'typed for q1';

    // The same DOM node is reused for q2, whose answer happens to be identical:
    // the q1 edit must not be committed to q2.
    view.rerender(<SlotHarness name="q2" value="same" />);
    fireEvent.blur(input);

    expect(commits).toEqual([]);
    expect(input.value).toBe('same');
  });

  it('does not replay a pre-hydration native edit over a controlled value change', () => {
    const commits: string[] = [];

    function HydrationHarness({ value }: { value: string }) {
      return (
        <ProtectedInput
          security={{ preventAutofill: true, preventAutocorrect: true } as any}
          name="answer"
          value={value}
          onChange={(event) => {
            commits.push(event.target.value);
          }}
        />
      );
    }

    const view = render(<HydrationHarness value="abc" />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.value = 'abcd';

    // Server hydration replaces the answer while the DOM holds an uncommitted
    // edit: the controlled value change is the acknowledgement/supersede point.
    view.rerender(<HydrationHarness value="hydrated" />);
    fireEvent.blur(input);

    expect(commits).toEqual([]);
    expect(input.value).toBe('hydrated');
  });
});
