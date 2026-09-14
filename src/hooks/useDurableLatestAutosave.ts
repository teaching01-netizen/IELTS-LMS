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
  /**
   * True for a user-visible action (flush / retry). Automatic debounced saves
   * are held while a conflict is unresolved; explicit actions may always
   * attempt the write so the author can resolve on purpose.
   */
  explicit: boolean;
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
  /**
   * Ref mirror of `status` so the async runner and schedule() can read the
   * CURRENT fence without waiting for a re-render. RISK-6: an unresolved
   * conflict must never be downgraded by a later keystroke or auto-send.
   */
  const statusRef = useRef<DurableAutosaveStatus>("saved");
  const applyStatus = useCallback((next: DurableAutosaveStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);
  /**
   * Per-request outcomes for explicit actions. The latest-only runner exposes
   * only a GLOBAL lastError, so a superseded failure would report ok:false for
   * an unrelated flush while a later success would mask a real flush failure.
   * `null` = saved, an Error = failed/held, and a MISSING entry = the request
   * never ran (coalesced away) — which must never read as success.
   */
  const explicitOutcomesRef = useRef(new Map<number, Error | null>());
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
      // RISK-6 mirror: while a conflict is unresolved, an AUTOMATIC debounced
      // save must not re-send the same stale base — the server rejects it
      // again and the attempt is pure noise. Explicit actions (flush/retry)
      // still attempt the write so the author can resolve deliberately. The
      // newest content is already checkpointed durably by schedule()/flush().
      if (!item.explicit && statusRef.current === "conflict") {
        return;
      }
      applyStatus("saving");
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
          applyStatus("saved");
          setLastSavedAt(new Date());
        }
        if (item.explicit) explicitOutcomesRef.current.set(item.requestId, null);
      } catch (error) {
        const resolved = asError(error);
        if (item.requestId === latestRequestIdRef.current) {
          // A 409/version conflict is not a transient failure: the server
          // advanced, so the local draft is preserved and the UI enters the
          // dedicated conflict state with reload guidance (never auto-retry
          // the stale payload, which would loop on the same conflict).
          applyStatus(isRevisionConflictError(error) ? "conflict" : "error");
          onErrorRef.current?.(resolved);
        }
        if (item.explicit) explicitOutcomesRef.current.set(item.requestId, resolved);
        throw error;
      }
    });
  }

  const persistLocal = useCallback((key: string | null, value: T, requestId: number) => {
    if (!key) return;
    void saveDurableDraft(key, value).catch((error) => {
      if (requestId !== latestRequestIdRef.current) return;
      applyStatus("error");
      onErrorRef.current?.(asError(error));
    });
  }, [applyStatus]);
  const enqueuePending = useCallback(() => {
    const value = pendingValueRef.current;
    const requestId = pendingRequestIdRef.current;
    if (value === null || requestId === null) return;
    runnerRef.current?.enqueue({
      value,
      requestId,
      durableKey: durableKeyRef.current,
      save: saveRef.current,
      explicit: false,
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
      // Shared-hook finding #1: a keystroke during an unresolved conflict must
      // not clear the fence back to "unsaved". The newest content is still
      // checkpointed durably below; the fence clears only through an explicit
      // resolution (retry / adopt / a successful save).
      if (statusRef.current !== "conflict") applyStatus("unsaved");
      persistLocal(key, value, requestId);
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(enqueuePending, debounceMs);
    },
    [applyStatus, debounceMs, enqueuePending, persistLocal]
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
      explicit: true,
    });
    await runnerRef.current?.idle();
    const outcome = explicitOutcomesRef.current.get(requestId);
    explicitOutcomesRef.current.delete(requestId);
    return {
      // The result is THIS request's outcome, never the runner's global
      // lastError (a superseded failure, or a later success, must not be
      // reported as this flush's result — navigation gates read `ok`).
      ok: outcome === null,
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
      explicit: true,
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
    applyStatus("saved");
    setLastSavedAt(new Date());
    const key = durableKeyRef.current;
    if (key) void clearDurableDraft(key).catch(() => undefined);
  }, [applyStatus]);

  useEffect(() => {
    const requestId = ++latestRequestIdRef.current;
    if (!durableKey) return;
    let cancelled = false;
    void loadDurableDraft<T>(durableKey)
      .then((recovered) => {
        if (cancelled || recovered === null) return;
        // Shared-hook finding #2: a schedule()/flush()/retry() that landed
        // while IndexedDB was loading owns the newest state. Installing the
        // stale recovered value (or enqueueing it) would overwrite the newer
        // edit with an id whose status writes are suppressed — an invisible
        // write. The durable read is only authoritative while no newer
        // request exists.
        if (requestId !== latestRequestIdRef.current) return;
        onRecoverRef.current?.(recovered);
        if (statusRef.current !== "conflict") applyStatus("unsaved");
        if (autoSaveRecovered) {
          runnerRef.current?.enqueue({
            value: recovered,
            requestId,
            durableKey,
            save: saveRef.current,
            explicit: false,
          });
        }
      })
      .catch((error) => {
        if (cancelled || requestId !== latestRequestIdRef.current) return;
        applyStatus("error");
        onErrorRef.current?.(asError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [applyStatus, autoSaveRecovered, durableKey]);

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
