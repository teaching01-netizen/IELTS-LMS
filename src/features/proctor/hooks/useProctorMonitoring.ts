import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useLiveUpdates, type LiveUpdateEvent } from "@shared/hooks/useLiveUpdates";
import {
  resolveRoomClock,
  type ServerClockSnapshot,
} from "@shared/hooks/useAuthoritativeDeadlineClock";
import {
  ALERT_WINDOW_LIMIT,
  fetchProctorSessionDetail,
  invalidateRoomReads,
  liveQueryPolicy,
  proctorKeys,
  type ProctorSessionDetailPayload,
  useProctorSessionSummaries,
} from "../api/proctorQueries";
import { proctorFacade } from "../application/proctorFacade";
import type {
  ProctorAlert,
  SessionAuditLog,
  SessionNote,
  StudentSession,
  ViolationRule,
} from "../../../types";
import type { ExamSessionRuntime } from "../../../types/domain";
import type { ProctorPresence } from "../../../types/domain";
import type { ProctorScheduleMetrics } from "../contracts";
import {
  mergeProctorRuntime,
  mergeSessionProjection,
  reconcileRoomRuntime,
  sessionProjectionSupersedes,
} from "../domain/mergeProctorRuntime";
import {
  mergeAuditWindow,
  reconcileAlertWindow,
  reconcileFullCollection,
  type CollectionOverlay,
} from "../domain/proctorSnapshot";

function mapBackendSessionSummary(payload: {
  attemptId: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  scheduleId: string;
  status: StudentSession["status"];
  satStartState?: StudentSession["satStartState"];
  currentSection: StudentSession["currentSection"];
  timeRemaining: number;
  runtimeStatus: StudentSession["runtimeStatus"];
  runtimeCurrentSection?: StudentSession["runtimeCurrentSection"] | null | undefined;
  runtimeTimeRemainingSeconds: number;
  runtimeDeadlineAt?: string | null | undefined;
  runtimeServerNow?: string | null | undefined;
  runtimeModuleRole?: StudentSession["runtimeModuleRole"] | null | undefined;
  runtimeCurrentModuleRole?: StudentSession["runtimeModuleRole"] | null | undefined;
  runtimeModuleDeadlineAt?: string | null | undefined;
  runtimeModuleRemainingSeconds?: number | null | undefined;
  runtimeSectionStatus?: StudentSession["runtimeSectionStatus"] | null | undefined;
  attemptRevision?: number | null | undefined;
  runtimeCurrentModuleId?: string | null | undefined;
  runtimeModuleAttemptId?: string | null | undefined;
  runtimeModuleAttemptRevision?: number | null | undefined;
  satRecoveryModuleAttemptId?: StudentSession["satRecoveryModuleAttemptId"];
  satRecoveryModuleTitle?: StudentSession["satRecoveryModuleTitle"];
  satRecoveryPhase?: StudentSession["satRecoveryPhase"];
  satRecoveryKind?: StudentSession["satRecoveryKind"];
  satRecoveryDeadlineAt?: StudentSession["satRecoveryDeadlineAt"];
  satRecoveryBoundaryRevision?: StudentSession["satRecoveryBoundaryRevision"];
  runtimeWaiting: boolean;
  ieltsPersonalStatus?: StudentSession["ieltsPersonalStatus"] | null | undefined;
  ieltsPersonalSectionKey?: StudentSession["ieltsPersonalSectionKey"] | null | undefined;
  ieltsPersonalDeadlineAt?: string | null | undefined;
  ieltsPersonalTimeRemainingSeconds?: number | null | undefined;
  ieltsOfflinePreparedSection?: string | null | undefined;
  ieltsOfflinePreparedAt?: string | null | undefined;
  draftEvidencePending?: number | null | undefined;
  violations: StudentSession["violations"];
  warnings: number;
  lastActivity: string;
  examId: string;
  examName: string;
}): StudentSession {
  proctorFacade.rememberAttemptSchedule(payload.attemptId, payload.scheduleId);

  return {
    id: payload.attemptId,
    studentId: payload.studentId,
    name: payload.studentName,
    email: payload.studentEmail,
    scheduleId: payload.scheduleId,
    status: payload.status,
    satStartState: payload.satStartState,
    currentSection: payload.currentSection,
    timeRemaining: payload.timeRemaining,
    runtimeStatus: payload.runtimeStatus ?? "not_started",
    runtimeCurrentSection: payload.runtimeCurrentSection ?? null,
    runtimeTimeRemainingSeconds: payload.runtimeTimeRemainingSeconds,
    runtimeDeadlineAt: payload.runtimeDeadlineAt ?? null,
    runtimeServerNow: payload.runtimeServerNow ?? null,
    // The server names this field `runtimeCurrentModuleRole`; accept the older
    // client-side name too, so the adaptive module slot is not lost to a key
    // that only ever existed on one side of the wire.
    runtimeModuleRole: payload.runtimeModuleRole ?? payload.runtimeCurrentModuleRole ?? null,
    runtimeModuleDeadlineAt: payload.runtimeModuleDeadlineAt ?? null,
    runtimeModuleRemainingSeconds: payload.runtimeModuleRemainingSeconds ?? null,
    // Runtime identity fence: the module the candidate is actually sitting is
    // carried by these three fields (attempt revision + active module attempt),
    // not by the presence heartbeat.
    attemptRevision: payload.attemptRevision ?? null,
    runtimeCurrentModuleId: payload.runtimeCurrentModuleId ?? null,
    runtimeModuleAttemptId: payload.runtimeModuleAttemptId ?? null,
    runtimeModuleAttemptRevision: payload.runtimeModuleAttemptRevision ?? null,
    satRecoveryModuleAttemptId: payload.satRecoveryModuleAttemptId ?? null,
    satRecoveryModuleTitle: payload.satRecoveryModuleTitle ?? null,
    satRecoveryPhase: payload.satRecoveryPhase ?? null,
    satRecoveryKind: payload.satRecoveryKind ?? null,
    satRecoveryDeadlineAt: payload.satRecoveryDeadlineAt ?? null,
    satRecoveryBoundaryRevision: payload.satRecoveryBoundaryRevision ?? null,
    runtimeSectionStatus: payload.runtimeSectionStatus ?? undefined,
    runtimeWaiting: payload.runtimeWaiting,
    ieltsPersonalStatus: payload.ieltsPersonalStatus ?? undefined,
    ieltsPersonalSectionKey: payload.ieltsPersonalSectionKey ?? undefined,
    ieltsPersonalDeadlineAt: payload.ieltsPersonalDeadlineAt ?? null,
    ieltsPersonalTimeRemainingSeconds: payload.ieltsPersonalTimeRemainingSeconds ?? null,
    ieltsOfflinePreparedSection:
      (payload.ieltsOfflinePreparedSection as StudentSession["ieltsOfflinePreparedSection"]) ?? null,
    ieltsOfflinePreparedAt: payload.ieltsOfflinePreparedAt ?? null,
    draftEvidencePending: payload.draftEvidencePending ?? 0,
    violations: payload.violations ?? [],
    warnings: payload.warnings,
    lastActivity: payload.lastActivity,
    examId: payload.examId,
    examName: payload.examName,
  };
}

