import { useCallback, useEffect, useRef, useState } from "react";
import { createLatestOnlyAsyncRunner, type LatestOnlyAsyncRunner } from "../utils/latestOnlyAsync";
import { clearDurableDraft, loadDurableDraft, saveDurableDraft } from "../utils/durableDraftStore";

export type DurableAutosaveStatus = "unsaved" | "saving" | "saved" | "error" | "conflict";

/**
 * Conflict detector: the server advanced while this client was editing
 * (another author saved, or a stale import commit/import raced us). Callers
 * map 409/CONFLICT/version-collision errors through this so the hook can
 * enter the dedicated conflict state instead of the generic error state.
 */
export function isRevisionConflictError(error: unknown): boolean {
  if (error instanceof Error) {
    const withCode = error as Error & {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
      backendCode?: unknown;
    };
    const codes = [withCode.code, withCode.backendCode]
      .filter((code): code is string => typeof code === "string")
      .map((code) => code.toUpperCase());
    if (
      codes.includes("CONFLICT") ||
      codes.includes("VERSION_COLLISION") ||
      codes.includes("CONTROL_EPOCH_STALE")
    ) {
      return true;
    }
    const statuses = [withCode.status, withCode.statusCode].filter(
      (status): status is number => typeof status === "number",
    );
    if (statuses.includes(409) || statuses.includes(412)) return true;
    return /revision|stale|conflict|changed elsewhere|changed while|409|412/i.test(
      error.message,
    );
  }
  return false;
}

export interface DurableAutosaveFlushResult {
  ok: boolean;
  isLatest: boolean;
}

export interface UseDurableLatestAutosaveOptions<T> {
  save: (value: T) => Promise<unknown>;
  durableKey?: string | null | undefined;
  debounceMs: number;
  onError?: ((error: Error) => void) | undefined;
  onRecover?: ((value: T) => void) | undefined;
  autoSaveRecovered?: boolean | undefined;
}
export interface UseDurableLatestAutosaveResult<T> {
  status: DurableAutosaveStatus;
  lastSavedAt: Date | null;
  schedule: (value: T) => void;
  flush: (value: T) => Promise<DurableAutosaveFlushResult>;
  retry: (value: T) => void;
  /**
   * Settle the local bookkeeping on an authoritative server value the caller
   * has already installed, WITHOUT a write. See the implementation comment.
   */
  adoptServerRevision: () => void;
}

type QueueItem<T> = {
  value: T;
  requestId: number;
  durableKey: string | null;
  save: (value: T) => Promise<unknown>;
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Autosave failed.");
}

