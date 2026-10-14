import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useExamQuery } from "../../api/examQueries";
import { accessLinkKeys } from "../../api/accessLinkKeys";
import { authoringEffects } from "../../api/authoringQueryEffects";
import { satCreateRoomApi } from "../../api/satCreateRoomApi";
import type { CreateRoomState, CreateSatRoomRequest, SatRoomFields, SatRoomReceipt } from "../../contracts/satCreateRoom";
import { useSatAuthoringCollaboration } from "../../realtime/coedit";
import {
  COEDIT_MUTATION_FLUSH_TIMEOUT_MS,
  coeditRoomBlockMessage,
  coeditRoomHoldsUnconfirmedWork,
} from "../collaboration/coeditNavigationGate";
import { useAuthoringShellLifecycle } from "../../application/authoringShellLifecycle";
import { classifySatRoomError } from "../../application/satRoomErrorMapper";
import { useOptionalAuthSession } from "../../../auth/authSession";
import { clearSatRoomAttempt, readSatRoomAttempt, retainSatRoomAttempt, satRoomAttemptScope, type PendingSatRoomAttempt } from "../../application/satRoomPendingAttempt";

/** The submission whose outcome is unknown: its key and body are reused verbatim. */
interface PendingAttempt {
  request: CreateSatRoomRequest;
}

/**
 * The ONE owner of "create a SAT room": acknowledgement barrier, committed-head
 * read, a single POST, and recovery from an uncertain outcome.
 *
 * It never publishes and never reads a draft it did not just confirm. The
 * server decides whether the room reuses the latest release or seals the
 * working draft, inside the same transaction that creates the room.
 */
