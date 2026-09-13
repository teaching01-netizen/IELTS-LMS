import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useDurableLatestAutosave } from "../../../hooks/useDurableLatestAutosave";
import { saveDurableDraft } from "../../../utils/durableDraftStore";
import type { QuestionRevision } from "../contracts/assessment";

export type QuestionSaveStatus =
  | "saved"
  | "unsaved"
  | "saving"
  | "error"
  | "offline"
  | "conflict";

export interface UseQuestionAutosaveOptions {
  save: (revision: QuestionRevision) => Promise<QuestionRevision | void>;
  debounceMs?: number | undefined;
  durableKey?: string | null | undefined;
  onRecover?: ((revision: QuestionRevision) => void) | undefined;
  autoSaveRecovered?: boolean | undefined;
  onError?: ((error: Error) => void) | undefined;
  /**
   * When `current` is true the question is known-obsolete server-side (another
   * author saved a newer revision), so NETWORK writes pause while the DURABLE
   * local write continues unchanged.
   *
   * The motivation is not to avoid a 409 — revision fencing remains the
   * backend safety net. It is that repeatedly POSTing a known-stale base is
   * pure noise, and letting the request SUCCEED (because a refetch moved the
   * fence forward) would silently overwrite a collaborator's work without the
   * author ever choosing to.
   *
   * A REF, not a boolean: the caller computes divergence from the same autosave
   * this hook feeds, so a reactive option would close a render loop. Read at
   * call time, exactly like the offline flag.
   */
  networkPausedRef?: RefObject<boolean> | undefined;
}

export interface QuestionFlushResult {
  ok: boolean;
  isLatest: boolean;
}

export interface UseQuestionAutosaveResult {
  status: QuestionSaveStatus;
  lastSavedAt: Date | null;
  /** True when the browser cannot reach the server; edits are still durable locally. */
  isOffline: boolean;
  /**
   * True when network writes are held back by divergence (not by connectivity).
   * The durable draft is already written; only the HTTP write waits.
   */
  isNetworkPaused: boolean;
  /** True when the selected question has changes that are not server-acknowledged. */
  hasPendingChanges: boolean;
  scheduleAutosave: (revision: QuestionRevision) => void;
  flushNow: (revision: QuestionRevision) => Promise<QuestionFlushResult>;
  commitAndAdvance: (revision: QuestionRevision) => Promise<QuestionFlushResult>;
  retry: (revision: QuestionRevision) => void;
  /**
   * The author explicitly took the server's revision (Review -> Use latest).
   * Clears the held write, the fenced status, and the device copy: there is
   * nothing left to send and nothing left to recover.
   */
  acknowledgeServerRevision: () => void;
}

function browserIsOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function useQuestionAutosave(
  options: UseQuestionAutosaveOptions
): UseQuestionAutosaveResult {
  const [isOffline, setIsOffline] = useState(browserIsOffline);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const {
    save,
    debounceMs,
    durableKey,
    onError: onErrorOption,
    onRecover: onRecoverOption,
    autoSaveRecovered,
    networkPausedRef,
  } = options;
  /**
   * One predicate for "this write may not go to the network", shared by every
   * outbound path so a paused question can never leak a request through the
   * debounced, flush, or retry door. Offline and divergent both mean: keep the
   * durable local copy, hold the HTTP write.
   */
  const networkWriteBlocked = useCallback(
    () => offlineRef.current || networkPausedRef?.current === true,
    [networkPausedRef],
  );
  const offlineRef = useRef(isOffline);
  const offlineDraftRef = useRef<QuestionRevision | null>(null);
  const latestRevisionRef = useRef<QuestionRevision | null>(null);
  const pendingRef = useRef(false);
  const onRecover = useCallback(
    (revision: QuestionRevision) => {
      latestRevisionRef.current = revision;
      if (offlineRef.current) offlineDraftRef.current = revision;
      setHasPendingChanges(true);
      onRecoverOption?.(revision);
    },
    [onRecoverOption]
  );
  const autosave = useDurableLatestAutosave<QuestionRevision>({
    save,
    debounceMs: debounceMs ?? 800,
    durableKey,
    onError: onErrorOption,
    onRecover,
    autoSaveRecovered: autoSaveRecovered ?? false,
  });
  const {
    status: autosaveStatus,
    lastSavedAt,
    schedule: scheduleAutosaveInternal,
    flush: flushAutosave,
    retry: retryAutosave,
    adoptServerRevision,
  } = autosave;
  const durableKeyRef = useRef(durableKey ?? null);

  useEffect(() => {
    offlineRef.current = isOffline;
  }, [isOffline]);

  useEffect(() => {
    if (autosaveStatus === "saved") setHasPendingChanges(false);
  }, [autosaveStatus]);

  useEffect(() => {
    pendingRef.current = hasPendingChanges;
  }, [hasPendingChanges]);

  useEffect(() => {
    durableKeyRef.current = durableKey ?? null;
    offlineDraftRef.current = null;
    latestRevisionRef.current = null;
    setHasPendingChanges(false);
  }, [durableKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOffline = () => {
      offlineRef.current = true;
      if (pendingRef.current && latestRevisionRef.current) {
        offlineDraftRef.current = latestRevisionRef.current;
      }
      setIsOffline(true);
    };
    const handleOnline = () => {
      offlineRef.current = false;
      setIsOffline(false);
      const pending = offlineDraftRef.current;
      offlineDraftRef.current = null;
      if (!pending) return;
      // Reconnecting must not become a backdoor for a stale write. If the
      // question is still diverged the flush stays paused; the durable copy is
      // already on the device and the author's explicit resolution is what
      // moves the fence, not the network coming back.
      if (networkPausedRef?.current === true) return;
      scheduleAutosaveInternal(pending);
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [scheduleAutosaveInternal, networkPausedRef]);

  const persistOffline = useCallback((revision: QuestionRevision) => {
    const durableKey = durableKeyRef.current;
    if (!durableKey) return;
    void saveDurableDraft(durableKey, revision).catch(onErrorOption);
  }, [onErrorOption]);

  const scheduleAutosave = useCallback((revision: QuestionRevision) => {
    latestRevisionRef.current = revision;
    setHasPendingChanges(true);
    if (!networkWriteBlocked()) {
      scheduleAutosaveInternal(revision);
      return;
    }
    offlineDraftRef.current = revision;
    persistOffline(revision);
  }, [networkWriteBlocked, persistOffline, scheduleAutosaveInternal]);

  const flushNow = useCallback(async (revision: QuestionRevision): Promise<QuestionFlushResult> => {
    latestRevisionRef.current = revision;
    setHasPendingChanges(true);
    if (!networkWriteBlocked()) return flushAutosave(revision);
    // Deliberately NOT ok: the caller must know the server does not have this
    // content yet, even though the device does. `isLatest` stays true because
    // this revision IS the newest local one — there is just nowhere safe to
    // send it yet.
    offlineDraftRef.current = revision;
    persistOffline(revision);
    return { ok: false, isLatest: true };
  }, [flushAutosave, networkWriteBlocked, persistOffline]);

  const commitAndAdvance = useCallback(
    async (revision: QuestionRevision) => flushNow(revision),
    [flushNow]
  );

  const retry = useCallback((revision: QuestionRevision) => {
    latestRevisionRef.current = revision;
    setHasPendingChanges(true);
    if (networkWriteBlocked()) {
      offlineDraftRef.current = revision;
      persistOffline(revision);
      return;
    }
    retryAutosave(revision);
  }, [networkWriteBlocked, persistOffline, retryAutosave]);

  const acknowledgeServerRevision = useCallback(() => {
    offlineDraftRef.current = null;
    latestRevisionRef.current = null;
    setHasPendingChanges(false);
    adoptServerRevision();
  }, [adoptServerRevision]);

  const status = isOffline ? "offline" : autosaveStatus;
  // Reads the ref at render time. The workspace owns the divergence state that
  // sets it, so a divergence change re-renders this hook's consumer anyway and
  // the value is never meaningfully stale. Only used for MESSAGING; the actual
  // write gate above always reads the ref at call time.
  const isNetworkPaused = networkPausedRef?.current === true;
  // Stable identity: callers thread `autosave` through useCallback deps
  // (e.g. workspace handleChange). A fresh literal per render would
  // re-create every dependent callback and re-render the editor + rail on
  // each keystroke and status tick.
  return useMemo(
    () => ({
      status,
      lastSavedAt,
      isOffline,
      isNetworkPaused,
      hasPendingChanges,
      scheduleAutosave,
      flushNow,
      commitAndAdvance,
      retry,
      acknowledgeServerRevision,
    }),
    [status, lastSavedAt, isOffline, isNetworkPaused, hasPendingChanges, scheduleAutosave, flushNow, commitAndAdvance, retry, acknowledgeServerRevision],
  );
}
