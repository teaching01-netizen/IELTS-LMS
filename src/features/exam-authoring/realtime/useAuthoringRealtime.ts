import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AssessmentAuthoringShell,
  AssessmentQuestionDetail,
} from "../contracts/assessment";
import { assessmentAuthoringApi } from "../api/assessmentAuthoringApi";
import { assessmentKeys } from "../api/assessmentQueries";
import {
  createAuthoringRealtimeStats,
  type AuthoringConnectionState,
  type AuthoringInboundFrame,
  type ReconcilerContext,
  type UseAuthoringRealtimeOptions,
  type UseAuthoringRealtimeResult,
} from "./contracts";
import {
  AuthoringRealtimeClient,
  buildAuthoringSocketUrl,
} from "./authoringRealtimeClient";
import {
  advanceAuthoringCursor,
  createAuthoringEventState,
  reduceAuthoringFrame,
  seedAuthoringBaseline,
} from "./authoringEventReducer";
import { reconcileAuthoringEvent } from "./authoringCacheReconciler";
import { recoverAuthoringSnapshot } from "./recovery";

/**
 * Workspace-owned orchestrator. Mounted ONCE (AuthoringWorkspace) — never in an
 * editor or rail. It owns the client lifecycle, the reducer cursor, reconciler
 * dispatch, snapshot recovery, the connection-state machine, and stats.
 *
 * Pipeline: socket frame -> reduce (dedupe / stale-draft) -> reconcile
 * (invalidate / deferred-dirty / lifecycle) OR recover (HTTP snapshot).
 * WS failure degrades to HTTP editing; it never blocks it.
 */
