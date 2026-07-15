export type SelectionObserverCallback = () => boolean;

export function subscribeSelectionObserver(onSelectionChange: SelectionObserverCallback): () => void {
  // `selectionchange` fires continuously while the user is drag-selecting.
  // If we react immediately (e.g. show a toolbar near the selection), we can
  // accidentally place an interactive element under the pointer and disrupt
  // the selection gesture, making the highlight "reset".
  let isPointerDown = false;
  let completionNotified = false;
  let lastPointerCompletionAt = Number.NEGATIVE_INFINITY;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  const onPointerDown = () => {
    isPointerDown = true;
    completionNotified = false;
  };

  const markConsumed = (source: 'pointer' | 'other') => {
    if (source === 'pointer') lastPointerCompletionAt = Date.now();
    completionNotified = true;
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      completionNotified = false;
      resetTimer = null;
    }, 500);
  };

  const notifyCompletion = (source: 'pointer' | 'legacy') => {
    isPointerDown = false;
    if (source === 'legacy' && Date.now() - lastPointerCompletionAt < 500) return;
    if (completionNotified) {
      return;
    }
    const consumed = onSelectionChange();
    if (!consumed) return;
    markConsumed(source === 'pointer' ? 'pointer' : 'other');
  };

  const onPointerUp = () => notifyCompletion('pointer');
  const onLegacyUp = () => notifyCompletion('legacy');

  const onSelectionChangeInternal = () => {
    if (isPointerDown) {
      return;
    }
    if (!completionNotified) {
      const consumed = onSelectionChange();
      if (consumed) markConsumed('other');
    }
  };

  document.addEventListener('selectionchange', onSelectionChangeInternal);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('touchstart', onPointerDown, true);
  document.addEventListener('mouseup', onLegacyUp);
  document.addEventListener('touchend', onLegacyUp);

  return () => {
    document.removeEventListener('selectionchange', onSelectionChangeInternal);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('mousedown', onPointerDown, true);
    document.removeEventListener('touchstart', onPointerDown, true);
    document.removeEventListener('mouseup', onLegacyUp);
    document.removeEventListener('touchend', onLegacyUp);
    if (resetTimer) clearTimeout(resetTimer);
  };
}
