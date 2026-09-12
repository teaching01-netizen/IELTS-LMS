import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  backendPost,
  backendConflictReason,
  buildQueuedMutationUpdate,
  buildStudentHeartbeatEvent,
  ensureClientSessionIdForAttempt,
  mapBackendStudentAttempt,
  PendingMutationDurabilityMirror,
  rotateClientSessionIdForAttempt,
  restoreClientSessionIdForAttempt,
  saveStudentAuditEvent,
  studentAttemptRepository,
} from "@student/application/studentAttemptFacade";
import type { DurablePersistTriggerSource } from "@student/application/studentAttemptFacade";
import { DurableResponseEngine } from "@shared/durability/DurableResponseEngine";
import {
  createResponseDurabilityV2Transport,
  takeOverResponseDurabilityLease,
} from "@student/api/responseDurabilityTransport";
import { getVisibleResponse, type ResponsePayload } from "@shared/durability/types";
import {
  blockedSubmitGateMessage,
  mapEngineStatus,
  type ReconcileBlockedResult,
} from "@shared/durability/useResponseDurabilityStatus";
import { queryClient } from "../../../app/data/queryClient";
import {
  emitStudentObservabilityMetric,
  withStudentObservabilityDimensions,
} from "../../../utils/studentObservability";
import type { ModuleType, Violation } from "../../../types";
import type {
  AttemptSyncState,
  HeartbeatEventType,
  StudentAnswerValue,
  StudentAnswerMutationMeta,
  StudentAttempt,
  StudentAttemptMutation,
  StudentAttemptMutationPayload,
  StudentAttemptMutationType,
  StudentPreCheckResult,
} from "../../../types/studentAttempt";
import {
  useStudentRuntime,
  useStudentRuntimeSession,
  useStudentRuntimeLiveRef,
} from "./StudentRuntimeProvider";
import { isVerifiedTerminalStudentState } from "./verifiedTerminalState";

interface StudentAttemptState {
  attempt: StudentAttempt | null;
  attemptId: string | null;
  lastLocalMutationAt: string | null;
  lastPersistedAt: string | null;
  pendingMutationCount: number;
  durabilityLeaseConflict: boolean;
  /** Question ids whose visible drafts need attention (blocked, never sent). */
  blockedQuestionIds: string[];
  /** Count of quarantined writes awaiting resolve-or-discard at submit time. */
  quarantinedCount: number;
}

interface StudentAttemptActions {
  persistAnswer: (
    questionId: string,
    answer: StudentAnswerValue,
    meta?: StudentAnswerMutationMeta
  ) => void;
  persistWritingAnswer: (taskId: string, text: string) => void;
  persistFlag: (questionId: string, flagged: boolean) => void;
  persistViolation: (violation: Violation) => void;
  persistPosition: (
    currentModule: ModuleType,
    currentQuestionId: string | null,
    phase: StudentAttempt["phase"]
  ) => void;
  recordPreCheckResult: (result: StudentPreCheckResult) => Promise<void>;
  recordNetworkStatus: (status: "offline" | "online", timestamp?: string) => Promise<void>;
  recordHeartbeat: (type: HeartbeatEventType, payload?: Record<string, unknown>) => Promise<void>;
  acknowledgeProctorWarning: (warningId: string) => Promise<void>;
  submitAttempt: () => Promise<boolean>;
  takeOverDurabilityLease: (reason?: string) => Promise<boolean>;
  setDeviceFingerprintHash: (hash: string) => Promise<void>;
  flushPending: () => Promise<boolean>;
  /**
   * Best-effort reconcile of one blocked question; see implementation notes.
   * Returns a reason union: "reconciled" | "not-blocked" | "refusal" |
   * `error:${string}`. Awaiting callers can treat "reconciled" as success;
   * boolean `true` still means reconciled for `=== true`/`=== false` checks
   * via the companion boolean (the union string "reconciled" is NOT `true` —
   * update call sites to compare against "reconciled").
   */
  reconcileBlockedResponse: (questionId: string) => Promise<ReconcileBlockedResult>;
  flushAnswerDurabilityNow: () => void;
  flushHeartbeatEvents: () => Promise<void>;
  dismissDroppedMutationsBanner: () => Promise<void>;
}

interface StudentAttemptContextValue {
  state: StudentAttemptState;
  actions: StudentAttemptActions;
}

interface StudentAttemptControlContextValue {
  getScheduleId: () => string | undefined;
  getAttemptId: () => string | undefined;
  flushAnswerDurabilityNow: () => void;
}

interface StudentAttemptProviderProps {
  children: ReactNode;
  scheduleId?: string | undefined;
  attemptSnapshot?: StudentAttempt | null;
  persistenceEnabled?: boolean | undefined;
  writingQuestionIds?: readonly string[] | undefined;
}

type AttemptPatch = Omit<Partial<StudentAttempt>, "integrity" | "recovery" | "writingAnswers"> & {
  integrity?: Partial<StudentAttempt["integrity"]> | undefined;
  recovery?: Partial<StudentAttempt["recovery"]> | undefined;
  // `null` is a deletion marker for a V2 writing response. It is consumed
  // while merging and never escapes into the StudentAttempt string map.
  writingAnswers?: Record<string, string | null> | undefined;
};

const StudentAttemptContext = createContext<StudentAttemptContextValue | null>(null);
const StudentAttemptControlContext = createContext<StudentAttemptControlContextValue | null>(null);
const ANSWER_DURABLE_WRITE_DEBOUNCE_MS = 100;
const BOUNDARY_IMMEDIATE_DURABILITY_THRESHOLD_SECONDS = 20;

function detectClientDeviceClass(): "phone" | "tablet" | "desktop" | "unknown" {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const ua = navigator.userAgent || "";
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i.test(ua)) {
    return "tablet";
  }
  if (/iPhone|iPod|Mobile|Android/i.test(ua)) {
    return "phone";
  }
  if (ua.trim().length === 0) {
    return "unknown";
  }
  return "desktop";
}

function detectBrowserEngine(): "webkit" | "blink" | "gecko" | "unknown" {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const ua = navigator.userAgent || "";
  if (/AppleWebKit/i.test(ua)) {
    return "webkit";
  }
  if (/Gecko\//i.test(ua) || /Firefox/i.test(ua)) {
    return "gecko";
  }
  if (/Chrome|Chromium|Edg|OPR/i.test(ua)) {
    return "blink";
  }
  return "unknown";
}

function isEditableDomTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.getAttribute("contenteditable") === "true"
  );
}

