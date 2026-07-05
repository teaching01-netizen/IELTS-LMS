import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { registerAnswerUndoRedoGuard } from '../answerUndoRedoGuard';

describe('answerUndoRedoGuard', () => {
  let element: HTMLDivElement;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    element.remove();
  });

  it('blocks beforeinput historyUndo and captures snapshot', () => {
    const readLatestSnapshot = vi.fn().mockReturnValue('snapshot-before');
    const restoreLatestSnapshot = vi.fn();
    const onBlocked = vi.fn();

    cleanup = registerAnswerUndoRedoGuard({
      element,
      readLatestSnapshot,
      restoreLatestSnapshot,
      onBlocked,
    });

    const event = new InputEvent('beforeinput', {
      inputType: 'historyUndo',
      cancelable: true,
    });
    element.dispatchEvent(event);

    expect(onBlocked).toHaveBeenCalledWith({
      kind: 'undo',
      via: 'beforeinput',
      cancelable: true,
    });
    expect(readLatestSnapshot).toHaveBeenCalled();
  });

  it('blocks beforeinput historyRedo', () => {
    const onBlocked = vi.fn();
    cleanup = registerAnswerUndoRedoGuard({
      element,
      readLatestSnapshot: () => '',
      restoreLatestSnapshot: () => {},
      onBlocked,
    });

    const event = new InputEvent('beforeinput', {
      inputType: 'historyRedo',
      cancelable: true,
    });
    element.dispatchEvent(event);

    expect(onBlocked).toHaveBeenCalledWith({
      kind: 'redo',
      via: 'beforeinput',
      cancelable: true,
    });
  });

  it('blocks keydown Cmd+Z (undo)', () => {
    const onBlocked = vi.fn();
    cleanup = registerAnswerUndoRedoGuard({
      element,
      readLatestSnapshot: () => '',
      restoreLatestSnapshot: () => {},
      onBlocked,
    });

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      cancelable: true,
    });
    element.dispatchEvent(event);

    expect(onBlocked).toHaveBeenCalledWith({
      kind: 'undo',
      via: 'keydown',
      cancelable: true,
    });
  });

  it('blocks keydown Ctrl+Z (undo)', () => {
    const onBlocked = vi.fn();
    cleanup = registerAnswerUndoRedoGuard({
      element,
      readLatestSnapshot: () => '',
      restoreLatestSnapshot: () => {},
      onBlocked,
    });

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      cancelable: true,
    });
    element.dispatchEvent(event);

    expect(onBlocked).toHaveBeenCalledWith({
      kind: 'undo',
      via: 'keydown',
      cancelable: true,
    });
  });

  it('blocks keydown Cmd+Shift+Z (redo)', () => {
    const onBlocked = vi.fn();
    cleanup = registerAnswerUndoRedoGuard({
      element,
      readLatestSnapshot: () => '',
      restoreLatestSnapshot: () => {},
      onBlocked,
    });

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      shiftKey: true,
      cancelable: true,
    });
    element.dispatchEvent(event);

    expect(onBlocked).toHaveBeenCalledWith({
      kind: 'redo',
      via: 'keydown',
      cancelable: true,
    });
  });

  it('blocks keydown Ctrl+Y (redo)', () => {
    const onBlocked = vi.fn();
    cleanup = registerAnswerUndoRedoGuard({
      element,
      readLatestSnapshot: () => '',
      restoreLatestSnapshot: () => {},
      onBlocked,
    });

    const event = new KeyboardEvent('keydown', {
      key: 'y',
      ctrlKey: true,
      cancelable: true,
    });
    element.dispatchEvent(event);

    expect(onBlocked).toHaveBeenCalledWith({
      kind: 'redo',
      via: 'keydown',
      cancelable: true,
    });
  });

  it('restores snapshot on input historyUndo after beforeinput', () => {
    const readLatestSnapshot = vi.fn().mockReturnValue('my-snapshot');
    const restoreLatestSnapshot = vi.fn();
    const onRestored = vi.fn();

    cleanup = registerAnswerUndoRedoGuard({
      element,
      readLatestSnapshot,
      restoreLatestSnapshot,
      onRestored,
    });

    element.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'historyUndo', cancelable: true }),
    );

    element.dispatchEvent(
      new InputEvent('input', { inputType: 'historyUndo', cancelable: false }),
    );

    expect(restoreLatestSnapshot).toHaveBeenCalledWith('my-snapshot');
    expect(onRestored).toHaveBeenCalledWith({
      kind: 'undo',
      via: 'input',
      cancelable: false,
    });
  });

  it('does not restore when no pending intent', () => {
    const restoreLatestSnapshot = vi.fn();
    cleanup = registerAnswerUndoRedoGuard({
      element,
      readLatestSnapshot: () => '',
      restoreLatestSnapshot,
    });

    element.dispatchEvent(
      new InputEvent('input', { inputType: 'historyUndo', cancelable: false }),
    );

    expect(restoreLatestSnapshot).not.toHaveBeenCalled();
  });

  it('does not restore when intent kind does not match', () => {
    const readLatestSnapshot = vi.fn().mockReturnValue('snap');
    const restoreLatestSnapshot = vi.fn();

    cleanup = registerAnswerUndoRedoGuard({
      element,
      readLatestSnapshot,
      restoreLatestSnapshot,
    });

    element.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'historyUndo', cancelable: true }),
    );

    element.dispatchEvent(
      new InputEvent('input', { inputType: 'historyRedo', cancelable: false }),
    );

    expect(restoreLatestSnapshot).not.toHaveBeenCalled();
  });

  it('ignores non-history input types', () => {
    const onBlocked = vi.fn();
    cleanup = registerAnswerUndoRedoGuard({
      element,
      readLatestSnapshot: () => '',
      restoreLatestSnapshot: () => {},
      onBlocked,
    });

    element.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'insertText', cancelable: true }),
    );

    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('ignores keydown without modifier keys', () => {
    const onBlocked = vi.fn();
    cleanup = registerAnswerUndoRedoGuard({
      element,
      readLatestSnapshot: () => '',
      restoreLatestSnapshot: () => {},
      onBlocked,
    });

    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', cancelable: true }),
    );

    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('cleans up event listeners on cleanup', () => {
    const onBlocked = vi.fn();
    cleanup = registerAnswerUndoRedoGuard({
      element,
      readLatestSnapshot: () => '',
      restoreLatestSnapshot: () => {},
      onBlocked,
    });

    cleanup();
    cleanup = undefined;

    element.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'historyUndo', cancelable: true }),
    );

    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('calls flushPersist after restore', async () => {
    const flushPersist = vi.fn();
    cleanup = registerAnswerUndoRedoGuard({
      element,
      readLatestSnapshot: () => 'snap',
      restoreLatestSnapshot: () => {},
      flushPersist,
    });

    element.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'historyUndo', cancelable: true }),
    );

    element.dispatchEvent(
      new InputEvent('input', { inputType: 'historyUndo', cancelable: false }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(flushPersist).toHaveBeenCalled();
  });
});
