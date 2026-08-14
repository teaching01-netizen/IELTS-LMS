import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStudentExamViewport } from '../useStudentExamViewport';

interface VisualViewportMock {
  height: number;
  offsetTop: number;
  scale: number;
  dispatchResize: () => void;
  dispatchScroll: () => void;
  addEventListener: (name: string, handler: (event: Event) => void) => void;
  removeEventListener: (name: string, handler: (event: Event) => void) => void;
}

let visualViewportMock: VisualViewportMock | null = null;
let originalVisualViewport: PropertyDescriptor | undefined;

function installVisualViewport(initialHeight: number, initialOffsetTop = 0) {
  const listeners: Record<string, ((event: Event) => void)[]> = {};
  const mock: VisualViewportMock = {
    height: initialHeight,
    offsetTop: initialOffsetTop,
    scale: 1,
    addEventListener(name, handler) {
      (listeners[name] ??= []).push(handler);
    },
    removeEventListener(name, handler) {
      listeners[name] = (listeners[name] ?? []).filter((entry) => entry !== handler);
    },
    dispatchResize() {
      for (const handler of listeners['resize'] ?? []) {
        handler(new Event('resize'));
      }
    },
    dispatchScroll() {
      for (const handler of listeners['scroll'] ?? []) {
        handler(new Event('scroll'));
      }
    },
  };

  originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: mock,
  });
  visualViewportMock = mock;
}

function resizeWindow(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  if (visualViewportMock) {
    visualViewportMock.height = height;
  }
  window.dispatchEvent(new Event('resize'));
}

function focusEditable() {
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  input.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: input }));
  return input;
}

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 768 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1024 });
});

afterEach(() => {
  if (originalVisualViewport) {
    Object.defineProperty(window, 'visualViewport', originalVisualViewport);
    originalVisualViewport = undefined;
  } else {
    Reflect.deleteProperty(window, 'visualViewport');
  }
  visualViewportMock = null;
});

describe('useStudentExamViewport', () => {
  it('commits a baseline on mount while active', () => {
    installVisualViewport(1024);
    const { result } = renderHook(() => useStudentExamViewport(true));

    expect(result.current.stableExamHeight).toBe(1024);
    expect(result.current.keyboardOpen).toBe(false);
    expect(result.current.visualViewportHeight).toBe(1024);
  });

  it('detects a software keyboard from a focused editable and a meaningful shrink', () => {
    installVisualViewport(1024);
    const { result } = renderHook(() => useStudentExamViewport(true));
    expect(result.current.stableExamHeight).toBe(1024);

    act(() => {
      focusEditable();
    });
    act(() => {
      resizeWindow(768, 580);
    });

    expect(result.current.keyboardOpen).toBe(true);
    expect(result.current.stableExamHeight).toBe(1024);
  });

  it('keeps the shell frozen while the keyboard is open across further shrinks', () => {
    installVisualViewport(1024);
    const { result } = renderHook(() => useStudentExamViewport(true));

    act(() => {
      focusEditable();
    });
    act(() => {
      resizeWindow(768, 620);
    });
    expect(result.current.keyboardOpen).toBe(true);

    act(() => {
      resizeWindow(768, 400);
    });
    expect(result.current.keyboardOpen).toBe(true);
    expect(result.current.stableExamHeight).toBe(1024);
  });

  it('closes the keyboard and restores the baseline after blur and resize back', () => {
    installVisualViewport(1024);
    const { result } = renderHook(() => useStudentExamViewport(true));

    let input: HTMLInputElement | null = null;
    act(() => {
      input = focusEditable();
      resizeWindow(768, 580);
    });
    expect(result.current.keyboardOpen).toBe(true);
    expect(input).not.toBeNull();

    act(() => {
      input!.blur();
      input!.dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }),
      );
      resizeWindow(768, 1024);
    });

    expect(result.current.keyboardOpen).toBe(false);
    expect(result.current.stableExamHeight).toBe(1024);
  });

  it('treats a shrink without focus as browser chrome and updates the baseline', () => {
    installVisualViewport(1024);
    const { result } = renderHook(() => useStudentExamViewport(true));

    act(() => {
      resizeWindow(768, 850);
    });

    expect(result.current.keyboardOpen).toBe(false);
    expect(result.current.stableExamHeight).toBe(850);
  });

  it('re-establishes the baseline after an orientation change', () => {
    installVisualViewport(1024);
    const { result } = renderHook(() => useStudentExamViewport(true));

    act(() => {
      focusEditable();
      resizeWindow(768, 580);
    });
    expect(result.current.keyboardOpen).toBe(true);

    act(() => {
      resizeWindow(1024, 768);
    });

    expect(result.current.keyboardOpen).toBe(false);
    expect(result.current.stableExamHeight).toBe(768);
  });

  it('reports visual viewport offset while scrolling', () => {
    installVisualViewport(700, 120);
    const { result } = renderHook(() => useStudentExamViewport(true));

    act(() => {
      visualViewportMock!.offsetTop = 160;
      visualViewportMock!.dispatchScroll();
    });

    expect(result.current.visualViewportOffsetTop).toBe(160);
    expect(result.current.visualViewportHeight).toBe(700);
  });

  it('does nothing while inactive', () => {
    installVisualViewport(1024);
    const { result } = renderHook(() => useStudentExamViewport(false));

    expect(result.current.stableExamHeight).toBeNull();

    act(() => {
      focusEditable();
      resizeWindow(768, 580);
    });

    expect(result.current.stableExamHeight).toBeNull();
    expect(result.current.keyboardOpen).toBe(false);
  });

  it('falls back to window.innerHeight when VisualViewport is unavailable', () => {
    Reflect.deleteProperty(window, 'visualViewport');
    const { result } = renderHook(() => useStudentExamViewport(true));

    expect(result.current.visualViewportHeight).toBe(1024);
    expect(result.current.stableExamHeight).toBe(1024);
  });
});
