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
  clearAttemptMutationWatermark,
  createStudentMutationOutbox,
  ensureClientSessionIdForAttempt,
  hasAttemptCredential,
  mapBackendStudentAttempt,
  PendingMutationDurabilityMirror,
  readAnswerSyncCheckpoint,
  refreshAttemptCredentialForAttempt,
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
import { emitAnswerMutationDebugLog } from "../answerMutationDebug";
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
  useV2DurabilityEngine?: boolean | undefined;
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

function pendingMutationOldestAgeMs(mutations: StudentAttemptMutation[]): number | null {
  let oldest = Number.POSITIVE_INFINITY;
  for (const mutation of mutations) {
    const ts = Date.parse(mutation.timestamp);
    if (Number.isFinite(ts) && ts < oldest) {
      oldest = ts;
    }
  }

  if (!Number.isFinite(oldest)) {
    return null;
  }

  return Math.max(0, Date.now() - oldest);
}

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

function shouldPreferLocalAttemptState(
  localAttempt: StudentAttempt,
  incomingAttempt: StudentAttempt
): boolean {
  const localAcceptedSeq = localAttempt.recovery.serverAcceptedThroughSeq ?? 0;
  const incomingAcceptedSeq = incomingAttempt.recovery.serverAcceptedThroughSeq ?? 0;
  if (localAcceptedSeq > incomingAcceptedSeq) {
    return true;
  }
  if (localAcceptedSeq < incomingAcceptedSeq) {
    return false;
  }

  const localRevision =
    typeof localAttempt.revision === "number" && Number.isFinite(localAttempt.revision)
      ? localAttempt.revision
      : null;
  const incomingRevision =
    typeof incomingAttempt.revision === "number" && Number.isFinite(incomingAttempt.revision)
      ? incomingAttempt.revision
      : null;

  if (localRevision !== null || incomingRevision !== null) {
    if (localRevision !== null && incomingRevision === null) {
      return true;
    }
    if (localRevision === null && incomingRevision !== null) {
      return false;
    }
    if (localRevision !== null && incomingRevision !== null) {
      if (localRevision > incomingRevision) {
        return true;
      }
      if (localRevision < incomingRevision) {
        return false;
      }
    }
  }

  const hasLocalMutationSignal =
    Boolean(localAttempt.recovery.lastLocalMutationAt) ||
    localAttempt.recovery.pendingMutationCount > 0 ||
    localAttempt.recovery.finalSubmissionPending;
  if (hasLocalMutationSignal) {
    return true;
  }

  const localFingerprint = JSON.stringify({
    phase: localAttempt.phase,
    currentModule: localAttempt.currentModule,
    currentQuestionId: localAttempt.currentQuestionId,
    answers: localAttempt.answers,
    writingAnswers: localAttempt.writingAnswers,
    flags: localAttempt.flags,
  });
  const incomingFingerprint = JSON.stringify({
    phase: incomingAttempt.phase,
    currentModule: incomingAttempt.currentModule,
    currentQuestionId: incomingAttempt.currentQuestionId,
    answers: incomingAttempt.answers,
    writingAnswers: incomingAttempt.writingAnswers,
    flags: incomingAttempt.flags,
  });
  if (localFingerprint !== incomingFingerprint) {
    return true;
  }

  if (
    localAttempt.recovery.syncState === "saved" &&
    incomingAttempt.recovery.syncState === "idle"
  ) {
    return true;
  }

  // When accepted sequence is tied and no authoritative revision breaks the tie,
  // keep local state to avoid regressing visible student answers.
  return false;
}

