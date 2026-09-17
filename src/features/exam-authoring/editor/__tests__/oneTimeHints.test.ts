import { describe, expect, it } from "vitest";
import {
  IMAGE_OBJECT_HINT_KEY,
  createOneTimeHintStore,
  defaultHintStore,
} from "../oneTimeHints";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    snapshot: () => ({ ...store }),
  };
}

describe("one-time hints", () => {
  it("remembers that the author has already been shown something", () => {
    const storage = fakeStorage();
    const hints = createOneTimeHintStore(storage);
    expect(hints.seen(IMAGE_OBJECT_HINT_KEY)).toBe(false);
    hints.markSeen(IMAGE_OBJECT_HINT_KEY);
    expect(hints.seen(IMAGE_OBJECT_HINT_KEY)).toBe(true);
    expect(storage.snapshot()[IMAGE_OBJECT_HINT_KEY]).toBe("true");
  });

  it("never breaks editing when storage is unavailable or read-only", () => {
    const unavailable = createOneTimeHintStore(null);
    expect(unavailable.seen(IMAGE_OBJECT_HINT_KEY)).toBe(false);
    expect(() => unavailable.markSeen(IMAGE_OBJECT_HINT_KEY)).not.toThrow();

    const hostile = createOneTimeHintStore({
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
    });
    expect(hostile.seen(IMAGE_OBJECT_HINT_KEY)).toBe(false);
    expect(() => hostile.markSeen(IMAGE_OBJECT_HINT_KEY)).not.toThrow();
  });

  it("defaults to browser storage", () => {
    const hints = defaultHintStore();
    hints.markSeen("sat-authoring.test.key");
    expect(hints.seen("sat-authoring.test.key")).toBe(true);
    window.localStorage.removeItem("sat-authoring.test.key");
  });
});
