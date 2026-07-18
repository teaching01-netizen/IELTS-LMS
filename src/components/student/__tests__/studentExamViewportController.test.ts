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
    });

    try {
      expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe(
        '640px',
      );
      expect(
        document.documentElement.style.getPropertyValue('--student-viewport-offset-top'),
      ).toBe('120px');

      vi.advanceTimersByTime(800);
      viewport.set(900, 0);
      vi.advanceTimersByTime(800);

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

  it('keeps the trusted full height when keyboard dismissal geometry remains smaller', () => {
    const viewport = installMutableVisualViewport(900);
    const input = document.createElement('input');
    document.body.append(input);
    const cleanup = installStudentExamViewportController({
      targetWindow: window,
      targetDocument: document,
    });

    try {
      vi.advanceTimersByTime(1_600);
      input.focus();
      viewport.set(560, 100);
      viewport.dispatchResize();

      expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe(
        '900px',
      );
      expect(
        document.documentElement.style.getPropertyValue('--student-viewport-offset-top'),
      ).toBe('100px');

      input.blur();
      viewport.set(820, 20);
      vi.advanceTimersByTime(1_600);

      expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe(
        '900px',
      );
      expect(
        document.documentElement.style.getPropertyValue('--student-viewport-offset-top'),
      ).toBe('0px');

      viewport.set(810, 10);
      viewport.dispatchResize();

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

  it('accepts late native-scale growth after keyboard dismissal', () => {
    const viewport = installMutableVisualViewport(900);
    const input = document.createElement('input');
    document.body.append(input);
    const cleanup = installStudentExamViewportController({
      targetWindow: window,
      targetDocument: document,
    });

    try {
      vi.advanceTimersByTime(1_600);
      input.focus();
      viewport.set(560, 100);
      viewport.dispatchResize();
      input.blur();
      viewport.set(820, 20);
      vi.advanceTimersByTime(800);
      viewport.set(950, 0);
      vi.advanceTimersByTime(800);

      expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe(
        '950px',
      );
      expect(
        document.documentElement.style.getPropertyValue('--student-viewport-offset-top'),
      ).toBe('0px');
    } finally {
      cleanup();
      viewport.restore();
    }
  });

  it('accepts native-scale browser chrome shrink after the viewport is stable', () => {
    const viewport = installMutableVisualViewport(900);
    const cleanup = installStudentExamViewportController({
      targetWindow: window,
      targetDocument: document,
    });

    try {
      vi.advanceTimersByTime(1_600);
      viewport.set(840, 10);
      viewport.dispatchResize();

      expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe(
        '840px',
      );
      expect(
        document.documentElement.style.getPropertyValue('--student-viewport-offset-top'),
      ).toBe('10px');
    } finally {
      cleanup();
      viewport.restore();
    }
  });

  it('falls back to layout height when visual viewport geometry is invalid', () => {
    const viewport = installMutableVisualViewport(0);
    const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 777 });
    const cleanup = installStudentExamViewportController({
      targetWindow: window,
      targetDocument: document,
    });

    try {
      expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe(
        '777px',
      );
    } finally {
      cleanup();
      viewport.restore();
      if (originalInnerHeight) {
        Object.defineProperty(window, 'innerHeight', originalInnerHeight);
      }
    }
  });

  it('allows an explicit orientation topology change to shrink the trusted viewport', () => {
    const viewport = installMutableVisualViewport(900);
    const input = document.createElement('input');
    document.body.append(input);
    const cleanup = installStudentExamViewportController({
      targetWindow: window,
      targetDocument: document,
    });

    try {
      vi.advanceTimersByTime(1_600);
      input.focus();
      viewport.set(560, 100);
      viewport.dispatchResize();
      viewport.set(700, 0);
      window.dispatchEvent(new Event('orientationchange'));

      expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe(
        '700px',
      );
    } finally {
      cleanup();
      viewport.restore();
    }
  });

  it('uses optional VirtualKeyboard geometry changes and removes the listener on cleanup', () => {
    const viewport = installMutableVisualViewport(900);
    const virtualKeyboard = new EventTarget();
    const originalVirtualKeyboard = Object.getOwnPropertyDescriptor(
      window.navigator,
      'virtualKeyboard',
    );
    Object.defineProperty(window.navigator, 'virtualKeyboard', {
      configurable: true,
      value: virtualKeyboard,
    });
    const cleanup = installStudentExamViewportController({
      targetWindow: window,
      targetDocument: document,
    });

    try {
      viewport.set(950, 0);
      virtualKeyboard.dispatchEvent(new Event('geometrychange'));

      expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe(
        '950px',
      );

      cleanup();
      viewport.set(1000, 0);
      virtualKeyboard.dispatchEvent(new Event('geometrychange'));
      expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe('');
    } finally {
      cleanup();
      viewport.restore();
      if (originalVirtualKeyboard) {
        Object.defineProperty(window.navigator, 'virtualKeyboard', originalVirtualKeyboard);
      } else {
        Reflect.deleteProperty(window.navigator, 'virtualKeyboard');
      }
    }
  });

  it('cancels delayed work and removes listeners and CSS state idempotently', () => {
    const viewport = installMutableVisualViewport(640, 120);
    const cleanup = installStudentExamViewportController({
      targetWindow: window,
      targetDocument: document,
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
