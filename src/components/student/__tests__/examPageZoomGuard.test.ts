import { afterEach, describe, expect, it } from "vitest";

import { EXAM_VIEWPORT_CONTENT, installExamPageZoomGuard } from "../examPageZoomGuard";

const ORIGINAL_VIEWPORT_CONTENT = "width=device-width, initial-scale=1.0";

function setViewport(content: string) {
  let viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) {
    viewport = document.createElement("meta");
    viewport.name = "viewport";
    document.head.appendChild(viewport);
  }
  viewport.content = content;
  return viewport;
}

afterEach(() => {
  document.querySelector('meta[name="viewport"]')?.remove();
});

describe("installExamPageZoomGuard", () => {
  it("applies a zoom-permissive exam viewport and restores the original content exactly", () => {
    const viewport = setViewport(ORIGINAL_VIEWPORT_CONTENT);

    const cleanup = installExamPageZoomGuard(document);

    expect(EXAM_VIEWPORT_CONTENT).toContain("viewport-fit=cover");
    expect(EXAM_VIEWPORT_CONTENT).not.toContain("interactive-widget=");
    expect(EXAM_VIEWPORT_CONTENT).not.toMatch(/maximum-scale/i);
    expect(EXAM_VIEWPORT_CONTENT).not.toMatch(/user-scalable=no/i);
    expect(viewport).toHaveAttribute("content", EXAM_VIEWPORT_CONTENT);
    cleanup();
    expect(viewport).toHaveAttribute("content", ORIGINAL_VIEWPORT_CONTENT);
  });

  it("does not disable native pinch zoom, multi-touch, or Safari gesture events", () => {
    setViewport(ORIGINAL_VIEWPORT_CONTENT);
    const cleanup = installExamPageZoomGuard(document);

    for (const eventName of ["gesturestart", "gesturechange", "gestureend"]) {
      const gesture = new Event(eventName, { bubbles: true, cancelable: true });
      document.dispatchEvent(gesture);
      expect(gesture.defaultPrevented).toBe(false);
    }

    const touches = [1, 2, 3].map((count) => {
      const event = new Event("touchmove", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", {
        configurable: true,
        value: Array.from({ length: count }, (_, index) => ({ identifier: index })),
      });
      return event;
    });
    for (const touchMove of touches) {
      document.dispatchEvent(touchMove);
      expect(touchMove.defaultPrevented).toBe(false);
    }

    cleanup();
  });

  it("removes a viewport element that it created during cleanup", () => {
    expect(document.querySelector('meta[name="viewport"]')).toBeNull();

    const cleanup = installExamPageZoomGuard(document);

    expect(document.querySelector('meta[name="viewport"]')).toHaveAttribute(
      "content",
      EXAM_VIEWPORT_CONTENT
    );
    cleanup();
    expect(document.querySelector('meta[name="viewport"]')).toBeNull();
  });
});
