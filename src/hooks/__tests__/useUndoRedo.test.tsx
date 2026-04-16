import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUndoRedo } from '../useUndoRedo';

describe('useUndoRedo', () => {
  it('tracks history, undo, and redo state', () => {
    const { result } = renderHook(() => useUndoRedo({ count: 0 }));

    act(() => {
      result.current.setState({ count: 1 }, 'Increment');
      result.current.setState({ count: 2 }, 'Increment Again');
    });

    expect(result.current.state.count).toBe(2);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.lastActionLabel).toBe('Increment Again');

    act(() => {
      result.current.undo();
    });

    expect(result.current.state.count).toBe(1);
    expect(result.current.canRedo).toBe(true);
    expect(result.current.lastActionLabel).toBe('Increment');

    act(() => {
      result.current.redo();
    });

    expect(result.current.state.count).toBe(2);
    expect(result.current.canRedo).toBe(false);
  });

  it('clears redo stack after a new branch edit', () => {
    const { result } = renderHook(() => useUndoRedo({ count: 0 }));

    act(() => {
      result.current.setState({ count: 1 }, 'Step 1');
      result.current.setState({ count: 2 }, 'Step 2');
      result.current.undo();
      result.current.setState({ count: 99 }, 'Branch');
    });

    expect(result.current.state.count).toBe(99);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.lastActionLabel).toBe('Branch');
  });
});