export function useAuthoringRealtime(
  options: UseAuthoringRealtimeOptions,
): UseAuthoringRealtimeResult {
  const queryClient = useQueryClient();
  const [connectionState, setConnectionState] = useState<AuthoringConnectionState>(
    options.enabled ? "connecting" : "disabled",
  );
  const [lastProcessedCursor, setLastProcessedCursor] = useState<number | null>(null);
  const [selfConnectionId, setSelfConnectionId] = useState<string | null>(null);
  const [stats] = useState(createAuthoringRealtimeStats);

  const reducerRef = useRef(createAuthoringEventState());
  const clientRef = useRef<AuthoringRealtimeClient | null>(null);
  const optionsRef = useRef(options);
  /** One conservative refetch per unknown kind per binding (no refetch storms). */
  const unknownKindRefetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const reconcilerContext = useMemo<ReconcilerContext>(
    () => ({
      examId: options.examId,
      draftVersionId: options.draftVersionId,
      isQuestionDirty: (examQuestionId) =>
        optionsRef.current.isQuestionDirty(examQuestionId),
      selectedExamQuestionId: options.selectedExamQuestionId,
      invalidateShell: (refetch) => {
        void queryClient.invalidateQueries({
          queryKey: assessmentKeys.shell(options.examId),
          refetchType: refetch,
        });
      },
      invalidateQuestion: (examQuestionId, refetch) => {
        void queryClient.invalidateQueries({
          queryKey: assessmentKeys.question(examQuestionId),
          refetchType: refetch,
        });
      },
      removeQuestionCache: (examQuestionId) => {
        queryClient.removeQueries({ queryKey: assessmentKeys.question(examQuestionId) });
      },
      invalidateReadinessAndRelease: () => {
        void queryClient.invalidateQueries({
          queryKey: assessmentKeys.readinessRoot(options.examId),
        });
        void queryClient.invalidateQueries({
          queryKey: assessmentKeys.release(options.examId),
        });
      },
      noteRemoteRevision: (examQuestionId, eventRevision, actorId) => {
        optionsRef.current.onRemoteRevision?.(examQuestionId, eventRevision, actorId);
      },
      noteRemoteStructuralChange: (examQuestionId, kind, actorId) => {
        optionsRef.current.onRemoteStructuralChange?.(examQuestionId, kind, actorId);
      },
    }),
    [queryClient, options.examId, options.draftVersionId, options.selectedExamQuestionId],
  );

  /**
   * Authoritative HTTP refetch of everything the socket cannot vouch for.
   * Used when the socket has a coverage hole it cannot express as events:
   * a fresh subscribe (no replay) or an unknown-but-valid event kind. A dirty
   * question is never refetched, so an unsaved draft is never overwritten.
   */
  const refetchAuthoritativeSurface = useCallback(() => {
    const { examId: boundExamId, selectedExamQuestionId: selected, isQuestionDirty } =
      optionsRef.current;
    void queryClient.invalidateQueries({
      queryKey: assessmentKeys.shell(boundExamId),
      refetchType: "active",
    });
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(boundExamId) });
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(boundExamId) });
    if (selected && !isQuestionDirty(selected)) {
      void queryClient.invalidateQueries({
        queryKey: assessmentKeys.question(selected),
        refetchType: "active",
      });
    }
  }, [queryClient]);

  const runRecovery = useCallback(
    async (reason: string) => {
      const source = optionsRef.current.snapshotSource ?? assessmentAuthoringApi;
      const result = await recoverAuthoringSnapshot(
        {
          examId: optionsRef.current.examId,
          selectedExamQuestionId: optionsRef.current.selectedExamQuestionId,
          source,
          setShellData: (shell) => {
            queryClient.setQueryData<AssessmentAuthoringShell>(
              assessmentKeys.shell(optionsRef.current.examId),
              shell,
            );
          },
          setQuestionData: (examQuestionId, detail: AssessmentQuestionDetail) => {
            queryClient.setQueryData(assessmentKeys.question(examQuestionId), detail);
          },
          removeQuestionCache: (examQuestionId) => {
            queryClient.removeQueries({ queryKey: assessmentKeys.question(examQuestionId) });
          },
          listCachedQuestionIds: () =>
            queryClient
              .getQueryCache()
              .findAll({ queryKey: ["assessment-question"] })
              .map((query) => String(query.queryKey[1] ?? ""))
              .filter((id) => id.length > 0),
          retryDelayMs: optionsRef.current.snapshotRetryDelayMs ?? 1_000,
        },
        reason,
      );
      if (result.recovered) {
        stats.snapshotRecoveries += 1;
        setConnectionState("live");
      } else {
        // Socket + snapshot both unusable: HTTP editing stays fully available.
        setConnectionState("degraded-http");
      }
    },
    [queryClient, stats],
  );

  const handleFrame = useCallback(
    (frame: AuthoringInboundFrame) => {
      stats.received += 1;
      const previousCursor = reducerRef.current.lastProcessedCursor;
      const { state: nextState, action } = reduceAuthoringFrame(
        reducerRef.current,
        frame,
        optionsRef.current.draftVersionId,
      );
      reducerRef.current = nextState;
      if (nextState.lastProcessedCursor !== previousCursor) {
        setLastProcessedCursor(nextState.lastProcessedCursor);
      }
      switch (action.action) {
        case "process": {
          const outcome = reconcileAuthoringEvent(reconcilerContext, action.event);
          if (outcome.outcome === "lifecycle") {
            setConnectionState(
              outcome.signal === "exam-changed" ? "live" : "stale-draft",
            );
            optionsRef.current.onLifecycle?.(outcome.signal);
          } else if (outcome.outcome === "invalidated") {
            // deferred-dirty / deferred-dirty-structural / ignored outcomes
            // deliberately issue no targeted content refetch, so they must not
            // be counted as reconciliations.
            stats.reconciled += 1;
          }
          break;
        }
        case "ignore-duplicate":
          stats.duplicates += 1;
          break;
        case "ignore-out-of-order":
          stats.outOfOrder += 1;
          break;
        case "ignore-stale-draft":
          stats.staleDraft += 1;
          break;
        // NOTE: a duplicate or out-of-order frame is NOT a gap. The Phase 04
        // cursor contract is explicit that cursors are not contiguous per exam,
        // so nothing here infers loss from arithmetic — only the server's own
        // `authoring.snapshot_required` frame declares one.
        case "ignore-unknown":
          break;
        case "snapshot-required":
          // Phase 06 note: there is deliberately NO client-side metric module
          // here. This repo has no client telemetry ingestion path, so browser
          // counters would be an in-memory subsystem with no operator reading
          // it. The measurement that matters is server-side
          // (authoring_resync_total{reason}), where the reason is already a
          // closed protocol enum and the resync is counted at its source.
          stats.snapshotsRequired += 1;
          void runRecovery(action.reason);
          break;
      }
    },
    [reconcilerContext, runRecovery, stats],
  );

  // The client is created once per (exam, draft) binding; frame handling goes
  // through a ref so a selection change never restarts the socket.
  const handleFrameRef = useRef(handleFrame);
  useEffect(() => {
    handleFrameRef.current = handleFrame;
  }, [handleFrame]);

  const reconnect = useCallback(() => {
    clientRef.current?.reconnectNow();
  }, []);

  const sendFrame = useCallback((frame: unknown): boolean => {
    return clientRef.current?.send(frame) ?? false;
  }, []);

  const { enabled, examId, draftVersionId, socketFactory, buildUrl } = options;

  useEffect(() => {
    if (!enabled || !draftVersionId) {
      clientRef.current?.stop();
      clientRef.current = null;
      setConnectionState("disabled");
      return () => undefined;
    }

    // A new binding is a new world: drop the old cursor baseline. The baseline
    // is then re-established from the HANDSHAKE (see onSubscribed), never from
    // the first arbitrary event.
    reducerRef.current = createAuthoringEventState();
    unknownKindRefetchedRef.current = new Set();
    setLastProcessedCursor(null);

    const url = (buildUrl ?? buildAuthoringSocketUrl)(examId);
    const client = new AuthoringRealtimeClient({
      url,
      examId,
      getLastSeenCursor: () => reducerRef.current.lastProcessedCursor,
      ...(socketFactory ? { socketFactory } : {}),
      onStateChange: (state) => setConnectionState(state),
      onFrame: (frame) => handleFrameRef.current(frame),
      onMalformed: (info) => {
        stats.malformed += 1;
        // Structured warn: reason + a truncated raw prefix, never content.
        console.warn("[authoring-realtime] ignored malformed frame", info);
      },
      onUnknownKind: ({ rawKind, cursor }) => {
        // Forward tolerance WITHOUT phantom loss: consume the cursor so a
        // later known event is not mistaken for a gap on resume, run one
        // conservative refetch per kind, and execute no business behavior.
        stats.unknownKind += 1;
        const advanced = advanceAuthoringCursor(reducerRef.current, cursor);
        if (advanced.lastProcessedCursor !== reducerRef.current.lastProcessedCursor) {
          reducerRef.current = advanced;
          setLastProcessedCursor(advanced.lastProcessedCursor);
        }
        if (!unknownKindRefetchedRef.current.has(rawKind)) {
          unknownKindRefetchedRef.current.add(rawKind);
          refetchAuthoritativeSurface();
        }
        console.warn("[authoring-realtime] unknown event kind; cursor consumed", {
          rawKind,
          cursor,
        });
      },
      onPresence: (raw) => {
        optionsRef.current.onPresence?.(raw);
      },
      onCapabilities: (capabilities) => {
        optionsRef.current.onCapabilities?.(capabilities);
      },
      onSubscribed: (info) => {
        // The ack is where this socket learns its own presence identity, which
        // it needs to exclude itself without also hiding the same user's other
        // tabs (they carry different connection ids).
        setSelfConnectionId(info.connectionId);
        if (info.resumed) {
          // Resume: replay fills (lastSeenCursor, barrierCursor] and the
          // existing cursor is already the correct baseline.
          return;
        }
        // Fresh subscribe: nothing is replayed, so the barrier is the
        // baseline, and any change between the last HTTP read and the barrier
        // would otherwise be invisible forever. Close that window with one
        // authoritative HTTP refetch.
        const seeded = seedAuthoringBaseline(reducerRef.current, info.barrierCursor);
        reducerRef.current = seeded;
        setLastProcessedCursor(seeded.lastProcessedCursor);
        refetchAuthoritativeSurface();
      },
    });
    clientRef.current = client;
    client.start();

    return () => {
      client.stop();
      if (clientRef.current === client) {
        clientRef.current = null;
      }
    };
  }, [
    enabled,
    examId,
    draftVersionId,
    socketFactory,
    buildUrl,
    stats,
    refetchAuthoritativeSurface,
  ]);

  return useMemo(
    () => ({
      connectionState,
      lastProcessedCursor,
      stats,
      reconnect,
      sendFrame,
      selfConnectionId,
    }),
    [connectionState, lastProcessedCursor, stats, reconnect, sendFrame, selfConnectionId],
  );
}