function mergeViolationsById(
  localViolations: Violation[],
  remoteViolations: Violation[]
): Violation[] {
  const merged = new Map<string, Violation>();
  for (const violation of localViolations) {
    merged.set(violation.id, violation);
  }
  for (const violation of remoteViolations) {
    merged.set(violation.id, violation);
  }

  return [...merged.values()].sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  );
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function mergeAttempt(attempt: StudentAttempt, patch: AttemptPatch): StudentAttempt {
  return {
    ...attempt,
    ...patch,
    answers: patch.answers ? { ...attempt.answers, ...patch.answers } : attempt.answers,
    writingAnswers: patch.writingAnswers
      ? Object.entries(patch.writingAnswers).reduce<Record<string, string>>(
          (writingAnswers, [questionId, answer]) => {
            if (answer === null) delete writingAnswers[questionId];
            else writingAnswers[questionId] = answer;
            return writingAnswers;
          },
          { ...attempt.writingAnswers }
        )
      : attempt.writingAnswers,
    flags: patch.flags ? { ...attempt.flags, ...patch.flags } : attempt.flags,
    violations: patch.violations ?? attempt.violations,
    integrity: patch.integrity
      ? {
          ...attempt.integrity,
          ...patch.integrity,
        }
      : attempt.integrity,
    recovery: patch.recovery
      ? {
          ...attempt.recovery,
          ...patch.recovery,
        }
      : attempt.recovery,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
}

export function StudentAttemptProvider({
  children,
  scheduleId,
  attemptSnapshot = null,
  persistenceEnabled = true,
  writingQuestionIds = [],
}: StudentAttemptProviderProps) {
  // Response durability is always V2: the backend serves only the V2 response
  // protocol and the V1 mutation endpoints are unavailable.
  const { state: runtimeState, actions: runtimeActions } = useStudentRuntimeSession();
  const runtimeLiveRef = useStudentRuntimeLiveRef();
  const setRuntimeAttemptSyncState = runtimeActions.setAttemptSyncState;
  const [attempt, setAttempt] = useState<StudentAttempt | null>(attemptSnapshot);
  const renderedAttemptIdentityRef = useRef<{
    attemptId: string | null;
    scheduleId: string | null;
  }>({
    attemptId: attemptSnapshot?.id ?? null,
    scheduleId: scheduleId ?? attemptSnapshot?.scheduleId ?? null,
  });
  renderedAttemptIdentityRef.current = {
    attemptId: attemptSnapshot?.id ?? null,
    scheduleId: scheduleId ?? attemptSnapshot?.scheduleId ?? null,
  };
  const attemptSnapshotRef = useRef<StudentAttempt | null>(attemptSnapshot);
  attemptSnapshotRef.current = attemptSnapshot;
  // Source of truth for UI pending badge is the durability mirror via onPendingMutationCountChange.
  // attempt.recovery.pendingMutationCount is persisted for recovery but not used for badge display.
  const [pendingMutationCount, setPendingMutationCount] = useState(0);
  const [durabilityLeaseConflict, setDurabilityLeaseConflict] = useState(false);
  // Per-question "needs attention" source for the blocked banner/badge.
  // Refreshed from the engine on every status/state publish; recovered via
  // publish path (no restructure of publishV2EngineState).
  const [blockedQuestionIds, setBlockedQuestionIds] = useState<string[]>([]);
  const [quarantinedCount, setQuarantinedCount] = useState(0);
  const attemptRef = useRef<StudentAttempt | null>(attemptSnapshot);
  const controlScheduleIdRef = useRef<string | undefined>(
    scheduleId ?? attemptSnapshot?.scheduleId
  );
  const controlAttemptIdRef = useRef<string | undefined>(attemptSnapshot?.id);
  const observedPositionRef = useRef<string>(
    JSON.stringify({
      phase: attemptSnapshot?.phase ?? "pre-check",
      currentModule: attemptSnapshot?.currentModule ?? "listening",
      currentQuestionId: attemptSnapshot?.currentQuestionId ?? null,
    })
  );
  const observedViolationsRef = useRef<string>(JSON.stringify(attemptSnapshot?.violations ?? []));
  const objectiveFlushTimeoutRef = useRef<number | null>(null);
  const writingFlushTimeoutRef = useRef<number | null>(null);
  const flushPendingRef = useRef<() => Promise<boolean>>(async () => true);
  const flushInFlightRef = useRef<Promise<boolean> | null>(null);
  const backgroundSubmitInFlightRef = useRef<Promise<void> | null>(null);
  const durabilityMirrorRef = useRef<PendingMutationDurabilityMirror | null>(null);

  const syncAttemptState = useCallback(
    (nextAttempt: StudentAttempt) => {
      const renderedIdentity = renderedAttemptIdentityRef.current;
      if (
        renderedIdentity.attemptId !== nextAttempt.id ||
        renderedIdentity.scheduleId !== nextAttempt.scheduleId
      ) {
        return;
      }
      attemptRef.current = nextAttempt;
      controlScheduleIdRef.current = scheduleId ?? nextAttempt.scheduleId;
      controlAttemptIdRef.current = nextAttempt.id;
      setAttempt(nextAttempt);
      setRuntimeAttemptSyncState(nextAttempt.recovery.syncState);
    },
    [scheduleId, setRuntimeAttemptSyncState]
  );
  const syncAttemptStateRef = useRef(syncAttemptState);
  syncAttemptStateRef.current = syncAttemptState;

  useEffect(() => {
    controlScheduleIdRef.current = scheduleId ?? attemptRef.current?.scheduleId;
    controlAttemptIdRef.current = attemptRef.current?.id;
  }, [attempt, scheduleId]);

  // Stable forwarder: the runtime `actions` object identity changes whenever stable
  // runtime state updates (including sync-state dispatches the V2 engine itself emits).
  // The engine lifecycle effect depends on this callback, so it must not change
  // identity per render or the engine would be destroyed/recreated mid-flight and
  // recovery would republish stale drafts over newer edits.
  const runtimeActionsRef = useRef(runtimeActions);
  runtimeActionsRef.current = runtimeActions;
  const setStorageDurabilityBlocking = useCallback((active: boolean) => {
    runtimeActionsRef.current.transitionBlocking("storage_unavailable", active);
  }, []);

  const v2EngineRef = useRef<DurableResponseEngine | null>(null);
  const v2ReadyRef = useRef<Promise<void> | null>(null);
  const v2PendingAcceptancesRef = useRef(new Set<Promise<void>>());
  const v2IdentityGenerationRef = useRef(0);
  const v2IdentityKey = `${scheduleId ?? attemptSnapshot?.scheduleId ?? ""}:${attemptSnapshot?.id ?? ""}`;
  const previousV2IdentityKeyRef = useRef<string | null>(null);
  const v2FieldKindRef = useRef(new Map<string, "answer" | "writing" | "flag">());
  if (previousV2IdentityKeyRef.current !== v2IdentityKey) {
    previousV2IdentityKeyRef.current = v2IdentityKey;
    v2IdentityGenerationRef.current += 1;
    v2FieldKindRef.current.clear();
  }
  const v2HydratedSnapshotKeyRef = useRef<string | null>(null);
  for (const questionId of writingQuestionIds) {
    if (questionId.trim()) {
      v2FieldKindRef.current.set(questionId, "writing");
    }
  }

  useEffect(() => {
    v2PendingAcceptancesRef.current.clear();
  }, [v2IdentityKey]);

  const publishV2EngineState = useCallback(
    (states: ReadonlyMap<string, import("@shared/durability/types").QuestionResponseState>) => {
      const currentAttempt = attemptRef.current;
      if (!currentAttempt) return;
      const answerPatch: Record<string, StudentAnswerValue> = {};
      const writingPatch: Record<string, string | null> = {};
      const flagPatch: Record<string, boolean> = {};
      let pending = 0;

      // Blocked ids are derived from the publish itself (metadata only:
      // question ids + blocked flags, never snapshot answers), so the
      // "needs attention" badge stays live even between status changes.
      // Do NOT restructure this publish: blocked ids piggyback on it.
      const blocked: string[] = [];
      for (const [questionId, state] of states) {
        if (state.pending?.blocked) blocked.push(questionId);
        if (state.pending) pending += 1;
        const visible = getVisibleResponse(state);
        if (!visible) continue;
        const kind =
          v2FieldKindRef.current.get(questionId) ??
          (Object.prototype.hasOwnProperty.call(currentAttempt.writingAnswers, questionId)
            ? "writing"
            : "answer");
        if (
          visible.markedForReview ||
          Object.prototype.hasOwnProperty.call(currentAttempt.flags, questionId) ||
          kind === "flag"
        ) {
          flagPatch[questionId] = visible.markedForReview;
        }
        if (kind === "writing") {
          writingPatch[questionId] = typeof visible.answer === "string" ? visible.answer : null;
        } else if (
          visible.answer === null ||
          typeof visible.answer === "string" ||
          Array.isArray(visible.answer)
        ) {
          answerPatch[questionId] = visible.answer;
        }
      }

      setPendingMutationCount(pending);
      // Keep blocked ids fresh even when there is no visible patch to merge
      // (e.g. a quarantine publish that only clears visible state).
      setBlockedQuestionIds(blocked);
      if (
        Object.keys(answerPatch).length === 0 &&
        Object.keys(writingPatch).length === 0 &&
        Object.keys(flagPatch).length === 0
      ) {
        return;
      }
      syncAttemptStateRef.current(
        mergeAttempt(currentAttempt, {
          answers: answerPatch,
          writingAnswers: writingPatch,
          flags: flagPatch,
          recovery: {
            pendingMutationCount: pending,
          },
        })
      );
    },
    []
  );

  useEffect(() => {
    const snapshot = attemptSnapshotRef.current;
    const enabled = persistenceEnabled && Boolean(snapshot?.id);
    if (!enabled) {
      v2EngineRef.current?.destroy();
      v2EngineRef.current = null;
      v2ReadyRef.current = null;
      setDurabilityLeaseConflict(false);
      setBlockedQuestionIds([]);
      setQuarantinedCount(0);
      return;
    }

    const generation = v2IdentityGenerationRef.current;
    const engine = new DurableResponseEngine({
      scheduleId: scheduleId ?? snapshot?.scheduleId ?? "unknown",
      attemptId: snapshot?.id ?? "unknown",
      leaseEpoch: snapshot?.leaseEpoch ?? 1,
      controlEpoch: snapshot?.controlEpoch ?? 1,
      transport: createResponseDurabilityV2Transport(
        scheduleId ?? snapshot?.scheduleId ?? "unknown",
        snapshot ?? undefined
      ),
      // WP7 reason-coded counters (telemetry only; never answer content).
      onDurabilityEvent: (name, fields) =>
        emitStudentObservabilityMetric(
          name,
          withStudentObservabilityDimensions({
            scheduleId: scheduleId ?? snapshot?.scheduleId,
            attemptId: snapshot?.id,
            ...fields,
          })
        ),
      onStateChange: (states) => {
        if (v2EngineRef.current !== engine || v2IdentityGenerationRef.current !== generation)
          return;
        publishV2EngineState(states);
      },
      onStatusChange: (status, error) => {
        if (v2EngineRef.current !== engine || v2IdentityGenerationRef.current !== generation)
          return;
        // Shared WP4/WP5 vocabulary: blocked_attention is honest-but-not-saved
        // work that must stay visible. Map through the shared mapper so IELTS
        // and SAT cannot drift. "blocked_attention" => AttemptSyncState "offline"
        // (kept, visible, needs attention) and explicitly NOT the
        // lease-conflict overlay (no setDurabilityLeaseConflict(true) here).
        const display = mapEngineStatus(status, engine.getBlockedCount());
        const blockedIds = (() => {
          try {
            return engine.getBlockedQuestionIds();
          } catch {
            return [];
          }
        })();
        setBlockedQuestionIds(blockedIds);
        try {
          setQuarantinedCount(engine.getQuarantined().length);
        } catch {
          setQuarantinedCount(0);
        }
        const currentAttempt = attemptRef.current;
        if (currentAttempt) {
          const terminalState = isVerifiedTerminalStudentState({
            attempt: currentAttempt,
            runtimeSnapshot: null,
          });
          syncAttemptState(
            mergeAttempt(currentAttempt, {
              recovery: {
                pendingMutationCount: engine.getPendingCount(),
                syncState:
                  terminalState !== "not_terminal"
                    ? "saved"
                    : status === "synced" && display === "saved"
                      ? "saved"
                      : status === "saving"
                        ? "saving"
                        : status === "saved_locally"
                          ? "offline"
                          : display === "blocked_attention"
                            ? "offline"
                            : "error",
              },
            })
          );
        }
        if (status === "durability_fault") {
          setStorageDurabilityBlocking(true);
        }
        if (status === "blocked_attention") {
          // Drafts are kept on this device and visible; they are not
          // acknowledged, so never report "saved" and never raise the
          // lease-takeover overlay. "offline" syncState above keeps them
          // honest; do not touch durabilityLeaseConflict here.
        }
        if (status === "conflict_fenced") {
          setDurabilityLeaseConflict(true);
          setRuntimeAttemptSyncState("error");
        }
        if (status === "conflict_terminal") {
          setDurabilityLeaseConflict(false);
          setRuntimeAttemptSyncState("error");
        }
        if (status === "synced" && display === "saved") {
          setDurabilityLeaseConflict(false);
          setStorageDurabilityBlocking(false);
        }
        void error;
      },
    });
    v2EngineRef.current = engine;
    const recovery = engine.recover().catch((error: unknown) => {
      if (v2EngineRef.current !== engine || v2IdentityGenerationRef.current !== generation) return;
      const currentAttempt = attemptRef.current;
      if (currentAttempt) {
        syncAttemptState(
          mergeAttempt(currentAttempt, {
            recovery: { syncState: "error" },
          })
        );
      }
      setStorageDurabilityBlocking(true);
      void error;
    });
    v2ReadyRef.current = recovery;

    return () => {
      engine.destroy();
      if (v2EngineRef.current === engine) v2EngineRef.current = null;
      if (v2ReadyRef.current === recovery) v2ReadyRef.current = null;
      // Mirror the persistenceEnabled=false branch: a destroyed engine owns
      // no blocked/quarantined drafts, so clear both ids + count. Without
      // this the "needs attention" badge can stick after teardown.
      setBlockedQuestionIds([]);
      setQuarantinedCount(0);
    };
  }, [
    attemptSnapshot?.id,
    attemptSnapshot?.scheduleId,
    attemptSnapshot?.leaseEpoch,
    attemptSnapshot?.controlEpoch,
    persistenceEnabled,
    publishV2EngineState,
    scheduleId,
    setRuntimeAttemptSyncState,
    setStorageDurabilityBlocking,
    syncAttemptState,
  ]);

  const waitForV2Acceptances = useCallback(async () => {
    let firstError: unknown;
    while (v2PendingAcceptancesRef.current.size > 0) {
      const settled = await Promise.allSettled([...v2PendingAcceptancesRef.current]);
      if (firstError === undefined) {
        const rejected = settled.find((entry) => entry.status === "rejected");
        if (rejected?.status === "rejected") firstError = rejected.reason;
      }
    }
    if (firstError !== undefined) throw firstError;
  }, []);

  const recordPendingMutationPersistenceError = useCallback(
    (
      error: unknown,
      pendingMutationCountForError: number,
      fallbackAttempt: StudentAttempt,
      source: DurablePersistTriggerSource,
      durablePersistResult: "failed" | "checkpoint_failed" = "failed"
    ) => {
      const renderedIdentity = renderedAttemptIdentityRef.current;
      if (
        renderedIdentity.attemptId !== fallbackAttempt.id ||
        renderedIdentity.scheduleId !== fallbackAttempt.scheduleId ||
        attemptRef.current?.id !== fallbackAttempt.id ||
        attemptRef.current?.scheduleId !== fallbackAttempt.scheduleId
      ) {
        return;
      }
      const erroredAttempt = mergeAttempt(attemptRef.current ?? fallbackAttempt, {
        recovery: {
          syncState: "error",
          pendingMutationCount: pendingMutationCountForError,
        },
      });
      syncAttemptState(erroredAttempt);
      setStorageDurabilityBlocking(true);
      emitStudentObservabilityMetric(
        "student_pending_persist_failure_total",
        withStudentObservabilityDimensions({
          scheduleId: scheduleId ?? fallbackAttempt.scheduleId,
          attemptId: fallbackAttempt.id,
          endpoint: "/v1/student/sessions/:scheduleId/mutations:pending",
          statusCode: null,
          reason: error instanceof Error ? error.message : "pending_mirror_persist_failed",
          syncState: "error",
          lifecycleEventSource: source,
          durablePersistResult,
          browserEngine: detectBrowserEngine(),
          platform:
            typeof navigator !== "undefined"
              ? ((
                  navigator as Navigator & {
                    userAgentData?: {
                      platform?: string;
                    };
                  }
                ).userAgentData?.platform ?? navigator.platform)
              : "unknown",
          deviceClass: detectClientDeviceClass(),
          pendingMutationAgeMs: (() => {
            let oldest = Number.POSITIVE_INFINITY;
            for (const mutation of durabilityMirrorRef.current?.getPendingMutations() ?? []) {
              const ts = Date.parse(mutation.timestamp);
              if (Number.isFinite(ts) && ts < oldest) {
                oldest = ts;
              }
            }
            return Number.isFinite(oldest) ? Math.max(0, Date.now() - oldest) : null;
          })(),
          pendingMutationCount: pendingMutationCountForError,
        })
      );
      void saveStudentAuditEvent(
        scheduleId ?? fallbackAttempt.scheduleId,
        "PERSISTENCE_STORAGE_ERROR",
        {
          message: error instanceof Error ? error.message : "Failed to persist pending mutations",
          pendingMutationCount: pendingMutationCountForError,
          lifecycleEventSource: source,
          durablePersistResult,
        },
        fallbackAttempt.id
      );
    },
    [scheduleId, setStorageDurabilityBlocking, syncAttemptState]
  );

  if (!durabilityMirrorRef.current) {
    durabilityMirrorRef.current = new PendingMutationDurabilityMirror({
      debounceMs: ANSWER_DURABLE_WRITE_DEBOUNCE_MS,
      getAttempt: () => attemptRef.current,
      savePendingMutations: (attemptId, mutations) =>
        studentAttemptRepository.savePendingMutations(attemptId, mutations),
      clearPendingMutations: (attemptId) =>
        studentAttemptRepository.clearPendingMutations(attemptId),
      setStorageDurabilityBlocking,
      onPersistError: recordPendingMutationPersistenceError,
      onPendingMutationCountChange: (count) => setPendingMutationCount(count),
    });
  }

  const flushAnswerDurableMirrorNow = useCallback((source: DurablePersistTriggerSource) => {
    durabilityMirrorRef.current?.flushAnswerDurableMirrorNow(source);
  }, []);

  const setPendingMutations = useCallback(
    (
      nextMutations: StudentAttemptMutation[],
      options?: {
        durableWriteMode?: "immediate" | "debounced";
        includesAnswerMutation?: boolean;
        awaitPersistence?: boolean;
        source?: DurablePersistTriggerSource;
      }
    ): Promise<boolean> | void => {
      return durabilityMirrorRef.current?.setPendingMutations(nextMutations, options);
    },
    []
  );

  const scheduleFlush = useCallback((kind: "objective" | "writing", delayMs: number) => {
    const timeoutRef = kind === "writing" ? writingFlushTimeoutRef : objectiveFlushTimeoutRef;

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      void flushPendingRef.current();
    }, delayMs);
  }, []);

  const applyPatch = useCallback(
    async (
      patch: AttemptPatch,
      mutationType: StudentAttemptMutationType,
      delayMs: number,
      payload: StudentAttemptMutationPayload<StudentAttemptMutationType>
    ) => {
      const currentAttempt = attemptRef.current;
      const renderedIdentity = renderedAttemptIdentityRef.current;
      if (
        !currentAttempt ||
        currentAttempt.id !== renderedIdentity.attemptId ||
        currentAttempt.scheduleId !== renderedIdentity.scheduleId
      ) {
        return;
      }

      const timestamp = new Date().toISOString();
      if (!persistenceEnabled) {
        const nextAttempt = mergeAttempt(currentAttempt, {
          ...patch,
          recovery: {
            ...patch.recovery,
            lastLocalMutationAt: timestamp,
            lastPersistedAt: timestamp,
            pendingMutationCount: 0,
            syncState: "idle",
          },
        });
        syncAttemptState(nextAttempt);
        return;
      }

      const isObjectiveMutation =
        mutationType === "answer" || mutationType === "flag" || mutationType === "writing_answer";
      const runtimeModule =
        runtimeLiveRef.current.runtimeSnapshot?.currentSectionKey ??
        runtimeLiveRef.current.currentModule ??
        null;
      const authoritativeModule = runtimeModule ?? currentAttempt.currentModule;
      const terminalState = isVerifiedTerminalStudentState({
        attempt: currentAttempt,
        runtimeSnapshot: null,
      });
      const existingModule = isObjectiveMutation
        ? (payload as { module?: unknown }).module
        : undefined;
      const payloadWithModule: StudentAttemptMutationPayload<StudentAttemptMutationType> =
        isObjectiveMutation &&
        (typeof existingModule !== "string" || existingModule.trim().length === 0)
          ? {
              ...payload,
              module: authoritativeModule,
            }
          : payload;
      const reportedRemaining =
        runtimeLiveRef.current.runtimeSnapshot?.currentSectionRemainingSeconds ??
        runtimeLiveRef.current.displayTimeRemaining ??
        runtimeLiveRef.current.timeRemaining;
      const forceImmediateDurability =
        isObjectiveMutation &&
        runtimeLiveRef.current.phase === "exam" &&
        Number.isFinite(reportedRemaining) &&
        reportedRemaining >= 0 &&
        reportedRemaining <= BOUNDARY_IMMEDIATE_DURABILITY_THRESHOLD_SECONDS;
      const mutation: StudentAttemptMutation = {
        id: generateId("mutation"),
        attemptId: currentAttempt.id,
        scheduleId: currentAttempt.scheduleId,
        timestamp,
        type: mutationType,
        payload: payloadWithModule,
      } as StudentAttemptMutation;
      const enqueue = buildQueuedMutationUpdate({
        currentAttempt,
        pending: durabilityMirrorRef.current?.getPendingMutations() ?? [],
        mutation,
        // V2 response writes own the server acknowledgement/status. Position,
        // violation, and device metadata are retained in the local recovery
        // mirror, but they are not V2 response batches and must not reset a
        // confirmed response to a perpetual "saving" state.
        patchSyncState:
          terminalState !== "not_terminal" ||
          (currentAttempt.protocolVersion === 2 && !isObjectiveMutation && mutationType !== "network")
            ? currentAttempt.recovery.syncState
            : patch.recovery?.syncState,
        online: navigator.onLine,
        flushDelayMs: forceImmediateDurability ? 0 : delayMs,
        forceImmediateDurability,
      });
      setPendingMutations(enqueue.nextPendingMutations, {
        durableWriteMode: enqueue.durableWriteMode,
        includesAnswerMutation: enqueue.includesAnswerMutation,
        source: "mutation",
      });

      const syncState: AttemptSyncState =
        terminalState !== "not_terminal" ||
        (currentAttempt.protocolVersion === 2 && !isObjectiveMutation && mutationType !== "network")
          ? currentAttempt.recovery.syncState
          : enqueue.syncState;
      const nextAttempt = mergeAttempt(currentAttempt, {
        ...patch,
        recovery: {
          ...patch.recovery,
          lastLocalMutationAt: timestamp,
          pendingMutationCount: enqueue.nextPendingMutations.length,
          syncState,
        },
      });

      syncAttemptState(nextAttempt);

      if (enqueue.flush) {
        scheduleFlush(enqueue.flush.kind, enqueue.flush.delayMs);
      }
    },
    [persistenceEnabled, runtimeLiveRef, scheduleFlush, setPendingMutations, syncAttemptState]
  );

  const flushPending = useCallback(async () => {
    if (flushInFlightRef.current) {
      return flushInFlightRef.current;
    }

    const generation = v2IdentityGenerationRef.current;
    const expectedIdentity = renderedAttemptIdentityRef.current;
    const isCurrent = () => {
      const renderedIdentity = renderedAttemptIdentityRef.current;
      return (
        v2IdentityGenerationRef.current === generation &&
        renderedIdentity.attemptId === expectedIdentity.attemptId &&
        renderedIdentity.scheduleId === expectedIdentity.scheduleId &&
        attemptRef.current?.id === expectedIdentity.attemptId &&
        attemptRef.current?.scheduleId === expectedIdentity.scheduleId
      );
    };
    if (!isCurrent()) return false;

    const promise = (async () => {
      // V2 is the only durability engine: responses flush through the V2
      // engine and non-response mutations persist via the durability mirror.
      await waitForV2Acceptances();
      if (!isCurrent()) return false;
      const ready = v2ReadyRef.current;
      if (ready) await ready;
      if (!isCurrent()) return false;
      const engine = v2EngineRef.current;
      if (
        !engine ||
        engine.attemptId !== expectedIdentity.attemptId ||
        engine.scheduleId !== expectedIdentity.scheduleId
      )
        return false;
      await engine.flush();
      if (!isCurrent() || engine.getPendingCount() > 0) return false;
      return true;
    })();

    flushInFlightRef.current = promise;
    try {
      return await promise;
    } finally {
      if (flushInFlightRef.current === promise) {
        flushInFlightRef.current = null;
      }
    }
  }, [
    persistenceEnabled,
    setRuntimeAttemptSyncState,
    setStorageDurabilityBlocking,
    syncAttemptState,
    waitForV2Acceptances,
  ]);

  // Keep flushPending stable via refs: flushPending reads attemptRef/durabilityMirrorRef (not snapshot closure).
  // Assign synchronously so timeouts always call latest flushPending without stale attemptId.
  flushPendingRef.current = flushPending;

  // Cancellation on attempt switch: drop in-flight flush promise so next flush uses new attempt.
  // Mirror reset is handled by the hydration effect below; this just clears the in-flight gate.
  useEffect(() => {
    flushInFlightRef.current = null;
  }, [attemptSnapshot?.id]);

  useEffect(() => {
    const handleFocusOut = (event: FocusEvent) => {
      if (!isEditableDomTarget(event.target)) {
        return;
      }
      flushAnswerDurableMirrorNow("focusout");
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") {
        return;
      }
      flushAnswerDurableMirrorNow("visibility_hidden");
    };

    const handlePageHide = () => {
      flushAnswerDurableMirrorNow("pagehide");
    };

    const handleBeforeUnload = () => {
      flushAnswerDurableMirrorNow("beforeunload");
    };

    const handleFreeze = () => {
      flushAnswerDurableMirrorNow("freeze");
    };

    const handleWindowBlur = () => {
      flushAnswerDurableMirrorNow("window_blur");
    };

    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("freeze", handleFreeze as EventListener);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("freeze", handleFreeze as EventListener);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [flushAnswerDurableMirrorNow]);

  useEffect(() => {
    if (!attemptSnapshot) {
      attemptRef.current = null;
      observedPositionRef.current = JSON.stringify({
        phase: "pre-check",
        currentModule: "listening",
        currentQuestionId: null,
      });
      observedViolationsRef.current = JSON.stringify([]);
      setRuntimeAttemptSyncState("idle");
      setAttempt(null);
      setPendingMutationCount(0);
      setDurabilityLeaseConflict(false);
      durabilityMirrorRef.current?.reset();
      return;
    }

    if (!persistenceEnabled) {
      const currentAttempt = attemptRef.current;
      const sameAttempt = currentAttempt?.id === attemptSnapshot.id;
      const ephemeralAttempt: StudentAttempt =
        sameAttempt && currentAttempt
          ? {
              ...currentAttempt,
              proctorStatus: attemptSnapshot.proctorStatus,
              proctorNote: attemptSnapshot.proctorNote,
              proctorUpdatedAt: attemptSnapshot.proctorUpdatedAt,
              proctorUpdatedBy: attemptSnapshot.proctorUpdatedBy,
              lastWarningId: attemptSnapshot.lastWarningId ?? currentAttempt.lastWarningId,
              lastAcknowledgedWarningId:
                currentAttempt.lastAcknowledgedWarningId ??
                attemptSnapshot.lastAcknowledgedWarningId,
              violations: mergeViolationsById(
                currentAttempt.violations ?? [],
                attemptSnapshot.violations ?? []
              ),
              recovery: {
                ...currentAttempt.recovery,
                pendingMutationCount: 0,
                syncState: "idle" as AttemptSyncState,
              },
            }
          : mergeAttempt(attemptSnapshot, {
              recovery: {
                pendingMutationCount: 0,
                syncState: "idle" as AttemptSyncState,
              },
            });
      attemptRef.current = ephemeralAttempt;
      setAttempt(ephemeralAttempt);
      observedPositionRef.current = JSON.stringify({
        phase: ephemeralAttempt.phase,
        currentModule: ephemeralAttempt.currentModule,
        currentQuestionId: ephemeralAttempt.currentQuestionId,
      });
      observedViolationsRef.current = JSON.stringify(ephemeralAttempt.violations ?? []);
      setRuntimeAttemptSyncState("idle");
      setPendingMutationCount(0);
      durabilityMirrorRef.current?.reset();
      return;
    }

    // V2 is the only durability engine: hydrate response-visible state from the
    // engine and merge non-response metadata from the fresh snapshot.
    {
      const snapshotKey = JSON.stringify([
        attemptSnapshot.id,
        attemptSnapshot.phase,
        attemptSnapshot.deliveryStatus,
        attemptSnapshot.submittedAt,
        attemptSnapshot.finalSubmission?.submissionId,
        attemptSnapshot.proctorStatus,
        attemptSnapshot.proctorNote,
        attemptSnapshot.leaseEpoch,
        attemptSnapshot.controlEpoch,
        attemptSnapshot.deadlineAt,
        attemptSnapshot.closingGraceUntil,
        attemptSnapshot.activeClientSessionId,
      ]);
      if (
        v2HydratedSnapshotKeyRef.current === snapshotKey &&
        attemptRef.current?.id === attemptSnapshot.id
      ) {
        return;
      }
      v2HydratedSnapshotKeyRef.current = snapshotKey;
      setDurabilityLeaseConflict(false);
      const currentAttempt = attemptRef.current;
      const nextAttempt =
        currentAttempt?.id === attemptSnapshot.id
          ? (() => {
              const {
                answers: _remoteAnswers,
                writingAnswers: _remoteWritingAnswers,
                flags: _remoteFlags,
                ...remoteMetadata
              } = attemptSnapshot;
              return mergeAttempt(currentAttempt, {
                ...remoteMetadata,
                recovery: {
                  ...attemptSnapshot.recovery,
                  pendingMutationCount: v2EngineRef.current?.getPendingCount() ?? 0,
                  syncState: currentAttempt.recovery.syncState,
                },
              });
            })()
          : attemptSnapshot;
      attemptRef.current = nextAttempt;
      setAttempt(nextAttempt);
      setPendingMutationCount(v2EngineRef.current?.getPendingCount() ?? 0);
      setRuntimeAttemptSyncState(nextAttempt.recovery.syncState);
      durabilityMirrorRef.current?.reset();
      return;
    }
  }, [
    attemptSnapshot,
    flushPending,
    persistenceEnabled,
    runtimeState.runtimeSnapshot,
    setRuntimeAttemptSyncState,
    syncAttemptState,
  ]);

  useEffect(() => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      return;
    }

    const verifiedTerminalState = isVerifiedTerminalStudentState({
      attempt: currentAttempt,
      runtimeSnapshot: runtimeState.runtimeSnapshot,
    });
    const effectivePhase =
      runtimeState.runtimeBacked &&
      runtimeState.phase === "post-exam" &&
      verifiedTerminalState === "not_terminal"
        ? "exam"
        : runtimeState.phase;
    const nextPosition = JSON.stringify({
      phase: effectivePhase,
      currentModule: runtimeState.currentModule,
      currentQuestionId: runtimeState.currentQuestionId,
    });
    const nextViolations = JSON.stringify(runtimeState.violations);

    const objectivePatch: AttemptPatch = {};

    if (
      nextViolations !== observedViolationsRef.current &&
      JSON.stringify(currentAttempt.violations) !== nextViolations
    ) {
      objectivePatch.violations = runtimeState.violations;
    }

    if (nextPosition !== observedPositionRef.current) {
      objectivePatch.phase = effectivePhase;
      objectivePatch.currentModule = runtimeState.currentModule;
      objectivePatch.currentQuestionId = runtimeState.currentQuestionId;
    }

    if (objectivePatch.violations) {
      void applyPatch(objectivePatch, "violation", 400, {
        changedAreas: ["violation"],
        violations: runtimeState.violations,
      });
    }

    if (nextPosition !== observedPositionRef.current) {
      void applyPatch(objectivePatch, "position", 400, {
        changedAreas: ["position"],
        phase: effectivePhase,
        currentModule: runtimeState.currentModule,
        currentQuestionId: runtimeState.currentQuestionId,
      });
    }

    observedPositionRef.current = nextPosition;
    observedViolationsRef.current = nextViolations;
  }, [
    applyPatch,
    runtimeState.currentModule,
    runtimeState.currentQuestionId,
    runtimeState.phase,
    runtimeState.violations,
    runtimeState.runtimeBacked,
    runtimeState.runtimeSnapshot,
  ]);

  useEffect(() => {
    return () => {
      if (objectiveFlushTimeoutRef.current) {
        window.clearTimeout(objectiveFlushTimeoutRef.current);
      }
      if (writingFlushTimeoutRef.current) {
        window.clearTimeout(writingFlushTimeoutRef.current);
      }
      durabilityMirrorRef.current?.cancelDebouncedPersist();
    };
  }, []);

  const enqueueV2Response = useCallback(
    (
      questionId: string,
      payload: ResponsePayload,
      kind: "answer" | "writing" | "flag",
      patch: AttemptPatch
    ) => {
      const generation = v2IdentityGenerationRef.current;
      const renderedIdentity = renderedAttemptIdentityRef.current;
      const currentAttempt = attemptRef.current;
      if (
        !currentAttempt ||
        currentAttempt.id !== renderedIdentity.attemptId ||
        currentAttempt.scheduleId !== renderedIdentity.scheduleId
      ) {
        return;
      }
      v2FieldKindRef.current.set(questionId, kind);
      syncAttemptState(mergeAttempt(currentAttempt, patch));
      const send = async () => {
        if (!v2EngineRef.current) {
          const ready = v2ReadyRef.current;
          if (ready) await ready;
        }
        const engine = v2EngineRef.current;
        if (
          !engine ||
          engine.attemptId !== renderedIdentity.attemptId ||
          engine.scheduleId !== renderedIdentity.scheduleId ||
          v2IdentityGenerationRef.current !== generation
        )
          return;
        await engine.acceptResponse(questionId, payload);
      };
      const acceptance = send();
      v2PendingAcceptancesRef.current.add(acceptance);
      void acceptance.then(
        () => v2PendingAcceptancesRef.current.delete(acceptance),
        () => v2PendingAcceptancesRef.current.delete(acceptance)
      );
      void acceptance.catch((error: unknown) => {
        if (v2IdentityGenerationRef.current !== generation) return;
        const current = attemptRef.current;
        if (current) {
          syncAttemptState(
            mergeAttempt(current, {
              recovery: {
                syncState: "error",
              },
            })
          );
        }
        setStorageDurabilityBlocking(true);
        void error;
      });
    },
    [setStorageDurabilityBlocking, syncAttemptState]
  );

  const durablePayloadForQuestion = useCallback((questionId: string): ResponsePayload => {
    const state = v2EngineRef.current?.getStates().get(questionId);
    const visible = state ? getVisibleResponse(state) : null;
    const currentAttempt = attemptRef.current;
    const fallbackAnswer = Object.prototype.hasOwnProperty.call(
      currentAttempt?.writingAnswers ?? {},
      questionId
    )
      ? (currentAttempt?.writingAnswers[questionId] ?? null)
      : (currentAttempt?.answers[questionId] ?? null);
    return {
      // `null` is an authoritative V2 clear; only fall back when no V2
      // response state exists at all.
      answer: visible ? visible.answer : fallbackAnswer,
      markedForReview: visible?.markedForReview ?? currentAttempt?.flags[questionId] ?? false,
      eliminatedOptions: visible ? [...visible.eliminatedOptions] : [],
      annotations: visible ? visible.annotations.map((annotation) => ({ ...annotation })) : [],
    };
  }, []);

  const persistAnswer = useCallback(
    (questionId: string, answer: StudentAnswerValue, meta?: StudentAnswerMutationMeta) => {
      void meta;
      enqueueV2Response(
        questionId,
        {
          ...durablePayloadForQuestion(questionId),
          answer,
        },
        "answer",
        { answers: { [questionId]: answer } }
      );
    },
    [durablePayloadForQuestion, enqueueV2Response]
  );

  const persistWritingAnswer = useCallback(
    (taskId: string, text: string) => {
      enqueueV2Response(
        taskId,
        {
          ...durablePayloadForQuestion(taskId),
          answer: text,
        },
        "writing",
        { writingAnswers: { [taskId]: text } }
      );
    },
    [durablePayloadForQuestion, enqueueV2Response]
  );

  const persistFlag = useCallback(
    (questionId: string, flagged: boolean) => {
      enqueueV2Response(
        questionId,
        {
          ...durablePayloadForQuestion(questionId),
          markedForReview: flagged,
        },
        "flag",
        { flags: { [questionId]: flagged } }
      );
    },
    [durablePayloadForQuestion, enqueueV2Response]
  );

  const persistViolation = useCallback(
    (violation: Violation) => {
      const currentAttempt = attemptRef.current;
      if (!currentAttempt) {
        return;
      }

      const nextViolations = currentAttempt.violations.some(
        (candidate) => candidate.id === violation.id
      )
        ? currentAttempt.violations
        : [...currentAttempt.violations, violation];

      void applyPatch(
        {
          violations: nextViolations,
        },
        "violation",
        400,
        {
          violationId: violation.id,
          violationType: violation.type,
          violations: nextViolations,
        }
      );
    },
    [applyPatch]
  );

  const persistPosition = useCallback(
    (
      currentModule: ModuleType,
      currentQuestionId: string | null,
      phase: StudentAttempt["phase"]
    ) => {
      void applyPatch(
        {
          currentModule,
          currentQuestionId,
          phase,
        },
        "position",
        400,
        {
          currentModule,
          currentQuestionId,
          phase,
        }
      );
    },
    [applyPatch]
  );

  const recordPreCheckResult = useCallback(
    async (result: StudentPreCheckResult) => {
      const currentAttempt = attemptRef.current;
      if (!currentAttempt) {
        throw new Error("Missing student attempt context.");
      }

      if (!persistenceEnabled) {
        syncAttemptState(
          mergeAttempt(currentAttempt, {
            integrity: {
              preCheck: result,
            },
            recovery: {
              syncState: "idle",
              pendingMutationCount: 0,
            },
          })
        );
        return;
      }

      const resolvedScheduleId = scheduleId ?? currentAttempt.scheduleId;
      const precheckIdempotencyKey = [
        currentAttempt.id,
        ensureClientSessionIdForAttempt(currentAttempt),
        result.completedAt,
      ].join(":");

      try {
        const persisted = await backendPost<any>(
          `/v1/student/sessions/${resolvedScheduleId}/precheck`,
          {
            attemptId: currentAttempt.id,
            studentKey: currentAttempt.studentKey,
            candidateId: currentAttempt.candidateId,
            candidateName: currentAttempt.candidateName,
            candidateEmail: currentAttempt.candidateEmail,
            clientSessionId: ensureClientSessionIdForAttempt(currentAttempt),
            preCheck: result,
            deviceFingerprintHash: currentAttempt.integrity.deviceFingerprintHash ?? undefined,
          },
          {
            retries: 0,
            headers: {
              "Idempotency-Key": precheckIdempotencyKey,
            },
          }
        );
        const nextAttempt = mapBackendStudentAttempt(persisted);
        // The pre-check POST is authoritative in runtime-backed delivery. Any locally queued
        // mutations generated during the pre-check UI can be safely discarded to avoid replaying
        // overlapping mutation sequences during bootstrap/polling races.
        await studentAttemptRepository.clearPendingMutations(nextAttempt.id);
        await studentAttemptRepository.saveAttempt(nextAttempt);
        syncAttemptState(nextAttempt);
      } catch (error) {
        syncAttemptState(
          mergeAttempt(currentAttempt, {
            recovery: {
              syncState: "error",
            },
          })
        );
        throw error instanceof Error ? error : new Error("Failed to save system check.");
      }

      await saveStudentAuditEvent(resolvedScheduleId, "PRECHECK_COMPLETED", {
        completedAt: result.completedAt,
        checks: result.checks,
        acknowledgedSafariLimitation: result.acknowledgedSafariLimitation,
      });

      if (result.acknowledgedSafariLimitation) {
        await saveStudentAuditEvent(resolvedScheduleId, "PRECHECK_WARNING_ACKNOWLEDGED", {
          completedAt: result.completedAt,
        });
      }
    },
    [applyPatch, persistenceEnabled, scheduleId, syncAttemptState]
  );

  const recordNetworkStatus = useCallback(
    async (status: "offline" | "online", timestamp = new Date().toISOString()) => {
      await applyPatch(
        {
          integrity:
            status === "offline"
              ? {
                  lastDisconnectAt: timestamp,
                }
              : {
                  lastReconnectAt: timestamp,
                },
          recovery: {
            syncState: status === "offline" ? "offline" : "syncing_reconnect",
          },
        },
        "network",
        0,
        {
          status,
          timestamp,
        }
      );
    },
    [applyPatch]
  );

  const recordHeartbeat = useCallback(
    async (type: HeartbeatEventType, payload?: Record<string, unknown>) => {
      if (!persistenceEnabled) {
        return;
      }

      const currentAttempt = attemptRef.current;
      if (!currentAttempt) {
        return;
      }

      const heartbeatEvent = buildStudentHeartbeatEvent(
        currentAttempt.id,
        currentAttempt.scheduleId,
        type,
        payload
      );
      await studentAttemptRepository.saveHeartbeatEvent(heartbeatEvent);
    },
    [persistenceEnabled]
  );

  const acknowledgeProctorWarning = useCallback(
    async (warningId: string) => {
      const currentAttempt = attemptRef.current;
      if (!currentAttempt || currentAttempt.lastAcknowledgedWarningId === warningId) {
        return;
      }

      const nextAttempt = mergeAttempt(currentAttempt, {
        lastAcknowledgedWarningId: warningId,
        proctorStatus:
          currentAttempt.proctorStatus === "warned" ? "active" : currentAttempt.proctorStatus,
        proctorUpdatedAt: new Date().toISOString(),
        proctorUpdatedBy: "Candidate",
      });

      if (!persistenceEnabled) {
        syncAttemptState(nextAttempt);
        return;
      }

      await studentAttemptRepository.saveAttempt(nextAttempt);
      syncAttemptState(nextAttempt);
      await saveStudentAuditEvent(
        scheduleId,
        "ALERT_ACKNOWLEDGED",
        {
          warningId,
        },
        currentAttempt.id
      );
    },
    [persistenceEnabled, scheduleId, syncAttemptState]
  );

  const scheduleBackgroundSubmitRetry = useCallback(
    (seedAttempt: StudentAttempt) => {
      if (!persistenceEnabled) {
        return;
      }

      if (backgroundSubmitInFlightRef.current) {
        return;
      }

      const generation = v2IdentityGenerationRef.current;
      const expectedIdentity = renderedAttemptIdentityRef.current;
      const isCurrent = () => {
        const renderedIdentity = renderedAttemptIdentityRef.current;
        return (
          v2IdentityGenerationRef.current === generation &&
          renderedIdentity.attemptId === expectedIdentity.attemptId &&
          renderedIdentity.scheduleId === expectedIdentity.scheduleId &&
          expectedIdentity.attemptId === seedAttempt.id &&
          attemptRef.current?.id === seedAttempt.id &&
          attemptRef.current?.scheduleId === seedAttempt.scheduleId
        );
      };
      if (!isCurrent()) return;

      // Durable, connectivity-gated final-submission retry. There is
      // deliberately no time cap: once the user has authorized final
      // submission with an unknown server outcome, the client keeps enough
      // durable intent (the persisted attempt state plus the deterministic
      // `student-submit-{attemptId}` idempotency key, or the V2 engine
      // durable command) to verify or retry whenever connectivity returns,
      // for the lifetime of the attempt. Reload resumes the loop through the
      // resume effect below.
      const promise = (async () => {
        let retryDelayMs = 5_000;

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, retryDelayMs);
        });

        while (isCurrent()) {
          if (!navigator.onLine) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, retryDelayMs);
            });
            if (!isCurrent()) return;
            retryDelayMs = Math.min(retryDelayMs * 2, 60_000);
            continue;
          }

          const candidateAttempt = attemptRef.current;
          if (!candidateAttempt) return;
          if (!candidateAttempt.recovery.finalSubmissionPending) {
            // Another path (hydration, verification, manual retry) resolved
            // the submission while this loop was waiting.
            return;
          }
          if (candidateAttempt.submittedAt) {
            // The attempt is already terminal (for example a replay of a
            // committed submit after reconnect): confirm locally and stop.
            syncAttemptState(
              mergeAttempt(candidateAttempt, {
                recovery: {
                  finalSubmissionPending: false,
                },
              })
            );
            void queryClient.invalidateQueries();
            return;
          }
          try {
            const flushed = await flushPending();
            if (!flushed || !isCurrent()) return;
            const ready = v2ReadyRef.current;
            if (ready) await ready;
            if (!isCurrent()) return;
            const engine = v2EngineRef.current;
            if (!engine) throw new Error("V2 response durability engine is not ready.");
            const submitted = await engine.submit(candidateAttempt.id, engine.getAttemptRevision());
            if (!isCurrent()) return;
            const submittedAt =
              submitted.submittedAt ??
              attemptRef.current?.submittedAt ??
              candidateAttempt.submittedAt ??
              new Date().toISOString();
            const submittedAttempt = mergeAttempt(attemptRef.current ?? candidateAttempt, {
              phase: "post-exam",
              submittedAt,
              responseRevision: submitted.attemptRevision,
              finalResponseDigest: submitted.finalResponseDigest,
              finalSubmission: {
                submissionId: submitted.submissionId,
                submittedAt,
              },
              recovery: {
                finalSubmissionPending: false,
                pendingMutationCount: 0,
                syncState: "saved",
              },
            });
            if (!isCurrent()) return;
            runtimeActions.setPhase("post-exam");
            syncAttemptState(submittedAttempt);
            void queryClient.invalidateQueries();
            return;
          } catch (error) {
            if (!isCurrent()) return;
            {
              const engine = v2EngineRef.current;
              if (
                engine?.getStatus() === "conflict_fenced" ||
                engine?.getStatus() === "conflict_terminal"
              ) {
                return;
              }
            }
            const statusCode =
              typeof error === "object" && error !== null && "statusCode" in error
                ? (error as { statusCode?: unknown }).statusCode
                : undefined;
            const reason = backendConflictReason(error);
            // Permanent outcomes stop the automatic loop: the attempt is
            // terminal on the server under a different outcome (for example
            // proctor termination) or the session can no longer authorize
            // this submission. The durable pending marker stays so the
            // explicit retry action or fresh hydration resolves the state.
            if (
              statusCode === 401 ||
              statusCode === 403 ||
              (statusCode === 409 && reason === null)
            ) {
              return;
            }
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, retryDelayMs);
            });
            retryDelayMs = Math.min(retryDelayMs * 2, 60_000);
          }
        }
      })();

      backgroundSubmitInFlightRef.current = promise;
      void promise.finally(() => {
        if (backgroundSubmitInFlightRef.current === promise) {
          backgroundSubmitInFlightRef.current = null;
        }
      });
    },
    [flushPending, persistenceEnabled, runtimeActions, syncAttemptState]
  );

  const takeOverDurabilityLease = useCallback(
    async (reason = "Candidate explicitly requested lease takeover"): Promise<boolean> => {
      const generation = v2IdentityGenerationRef.current;
      const renderedIdentity = renderedAttemptIdentityRef.current;
      const currentAttempt = attemptRef.current;
      const engine = v2EngineRef.current;
      if (
        !currentAttempt ||
        !engine ||
        v2IdentityGenerationRef.current !== generation ||
        currentAttempt.id !== renderedIdentity.attemptId ||
        currentAttempt.scheduleId !== renderedIdentity.scheduleId ||
        engine.attemptId !== renderedIdentity.attemptId ||
        engine.scheduleId !== renderedIdentity.scheduleId ||
        currentAttempt.id !== controlAttemptIdRef.current
      )
        return false;

      const previousClientSessionId = ensureClientSessionIdForAttempt(currentAttempt);
      const nextClientSessionId = rotateClientSessionIdForAttempt(currentAttempt);
      let takeoverAccepted = false;
      let takeover: Awaited<ReturnType<typeof takeOverResponseDurabilityLease>>;
      try {
        takeover = await takeOverResponseDurabilityLease(
          currentAttempt.scheduleId,
          currentAttempt.id,
          {
            clientSessionId: nextClientSessionId,
            reason,
          },
          currentAttempt
        );
        takeoverAccepted = true;
      } catch (error) {
        if (!takeoverAccepted) {
          restoreClientSessionIdForAttempt(currentAttempt, previousClientSessionId);
        }
        if (v2IdentityGenerationRef.current === generation) {
          syncAttemptState(
            mergeAttempt(currentAttempt, {
              recovery: { syncState: "error" },
            })
          );
        }
        void error;
        return false;
      }

      if (
        v2IdentityGenerationRef.current !== generation ||
        renderedAttemptIdentityRef.current.attemptId !== currentAttempt.id ||
        renderedAttemptIdentityRef.current.scheduleId !== currentAttempt.scheduleId
      )
        return false;
      const currentEngine = v2EngineRef.current;
      if (
        !currentEngine ||
        currentEngine.attemptId !== currentAttempt.id ||
        currentEngine.scheduleId !== currentAttempt.scheduleId
      )
        return false;
      currentEngine.updateEpochs(takeover.leaseEpoch, currentEngine.getControlEpoch());
      const nextAttempt = mergeAttempt(attemptRef.current ?? currentAttempt, {
        activeClientSessionId: takeover.clientSessionId,
        leaseEpoch: takeover.leaseEpoch,
        integrity: { clientSessionId: takeover.clientSessionId },
        recovery: {
          clientSessionId: takeover.clientSessionId,
          syncState: "saved",
        },
      });
      setDurabilityLeaseConflict(false);
      syncAttemptState(nextAttempt);

      try {
        await currentEngine.recover();
      } catch (error) {
        if (
          v2IdentityGenerationRef.current === generation &&
          v2EngineRef.current === currentEngine
        ) {
          syncAttemptState(
            mergeAttempt(attemptRef.current ?? nextAttempt, {
              recovery: { syncState: "error" },
            })
          );
        }
        void error;
      }
      return (
        v2IdentityGenerationRef.current === generation && v2EngineRef.current === currentEngine
      );
    },
    [syncAttemptState]
  );

  const submitAttempt = useCallback(async (): Promise<boolean> => {
    const currentAttempt = attemptRef.current;
    const renderedIdentity = renderedAttemptIdentityRef.current;
    if (
      !currentAttempt ||
      currentAttempt.id !== renderedIdentity.attemptId ||
      currentAttempt.scheduleId !== renderedIdentity.scheduleId
    ) {
      return false;
    }
    const generation = v2IdentityGenerationRef.current;
    const isCurrent = () =>
      v2IdentityGenerationRef.current === generation &&
      renderedAttemptIdentityRef.current.attemptId === currentAttempt.id &&
      renderedAttemptIdentityRef.current.scheduleId === currentAttempt.scheduleId &&
      attemptRef.current?.id === currentAttempt.id &&
      attemptRef.current?.scheduleId === currentAttempt.scheduleId;

    const latestAttempt = attemptRef.current ?? currentAttempt;
    if (!persistenceEnabled) {
      // Preview mode intentionally completes locally; production submissions must use the server receipt path below.
      const submittedAttempt = mergeAttempt(latestAttempt, {
        phase: "post-exam",
        submittedAt: new Date().toISOString(),
        recovery: {
          syncState: "idle",
          pendingMutationCount: 0,
        },
      });
      if (!isCurrent()) return false;
      runtimeActions.setPhase("post-exam");
      syncAttemptState(submittedAttempt);
      return true;
    }

    try {
      const flushed = await flushPending();
      if (!isCurrent()) return false;
      if (!flushed) {
        throw new Error("Not all attempt changes were durably saved.");
      }
      const ready = v2ReadyRef.current;
      if (ready) await ready;
      const engine = v2EngineRef.current;
      if (
        !isCurrent() ||
        !engine ||
        engine.attemptId !== currentAttempt.id ||
        engine.scheduleId !== currentAttempt.scheduleId
      )
        return false;
      // Submit gate (WP4/WP5): blocked/quarantined drafts must be resolved
      // or explicitly discarded before submit completes. engine.submit() also
      // enforces this provider-independently; surface the exam-stress-safe
      // warning here and refuse silent exclusion of drafts.
      // NOTE: the engine now provides reconcileBlocked(questionId),
      // discardBlocked(questionId), and getTombstonedQuestionIds(). The
      // recovery-panel buttons can call them via reconcileBlockedResponse
      // below; remaining work is future recovery-panel UI wiring only. The
      // gate stays: this provider-level failure message plus engine-side guard.
      let blockedCount = 0;
      let quarantined = 0;
      try {
        blockedCount = engine.getBlockedCount();
      } catch {
        blockedCount = 0;
      }
      try {
        quarantined = engine.getQuarantined().length;
      } catch {
        quarantined = 0;
      }
      if (blockedCount > 0 || quarantined > 0) {
        const blockedIds = (() => {
          try {
            return engine.getBlockedQuestionIds();
          } catch {
            return [];
          }
        })();
        setBlockedQuestionIds(blockedIds);
        setQuarantinedCount(quarantined);
        syncAttemptState(
          mergeAttempt(attemptRef.current ?? latestAttempt, {
            recovery: {
              pendingMutationCount: engine.getPendingCount(),
              syncState: "offline",
            },
          })
        );
        void saveStudentAuditEvent(currentAttempt.scheduleId, "SUBMIT_BLOCKED_NEEDS_ATTENTION", {
          blockedCount,
          quarantinedCount: quarantined,
        }, currentAttempt.id);
        // Shared exam-stress-safe gate copy (same function SAT uses). The
        // engine's own "Blocked drafts need attention before submit. ..."
        // guard stays as the provider-independent backstop below.
        throw new Error(blockedSubmitGateMessage(blockedCount, quarantined));
      }
      const submitted = await engine.submit(latestAttempt.id, engine.getAttemptRevision());
      if (!isCurrent()) return false;
      const submittedAt =
        submitted.submittedAt ?? latestAttempt.submittedAt ?? new Date().toISOString();
      const confirmedAttempt = mergeAttempt(attemptRef.current ?? latestAttempt, {
        phase: "post-exam",
        submittedAt,
        responseRevision: submitted.attemptRevision,
        finalResponseDigest: submitted.finalResponseDigest,
        finalSubmission: {
          submissionId: submitted.submissionId,
          submittedAt,
        },
        recovery: {
          finalSubmissionPending: false,
          pendingMutationCount: 0,
          syncState: "saved",
        },
      });
      runtimeActions.setPhase("post-exam");
      syncAttemptState(confirmedAttempt);
      void queryClient.invalidateQueries();
      return true;
    } catch (error) {
      if (!isCurrent()) return false;

      // Engine-gate backstop: if the provider-level gate above raced (a
      // control bump blocked a draft between the check and engine.submit),
      // the engine throws "Blocked drafts need attention before submit. ...".
      // Match that gate error and force the shared exam-stress-safe gate
      // copy — never a generic pending+retry failure — so the student sees
      // the actionable "kept on this device / ask your proctor" message.
      // The engine guard stays the provider-independent backstop.
      if (error instanceof Error && error.message.includes("Blocked drafts need attention")) {
        let backstopBlocked = 0;
        let backstopQuarantined = 0;
        const backstopEngine = v2EngineRef.current;
        try {
          backstopBlocked = backstopEngine?.getBlockedCount() ?? 0;
        } catch {
          backstopBlocked = 0;
        }
        try {
          backstopQuarantined = backstopEngine?.getQuarantined().length ?? 0;
        } catch {
          backstopQuarantined = 0;
        }
        try {
          setBlockedQuestionIds(backstopEngine?.getBlockedQuestionIds() ?? []);
        } catch {
          // Keep the last published ids; next publish refreshes them.
        }
        setQuarantinedCount(backstopQuarantined);
        syncAttemptState(
          mergeAttempt(attemptRef.current ?? latestAttempt, {
            recovery: {
              pendingMutationCount: backstopEngine?.getPendingCount() ?? 0,
              syncState: "offline",
            },
          })
        );
        void saveStudentAuditEvent(currentAttempt.scheduleId, "SUBMIT_BLOCKED_NEEDS_ATTENTION", {
          blockedCount: backstopBlocked,
          quarantinedCount: backstopQuarantined,
        }, currentAttempt.id);
        throw new Error(blockedSubmitGateMessage(backstopBlocked, backstopQuarantined));
      }

      // A proctor or worker may seal the attempt after the student's final
      // flush but before this submit request reaches the server. The V2
      // engine correctly fences that request; reconcile the canonical attempt
      // before exposing a retryable failure so the student sees completion
      // instead of an indefinite "Submitting" overlay.
      const engine = v2EngineRef.current;
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error
          ? (error as { statusCode?: unknown }).statusCode
          : undefined;
      // The API can return ATTEMPT_NOT_WRITABLE as a plain 422 before the
      // durability engine has classified the response. Treat submit-time
      // conflict statuses as reconciliation candidates too; the canonical
      // attempt decides whether the outcome is completed or terminated.
      const submitConflict =
        engine?.getStatus() === "conflict_terminal" || statusCode === 409 || statusCode === 422;
      if (submitConflict) {
        const canonical = await studentAttemptRepository
          .getCanonicalAttemptByScheduleId(currentAttempt.scheduleId, currentAttempt.studentKey)
          .catch(() => null);
        if (
          canonical &&
          isCurrent() &&
          isVerifiedTerminalStudentState({
            attempt: canonical,
            runtimeSnapshot: runtimeState.runtimeSnapshot,
          }) !== "not_terminal"
        ) {
          const terminalAttempt = mergeAttempt(canonical, {
            recovery: {
              finalSubmissionPending: false,
              pendingMutationCount: 0,
              syncState: "saved",
            },
          });
          runtimeActions.setPhase("post-exam");
          syncAttemptState(terminalAttempt);
          void queryClient.invalidateQueries();
          return true;
        }
      }

      const pendingAttempt = mergeAttempt(latestAttempt, {
        recovery: {
          finalSubmissionPending: true,
          syncState: "syncing_reconnect",
        },
      });
      syncAttemptState(pendingAttempt);
      // A permanent authorization failure cannot be retried automatically;
      // the UI keeps the durable pending state and offers the explicit
      // retry action.
      const permanentFailure = statusCode === 401 || statusCode === 403;
      if (!permanentFailure) {
        scheduleBackgroundSubmitRetry(pendingAttempt);
      }
      return false;
    }
  }, [
    flushPending,
    persistenceEnabled,
    runtimeActions,
    runtimeState.runtimeSnapshot,
    scheduleBackgroundSubmitRetry,
    syncAttemptState,
  ]);

  // Resume a pending final submission after reload or after the automatic
  // loop stopped for a permanent reason: durable pending intent must never
  // be abandoned just because the previous page lifetime ended.
  useEffect(() => {
    if (!persistenceEnabled) {
      return;
    }

    const candidate = attemptRef.current;
    if (!candidate?.recovery.finalSubmissionPending) {
      return;
    }
    if (backgroundSubmitInFlightRef.current) {
      return;
    }
    if (candidate.submittedAt) {
      syncAttemptState(
        mergeAttempt(candidate, {
          recovery: {
            finalSubmissionPending: false,
          },
        })
      );
      return;
    }
    scheduleBackgroundSubmitRetry(candidate);
  }, [
    attempt?.recovery.finalSubmissionPending,
    persistenceEnabled,
    scheduleBackgroundSubmitRetry,
    syncAttemptState,
  ]);

  const flushAnswerDurabilityNow = useCallback(() => {
    if (!persistenceEnabled) {
      return;
    }
    flushAnswerDurableMirrorNow("dom_rescue_commit");
  }, [flushAnswerDurableMirrorNow, persistenceEnabled]);

  const setDeviceFingerprintHash = useCallback(
    async (hash: string) => {
      await applyPatch(
        {
          integrity: {
            deviceFingerprintHash: hash,
          },
        },
        "device_fingerprint",
        0,
        {
          hash,
        }
      );
    },
    [applyPatch]
  );

  const flushHeartbeatEvents = useCallback(async () => {
    if (!persistenceEnabled) {
      return;
    }

    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      return;
    }

    await studentAttemptRepository.flushHeartbeatEvents(currentAttempt.id);
  }, [persistenceEnabled]);

  const dismissDroppedMutationsBanner = useCallback(async () => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      return;
    }

    if (!currentAttempt.recovery.lastDroppedMutations) {
      return;
    }

    const nextAttempt = mergeAttempt(currentAttempt, {
      recovery: {
        lastDroppedMutations: null,
      },
    });
    syncAttemptState(nextAttempt);
    if (!persistenceEnabled) {
      return;
    }
    await studentAttemptRepository.saveAttempt(nextAttempt).catch(() => {});
  }, [persistenceEnabled, syncAttemptState]);

  // Best-effort reconcile of one blocked question. Returns a reason union
  // ("reconciled" | "not-blocked" | "refusal" | `error:${string}`) so
  // callers can distinguish refusal (lease fence / terminal / server-newer /
  // superseded / in-progress) from a thrown exception. The engine provides
  // reconcileBlocked(questionId): boolean; call it directly and keep the
  // recover() fallback only under a typeof check — the engine is expected to
  // always provide reconcileBlocked, so the fallback is defensive only.
  // Never crashes and never imports storage internals (type-only engine
  // import at the top; no runtime/storage imports).
  const reconcileBlockedResponse = useCallback(
    async (questionId: string): Promise<ReconcileBlockedResult> => {
      const engine = v2EngineRef.current;
      if (!engine) return "not-blocked";
      if (!questionId.trim()) return "not-blocked";
      // Not blocked: nothing to do (covers already-reconciled/discarded).
      try {
        if (engine.getBlockedQuestionIds().includes(questionId) === false) return "not-blocked";
      } catch {
        // Reader threw: fall through and let the reconcile attempt decide.
      }
      const candidate = engine as unknown as {
        reconcileBlocked?: (id: string) => Promise<boolean>;
      };
      let reconciled: boolean;
      try {
        if (typeof candidate.reconcileBlocked === "function") {
          reconciled = await candidate.reconcileBlocked(questionId);
        } else {
          // Defensive fallback (engine always provides reconcileBlocked);
          // re-run recovery so a fresh snapshot re-seeds + re-publishes state.
          await engine.recover();
          reconciled = false;
        }
      } catch (error) {
        try {
          setBlockedQuestionIds(engine.getBlockedQuestionIds());
        } catch {
          // Keep the last published ids; next publish refreshes them.
        }
        const message = error instanceof Error ? error.message : String(error);
        return `error:${message}`;
      }
      // Refresh blocked ids on every outcome (including refusal) so the
      // badge cannot stick on stale ids.
      let remaining: string[] = [];
      try {
        remaining = engine.getBlockedQuestionIds();
        setBlockedQuestionIds(remaining);
      } catch {
        // Keep the last published ids; next publish refreshes them.
      }
      try {
        setQuarantinedCount(engine.getQuarantined().length);
      } catch {
        // Quarantine count is advisory only.
      }
      if (remaining.includes(questionId) === false) return "reconciled";
      // Still blocked afterwards: engine refused (returned false) or the
      // recover() fallback could not clear it.
      void reconciled;
      return "refusal";
    },
    []
  );

  const value = useMemo<StudentAttemptContextValue>(
    () => ({
      state: {
        attempt,
        attemptId: attempt?.id ?? null,
        lastLocalMutationAt: attempt?.recovery.lastLocalMutationAt ?? null,
        lastPersistedAt: attempt?.recovery.lastPersistedAt ?? null,
        pendingMutationCount,
        durabilityLeaseConflict,
        blockedQuestionIds,
        quarantinedCount,
      },
      actions: {
        persistAnswer,
        persistWritingAnswer,
        persistFlag,
        persistViolation,
        persistPosition,
        recordPreCheckResult,
        recordNetworkStatus,
        recordHeartbeat,
        acknowledgeProctorWarning,
        submitAttempt,
        takeOverDurabilityLease,
        setDeviceFingerprintHash,
        flushPending,
        reconcileBlockedResponse,
        flushAnswerDurabilityNow,
        flushHeartbeatEvents,
        dismissDroppedMutationsBanner,
      },
    }),
    [
      acknowledgeProctorWarning,
      attempt,
      blockedQuestionIds,
      quarantinedCount,
      flushPending,
      reconcileBlockedResponse,
      pendingMutationCount,
      durabilityLeaseConflict,
      persistAnswer,
      persistFlag,
      persistPosition,
      persistViolation,
      persistWritingAnswer,
      recordHeartbeat,
      recordNetworkStatus,
      recordPreCheckResult,
      submitAttempt,
      takeOverDurabilityLease,
      setDeviceFingerprintHash,
      flushHeartbeatEvents,
      flushAnswerDurabilityNow,
      dismissDroppedMutationsBanner,
    ]
  );

  const controlValue = useMemo<StudentAttemptControlContextValue>(
    () => ({
      getScheduleId: () => controlScheduleIdRef.current,
      getAttemptId: () => controlAttemptIdRef.current,
      flushAnswerDurabilityNow,
    }),
    [flushAnswerDurabilityNow]
  );

  return (
    <StudentAttemptControlContext.Provider value={controlValue}>
      <StudentAttemptContext.Provider value={value}>{children}</StudentAttemptContext.Provider>
    </StudentAttemptControlContext.Provider>
  );
}

