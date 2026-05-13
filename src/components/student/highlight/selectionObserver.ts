export type SelectionObserverCallback = () => void;

export function subscribeSelectionObserver(onSelectionChange: SelectionObserverCallback): () => void {
  // `selectionchange` fires continuously while the user is drag-selecting.
  // If we react immediately (e.g. show a toolbar near the selection), we can
  // accidentally place an interactive element under the pointer and disrupt
  // the selection gesture, making the highlight "reset".
  let isPointerDown = false;

  const onPointerDown = () => {
    isPointerDown = true;
  };

  const onPointerUp = () => {
    isPointerDown = false;
    onSelectionChange();
  };

  const onSelectionChangeInternal = () => {
    if (isPointerDown) {
      return;
    }
    onSelectionChange();
  };

  document.addEventListener('selectionchange', onSelectionChangeInternal);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('mouseup', onSelectionChange);
  document.addEventListener('touchend', onSelectionChange);

  return () => {
    document.removeEventListener('selectionchange', onSelectionChangeInternal);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('mouseup', onSelectionChange);
    document.removeEventListener('touchend', onSelectionChange);
  };
}