function mapBackendAlert(payload: {
  id: string;
  severity: ProctorAlert["severity"];
  type: string;
  studentName: string;
  studentId: string;
  timestamp: string;
  message: string;
  isAcknowledged: boolean;
}): ProctorAlert {
  return {
    id: payload.id,
    severity: payload.severity,
    type: payload.type,
    studentName: payload.studentName,
    studentId: payload.studentId,
    timestamp: payload.timestamp,
    message: payload.message,
    isAcknowledged: payload.isAcknowledged,
  };
}

function mapBackendAuditLog(payload: {
  id: string;
  scheduleId: string;
  actor: string;
  actionType: SessionAuditLog["actionType"];
  targetStudentId?: string | null | undefined;
  payload?: Record<string, unknown> | null | undefined;
  createdAt: string;
}): SessionAuditLog {
  return {
    id: payload.id,
    timestamp: payload.createdAt,
    actor: payload.actor,
    actionType: payload.actionType,
    targetStudentId: payload.targetStudentId ?? undefined,
    sessionId: payload.scheduleId,
    payload: payload.payload ?? undefined,
  };
}

function mapBackendNote(payload: {
  id: string;
  scheduleId: string;
  author: string;
  category: SessionNote["category"] | string;
  content: string;
  isResolved?: boolean | undefined;
  createdAt: string;
}): SessionNote {
  return {
    id: payload.id,
    scheduleId: payload.scheduleId,
    author: payload.author,
    timestamp: payload.createdAt,
    content: payload.content,
    category:
      payload.category === "incident" || payload.category === "handover"
        ? payload.category
        : "general",
    isResolved: payload.isResolved ?? false,
  };
}

function mapBackendViolationRule(payload: {
  id: string;
  scheduleId: string;
  triggerType: ViolationRule["triggerType"];
  threshold: number;
  specificViolationType?: string | null | undefined;
  specificSeverity?: ViolationRule["specificSeverity"] | null | undefined;
  action: ViolationRule["action"];
  isEnabled: boolean;
  createdAt: string;
  createdBy: string;
}): ViolationRule {
  return {
    id: payload.id,
    scheduleId: payload.scheduleId,
    triggerType: payload.triggerType,
    threshold: payload.threshold,
    specificViolationType: payload.specificViolationType ?? undefined,
    specificSeverity: payload.specificSeverity ?? undefined,
    action: payload.action,
    isEnabled: payload.isEnabled,
    createdAt: payload.createdAt,
    createdBy: payload.createdBy,
  };
}

function mapBackendProctorPresence(payload: {
  proctorId: string;
  proctorName: string;
  joinedAt: string;
  lastHeartbeatAt: string;
}): ProctorPresence {
  return {
    proctorId: payload.proctorId,
    proctorName: payload.proctorName,
    joinedAt: payload.joinedAt,
    lastHeartbeat: payload.lastHeartbeatAt,
  };
}

function sortSessionsByLastActivity(left: StudentSession, right: StudentSession) {
  return new Date(right.lastActivity).getTime() - new Date(left.lastActivity).getTime();
}

function sortAlertsByTimestamp(left: ProctorAlert, right: ProctorAlert) {
  return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
}

/**
 * The newest server instant among the payloads one refresh carried. Every read
 * stamps its own `serverNow`, so the freshest one is the room's clock for this
 * refresh; taking it here keeps the room and the per-student rows on the same
 * instant instead of each correcting itself.
 */
function newestServerNow(candidates: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = Date.parse(candidate);
    if (!Number.isFinite(parsed) || parsed <= bestMs) continue;
    best = candidate;
    bestMs = parsed;
  }
  return best;
}