export function useStudentAttempt() {
  const context = useContext(StudentAttemptContext);
  if (!context) {
    throw new Error("useStudentAttempt must be used within StudentAttemptProvider");
  }
  return context;
}

/**
 * Per-question "needs attention" source for banners/badges. Returns the live
 * blocked question ids from provider state (refreshed from the engine on
 * every status/state publish; recovered via the publish path). Minimal
 * additive hook: no publish restructure, no storage imports.
 */
export function useStudentBlockedResponses(): {
  blockedQuestionIds: string[];
  quarantinedCount: number;
  reconcileBlockedResponse: (questionId: string) => Promise<ReconcileBlockedResult>;
} {
  const context = useContext(StudentAttemptContext);
  if (!context) {
    throw new Error("useStudentBlockedResponses must be used within StudentAttemptProvider");
  }
  return {
    blockedQuestionIds: context.state.blockedQuestionIds,
    quarantinedCount: context.state.quarantinedCount,
    reconcileBlockedResponse: context.actions.reconcileBlockedResponse,
  };
}

export function useOptionalStudentAttempt(): StudentAttemptContextValue | null {
  return useContext(StudentAttemptContext);
}

export function useOptionalStudentAttemptControls(): StudentAttemptControlContextValue | null {
  return useContext(StudentAttemptControlContext);
}
