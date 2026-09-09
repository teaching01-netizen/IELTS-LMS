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

if (typeof Element !== "undefined") {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
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
