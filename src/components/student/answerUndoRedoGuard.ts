export type UndoRedoKind = 'undo' | 'redo';

type UndoRedoSignal = {
  kind: UndoRedoKind;
  via: 'beforeinput' | 'keydown' | 'input';
  cancelable: boolean;
};

interface AnswerUndoRedoGuardOptions {
  element: HTMLElement;
  readLatestSnapshot: () => string;
  restoreLatestSnapshot: (snapshot: string) => void;
  flushPersist?: (() => void) | undefined;
  onBlocked?: ((signal: UndoRedoSignal) => void) | undefined;
  onRestored?: ((signal: UndoRedoSignal) => void) | undefined;
}

function historyKindFromInputEvent(event: Event): UndoRedoKind | null {
  const inputType = (event as InputEvent).inputType;
  if (inputType === 'historyUndo') {
    return 'undo';
  }
  if (inputType === 'historyRedo') {
    return 'redo';
  }
  return null;
}

function historyKindFromKeydown(event: KeyboardEvent): UndoRedoKind | null {
  const key = event.key.toLowerCase();
  const usesUndoModifier = (event.metaKey || event.ctrlKey) && !event.altKey;
  if (!usesUndoModifier) {
    return null;
  }

  if (!event.shiftKey && key === 'z') {
    return 'undo';
  }

  const isRedo =
    (event.metaKey && event.shiftKey && key === 'z') ||
    (event.ctrlKey && (key === 'y' || (event.shiftKey && key === 'z')));
  return isRedo ? 'redo' : null;
}

function queuePersistFlush(flushPersist?: (() => void) | undefined) {
  if (typeof flushPersist !== 'function') {
    return;
  }

  if (typeof queueMicrotask === 'function') {
    queueMicrotask(() => flushPersist());
    return;
  }

  window.setTimeout(() => flushPersist(), 0);
}

export function registerAnswerUndoRedoGuard(options: AnswerUndoRedoGuardOptions) {
  const {
    element,
    readLatestSnapshot,
    restoreLatestSnapshot,
    flushPersist,
    onBlocked,
    onRestored,
  } = options;

  let lastSnapshotBeforeMutation: string | null = null;

  const handleBeforeInput = (event: Event) => {
    const kind = historyKindFromInputEvent(event);
    if (!kind) {
      return;
    }

    lastSnapshotBeforeMutation = readLatestSnapshot();
    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();
    onBlocked?.({
      kind,
      via: 'beforeinput',
      cancelable: event.cancelable,
    });
  };

  const handleKeydown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    const kind = historyKindFromKeydown(keyboardEvent);
    if (!kind) {
      return;
    }

    lastSnapshotBeforeMutation = readLatestSnapshot();
    if (keyboardEvent.cancelable) {
      keyboardEvent.preventDefault();
    }
    keyboardEvent.stopPropagation();
    onBlocked?.({
      kind,
      via: 'keydown',
      cancelable: keyboardEvent.cancelable,
    });
  };

  const handleInput = (event: Event) => {
    const kind = historyKindFromInputEvent(event);
    if (!kind) {
      return;
    }

    const snapshot = lastSnapshotBeforeMutation ?? readLatestSnapshot();
    lastSnapshotBeforeMutation = null;
    restoreLatestSnapshot(snapshot);
    queuePersistFlush(flushPersist);
    onRestored?.({
      kind,
      via: 'input',
      cancelable: event.cancelable,
    });
  };

  element.addEventListener('beforeinput', handleBeforeInput, true);
  element.addEventListener('keydown', handleKeydown, true);
  element.addEventListener('input', handleInput, true);

  return () => {
    element.removeEventListener('beforeinput', handleBeforeInput, true);
    element.removeEventListener('keydown', handleKeydown, true);
    element.removeEventListener('input', handleInput, true);
  };
}