export function StudentAttemptProvider({
  children,
  scheduleId,
  attemptSnapshot = null,
  persistenceEnabled = true,
  useV2DurabilityEngine,
  writingQuestionIds = [],
}: StudentAttemptProviderProps) {
  const v2DurabilityEnabled =
    (useV2DurabilityEngine ??
      String(import.meta.env["VITE_USE_V2_DURABILITY_ENGINE"] ?? "false") === "true") &&
    attemptSnapshot?.protocolVersion === 2;
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

  const setStorageDurabilityBlocking = useCallback(
    (active: boolean) => {
      runtimeActions.transitionBlocking("storage_unavailable", active);
    },
    [runtimeActions]
  );

  const v2EngineRef = useRef<DurableResponseEngine | null>(null);
  const v2ReadyRef = useRef<Promise<void> | null>(null);
  const v2PendingAcceptancesRef = useRef(new Set<Promise<void>>());
  const v2IdentityGenerationRef = useRef(0);
  const v2IdentityKey = `${scheduleId ?? attemptSnapshot?.scheduleId ?? ""}:${attemptSnapshot?.id ?? ""}:${v2DurabilityEnabled}`;
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

      for (const [questionId, state] of states) {
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
          writingPatch[questionId] =
            typeof visible.answer === "string" ? visible.answer : null;
        } else if (
          visible.answer === null ||
          typeof visible.answer === "string" ||
          Array.isArray(visible.answer)
        ) {
          answerPatch[questionId] = visible.answer;
        }
      }

      setPendingMutationCount(pending);
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
    const enabled = v2DurabilityEnabled && persistenceEnabled && Boolean(snapshot?.id);
    if (!enabled) {
      v2EngineRef.current?.destroy();
      v2EngineRef.current = null;
      v2ReadyRef.current = null;
      setDurabilityLeaseConflict(false);
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
      ),      onStateChange: (states) => {
        if (v2EngineRef.current !== engine || v2IdentityGenerationRef.current !== generation)
          return;
        publishV2EngineState(states);
      },
      onStatusChange: (status, error) => {
        if (v2EngineRef.current !== engine || v2IdentityGenerationRef.current !== generation)
          return;
        const currentAttempt = attemptRef.current;
        if (currentAttempt) {
          syncAttemptState(
            mergeAttempt(currentAttempt, {
              recovery: {
                pendingMutationCount: engine.getPendingCount(),
                syncState:
                  status === "synced"
                    ? "saved"
                    : status === "saving"
                      ? "saving"
                      : status === "saved_locally"
                        ? "offline"
                        : "error",
              },
            })
          );
        }
        if (status === "durability_fault") {
          setStorageDurabilityBlocking(true);
        }
        if (status === "conflict_fenced") {
          setDurabilityLeaseConflict(true);
          setRuntimeAttemptSyncState("error");
        }
        if (status === "conflict_terminal") {
          setDurabilityLeaseConflict(false);
          setRuntimeAttemptSyncState("error");
        }
        if (status === "synced") {
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
    v2DurabilityEnabled,
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
          pendingMutationAgeMs: pendingMutationOldestAgeMs(
            durabilityMirrorRef.current?.getPendingMutations() ?? []
          ),
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
        patchSyncState: patch.recovery?.syncState,
        online: navigator.onLine,
        flushDelayMs: forceImmediateDurability ? 0 : delayMs,
        forceImmediateDurability,
      });
      setPendingMutations(enqueue.nextPendingMutations, {
        durableWriteMode: enqueue.durableWriteMode,
        includesAnswerMutation: enqueue.includesAnswerMutation,
        source: "mutation",
      });

      const syncState: AttemptSyncState = enqueue.syncState;
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
      const flushLegacyMutationQueue = async (): Promise<boolean> => {
        if (!isCurrent()) return false;
        const mirror = durabilityMirrorRef.current;
        if (!mirror) {
          return true;
        }

        const outbox = createStudentMutationOutbox({
          getAttempt: () => (isCurrent() ? attemptRef.current : null),
          syncAttemptState: (nextAttempt) => {
            if (isCurrent()) syncAttemptState(nextAttempt);
          },
          setRuntimeAttemptSyncState: (state) => {
            if (isCurrent()) setRuntimeAttemptSyncState(state);
          },
          setStorageDurabilityBlocking: (active) => {
            if (isCurrent()) setStorageDurabilityBlocking(active);
          },
          mirror,
          persistenceEnabled: () => isCurrent() && persistenceEnabled,
          isOnline: () => isCurrent() && navigator.onLine,
          hasAttemptCredential,
          refreshAttemptCredentialForAttempt: async (attempt) => {
            if (!isCurrent() || attempt.id !== expectedIdentity.attemptId) return false;
            const refreshed = await refreshAttemptCredentialForAttempt(attempt);
            return isCurrent() && refreshed;
          },
          backendConflictReason,
          clearAttemptMutationWatermark: (attempt) => {
            if (isCurrent()) clearAttemptMutationWatermark(attempt);
          },
          onReplayAfterSubmit: (attempt) => {
            if (!isCurrent()) return;
            emitStudentObservabilityMetric(
              "student_mutation_replay_after_submit_total",
              withStudentObservabilityDimensions({
                scheduleId: attempt.scheduleId,
                attemptId: attempt.id,
                endpoint: "mutations:batch",
                reason: "ATTEMPT_SUBMITTED",
                syncState: attempt.recovery.syncState,
              })
            );
          },
          saveAttempt: async (attempt, context) => {
            if (!isCurrent() || attempt.id !== expectedIdentity.attemptId) {
              throw new Error("The student attempt changed while durability was flushing.");
            }
            await studentAttemptRepository.saveAttempt(attempt, context);
            if (!isCurrent()) {
              throw new Error("The student attempt changed while durability was flushing.");
            }
          },
          clearPendingMutations: async (attemptId) => {
            if (!isCurrent() || attemptId !== expectedIdentity.attemptId) return;
            await studentAttemptRepository.clearPendingMutations(attemptId);
          },
          getAttemptsByScheduleId: async (scheduleId) => {
            if (!isCurrent() || scheduleId !== expectedIdentity.scheduleId) return [];
            return studentAttemptRepository.getAttemptsByScheduleId(scheduleId);
          },
          getCanonicalAttempt: async (attempt) => {
            if (!isCurrent() || attempt.id !== expectedIdentity.attemptId) return null;
            return studentAttemptRepository.getCanonicalAttemptByScheduleId(
              attempt.scheduleId,
              attempt.studentKey
            );
          },
        });

        return outbox.flushNow();
      };

      if (v2DurabilityEnabled) {
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
      }

      // V2 owns answer durability, but position, violations, network events,
      // and other non-response mutations still use the legacy mutation ledger.
      if (!isCurrent()) return false;
      return flushLegacyMutationQueue();
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
    v2DurabilityEnabled,
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
    let cancelled = false;

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

    if (v2DurabilityEnabled) {
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

    const currentAttempt = attemptRef.current;
    const sameAttempt = currentAttempt?.id === attemptSnapshot.id;
    const shouldKeepLocalAttempt =
      sameAttempt &&
      !!currentAttempt &&
      ((durabilityMirrorRef.current?.getPendingMutations().length ?? 0) > 0 ||
        shouldPreferLocalAttemptState(currentAttempt, attemptSnapshot));

    if (shouldKeepLocalAttempt && currentAttempt) {
      const mergedViolations = mergeViolationsById(
        currentAttempt.violations ?? [],
        attemptSnapshot.violations ?? []
      );

      const mergedAttempt = mergeAttempt(currentAttempt, {
        phase:
          isVerifiedTerminalStudentState({
            attempt: attemptSnapshot,
            runtimeSnapshot: runtimeState.runtimeSnapshot,
          }) !== "not_terminal"
            ? "post-exam"
            : currentAttempt.phase,
        proctorStatus: attemptSnapshot.proctorStatus,
        proctorNote: attemptSnapshot.proctorNote,
        proctorUpdatedAt: attemptSnapshot.proctorUpdatedAt,
        proctorUpdatedBy: attemptSnapshot.proctorUpdatedBy,
        lastWarningId: attemptSnapshot.lastWarningId ?? currentAttempt.lastWarningId,
        lastAcknowledgedWarningId:
          currentAttempt.lastAcknowledgedWarningId ?? attemptSnapshot.lastAcknowledgedWarningId,
        violations: mergedViolations,
      });

      syncAttemptState(mergedAttempt);
      observedPositionRef.current = JSON.stringify({
        phase: mergedAttempt.phase,
        currentModule: mergedAttempt.currentModule,
        currentQuestionId: mergedAttempt.currentQuestionId,
      });
      observedViolationsRef.current = JSON.stringify(mergedAttempt.violations ?? []);
      return;
    }

    attemptRef.current = attemptSnapshot;
    setAttempt(attemptSnapshot);
    observedPositionRef.current = JSON.stringify({
      phase: attemptSnapshot.phase,
      currentModule: attemptSnapshot.currentModule,
      currentQuestionId: attemptSnapshot.currentQuestionId,
    });
    observedViolationsRef.current = JSON.stringify(attemptSnapshot.violations ?? []);
    setRuntimeAttemptSyncState(attemptSnapshot.recovery.syncState);

    void (async () => {
      let pendingMutations = await studentAttemptRepository.getPendingMutations(attemptSnapshot.id);
      if (cancelled) {
        return;
      }

      // Local edits that happen during mount hydration are authoritative for this tab.
      // Do not replace them with a stale durable snapshot that resolved later.
      if ((durabilityMirrorRef.current?.getPendingMutations().length ?? 0) > 0) {
        return;
      }

      let recoveredFromCheckpoint = false;
      if (pendingMutations.length === 0) {
        const checkpointMutations = readAnswerSyncCheckpoint(attemptSnapshot.id);
        if (checkpointMutations.length > 0) {
          pendingMutations = checkpointMutations;
          recoveredFromCheckpoint = true;
          emitStudentObservabilityMetric(
            "student_pending_checkpoint_recovered_total",
            withStudentObservabilityDimensions({
              scheduleId: attemptSnapshot.scheduleId,
              attemptId: attemptSnapshot.id,
              endpoint: "/v1/student/sessions/:scheduleId/mutations:pending",
              statusCode: null,
              reason: "sync_checkpoint_recovery",
              syncState: attemptSnapshot.recovery.syncState,
              lifecycleEventSource: "hydrate_checkpoint",
              durablePersistResult: "recovered",
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
              pendingMutationAgeMs: pendingMutationOldestAgeMs(checkpointMutations),
              pendingMutationCount: checkpointMutations.length,
            })
          );
        }
      }

      durabilityMirrorRef.current?.hydratePendingMutations({
        mutations: pendingMutations,
        recoveredFromCheckpoint,
      });

      if (pendingMutations.length > 0) {
        const replayAnswers: Record<string, StudentAnswerValue> = {};
        const replayWritingAnswers: Record<string, string> = {};
        const replayFlags: Record<string, boolean> = {};

        for (const mutation of pendingMutations) {
          if (mutation.type === "answer") {
            const questionId = mutation.payload.questionId;
            if (typeof questionId !== "string" || questionId.trim() === "") {
              continue;
            }
            replayAnswers[questionId] = mutation.payload.value;
            continue;
          }

          if (mutation.type === "writing_answer") {
            const taskId = mutation.payload.taskId;
            if (typeof taskId !== "string" || taskId.trim() === "") {
              continue;
            }
            const value = mutation.payload.value;
            if (typeof value !== "string") {
              continue;
            }
            replayWritingAnswers[taskId] = value;
            continue;
          }

          if (mutation.type === "flag") {
            const questionId = mutation.payload.questionId;
            if (typeof questionId !== "string" || questionId.trim() === "") {
              continue;
            }
            const value = mutation.payload.value;
            if (typeof value !== "boolean") {
              continue;
            }
            replayFlags[questionId] = value;
          }
        }

        const currentAttempt = attemptRef.current ?? attemptSnapshot;
        const replayedAttempt = mergeAttempt(currentAttempt, {
          answers: replayAnswers,
          writingAnswers: replayWritingAnswers,
          flags: replayFlags,
          recovery: {
            pendingMutationCount: pendingMutations.length,
            syncState: navigator.onLine ? currentAttempt.recovery.syncState : "offline",
          },
        });

        syncAttemptState(replayedAttempt);
        observedPositionRef.current = JSON.stringify({
          phase: replayedAttempt.phase,
          currentModule: replayedAttempt.currentModule,
          currentQuestionId: replayedAttempt.currentQuestionId,
        });
        observedViolationsRef.current = JSON.stringify(replayedAttempt.violations ?? []);
      }

      if (pendingMutations.length > 0 && navigator.onLine) {
        await flushPending();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    attemptSnapshot,
    flushPending,
    persistenceEnabled,
    runtimeState.runtimeSnapshot,
    setRuntimeAttemptSyncState,
    syncAttemptState,
    v2DurabilityEnabled,
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
      if (v2DurabilityEnabled) {
        enqueueV2Response(
          questionId,
          {
            ...durablePayloadForQuestion(questionId),
            answer,
          },
          "answer",
          { answers: { [questionId]: answer } }
        );
        return;
      }

      const payload: StudentAttemptMutationPayload<"answer"> = { questionId, value: answer };
      if (meta?.interactionType === "typing" || meta?.interactionType === "discrete") {
        payload.interactionType = meta.interactionType;
      }
      if (
        typeof meta?.slotIndex === "number" &&
        Number.isInteger(meta.slotIndex) &&
        meta.slotIndex >= 0
      ) {
        payload.slotIndex = meta.slotIndex;
      }
      if (typeof meta?.slotId === "string" && meta.slotId.trim()) {
        payload.slotId = meta.slotId;
      }
      if (
        typeof meta?.slotCount === "number" &&
        Number.isInteger(meta.slotCount) &&
        meta.slotCount > 0
      ) {
        payload.slotCount = meta.slotCount;
      }
      emitAnswerMutationDebugLog("StudentAttemptProvider.persistAnswer", {
        questionId,
        answer,
        mutationMeta: meta ?? null,
        payload,
      });

      void applyPatch(
        {
          answers: {
            [questionId]: answer,
          },
        },
        "answer",
        400,
        payload
      );
    },
    [applyPatch, durablePayloadForQuestion, enqueueV2Response, v2DurabilityEnabled]
  );

  const persistWritingAnswer = useCallback(
    (taskId: string, text: string) => {
      if (v2DurabilityEnabled) {
        enqueueV2Response(
          taskId,
          {
            ...durablePayloadForQuestion(taskId),
            answer: text,
          },
          "writing",
          { writingAnswers: { [taskId]: text } }
        );
        return;
      }
      void applyPatch(
        {
          writingAnswers: {
            [taskId]: text,
          },
        },
        "writing_answer",
        1_500,
        { taskId, value: text }
      );
    },
    [applyPatch, durablePayloadForQuestion, enqueueV2Response, v2DurabilityEnabled]
  );

  const persistFlag = useCallback(
    (questionId: string, flagged: boolean) => {
      if (v2DurabilityEnabled) {
        enqueueV2Response(
          questionId,
          {
            ...durablePayloadForQuestion(questionId),
            markedForReview: flagged,
          },
          "flag",
          { flags: { [questionId]: flagged } }
        );
        return;
      }
      void applyPatch(
        {
          flags: {
            [questionId]: flagged,
          },
        },
        "flag",
        400,
        { questionId, value: flagged }
      );
    },
    [applyPatch, durablePayloadForQuestion, enqueueV2Response, v2DurabilityEnabled]
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
            if (v2DurabilityEnabled) {
              const flushed = await flushPending();
              if (!flushed || !isCurrent()) return;
              const ready = v2ReadyRef.current;
              if (ready) await ready;
              if (!isCurrent()) return;
              const engine = v2EngineRef.current;
              if (!engine) throw new Error("V2 response durability engine is not ready.");
              const submitted = await engine.submit(
                candidateAttempt.id,
                engine.getAttemptRevision()
              );
              if (!isCurrent()) return;
              const submittedAttempt = mergeAttempt(attemptRef.current ?? candidateAttempt, {
                phase: "post-exam",
                submittedAt: submitted.submittedAt,
                responseRevision: submitted.attemptRevision,
                finalResponseDigest: submitted.finalResponseDigest,
                finalSubmission: {
                  submissionId: submitted.submissionId,
                  submittedAt: submitted.submittedAt,
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
            }
            const submittedAttempt = await studentAttemptRepository.submitAttempt(candidateAttempt);
            if (!isCurrent()) return;
            const confirmedAttempt = mergeAttempt(submittedAttempt, {
              phase: "post-exam",
              recovery: {
                finalSubmissionPending: false,
              },
            });
            runtimeActions.setPhase("post-exam");
            syncAttemptState(confirmedAttempt);
            void queryClient.invalidateQueries();
            return;
          } catch (error) {
            if (!isCurrent()) return;
            if (v2DurabilityEnabled) {
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
    [
      flushPending,
      persistenceEnabled,
      runtimeActions,
      syncAttemptState,
      v2DurabilityEnabled,
    ]
  );

  const takeOverDurabilityLease = useCallback(
    async (reason = "Candidate explicitly requested lease takeover"): Promise<boolean> => {
      if (!v2DurabilityEnabled) return false;
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
      return v2IdentityGenerationRef.current === generation && v2EngineRef.current === currentEngine;
    },
    [syncAttemptState, v2DurabilityEnabled]
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
      if (v2DurabilityEnabled) {
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
        const submitted = await engine.submit(latestAttempt.id, engine.getAttemptRevision());
        if (!isCurrent()) return false;
        const confirmedAttempt = mergeAttempt(attemptRef.current ?? latestAttempt, {
          phase: "post-exam",
          submittedAt: submitted.submittedAt,
          responseRevision: submitted.attemptRevision,
          finalResponseDigest: submitted.finalResponseDigest,
          finalSubmission: {
            submissionId: submitted.submissionId,
            submittedAt: submitted.submittedAt,
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
      }
      const submittedAttempt = await studentAttemptRepository.submitAttempt(latestAttempt);
      if (!isCurrent()) return false;
      const confirmedAttempt = mergeAttempt(submittedAttempt, {
        phase: "post-exam",
        recovery: {
          finalSubmissionPending: false,
        },
      });
      runtimeActions.setPhase("post-exam");
      syncAttemptState(confirmedAttempt);
      void queryClient.invalidateQueries();
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
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
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error
          ? (error as { statusCode?: unknown }).statusCode
          : undefined;
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
    scheduleBackgroundSubmitRetry,
    syncAttemptState,
    v2DurabilityEnabled,
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

  const value = useMemo<StudentAttemptContextValue>(
    () => ({
      state: {
        attempt,
        attemptId: attempt?.id ?? null,
        lastLocalMutationAt: attempt?.recovery.lastLocalMutationAt ?? null,
        lastPersistedAt: attempt?.recovery.lastPersistedAt ?? null,
        pendingMutationCount,
        durabilityLeaseConflict,
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
        flushAnswerDurabilityNow,
        flushHeartbeatEvents,
        dismissDroppedMutationsBanner,
      },
    }),
    [
      acknowledgeProctorWarning,
      attempt,
      flushPending,
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

export function useOptionalStudentAttempt(): StudentAttemptContextValue | null {
  return useContext(StudentAttemptContext);
}

export function useOptionalStudentAttemptControls(): StudentAttemptControlContextValue | null {
  return useContext(StudentAttemptControlContext);
}