function getLiveUpdateScheduleId(event: LiveUpdateEvent): string | null {
  if (event.scheduleId) {
    return event.scheduleId;
  }

  if (
    event.kind === "schedule_runtime" ||
    event.kind === "schedule_roster" ||
    event.kind === "schedule_alert"
  ) {
    return event.id;
  }

  if (event.kind === "attempt") {
    return proctorFacade.getAttemptSchedule(event.id) ?? null;
  }

  return null;
}

/** Live events within this window collapse into one refresh. */
const LIVE_REFRESH_COALESCE_MS = 100;

/** Client-generated alerts (auto-rule notifications) never come back from the server. */
export const LOCAL_ALERT_PREFIX = "auto-rule-notify:";
const isLocalOnlyAlert = (alert: ProctorAlert) => alert.id.startsWith(LOCAL_ALERT_PREFIX);

type OverlayEntry<T> =
  | { kind: "upsert"; row: T; scheduleId: string; operation: number; confirmedOrder: number | null }
  | { kind: "delete"; scheduleId: string; operation: number; confirmedOrder: number | null };

// Reads and acknowledgements using the same cache must share an ordering even
// when multiple monitoring observers are mounted.
const detailOrders = new WeakMap<QueryClient, number>();
function nextDetailOrder(client: QueryClient): number {
  const order = (detailOrders.get(client) ?? 0) + 1;
  detailOrders.set(client, order);
  return order;
}

function requireUnpausedReads(client: QueryClient, keys: ReadonlyArray<readonly unknown[]>): void {
  if (keys.some((key) => client.getQueryState(key)?.fetchStatus === 'paused')) {
    throw new Error('The room could not refresh while offline.');
  }
}

/**
 * Pending operations on a full server collection. An entry stays until a
 * detail read started after the server confirmed it, so neither an older poll
 * nor an in-flight one can resurrect a deletion or roll back an edit.
 */