export function useDurableLatestAutosave<T>(
  options: UseDurableLatestAutosaveOptions<T>
): UseDurableLatestAutosaveResult<T> {
  const { debounceMs, durableKey = null, autoSaveRecovered = true } = options;
  const [status, setStatus] = useState<DurableAutosaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveRef = useRef(options.save);
  const onErrorRef = useRef(options.onError);
  const onRecoverRef = useRef(options.onRecover);
  const durableKeyRef = useRef<string | null>(durableKey);
  const latestRequestIdRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  const pendingValueRef = useRef<T | null>(null);
  const pendingRequestIdRef = useRef<number | null>(null);
  const runnerRef = useRef<LatestOnlyAsyncRunner<QueueItem<T>> | null>(null);

  useEffect(() => {
    saveRef.current = options.save;
    onErrorRef.current = options.onError;
    onRecoverRef.current = options.onRecover;
    durableKeyRef.current = durableKey;
  }, [durableKey, options.onError, options.onRecover, options.save]);

  if (!runnerRef.current) {
    runnerRef.current = createLatestOnlyAsyncRunner(async (item) => {
      setStatus("saving");
      if (item.durableKey) {
        try {
          await saveDurableDraft(item.durableKey, item.value);
        } catch (error) {
          onErrorRef.current?.(asError(error));
        }
      }
      try {
        await item.save(item.value);
        if (
          item.requestId === latestRequestIdRef.current &&
          item.durableKey === durableKeyRef.current
        ) {
          if (item.durableKey) await clearDurableDraft(item.durableKey);
          setStatus("saved");
          setLastSavedAt(new Date());
        }
      } catch (error) {
        if (item.requestId === latestRequestIdRef.current) {
          const resolved = asError(error);
          // A 409/version conflict is not a transient failure: the server
          // advanced, so the local draft is preserved and the UI enters the
          // dedicated conflict state with reload guidance (never auto-retry
          // the stale payload, which would loop on the same conflict).
          setStatus(isRevisionConflictError(error) ? "conflict" : "error");
          onErrorRef.current?.(resolved);
        }
        throw error;
      }
    });
  }

  const persistLocal = useCallback((key: string | null, value: T, requestId: number) => {
    if (!key) return;
    void saveDurableDraft(key, value).catch((error) => {
      if (requestId !== latestRequestIdRef.current) return;
      setStatus("error");
      onErrorRef.current?.(asError(error));
    });
  }, []);
  const enqueuePending = useCallback(() => {
    const value = pendingValueRef.current;
    const requestId = pendingRequestIdRef.current;
    if (value === null || requestId === null) return;
    runnerRef.current?.enqueue({
      value,
      requestId,
      durableKey: durableKeyRef.current,
      save: saveRef.current,
    });
    pendingValueRef.current = null;
    pendingRequestIdRef.current = null;
    debounceRef.current = null;
  }, []);

  const schedule = useCallback(
    (value: T) => {
      const requestId = ++latestRequestIdRef.current;
      const key = durableKeyRef.current;
      pendingValueRef.current = value;
      pendingRequestIdRef.current = requestId;
      setStatus("unsaved");
      persistLocal(key, value, requestId);
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(enqueuePending, debounceMs);
    },
    [debounceMs, enqueuePending, persistLocal]
  );

  const flush = useCallback(async (value: T): Promise<DurableAutosaveFlushResult> => {
    const requestId = ++latestRequestIdRef.current;
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
    pendingValueRef.current = null;
    pendingRequestIdRef.current = null;
    runnerRef.current?.enqueue({
      value,
      requestId,
      durableKey: durableKeyRef.current,
      save: saveRef.current,
    });
    await runnerRef.current?.idle();
    return {
      ok: !runnerRef.current?.lastError,
      isLatest: requestId === latestRequestIdRef.current,
    };
  }, []);

  const retry = useCallback((value: T) => {
    const requestId = ++latestRequestIdRef.current;
    runnerRef.current?.enqueue({
      value,
      requestId,
      durableKey: durableKeyRef.current,
      save: saveRef.current,
    });
  }, []);

  /**
   * Adopt the server's authoritative value as the local baseline WITHOUT a
   * write. Used by an explicit conflict resolution that installs the remote
   * revision: there is nothing left to send, so `saved` is the truth — and
   * leaving the fenced `conflict` status behind would strand the save area on a
   * conflict that no longer exists, with a Retry button that would re-send a
   * payload the client already knows is stale.
   *
   * The durable copy is retired because the author chose the other version; a
   * surviving device draft would re-surface as "recovered unsaved changes" on
   * the next reload, which is precisely the work they resolved against.
   * In-flight requests stay fenced server-side as always.
   */
  const adoptServerRevision = useCallback(() => {
    // Bump the request id so any in-flight or queued item loses the authority
    // to write status (its id can no longer match), then drop the pending slot
    // and its debounce so nothing is left to send.
    latestRequestIdRef.current += 1;
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
    pendingValueRef.current = null;
    pendingRequestIdRef.current = null;
    setStatus("saved");
    setLastSavedAt(new Date());
    const key = durableKeyRef.current;
    if (key) void clearDurableDraft(key).catch(() => undefined);
  }, []);

  useEffect(() => {
    const requestId = ++latestRequestIdRef.current;
    if (!durableKey) return;
    let cancelled = false;
    void loadDurableDraft<T>(durableKey)
      .then((recovered) => {
        if (cancelled || recovered === null) return;
        onRecoverRef.current?.(recovered);
        setStatus("unsaved");
        if (autoSaveRecovered) {
          runnerRef.current?.enqueue({ value: recovered, requestId, durableKey, save: saveRef.current });
        }
      })
      .catch((error) => {
        if (cancelled || requestId !== latestRequestIdRef.current) return;
        setStatus("error");
        onErrorRef.current?.(asError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [autoSaveRecovered, durableKey]);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    status,
    lastSavedAt,
    schedule,
    flush,
    retry,
    adoptServerRevision,
  };
}
