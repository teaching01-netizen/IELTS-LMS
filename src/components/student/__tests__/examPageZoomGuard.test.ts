import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EXAM_VIEWPORT_CONTENT,
  installExamPageZoomGuard,
} from '../examPageZoomGuard';

const ORIGINAL_VIEWPORT_CONTENT = 'width=device-width, initial-scale=1.0';

function setViewport(content: string) {
  let viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) {
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    document.head.appendChild(viewport);
  }
  viewport.content = content;
  return viewport;
}

function createTouchMove(touchCount: number) {
  const event = new Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    configurable: true,
    value: Array.from({ length: touchCount }, (_, index) => ({ identifier: index })),
  });
  return event;
}

afterEach(() => {
  document.querySelector('meta[name="viewport"]')?.remove();
});

describe('installExamPageZoomGuard', () => {
  it('applies the exam viewport policy and restores the original content exactly', () => {
    const viewport = setViewport(ORIGINAL_VIEWPORT_CONTENT);

    const cleanup = installExamPageZoomGuard(document);

    expect(EXAM_VIEWPORT_CONTENT).toContain('viewport-fit=cover');
    expect(EXAM_VIEWPORT_CONTENT).not.toContain('interactive-widget=');
    expect(viewport).toHaveAttribute('content', EXAM_VIEWPORT_CONTENT);
    cleanup();
    expect(viewport).toHaveAttribute('content', ORIGINAL_VIEWPORT_CONTENT);
  });

  it('removes a viewport element that it created during cleanup', () => {
    expect(document.querySelector('meta[name="viewport"]')).toBeNull();

    const cleanup = installExamPageZoomGuard(document);

    expect(document.querySelector('meta[name="viewport"]')).toHaveAttribute(
      'content',
      EXAM_VIEWPORT_CONTENT,
    );
    cleanup();
    expect(document.querySelector('meta[name="viewport"]')).toBeNull();
  });

  it('keeps the measured visual viewport height authoritative when dvh is supported', () => {
    setViewport(ORIGINAL_VIEWPORT_CONTENT);
    const originalCss = window.CSS;
    const originalVisualViewport = window.visualViewport;
    const visualViewport = new EventTarget() as VisualViewport;
    Object.defineProperty(visualViewport, 'height', {
      configurable: true,
      value: 700,
      writable: true,
    });
    Object.defineProperty(window, 'CSS', {
      configurable: true,
      value: { supports: () => true },
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    });

    const cleanup = installExamPageZoomGuard(document);

    expect(document.documentElement.style.getPropertyValue('--student-visual-viewport-height')).toBe('700px');
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 620 });
    visualViewport.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--student-visual-viewport-height')).toBe('620px');
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 700 });
    visualViewport.dispatchEvent(new Event('scroll'));
    expect(document.documentElement.style.getPropertyValue('--student-visual-viewport-height')).toBe('700px');

    cleanup();
    expect(document.documentElement.style.getPropertyValue('--student-visual-viewport-height')).toBe('');
    Object.defineProperty(window, 'CSS', { configurable: true, value: originalCss });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: originalVisualViewport,
    });
  });

  it('resamples the visual viewport after the keyboard focus transition settles', () => {
    vi.useFakeTimers();
    setViewport(ORIGINAL_VIEWPORT_CONTENT);
    const originalVisualViewport = window.visualViewport;
    const visualViewport = new EventTarget() as VisualViewport;
    Object.defineProperty(visualViewport, 'height', {
      configurable: true,
      value: 420,
      writable: true,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    });

    const cleanup = installExamPageZoomGuard(document);

    expect(document.documentElement.style.getPropertyValue('--student-visual-viewport-height')).toBe('420px');
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 700 });
    vi.advanceTimersByTime(700);
    expect(document.documentElement.style.getPropertyValue('--student-visual-viewport-height')).toBe('700px');

    cleanup();
    vi.runOnlyPendingTimers();
    expect(document.documentElement.style.getPropertyValue('--student-visual-viewport-height')).toBe('');
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: originalVisualViewport,
    });
    vi.useRealTimers();
  });

  it('blocks native multi-touch and Safari gesture events but preserves single-touch movement', () => {
    setViewport(ORIGINAL_VIEWPORT_CONTENT);
    const cleanup = installExamPageZoomGuard(document);
    const singleTouchMove = createTouchMove(1);
    const multiTouchMove = createTouchMove(2);

    document.dispatchEvent(singleTouchMove);
    document.dispatchEvent(multiTouchMove);

    expect(singleTouchMove.defaultPrevented).toBe(false);
    expect(multiTouchMove.defaultPrevented).toBe(true);

    for (const eventName of ['gesturestart', 'gesturechange', 'gestureend']) {
      const gesture = new Event(eventName, { bubbles: true, cancelable: true });
      document.dispatchEvent(gesture);
      expect(gesture.defaultPrevented).toBe(true);
    }

    cleanup();
    const gestureAfterCleanup = new Event('gesturestart', { bubbles: true, cancelable: true });
    document.dispatchEvent(gestureAfterCleanup);
    expect(gestureAfterCleanup.defaultPrevented).toBe(false);
  });
});
