import { afterEach, describe, expect, it } from 'vitest';

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

    expect(EXAM_VIEWPORT_CONTENT).toContain('interactive-widget=overlays-content');
    expect(EXAM_VIEWPORT_CONTENT).not.toContain('interactive-widget=resizes-visual');
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
