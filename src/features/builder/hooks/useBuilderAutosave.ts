import { useCallback } from "react";
import type { ExamState } from "../../../types";
import { useDurableLatestAutosave } from "../../../hooks/useDurableLatestAutosave";

export type BuilderSaveStatus = "unsaved" | "saving" | "saved" | "error" | "conflict";

export interface UseBuilderAutosaveOptions {
  /** Persists a full exam state snapshot. Serialized and retry-safe. */
  save: (state: ExamState) => Promise<void>;
  /** Debounce window for scheduleAutosave (default 350ms). */
  debounceMs?: number;
  /** Stable browser-durable recovery identity, normally scoped to one exam. */
  durableKey?: string | null;
  /** Restores a crash-recovered local draft into the editor. */
  onRecover?: (state: ExamState) => void;
  /** Builder defaults to explicit recovery instead of overwriting a newer server revision. */
  autoSaveRecovered?: boolean;
  onError?: (error: Error) => void;
}

export interface FlushResult {
  /** Whether the persisted save completed without error. */
  ok: boolean;
  /**
   * Whether the flushed request is still the newest one. Pages use this to
   * suppress success feedback when a newer autosave superseded the flush.
   */
  isLatest: boolean;
}

export interface UseBuilderAutosaveResult {
  status: BuilderSaveStatus;
  scheduleAutosave: (nextState: ExamState) => void;
  flushNow: (state: ExamState) => Promise<FlushResult>;
  /**
   * Flush-before-leave: persists the editor's current state and resolves true
   * only once the newest edit is saved. An older save that lands while newer
   * edits arrive never unlocks navigation on its own.
   */
  flushLatest: (getState: () => ExamState | null) => Promise<boolean>;
  /** Re-enqueues a state under a fresh request id (used by error retry actions). */
  retry: (state: ExamState) => void;
}

/**
 * Debounced, latest-wins draft autosave with flush-before-navigation semantics.
 *
 * Contract:
 * - `scheduleAutosave` marks the state unsaved and debounces persistence.
 * - Rapid schedules coalesce into one save carrying the newest state.
 * - A save failure only surfaces (status 'error' + onError) when the failing
 *   request is the newest one at the time it fails; superseded failures are
 *   suppressed so a newer successful save keeps the UI "saved".
 * - `flushNow` persists immediately and resolves when the queue drains, so
 *   navigation can be gated on `ok`.
 */
export function useBuilderAutosave(options: UseBuilderAutosaveOptions): UseBuilderAutosaveResult {
  const autosave = useDurableLatestAutosave<ExamState>({
    save: options.save,
    debounceMs: options.debounceMs ?? 350,
    durableKey: options.durableKey,
    onError: options.onError,
    onRecover: options.onRecover,
    autoSaveRecovered: options.autoSaveRecovered ?? false,
  });

  const { flush } = autosave;
  const flushLatest = useCallback(
    async (getState: () => ExamState | null) => {
      // offcut: bounded so continuous typing cannot hold navigation forever;
      // the page stays put and autosave keeps going.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const state = getState();
        if (!state) return false;
        const result = await flush(state);
        if (!result.ok) return false;
        if (result.isLatest) return true;
      }
      return false;
    },
    [flush],
  );

  return {
    status: autosave.status,
    scheduleAutosave: autosave.schedule,
    flushNow: autosave.flush,
    flushLatest,
    retry: autosave.retry,
  };
}
