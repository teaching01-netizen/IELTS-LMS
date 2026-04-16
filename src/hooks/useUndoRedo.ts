import { useCallback, useMemo, useReducer } from 'react';

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

  const setState = useCallback(
    (nextState: T | ((current: T) => T), label = 'Updated') => {
      dispatch({
        type: 'set',
        label,
        limit,
        nextValue: nextState,
      });
    },
    [limit],
  );

  const undo = useCallback(() => {
    dispatch({ type: 'undo' });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: 'redo' });
  }, []);

  const reset = useCallback(
    (nextState: T, label = initialLabel) => {
      dispatch({
        type: 'reset',
        label,
        nextValue: nextState,
      });
    },
    [initialLabel],
  );

  return useMemo(
    () => ({
      state: history.present.value,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      lastActionLabel: history.present.label,
      undoState: history.past[history.past.length - 1]?.value,
      redoState: history.future[0]?.value,
      undoStackLabels: history.past.map((entry) => entry.label),
      redoStackLabels: history.future.map((entry) => entry.label),
      setState,
      undo,
      redo,
      reset,
    }),
    [history, redo, reset, setState, undo],
  );
}
