import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStudentExamViewportController } from '../studentExamViewportController';

function installMutableVisualViewport(initialHeight: number, initialOffsetTop = 0) {
  const target = new EventTarget();
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  let height = initialHeight;
  let offsetTop = initialOffsetTop;
  let scale = 1;

  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      get height() {
        return height;
      },
      get offsetTop() {
        return offsetTop;
      },
      get scale() {
        return scale;
      },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    },
  });

  return {
    set(nextHeight: number, nextOffsetTop: number, nextScale = 1) {
      height = nextHeight;
      offsetTop = nextOffsetTop;
      scale = nextScale;
    },
    dispatchResize() {
      target.dispatchEvent(new Event('resize'));
    },
    restore() {
      if (original) {
        Object.defineProperty(window, 'visualViewport', original);
      } else {
        Reflect.deleteProperty(window, 'visualViewport');
      }
    },
  };
}

describe('installStudentExamViewportController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.documentElement.classList.remove('student-exam-active');
    document.body.classList.remove('student-exam-active');
    document.documentElement.style.removeProperty('--student-viewport-height');
    document.documentElement.style.removeProperty('--student-viewport-offset-top');
    document.body.replaceChildren();
  });

  it('settles to a final reused-tab viewport even when no resize event fires', () => {
    const viewport = installMutableVisualViewport(640, 120);
    const cleanup = installStudentExamViewportController({
      targetWindow: window,
      targetDocument: document,
      protectHeight: true,
    });

    try {
      expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe(
        '640px',
      );
      expect(
        document.documentElement.style.getPropertyValue('--student-viewport-offset-top'),
      ).toBe('120px');

      viewport.set(900, 0);
      vi.advanceTimersByTime(500);

      expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe(
        '900px',
      );
      expect(
        document.documentElement.style.getPropertyValue('--student-viewport-offset-top'),
      ).toBe('0px');
    } finally {
      cleanup();
      viewport.restore();
    }
  });

  it('preserves keyboard shrinkage and rebases after editable focusout without a final resize', () => {
    const viewport = installMutableVisualViewport(900);
    const input = document.createElement('input');
    document.body.append(input);
    const cleanup = installStudentExamViewportController({
      targetWindow: window,
      targetDocument: document,
      protectHeight: true,
    });

    try {
      vi.advanceTimersByTime(500);
      input.focus();
      viewport.set(560, 100);
      viewport.dispatchResize();
      vi.advanceTimersByTime(500);

      expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe(
        '900px',
      );
      expect(
        document.documentElement.style.getPropertyValue('--student-viewport-offset-top'),
      ).toBe('100px');

      input.blur();
      viewport.set(820, 20);
      vi.advanceTimersByTime(500);

      expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe(
        '820px',
      );
      expect(
        document.documentElement.style.getPropertyValue('--student-viewport-offset-top'),
      ).toBe('20px');
    } finally {
      cleanup();
      viewport.restore();
    }
  });

  it('cancels delayed work and removes listeners and CSS state idempotently', () => {
    const viewport = installMutableVisualViewport(640, 120);
    const cleanup = installStudentExamViewportController({
      targetWindow: window,
      targetDocument: document,
      protectHeight: true,
    });

    viewport.set(900, 0);
    cleanup();
    cleanup();
    vi.advanceTimersByTime(500);
    window.dispatchEvent(new Event('pageshow'));

    expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--student-viewport-offset-top')).toBe(
      '',
    );
    expect(document.documentElement).not.toHaveClass('student-exam-active');
    expect(document.body).not.toHaveClass('student-exam-active');
    viewport.restore();
  });
});