function useCollectionOverlay<T extends { id: string; scheduleId: string }>(client: QueryClient, selectedScheduleId: string | null) {
  const [entries, setEntries] = useState<ReadonlyMap<string, OverlayEntry<T>>>(() => new Map());
  const operationRef = useRef(0);
  const update = useCallback((mutate: (next: Map<string, OverlayEntry<T>>) => void) => {
    setEntries((current) => {
      const next = new Map(current);
      mutate(next);
      return next;
    });
  }, []);
  const overlay = useMemo<CollectionOverlay<T>>(() => {
    const upserts = new Map<string, T>();
    const deletes = new Set<string>();
    for (const [id, entry] of entries) {
      if (entry.scheduleId !== selectedScheduleId) continue;
      if (entry.kind === "upsert") upserts.set(id, entry.row);
      else deletes.add(id);
    }
    return { upserts, deletes };
  }, [entries, selectedScheduleId]);
  return {
    overlay,
    beginUpsert: useCallback((row: T) => {
      const operation = ++operationRef.current;
      update((next) => next.set(row.id, { kind: "upsert", row, scheduleId: row.scheduleId, operation, confirmedOrder: null }));
      return operation;
    }, [update]),
    beginDelete: useCallback((row: Pick<T, "id" | "scheduleId">) => {
      const operation = ++operationRef.current;
      update((next) => next.set(row.id, { kind: "delete", scheduleId: row.scheduleId, operation, confirmedOrder: null }));
      return operation;
    }, [update]),
    confirm: useCallback((id: string, operation: number) => {
      const confirmedOrder = nextDetailOrder(client);
      update((next) => {
        const entry = next.get(id);
        if (entry?.operation === operation) next.set(id, { ...entry, confirmedOrder });
      });
    }, [client, update]),
    rollback: useCallback((id: string, operation: number) => update((next) => {
      if (next.get(id)?.operation === operation) next.delete(id);
    }), [update]),
    /** Only a read started after confirmation can retire that room's overlay. */
    prune: useCallback((scheduleId: string, readOrder: number) => {
      setEntries((current) => {
        let changed = false;
        const next = new Map(current);
        for (const [id, entry] of current) {
          if (entry.scheduleId === scheduleId && entry.confirmedOrder !== null && entry.confirmedOrder < readOrder) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, []),
    clear: useCallback(() => setEntries((current) => (current.size === 0 ? current : new Map())), []),
  };
}

/** The selected room's detail collections, as the server last returned them. */
interface RoomCollections {
  scheduleId: string | null;
  alerts: ProctorAlert[];
  auditLogs: SessionAuditLog[];
  notes: SessionNote[];
  violationRules: ViolationRule[];
}

const EMPTY_ROOM: RoomCollections = { scheduleId: null, alerts: [], auditLogs: [], notes: [], violationRules: [] };

/** The shared, revision-guarded live projection for one detail query. */
interface ProctorDetailCache {
  detail: ProctorSessionDetailPayload | null;
  readOrder: number;
  runtime: ExamSessionRuntime;
  clock: ServerClockSnapshot;
  sessions: StudentSession[];
  room: RoomCollections;
  acknowledgedAlertIds: string[];
  /** Confirmed local updates remain until a read begun after each command. */
  sessionWriteOrders: Record<string, number>;
}

const EMPTY_SESSIONS: StudentSession[] = [];

/** Runs at the cache write boundary, including when a poll finishes after a socket frame. */
function reconcileDetailCache(oldData: unknown, newData: unknown): ProctorDetailCache {
  const previous = oldData as ProctorDetailCache | undefined;
  const incoming = newData as ProctorDetailCache;
  if (!previous || incoming.readOrder === previous.readOrder) return incoming;
  if (incoming.readOrder < previous.readOrder) return previous;
  const previousById = new Map(previous.sessions.map((session) => [session.id, session]));
  const nextSessions = incoming.sessions.map((next) => {
    const held = previousById.get(next.id);
    previousById.delete(next.id);
    if (!held) return next;
    const writeOrder = previous.sessionWriteOrders[next.id];
    if (writeOrder !== undefined && incoming.readOrder < writeOrder) return held;
    // Once a read starts after the acknowledgement it can replace an
    // unversioned command projection on a tie, while known newer revisions
    // and module identities continue to win over older reads.
    if (writeOrder !== undefined && !sessionProjectionSupersedes(next, held) && !sessionProjectionSupersedes(held, next)) return next;
    return mergeSessionProjection(held, next);
  });
  for (const held of previousById.values()) {
    const writeOrder = previous.sessionWriteOrders[held.id];
    if (writeOrder !== undefined && incoming.readOrder < writeOrder) nextSessions.push(held);
  }
  const sessionWriteOrders = Object.fromEntries(
    Object.entries(previous.sessionWriteOrders).filter(([, order]) => incoming.readOrder < order),
  );
  const acknowledged = new Set([
    ...previous.acknowledgedAlertIds,
    ...previous.room.alerts.filter((alert) => alert.isAcknowledged).map((alert) => alert.id),
  ]);
  return {
    ...incoming,
    ...reconcileRoomRuntime(previous, incoming, "detail"),
    sessions: nextSessions.sort(sortSessionsByLastActivity),
    sessionWriteOrders,
    room: {
      ...incoming.room,
      alerts: reconcileAlertWindow({
        server: incoming.room.alerts,
        limit: ALERT_WINDOW_LIMIT,
        previous: previous.room.alerts,
        acknowledged,
        reopened: new Set(),
        isLocalOnly: isLocalOnlyAlert,
      }),
      auditLogs: mergeAuditWindow(previous.room.auditLogs, incoming.room.auditLogs),
    },
    acknowledgedAlertIds: previous.acknowledgedAlertIds,
  };
}

export interface ProctorRouteControllerOptions {
  providerKey?: "sat" | "ielts" | "act";
  /**
   * Provider families whose rooms this view shows, applied to the summary read.
   * The summary read is shared, so pass a stable (module-level) array.
   */
  visibleProviderKeys?: ReadonlyArray<"sat" | "ielts" | "act">;
  initialScheduleId?: string | null;
}

/**
 * Query subscription and room projection for proctor monitoring.
 *
 * Summary and detail polls, socket frames, and command follow-up reads all
 * pass through the same revision-guarded merges (mergeProctorRuntime,
 * mergeSessionProjection) and per-collection reconciliation
 * (proctorSnapshot). Local pending operations are overlays; nothing here
 * hands views a setter for server entities.
 */
export function useProctorMonitoring(options: ProctorRouteControllerOptions = {}) {
  const queryClient = useQueryClient();
  // One accepted server instant for the whole room: the stamp of the freshest
  // payload plus the local instant it arrived. See mergeProctorRuntime for why
  // the runtime projection alone cannot be trusted to be the freshest read.
  // The resolved room clock consumers read is derived from it just below.
  const [acceptedRoomClock, setAcceptedRoomClock] = useState<ServerClockSnapshot>({
    serverNow: null,
    receivedAt: 0,
  });
  const [localAlerts, setLocalAlerts] = useState<Array<{ scheduleId: string; alert: ProctorAlert }>>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(
    options.initialScheduleId ?? null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commandErrors, setCommandErrors] = useState<Record<string, string>>({});
  const [wsConnected, setWsConnected] = useState<boolean | null>(null);

  // Alert acknowledgements this client sent, and display-only reopenings
  // (the server has no reopen command). Refs feed reconciliation; the state
  // copies re-render the view.
  const acknowledgedAlertIdsRef = useRef<Set<string>>(new Set());
  const reopenedAlertIdsRef = useRef<Set<string>>(new Set());
  const [alertAckVersion, setAlertAckVersion] = useState(0);
  const noteOverlay = useCollectionOverlay<SessionNote>(queryClient, selectedScheduleId);
  const ruleOverlay = useCollectionOverlay<ViolationRule>(queryClient, selectedScheduleId);
  const setCommandError = useCallback((scheduleId: string, message: string | null) => {
    setCommandErrors((current) => {
      if ((current[scheduleId] ?? null) === message) return current;
      const next = { ...current };
      if (message === null) delete next[scheduleId];
      else next[scheduleId] = message;
      return next;
    });
  }, []);

  /**
   * The room's clock, resolved HERE and only here: the accepted server instant
   * when one has landed, otherwise the selected runtime's own stamp (a
   * projection that reached the room outside the accepted-clock path). Every
   * consumer reads a clock; none of them decides where "now" comes from, so no
   * surface can drift onto its own correction.
   */
  const summariesQuery = useProctorSessionSummaries(
    10_000,
    options.providerKey,
    true,
    options.initialScheduleId ? 'always' : undefined,
  );
  const summaries = useMemo(() => summariesQuery.data ?? [], [summariesQuery.data]);
  const visibleProviderKeys = options.visibleProviderKeys;
  const visibleSummaries = useMemo(
    () => summaries.filter((summary) =>
      !proctorFacade.isPreviewRuntimeCohortName(summary.schedule.cohortName) &&
      (!visibleProviderKeys || visibleProviderKeys.includes(summary.schedule.providerKey))),
    [summaries, visibleProviderKeys],
  );
  const schedules = useMemo(
    () => visibleSummaries.map((summary) => proctorFacade.mapSchedule(summary.schedule)),
    [visibleSummaries],
  );
  const scheduleMetrics = useMemo(() => {
    const metrics: Record<string, ProctorScheduleMetrics> = {};
    for (const summary of visibleSummaries) {
      const studentCount = summary.studentCount ?? 0;
      const joinReadyCount = summary.joinReadyCount ?? studentCount;
      metrics[summary.schedule.id] = {
        studentCount,
        activeCount: summary.activeCount ?? 0,
        joinReadyCount,
        joinTotalCount: Math.max(summary.joinTotalCount ?? studentCount, joinReadyCount),
        alertCount: summary.alertCount ?? 0,
        violationCount: summary.violationCount ?? 0,
        degradedLiveMode: summary.degradedLiveMode,
      };
    }
    return metrics;
  }, [visibleSummaries]);
  const degradedLiveMode = visibleSummaries.some((summary) => summary.degradedLiveMode);
  // The summary query clamps to a 10s floor; detail uses its existing 8s
  // recovery cadence when the backend reports degraded live updates.
  const detailPollIntervalMs = degradedLiveMode ? 8_000 : 15_000;
  useEffect(() => {
    if (options.initialScheduleId) {
      setSelectedScheduleId(options.initialScheduleId);
    }
  }, [options.initialScheduleId]);

  useEffect(() => {
    if (!selectedScheduleId) {
      return;
    }

    if (!summariesQuery.data) {
      return;
    }

    // A room route can arrive with a summary cached before the room was
    // created. Keep the route's schedule selected until its forced fresh read
    // completes, otherwise the stale list can clear it before detail loads.
    if (
      options.initialScheduleId === selectedScheduleId &&
      !summariesQuery.isFetchedAfterMount
    ) {
      return;
    }

    const scheduleStillExists = summaries.some(
      (summary) => summary.schedule.id === selectedScheduleId
    );
    if (!scheduleStillExists) {
      setSelectedScheduleId(null);
      return;
    }
  }, [options.initialScheduleId, selectedScheduleId, summaries, summariesQuery.data, summariesQuery.isFetchedAfterMount]);

  const detailScheduleIds = useMemo(() => {
    if (!selectedScheduleId) {
      return [];
    }
    return [selectedScheduleId];
  }, [selectedScheduleId]);

  const detailQueryState = useQueries({
    queries: detailScheduleIds.map((scheduleId) => ({
      queryKey: proctorKeys.detail(scheduleId),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const readOrder = nextDetailOrder(queryClient);
        const detail = await fetchProctorSessionDetail(scheduleId, signal);
        const schedule = proctorFacade.mapSchedule(detail.schedule);
        const runtime = mergeProctorRuntime(
          undefined,
          proctorFacade.mapRuntime(detail.runtime, schedule),
          detail.presence.map(mapBackendProctorPresence),
        );
        return {
          detail,
          readOrder,
          runtime,
          clock: {
            serverNow: newestServerNow([detail.runtime?.serverNow, ...detail.sessions.map((session) => session.runtimeServerNow)]),
            receivedAt: Date.now(),
          },
          sessions: detail.sessions.map(mapBackendSessionSummary).sort(sortSessionsByLastActivity),
          room: {
            scheduleId: detail.schedule.id,
            alerts: detail.alerts.map(mapBackendAlert),
            auditLogs: detail.auditLogs.map(mapBackendAuditLog),
            notes: detail.notes.map(mapBackendNote),
            violationRules: detail.violationRules.map(mapBackendViolationRule),
          },
          acknowledgedAlertIds: [],
          sessionWriteOrders: {},
        } satisfies ProctorDetailCache;
      },
      structuralSharing: reconcileDetailCache,
      ...liveQueryPolicy,
      refetchInterval: detailPollIntervalMs,
    })),
    combine: (results) => ({
      details: results
        .map((result) => result.data?.detail)
        .filter((detail): detail is ProctorSessionDetailPayload => detail != null),
      readOrder: Math.max(0, ...results.map((result) => result.data?.readOrder ?? 0)),
      projection: results[0]?.data,
      hasPendingDetail: results.some((result) => result.isPending || !result.data?.detail),
      error: results.find((result) => result.error)?.error ?? null,
    }),
  });

  const sessions = detailQueryState.projection?.sessions ?? EMPTY_SESSIONS;
  const room = detailQueryState.projection?.room ?? EMPTY_ROOM;

  const runtimeSnapshots = useMemo(() => {
    const bySchedule = new Map<string, ExamSessionRuntime>();
    for (const summary of visibleSummaries) {
      const schedule = proctorFacade.mapSchedule(summary.schedule);
      const mapped = proctorFacade.mapRuntime(summary.runtime, schedule);
      const cached = detailQueryState.projection?.runtime;
      bySchedule.set(schedule.id, cached?.scheduleId === schedule.id ? cached : mergeProctorRuntime(undefined, mapped));
    }
    const detail = detailQueryState.projection?.detail;
    if (detail && !proctorFacade.isPreviewRuntimeCohortName(detail.schedule.cohortName) && !bySchedule.has(detail.schedule.id)) {
      bySchedule.set(detail.schedule.id, detailQueryState.projection!.runtime);
    }
    return [...bySchedule.values()];
  }, [detailQueryState.projection, visibleSummaries]);

  const roomClock = useMemo(
    () => resolveRoomClock(
      detailQueryState.projection?.clock.serverNow ? detailQueryState.projection.clock : acceptedRoomClock,
      runtimeSnapshots.find((runtime) => runtime.scheduleId === selectedScheduleId)?.serverNow ?? null,
    ),
    [acceptedRoomClock, detailQueryState.projection, runtimeSnapshots, selectedScheduleId],
  );

  // A selected room's summary is another partial runtime projection. Write it
  // through the same cache boundary as the detail poll and socket frame.
  useEffect(() => {
    if (!selectedScheduleId) return;
    const summary = summaries.find((candidate) => candidate.schedule.id === selectedScheduleId);
    if (!summary || proctorFacade.isPreviewRuntimeCohortName(summary.schedule.cohortName)) return;
    const schedule = proctorFacade.mapSchedule(summary.schedule);
    const mapped = proctorFacade.mapRuntime(summary.runtime, schedule);
    queryClient.setQueryData<ProctorDetailCache>(proctorKeys.detail(selectedScheduleId), (current) => {
      if (!current) return current;
      return {
        ...current,
        ...reconcileRoomRuntime(current, {
          runtime: mapped,
          clock: { serverNow: mapped.serverNow ?? null, receivedAt: Date.now() },
        }, "summary"),
      };
    });
  }, [detailQueryState.readOrder, queryClient, selectedScheduleId, summaries]);

  const acceptRoomClock = useCallback((candidates: Array<string | null | undefined>) => {
    const serverNow = newestServerNow(candidates);
    if (!serverNow) return;
    const serverNowMs = Date.parse(serverNow);
    if (!Number.isFinite(serverNowMs)) return;
    setAcceptedRoomClock((current) => {
      const heldMs = current.serverNow ? Date.parse(current.serverNow) : Number.NaN;
      // A read older than the accepted instant must not rewind the room: a
      // slow or out-of-order response would otherwise step every countdown on
      // the page backwards while the runtime projection (ordered by the same
      // stamp rule) stayed put. A duplicate stamp keeps the existing anchor so
      // the clock keeps ticking forward from it instead of rewinding to the
      // same instant.
      if (Number.isFinite(heldMs) && serverNowMs <= heldMs) return current;
      return { serverNow, receivedAt: Date.now() };
    });
  }, []);

  const { prune: pruneNotes } = noteOverlay;
  const { prune: pruneRules } = ruleOverlay;

  const applyMonitoringState = useCallback(
    (nextSummaries: typeof summaries, details: ProctorSessionDetailPayload[], detailReadOrder: number) => {
      const filteredSummaries = nextSummaries.filter(
        (summary) => !proctorFacade.isPreviewRuntimeCohortName(summary.schedule.cohortName)
      );
      const filteredDetails = details.filter(
        (detail) => !proctorFacade.isPreviewRuntimeCohortName(detail.schedule.cohortName)
      );

      if (filteredSummaries.length === 0) {
        setAcceptedRoomClock({ serverNow: null, receivedAt: 0 });
        return;
      }

      acceptRoomClock([
        ...filteredSummaries.map((summary) => summary.runtime?.serverNow ?? null),
        ...filteredDetails.flatMap((detail) => [
          detail.runtime?.serverNow ?? null,
          ...detail.sessions.map((session) => session.runtimeServerNow ?? null),
        ]),
      ]);

      const detail = filteredDetails[0];
      if (detail) {
        pruneNotes(detail.schedule.id, detailReadOrder);
        pruneRules(detail.schedule.id, detailReadOrder);
      }
    },
    [acceptRoomClock, pruneNotes, pruneRules]
  );

  useEffect(() => {
    const queryError = summariesQuery.error ?? detailQueryState.error;
    if (queryError) {
      setError(queryError instanceof Error ? queryError.message : "Failed to load proctor data");
      setIsLoading(false);
      return;
    }

    if (!summariesQuery.data) {
      return;
    }

    applyMonitoringState(summariesQuery.data, detailQueryState.details, detailQueryState.readOrder);
    setLastSuccessfulRefreshAt(new Date().toISOString());
    setError(null);
    setIsLoading(detailQueryState.hasPendingDetail);
  }, [
    applyMonitoringState,
    detailQueryState.details,
    detailQueryState.hasPendingDetail,
    detailQueryState.error,
    detailQueryState.readOrder,
    summariesQuery.data,
    summariesQuery.error,
  ]);

  // refetchQueries swallows query errors unless asked: required reconciliation
  // must reject so callers can tell a stale view from a fresh one.
  const refresh = useCallback(async (clearCommandError = false) => {
    const summariesKey = proctorKeys.sessions(options.providerKey);
    await queryClient.refetchQueries({ queryKey: summariesKey }, { throwOnError: true });
    requireUnpausedReads(queryClient, [summariesKey]);
    await Promise.all(
      detailScheduleIds.map((scheduleId) =>
        queryClient.refetchQueries({ queryKey: proctorKeys.detail(scheduleId) }, { throwOnError: true })
      )
    );
    requireUnpausedReads(queryClient, detailScheduleIds.map((id) => proctorKeys.detail(id)));
    if (clearCommandError && selectedScheduleId) setCommandError(selectedScheduleId, null);
  }, [detailScheduleIds, options.providerKey, queryClient, selectedScheduleId, setCommandError]);

  const refreshForUser = useCallback(() => refresh(true), [refresh]);

  const refreshSchedule = useCallback(
    async (scheduleId: string) => {
      // Refresh the summary family this controller subscribes to (SAT rooms
      // and the all-provider overview are different cache entries).
      await Promise.all([
        queryClient.refetchQueries({ queryKey: proctorKeys.sessions(options.providerKey) }, { throwOnError: true }),
        queryClient.refetchQueries({ queryKey: proctorKeys.detail(scheduleId) }, { throwOnError: true }),
      ]);
      requireUnpausedReads(queryClient, [proctorKeys.sessions(options.providerKey), proctorKeys.detail(scheduleId)]);
    },
    [options.providerKey, queryClient]
  );

  /**
   * Reconcile after a confirmed command. Resolves the refresh error (null when
   * the view is fresh). The command already happened, so a failed read is
   * reported as a stale view on the connection banner, never as a failed or
   * repeatable command.
   */
  const reconcileAfterCommand = useCallback(async (
    scheduleId: string,
    outcome: 'confirmed' | 'uncertain' = 'confirmed',
  ): Promise<string | null> => {
    // Other provider families (SAT rooms vs. the all-provider overview) are
    // marked stale too, so no other screen serves the pre-command state.
    void invalidateRoomReads(queryClient, { exceptSummaries: proctorKeys.sessions(options.providerKey) });
    try {
      await queryClient.invalidateQueries({ queryKey: proctorKeys.detail(scheduleId), refetchType: 'none' });
      await refresh();
      return null;
    } catch (refreshError) {
      const prefix = outcome === 'confirmed' ? 'Action confirmed' : 'Action outcome is uncertain';
      const message = refreshError instanceof Error
        ? `${prefix}, but live data could not be refreshed: ${refreshError.message}`
        : `${prefix}, but live data could not be refreshed.`;
      setCommandError(scheduleId, message);
      return message;
    }
  }, [options.providerKey, queryClient, refresh, setCommandError]);

  // Live events arrive in bursts (one per student action). Coalesce them at
  // this boundary into one refresh per window instead of a read per event.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const refreshScheduleRef = useRef(refreshSchedule);
  refreshScheduleRef.current = refreshSchedule;
  const selectedScheduleIdRef = useRef(selectedScheduleId);
  selectedScheduleIdRef.current = selectedScheduleId;
  const pendingLiveRefreshRef = useRef<{ all: boolean; schedules: Set<string> } | null>(null);
  const liveRefreshTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (liveRefreshTimerRef.current !== null) window.clearTimeout(liveRefreshTimerRef.current);
  }, []);

  const handleLiveUpdate = useCallback((event: LiveUpdateEvent) => {
    const scheduleId = getLiveUpdateScheduleId(event);
    const pending = pendingLiveRefreshRef.current ?? { all: false, schedules: new Set<string>() };
    pendingLiveRefreshRef.current = pending;
    if (scheduleId && scheduleId === selectedScheduleIdRef.current) pending.schedules.add(scheduleId);
    else pending.all = true;
    if (liveRefreshTimerRef.current !== null) return;
    liveRefreshTimerRef.current = window.setTimeout(() => {
      liveRefreshTimerRef.current = null;
      const batch = pendingLiveRefreshRef.current;
      pendingLiveRefreshRef.current = null;
      if (!batch) return;
      const work = batch.all
        ? refreshRef.current()
        : Promise.all([...batch.schedules].map((id) => refreshScheduleRef.current(id))).then(() => undefined);
      void work.catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Failed to refresh live data");
      });
    }, LIVE_REFRESH_COALESCE_MS);
  }, []);

  const handleRuntimeSnapshot = useCallback(
    (payload: { scheduleId?: string; runtime: unknown }) => {
      const scheduleId = payload.scheduleId ?? selectedScheduleId;
      if (!scheduleId || scheduleId !== selectedScheduleId) return;
      const schedule = schedules.find((candidate) => candidate.id === scheduleId);
      if (!schedule) return;
      try {
        const mapped = proctorFacade.mapRuntime(
          payload.runtime as Parameters<typeof proctorFacade.mapRuntime>[0],
          schedule
        );
        acceptRoomClock([mapped.serverNow]);
        queryClient.setQueryData<ProctorDetailCache>(proctorKeys.detail(scheduleId), (current) => {
          // A frame is a read like any other: the same-revision tie-break applies,
          // so a live section keeps receiving its fresher clock over the socket
          // while a late or duplicated frame still cannot move it backwards.
          const projection = reconcileRoomRuntime(current, {
            runtime: mapped,
            clock: { serverNow: mapped.serverNow ?? null, receivedAt: Date.now() },
          }, "socket");
          return {
            detail: current?.detail ?? null,
            readOrder: current?.readOrder ?? 0,
            ...projection,
            sessions: current?.sessions ?? EMPTY_SESSIONS,
            room: current?.room ?? EMPTY_ROOM,
            acknowledgedAlertIds: current?.acknowledgedAlertIds ?? [],
            sessionWriteOrders: current?.sessionWriteOrders ?? {},
          };
        });
      } catch {
        // Pull-based refresh remains the recovery path for malformed frames.
      }
    },
    [acceptRoomClock, queryClient, schedules, selectedScheduleId]
  );

  // Staff sockets stay (plan C1 retires student sockets only).
  useLiveUpdates({
    role: 'proctor-observer',
    ...(selectedScheduleId ? { scheduleId: selectedScheduleId } : {}),
    onConnected: () => setWsConnected(true),
    onDisconnected: () => setWsConnected(false),
    onRuntimeSnapshot: handleRuntimeSnapshot,
    onEvent: handleLiveUpdate,
  });

  // ---------------------------------------------------------------- projection
  const roomIsSelected = room.scheduleId !== null && room.scheduleId === selectedScheduleId;
  const alerts = useMemo(() => {
    void alertAckVersion;
    const acknowledged = acknowledgedAlertIdsRef.current;
    const reopened = reopenedAlertIdsRef.current;
    const flag = (alert: ProctorAlert): ProctorAlert => {
      const isAcknowledged = !reopened.has(alert.id) && (alert.isAcknowledged || acknowledged.has(alert.id));
      return alert.isAcknowledged === isAcknowledged ? alert : { ...alert, isAcknowledged };
    };
    const local = localAlerts
      .filter((entry) => entry.scheduleId === selectedScheduleId)
      .map((entry) => entry.alert)
      .filter((alert) => !room.alerts.some((existing) => existing.id === alert.id));
    return [...(roomIsSelected ? room.alerts : []), ...local]
      .map(flag)
      .sort(sortAlertsByTimestamp);
  }, [alertAckVersion, localAlerts, room.alerts, roomIsSelected, selectedScheduleId]);
  const notes = useMemo(
    () => reconcileFullCollection(roomIsSelected ? room.notes : [], noteOverlay.overlay),
    [noteOverlay.overlay, room.notes, roomIsSelected],
  );
  const violationRules = useMemo(
    () => reconcileFullCollection(roomIsSelected ? room.violationRules : [], ruleOverlay.overlay),
    [room.violationRules, roomIsSelected, ruleOverlay.overlay],
  );
  const auditLogs = roomIsSelected ? room.auditLogs : EMPTY_ROOM.auditLogs;

  // ---------------------------------------------------------------- writers for commands
  const patchSession = useCallback((scheduleId: string, attemptId: string, update: (session: StudentSession) => StudentSession) => {
    const writeOrder = nextDetailOrder(queryClient);
    queryClient.setQueryData<ProctorDetailCache>(proctorKeys.detail(scheduleId), (current) => {
      if (!current || !current.sessions.some((session) => session.id === attemptId)) return current;
      return {
        ...current,
        sessions: current.sessions.map((session) => (session.id === attemptId ? update(session) : session)),
        sessionWriteOrders: { ...current.sessionWriteOrders, [attemptId]: writeOrder },
      };
    });
  }, [queryClient]);

  const setAlertAcknowledged = useCallback((alertIds: readonly string[], acknowledged: boolean) => {
    for (const id of alertIds) {
      if (acknowledged) {
        acknowledgedAlertIdsRef.current.add(id);
        reopenedAlertIdsRef.current.delete(id);
      } else {
        reopenedAlertIdsRef.current.add(id);
      }
    }
    setAlertAckVersion((version) => version + 1);
  }, []);

  const forgetAlertAcknowledgement = useCallback((alertId: string) => {
    acknowledgedAlertIdsRef.current.delete(alertId);
    setAlertAckVersion((version) => version + 1);
  }, []);

  const confirmAlertAcknowledgements = useCallback((scheduleId: string, alertIds: readonly string[]) => {
    if (alertIds.length === 0) return;
    const confirmed = new Set(alertIds);
    queryClient.setQueryData<ProctorDetailCache>(proctorKeys.detail(scheduleId), (current) => {
      if (!current) return current;
      return {
        ...current,
        acknowledgedAlertIds: [...new Set([...current.acknowledgedAlertIds, ...confirmed])],
        room: {
          ...current.room,
          alerts: current.room.alerts.map((alert) =>
            confirmed.has(alert.id) ? { ...alert, isAcknowledged: true } : alert),
        },
      };
    });
  }, [queryClient]);

  /** Re-read one room's detail; an in-flight read is cancelled so the answer reflects the command. */
  const invalidateRoomDetail = useCallback(
    (scheduleId: string) => queryClient.invalidateQueries({ queryKey: proctorKeys.detail(scheduleId) }),
    [queryClient],
  );

  const markRoomDetailStale = useCallback(
    (scheduleId: string) => queryClient.invalidateQueries({ queryKey: proctorKeys.detail(scheduleId), refetchType: 'none' }),
    [queryClient],
  );

  const addLocalAlerts = useCallback((scheduleId: string, next: ProctorAlert[]) => {
    setLocalAlerts((current) => {
      const existingIds = new Set(current.filter((entry) => entry.scheduleId === scheduleId).map((entry) => entry.alert.id));
      const added = next.filter((alert) => !existingIds.has(alert.id));
      return added.length === 0 ? current : [...current, ...added.map((alert) => ({ scheduleId, alert }))];
    });
  }, []);

  return {
    alerts,
    auditLogs,
    degradedLiveMode,
    error: (selectedScheduleId ? commandErrors[selectedScheduleId] : null) ?? error,
    isLoading,
    lastSuccessfulRefreshAt,
    wsConnected,
    notes,
    runtimeSnapshots,
    roomClock,
    schedules,
    scheduleMetrics,
    sessions,
    selectedScheduleId,
    setSelectedScheduleId: setSelectedScheduleId as Dispatch<SetStateAction<string | null>>,
    violationRules,
    refresh: refreshForUser,
    // Command-side writers: typed, narrow, and never handed to views.
    reconcileAfterCommand,
    invalidateRoomDetail,
    markRoomDetailStale,
    setError,
    setCommandError,
    patchSession,
    setAlertAcknowledged,
    forgetAlertAcknowledgement,
    confirmAlertAcknowledgements,
    addLocalAlerts,
    noteOverlay,
    ruleOverlay,
  };
}

export type ProctorMonitoring = ReturnType<typeof useProctorMonitoring>;
