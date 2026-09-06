import { useCallback, useMemo, useReducer, useRef } from 'react';

interface HistoryEntry<T> {
  label: string;
  value: T;
}

interface UndoRedoOptions {
  limit?: number;
  initialLabel?: string;
}

interface HistoryState<T> {
  future: HistoryEntry<T>[];
  past: HistoryEntry<T>[];
  present: HistoryEntry<T>;
}

type HistoryAction<T> =
  | {
      type: 'set';
      label: string;
      limit: number;
      nextValue: T | ((current: T) => T);
    }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; label: string; nextValue: T };

function historyReducer<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
  switch (action.type) {
    case 'set': {
      const nextValue =
        typeof action.nextValue === 'function'
          ? (action.nextValue as (current: T) => T)(state.present.value)
          : action.nextValue;

      if (Object.is(nextValue, state.present.value)) {
        return state;
      }

      const nextPast = [...state.past, state.present];
      return {
        future: [],
        past:
          nextPast.length > action.limit
            ? nextPast.slice(nextPast.length - action.limit)
            : nextPast,
        present: {
          label: action.label,
          value: nextValue,
        },
      };
    }
    case 'undo': {
      if (state.past.length === 0) {
        return state;
      }

      const previousEntry = state.past[state.past.length - 1];
      if (!previousEntry) {
        return state;
      }
      return {
        future: [state.present, ...state.future],
        past: state.past.slice(0, -1),
        present: previousEntry,
      };
    }
    case 'redo': {
      if (state.future.length === 0) {
        return state;
      }

      const [nextEntry, ...remaining] = state.future;
      if (!nextEntry) {
        return state;
      }
      return {
        future: remaining,
        past: [...state.past, state.present],
        present: nextEntry,
      };
    }
    case 'reset':
      return {
        future: [],
        past: [],
        present: {
          label: action.label,
          value: action.nextValue,
        },
      };
    default:
      return state;
  }
}

function applySetToMirror<T>(mirror: HistoryState<T>, label: string, limit: number, next: T): void {
  if (Object.is(next, mirror.present.value)) return;
  const nextPast = [...mirror.past, mirror.present];
  mirror.past = nextPast.length > limit ? nextPast.slice(nextPast.length - limit) : nextPast;
  mirror.future = [];
  mirror.present = { label, value: next };
}

/**
 * Undo/redo history for builder state. Backward compatible: the existing
 * `{ state, canUndo, canRedo, ..., setState, undo, redo, reset }` shape is
 * unchanged; the additions below are purely additive.
 *
 * Added (additive only):
 * - `getSnapshot()` — synchronous post-update snapshot of the present value.
 *   `dispatch` (useReducer) applies asynchronously, so `history.state` read
 *   immediately after `setState/undo/redo/reset` still holds the previous
 *   value. Call sites that must act on the new value synchronously (e.g.
 *   `currentStateRef.current = next; scheduleAutosave(next)`) should use the
 *   value returned by the mutator itself or `getSnapshot()`.
 * - `setState`/`undo`/`redo`/`reset` now RETURN the post-update present value,
 *   so `const next = history.setState(v, label)` replaces the
 *   read-after-dispatch anti-pattern without breaking existing callers that
 *   ignore the return value.
 *
 * The mirror ref replicates the pure reducer transitions eagerly so returns
 * and `getSnapshot()` are correct between dispatch and re-render; the reducer
 * remains the source of truth for rendering and the two converge after flush.
 */
export function useUndoRedo<T>(initialState: T, options: UndoRedoOptions = {}) {
  const { limit = Number.POSITIVE_INFINITY, initialLabel = 'Initial state' } = options;
  const [history, dispatch] = useReducer(historyReducer<T>, {
    future: [],
    past: [],
    present: {
      label: initialLabel,
      value: initialState,
    },
  });
  const mirrorRef = useRef<HistoryState<T>>({
    future: [],
    past: [],
    present: { label: initialLabel, value: initialState },
  });

  const setState = useCallback(
    (nextState: T | ((current: T) => T), label = 'Updated'): T => {
      const mirror = mirrorRef.current;
      const resolved =
        typeof nextState === 'function' ? (nextState as (prev: T) => T)(mirror.present.value) : nextState;
      applySetToMirror(mirror, label, limit, resolved);
      dispatch({
        type: 'set',
        label,
        limit,
        nextValue: nextState,
      });
      return mirror.present.value;
    },
    [limit],
  );

  const undo = useCallback((): T => {
    const mirror = mirrorRef.current;
    const previousEntry = mirror.past[mirror.past.length - 1];
    if (previousEntry) {
      mirror.future = [mirror.present, ...mirror.future];
      mirror.past = mirror.past.slice(0, -1);
      mirror.present = previousEntry;
    }
    dispatch({ type: 'undo' });
    return mirror.present.value;
  }, []);

  const redo = useCallback((): T => {
    const mirror = mirrorRef.current;
    const [nextEntry, ...remaining] = mirror.future;
    if (nextEntry) {
      mirror.past = [...mirror.past, mirror.present];
      mirror.future = remaining;
      mirror.present = nextEntry;
    }
    dispatch({ type: 'redo' });
    return mirror.present.value;
  }, []);

  const reset = useCallback(
    (nextState: T, label = initialLabel): T => {
      mirrorRef.current = { future: [], past: [], present: { label, value: nextState } };
      dispatch({
        type: 'reset',
        label,
        nextValue: nextState,
      });
      return nextState;
    },
    [initialLabel],
  );

  const getSnapshot = useCallback((): T => mirrorRef.current.present.value, []);

  return useMemo(
    () => ({
      state: history.present.value,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      lastActionLabel: history.present.label,
      undoState: history.past[history.past.length - 1]?.value,
      redoState: history.future[0]?.value,
      undoStackLabels: Array.isArray(history.past) ? history.past.map((entry) => entry.label) : [],
      redoStackLabels: Array.isArray(history.future) ? history.future.map((entry) => entry.label) : [],
      setState,
      undo,
      redo,
      reset,
      getSnapshot,
    }),
    [history, redo, reset, setState, undo, getSnapshot],
  );
}
