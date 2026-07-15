export type SelectionObserverCallback = () => boolean;

const subscribers = new Set<SelectionObserverCallback>();
let isPointerDown = false;
let completionNotified = false;
let lastPointerCompletionAt = Number.NEGATIVE_INFINITY;
let resetTimer: ReturnType<typeof setTimeout> | null = null;
let listenersInstalled = false;

function notifySubscribers(): boolean {
  for (const subscriber of subscribers) {
    if (subscriber()) return true;
  }
  return false;
}

function onPointerDown() {
  isPointerDown = true;
  completionNotified = false;
}

function markConsumed(source: 'pointer' | 'other') {
  if (source === 'pointer') lastPointerCompletionAt = Date.now();
  completionNotified = true;
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    completionNotified = false;
    resetTimer = null;
  }, 500);
}

function notifyCompletion(source: 'pointer' | 'legacy') {
  isPointerDown = false;
  if (source === 'legacy' && Date.now() - lastPointerCompletionAt < 500) return;
  if (completionNotified) return;
  const consumed = notifySubscribers();
  if (consumed) markConsumed(source === 'pointer' ? 'pointer' : 'other');
}

const onPointerUp = () => notifyCompletion('pointer');
const onLegacyUp = () => notifyCompletion('legacy');

function onSelectionChange() {
  if (isPointerDown || completionNotified) return;
  if (notifySubscribers()) markConsumed('other');
}

function installListeners() {
  if (listenersInstalled) return;
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('touchstart', onPointerDown, true);
  document.addEventListener('mouseup', onLegacyUp);
  document.addEventListener('touchend', onLegacyUp);
  listenersInstalled = true;
}

function removeListeners() {
  if (!listenersInstalled) return;
  document.removeEventListener('selectionchange', onSelectionChange);
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('pointerup', onPointerUp, true);
  document.removeEventListener('mousedown', onPointerDown, true);
  document.removeEventListener('touchstart', onPointerDown, true);
  document.removeEventListener('mouseup', onLegacyUp);
  document.removeEventListener('touchend', onLegacyUp);
  listenersInstalled = false;
  isPointerDown = false;
  completionNotified = false;
  lastPointerCompletionAt = Number.NEGATIVE_INFINITY;
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = null;
}

export function subscribeSelectionObserver(onSelectionChange: SelectionObserverCallback): () => void {
  subscribers.add(onSelectionChange);
  installListeners();
  return () => {
    subscribers.delete(onSelectionChange);
    if (subscribers.size === 0) removeListeners();
  };
}
