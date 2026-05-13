export type SelectionObserverCallback = () => void;

export function subscribeSelectionObserver(onSelectionChange: SelectionObserverCallback): () => void {
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('mouseup', onSelectionChange);
  document.addEventListener('touchend', onSelectionChange);

  return () => {
    document.removeEventListener('selectionchange', onSelectionChange);
    document.removeEventListener('mouseup', onSelectionChange);
    document.removeEventListener('touchend', onSelectionChange);
  };
}
