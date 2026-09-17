/**
 * One-time contextual hints.
 *
 * Some capabilities are discovered by using them (paste LaTeX, select an
 * image). For the ones that only need pointing at once, this store remembers
 * that the author has already seen the pointer, so the product can stop
 * teaching the moment understanding is demonstrated.
 *
 * Persistence is a port, not an import: the composer receives a store from its
 * composition boundary, tests inject a fake, and browser storage (which can
 * throw in private mode) never leaks into editor logic.
 */
export interface OneTimeHintStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OneTimeHintStore {
  seen(key: string): boolean;
  markSeen(key: string): void;
}

export const IMAGE_OBJECT_HINT_KEY = "sat-authoring.editor.image-object-hint";

export function createOneTimeHintStore(storage: OneTimeHintStorage | null): OneTimeHintStore {
  return {
    seen(key) {
      try {
        return storage?.getItem(key) === "true";
      } catch {
        return false;
      }
    },
    markSeen(key) {
      try {
        storage?.setItem(key, "true");
      } catch {
        // A read-only or unavailable store only costs the author one repeated
        // hint; it must never break editing.
      }
    },
  };
}

/** The default store for real browsers, created at the composition boundary. */
export function defaultHintStore(): OneTimeHintStore {
  if (typeof window === "undefined") return createOneTimeHintStore(null);
  try {
    return createOneTimeHintStore(window.localStorage);
  } catch {
    return createOneTimeHintStore(null);
  }
}
