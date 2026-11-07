import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useStudentFocusedControlVisibility } from '../useStudentFocusedControlVisibility';

it('keeps the last answer above the iPad Chrome toolbar as the viewport changes', () => {
  const viewport = Object.assign(new EventTarget(), { height: 600, offsetTop: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('navigator', { userAgent: 'iPad CriOS/142.0 Mobile' });
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => { frame = undefined; });
  const paint = () => act(() => {
    const callback = frame;
    frame = undefined;
    callback?.(0);
  });

  function Exam({ keyboardOpen }: { keyboardOpen: boolean }) {
    useStudentFocusedControlVisibility(keyboardOpen);
    return (
      <div className="student-exam-shell">
        <div data-testid="questions" data-student-zoom-scroll style={{ overflowY: 'auto' }}>
          <input aria-label="Question 14" />
          <input aria-label="Question 15" />
        </div>
      </div>
    );
  }

  try {
    const { rerender, unmount } = render(<Exam keyboardOpen={false} />);
    const pane = screen.getByTestId('questions');
    const previousAnswer = screen.getByRole('textbox', { name: 'Question 14' });
    const answer = screen.getByRole('textbox', { name: 'Question 15' });
    const clearance = () =>
      Number.parseFloat(pane.style.getPropertyValue('--student-keyboard-scroll-clearance')) || 0;
    let scrollTop = 0;
    Object.defineProperties(pane, {
      clientHeight: { value: 700 },
      scrollHeight: { get: () => 780 + clearance() },
      scrollTop: {
        get: () => Math.min(scrollTop, 80 + clearance()),
        set: (value: number) => { scrollTop = Math.max(0, Math.min(value, 80 + clearance())); },
      },
    });
    vi.spyOn(pane, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 100, 500, 700));
    vi.spyOn(answer, 'getBoundingClientRect').mockImplementation(() =>
      new DOMRect(10, 816 - pane.scrollTop, 200, 48));
    vi.spyOn(previousAnswer, 'getBoundingClientRect').mockImplementation(() =>
      new DOMRect(10, 480 - pane.scrollTop, 200, 48));

    act(() => answer.focus());
    rerender(<Exam keyboardOpen />);
    paint();
    expect(answer).toHaveFocus();
    expect(answer.getBoundingClientRect().bottom).toBe(544);

    viewport.height = 400;
    viewport.offsetTop = 40;
    viewport.dispatchEvent(new Event('resize'));
    paint();
    expect(answer.getBoundingClientRect().bottom).toBe(384);

    viewport.offsetTop = 200;
    viewport.dispatchEvent(new Event('scroll'));
    paint();
    act(() => previousAnswer.focus());
    paint();
    expect(previousAnswer).toHaveFocus();
    expect(previousAnswer.getBoundingClientRect().top).toBe(212);

    rerender(<Exam keyboardOpen={false} />);
    expect(clearance()).toBe(0);
    unmount();
  } finally {
    vi.unstubAllGlobals();
  }
});
