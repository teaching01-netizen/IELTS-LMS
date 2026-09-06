/**
 * Single-owner body scroll lock shared by overlay primitives (Dialog, Drawer).
 *
 * Multiple overlays may be open at once (e.g. a Dialog over a Drawer). A naive
 * `overflow = 'hidden'` / `overflow = 'unset'` pair per component restores
 * scrolling while another overlay is still open, and clobbers a pre-existing
 * inline overflow value. This module keeps one process-wide owner count: the
 * first acquirer saves and replaces the inline value, the last releaser
 * restores exactly what was saved.
 */

interface ScrollLockState {
  count: number;
  savedOverflow: string;
}

function lockState(): ScrollLockState {
  const globalScope = globalThis as unknown as {
    __dshBodyScrollLock?: ScrollLockState | undefined;
  };
  if (!globalScope.__dshBodyScrollLock) {
    globalScope.__dshBodyScrollLock = { count: 0, savedOverflow: "" };
  }
  return globalScope.__dshBodyScrollLock;
}

export function acquireBodyScrollLock(): void {
  if (typeof document === "undefined") return;
  const state = lockState();
  if (state.count === 0) {
    state.savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  state.count += 1;
}

export function releaseBodyScrollLock(): void {
  if (typeof document === "undefined") return;
  const state = lockState();
  if (state.count <= 0) return;
  state.count -= 1;
  if (state.count === 0) {
    document.body.style.overflow = state.savedOverflow;
  }
}