export function useCreateSatRoom(examId: string) {
  const queryClient = useQueryClient();
  const auth = useOptionalAuthSession();
  const actorId = auth?.session?.user.id;
  const scope = actorId ? satRoomAttemptScope(actorId, examId) : null;
  const identity = JSON.stringify([actorId ?? null, examId]);
  const identityRef = useRef(identity);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [restored] = useState(() => {
    try { return scope ? readSatRoomAttempt(scope) : null; } catch { return null; }
  });
  const collaboration = useSatAuthoringCollaboration();
  const shellLifecycle = useAuthoringShellLifecycle(examId);
  const examQuery = useExamQuery(examId);
  const [state, setStateValue] = useState<CreateRoomState>(restored
    ? { status: "unknown", operationKey: restored.operationKey, message: "A previous room attempt is unconfirmed. Check its status before creating another room." }
    : { status: "editing" });
  // Mirrors `state` so a caller awaiting submit() reads the outcome it produced
  // instead of the render that preceded it.
  const stateRef = useRef<CreateRoomState>(state);
  const setState = useCallback((next: CreateRoomState) => {
    stateRef.current = next;
    setStateValue(next);
  }, []);
  const inFlightRef = useRef(false);
  const pendingRef = useRef<PendingSatRoomAttempt | null>(restored);

  // The global form keeps its fields when the selected exam changes. Its
  // operation state must still belong to the correct actor and exam.
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    let previous: PendingSatRoomAttempt | null = null;
    try { previous = scope ? readSatRoomAttempt(scope) : null; } catch { /* POST fails closed if storage is unavailable. */ }
    pendingRef.current = previous;
    inFlightRef.current = false;
    setState(previous
      ? { status: "unknown", operationKey: previous.operationKey, message: "A previous room attempt is unconfirmed. Check its status." }
      : { status: "editing" });
  }

  const forget = useCallback(() => {
    if (identityRef.current === identity) pendingRef.current = null;
    if (scope) {
      try { clearSatRoomAttempt(scope); } catch { /* A received commit remains successful if browser cleanup fails. */ }
    }
  }, [identity, scope]);

  const finish = useCallback((receipt: SatRoomReceipt, operationKey: string) => {
    forget();
    if (!mountedRef.current || identityRef.current !== identity) return null;
    queryClient.setQueryData(accessLinkKeys.link(receipt.room.id), receipt.room);
    // The POST receipt is the acknowledgement; every refresh below is a
    // best-effort projection and can never take it away.
    if (receipt.version.createdNow) {
      void authoringEffects.published(queryClient, examId);
    } else {
      void authoringEffects.accessChanged(queryClient, examId);
    }
    setState({ status: "created", operationKey, receipt });
    return receipt;
  }, [examId, forget, identity, queryClient, setState]);

  const post = useCallback(async (attempt: PendingAttempt): Promise<SatRoomReceipt | null> => {
    if (!mountedRef.current || identityRef.current !== identity) return null;
    const resolving = pendingRef.current !== null;
    if (scope) retainSatRoomAttempt(scope, attempt.request);
    pendingRef.current = { operationKey: attempt.request.operationKey, request: attempt.request };
    setState({ status: "creating", operationKey: attempt.request.operationKey });
    try {
      return finish(await satCreateRoomApi.create(examId, attempt.request), attempt.request.operationKey);
    } catch (error) {
      const failure = classifySatRoomError(error);
      if (identityRef.current !== identity) return null;
      if (failure.kind === "unknown" || (resolving && failure.kind === "forbidden")) {
        setState({ status: "unknown", operationKey: attempt.request.operationKey, message: failure.message });
        return null;
      }
      // The server answered and committed nothing: the key is spent with it.
      forget();
      if (failure.kind === "not-ready") {
        setState({ status: "invalid", message: failure.message, issues: failure.issues });
      } else if (failure.kind === "conflict") {
        void shellLifecycle.refresh();
        void examQuery.refetch();
        setState({ status: "conflict", message: failure.message, currentExamRevision: failure.currentExamRevision });
      } else {
        setState({ status: "failed", message: failure.message });
      }
      return null;
    }
  }, [examId, examQuery, finish, forget, identity, scope, setState, shellLifecycle]);

  const submit = useCallback(async (room: SatRoomFields): Promise<SatRoomReceipt | null> => {
    if (inFlightRef.current) return null;
    // An unresolved outcome owns the key; a new submission would orphan it.
    if (pendingRef.current) return null;
    inFlightRef.current = true;
    try {
      if (scope) {
        const previous = readSatRoomAttempt(scope);
        if (previous) {
          pendingRef.current = previous;
          setState({ status: "unknown", operationKey: previous.operationKey, message: "A previous room attempt is unconfirmed. Check its status." });
          return null;
        }
      }
      setState({ status: "syncing" });
      // Room creation seals whatever the server holds, so an unacknowledged
      // edit must be flushed and confirmed first (the same barrier a route
      // change uses). The server re-fences its own committed revision.
      if (collaboration && coeditRoomHoldsUnconfirmedWork(collaboration.workspaceSnapshot)) {
        const flushed = await collaboration.flushAndWaitForSaved(COEDIT_MUTATION_FLUSH_TIMEOUT_MS);
        const block = coeditRoomBlockMessage(collaboration.workspaceSnapshot, flushed.outcome);
        if (block !== null) {
          setState({ status: "failed", message: block });
          return null;
        }
      }
      const committed = await shellLifecycle.refresh();
      if (committed.kind !== "ready" && committed.kind !== "no-draft") {
        setState({ status: "failed", message: "The latest saved exam could not be read. Check your connection and try again." });
        return null;
      }
      const fresh = await examQuery.refetch();
      const examRevision = fresh.data?.revision;
      if (typeof examRevision !== "number" || !Number.isInteger(examRevision)) {
        setState({ status: "failed", message: "The latest exam revision could not be read. Try again." });
        return null;
      }
      const draft = committed.kind === "ready" ? committed.shell : null;
      const request: CreateSatRoomRequest = {
        operationKey: crypto.randomUUID(),
        expectedExamRevision: examRevision,
        expectedDraftVersionId: draft?.versionId ?? "",
        ...(draft ? { expectedDraftRevision: draft.versionRevision } : {}),
        room: structuredClone(room),
      };
      return await post({ request });
    } catch (error) {
      if (identityRef.current !== identity) return null;
      setState({ status: "failed", message: error instanceof Error ? error.message : "The room could not be created." });
      return null;
    } finally {
      if (identityRef.current === identity) inFlightRef.current = false;
    }
  }, [collaboration, examQuery, identity, post, scope, setState, shellLifecycle]);

  /** Re-sends the unresolved attempt verbatim: the server replays or creates it exactly once. */
  const retryUnknown = useCallback(async (): Promise<SatRoomReceipt | null> => {
    const pending = pendingRef.current;
    if (!pending?.request || inFlightRef.current) return null;
    inFlightRef.current = true;
    try {
      return await post({ request: pending.request });
    } finally {
      if (identityRef.current === identity) inFlightRef.current = false;
    }
  }, [identity, post]);

  /** Reads the committed outcome by key. Not-found keeps the attempt; only a verbatim retry may resolve it. */
  const checkStatus = useCallback(async (): Promise<SatRoomReceipt | null> => {
    const pending = pendingRef.current;
    if (!pending || inFlightRef.current) return null;
    inFlightRef.current = true;
    try {
      return finish(await satCreateRoomApi.operation(pending.operationKey), pending.operationKey);
    } catch (error) {
      const failure = classifySatRoomError(error);
      if (identityRef.current !== identity) return null;
      const message = !pending.request
        ? "The previous attempt is still unconfirmed. Check again; its retry details were cleared on reload or expiry."
        : failure.kind === "unknown"
        ? "The room could not be confirmed yet. Check again in a moment."
        : "No room has been recorded for that attempt yet. You can try again; it will not create a duplicate.";
      setState({ status: "unknown", operationKey: pending.operationKey, message });
      return null;
    } finally {
      if (identityRef.current === identity) inFlightRef.current = false;
    }
  }, [finish, identity, setState]);

  /** Returns to editing after an invalid/conflict/failed answer. Never clears an unknown attempt. */
  const dismiss = useCallback(() => {
    if (pendingRef.current) return;
    setState({ status: "editing" });
  }, [setState]);

  return {
    state,
    /** The latest state, synchronously (safe to read right after awaiting submit()). */
    getState: () => stateRef.current,
    submit,
    retryUnknown,
    checkStatus,
    dismiss,
    /** True while the server owns an operation whose outcome the client does not know. */
    hasUnresolvedAttempt: state.status === "unknown",
    canRetryUnknown: pendingRef.current?.request != null,
    isBusy: state.status === "syncing" || state.status === "creating",
  };
}
