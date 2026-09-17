import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock localStorage for tests
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
})();

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
  });
}

// jsdom lacks ResizeObserver, which @dnd-kit/dom references at import time.
if (typeof (globalThis as Record<string, unknown>)["ResizeObserver"] === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>)["ResizeObserver"] = ResizeObserverStub;
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>)["ResizeObserver"] = ResizeObserverStub;
  }
}

// jsdom (as shipped) lacks window.PointerEvent, so `fireEvent.pointerDown`
// dispatches a plain Event and pointer properties (pointerId, clientX) never
// reach React handlers. Production code follows the real Pointer Events
// contract (pointer capture, pointerId de-duplication), so tests get a
// faithful MouseEvent-based polyfill instead of forcing components to keep
// legacy mouse listeners.
if (typeof window !== "undefined" && (window as unknown as Record<string, unknown>)["PointerEvent"] === undefined) {
  class PointerEventPolyfill extends MouseEvent {
    public pointerId: number;
    public pointerType: string;
    public isPrimary: boolean;
    public pressure: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "";
      this.isPrimary = params.isPrimary ?? false;
      this.pressure = params.pressure ?? 0;
    }
  }
  (window as unknown as Record<string, unknown>)["PointerEvent"] = PointerEventPolyfill;
}

// jsdom ships canvas elements without a rendering backend: getContext("2d")
// raises a "Not implemented" console error before returning null. Production
// code feature-detects the canvas and degrades when it is absent (clipboard
// image fingerprinting is skipped, byte identity still applies), so tests get
// the same honest null without the console noise.
if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: () => null,
  });
}

if (typeof Element !== "undefined") {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
}

// jsdom implements neither getClientRects() nor getBoundingClientRect() on
// Range. ProseMirror's coordsAtPos() — which the rich editor's anchored
// editing surfaces use to sit next to a selection or a selected object — calls
// both and throws without them. The stub reports an empty, zero-sized box:
// tests assert the surfaces' presence and state, never their measured pixels.
//
// Both stay writable: tests that position a surface (see
// highlightSelectionPort.test.tsx, EditableMathExtension.test.tsx) assign a
// rect onto a live range instance, and a non-writable prototype property turns
// that assignment into a TypeError under strict mode.
if (typeof Range !== "undefined") {
  if (typeof Range.prototype.getClientRects !== "function") {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      writable: true,
      value: () => [] as unknown as DOMRectList,
    });
  }
  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      writable: true,
      value: () =>
        ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    });
  }
}

// jsdom has no Pointer Capture API. Production components (splitter, Radix
// Select) call hasPointerCapture/setPointerCapture/releasePointerCapture;
// stub them browser-faithfully (nothing ever holds capture) instead of
// forcing components to guard every call.
if (typeof Element !== "undefined") {
  const captureStub = { configurable: true } as PropertyDescriptor;
  for (const method of [
    "hasPointerCapture",
    "setPointerCapture",
    "releasePointerCapture",
  ] as const) {
    if (!(method in Element.prototype)) {
      Object.defineProperty(Element.prototype, method, {
        ...captureStub,
        value:
          method === "hasPointerCapture"
            ? () => false
            : () => {},
      });
    }
  }
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: () => {},
  });
}

// Deterministic micro-interactions in tests: zero all CSS/JS animation
// durations so assertions never race transitions. Production unaffected.
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.setAttribute("data-testing", "no-motion");
  style.textContent =
    ".testing-no-motion *, .testing-no-motion *::before, .testing-no-motion *::after" +
    "{ animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }";
  document.head.appendChild(style);
  document.documentElement.classList.add("testing-no-motion");
}
