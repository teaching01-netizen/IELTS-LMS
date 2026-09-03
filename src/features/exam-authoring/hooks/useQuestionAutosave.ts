import { useCallback, useEffect, useRef, useState } from "react";
import { useDurableLatestAutosave } from "../../../hooks/useDurableLatestAutosave";
import { saveDurableDraft } from "../../../utils/durableDraftStore";
import type { QuestionRevision } from "../contracts/assessment";

export type QuestionSaveStatus = "saved" | "unsaved" | "saving" | "error" | "offline";

export interface UseQuestionAutosaveOptions {
  save: (revision: QuestionRevision) => Promise<QuestionRevision | void>;
  debounceMs?: number | undefined;
  durableKey?: string | null | undefined;
  onRecover?: ((revision: QuestionRevision) => void) | undefined;
  autoSaveRecovered?: boolean | undefined;
  onError?: ((error: Error) => void) | undefined;
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
  /** True when the selected question has changes that are not server-acknowledged. */
  hasPendingChanges: boolean;
  scheduleAutosave: (revision: QuestionRevision) => void;
  flushNow: (revision: QuestionRevision) => Promise<QuestionFlushResult>;
  commitAndAdvance: (revision: QuestionRevision) => Promise<QuestionFlushResult>;
  retry: (revision: QuestionRevision) => void;
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
  } = options;
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
      if (pending) scheduleAutosaveInternal(pending);
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [scheduleAutosaveInternal]);

  const persistOffline = useCallback((revision: QuestionRevision) => {
    const durableKey = durableKeyRef.current;
    if (!durableKey) return;
    void saveDurableDraft(durableKey, revision).catch(onErrorOption);
  }, [onErrorOption]);

  const scheduleAutosave = useCallback((revision: QuestionRevision) => {
    latestRevisionRef.current = revision;
    setHasPendingChanges(true);
    if (!offlineRef.current) {
      scheduleAutosaveInternal(revision);
      return;
    }
    offlineDraftRef.current = revision;
    persistOffline(revision);
  }, [persistOffline, scheduleAutosaveInternal]);

  const flushNow = useCallback(async (revision: QuestionRevision): Promise<QuestionFlushResult> => {
    latestRevisionRef.current = revision;
    setHasPendingChanges(true);
    if (!offlineRef.current) return flushAutosave(revision);
    offlineDraftRef.current = revision;
    persistOffline(revision);
    return { ok: false, isLatest: true };
  }, [flushAutosave, persistOffline]);

  const commitAndAdvance = useCallback(
    async (revision: QuestionRevision) => flushNow(revision),
    [flushNow]
  );

  const retry = useCallback((revision: QuestionRevision) => {
    latestRevisionRef.current = revision;
    setHasPendingChanges(true);
    if (offlineRef.current) {
      offlineDraftRef.current = revision;
      persistOffline(revision);
      return;
    }
    retryAutosave(revision);
  }, [persistOffline, retryAutosave]);

  return {
    status: isOffline ? "offline" : autosaveStatus,
    lastSavedAt,
    isOffline,
    hasPendingChanges,
    scheduleAutosave,
    flushNow,
    commitAndAdvance,
    retry,
  };
}
