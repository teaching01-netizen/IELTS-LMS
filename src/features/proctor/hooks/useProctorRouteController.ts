import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useLiveUpdates, type LiveUpdateEvent } from "@shared/hooks/useLiveUpdates";
import type { ServerClockSnapshot } from "@shared/hooks/useAuthoritativeDeadlineClock";
import {
  fetchProctorSessionDetail,
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
import type { ExamSchedule, ExamSessionRuntime } from "../../../types/domain";
import type { ProctorPresence } from "../../../types/domain";
import type { ProctorScheduleMetrics } from "../contracts";
import { mergeProctorRuntime, runtimeProjectionSupersedes } from "../domain/mergeProctorRuntime";

function mapBackendSessionSummary(payload: {
  attemptId: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  scheduleId: string;
  status: StudentSession["status"];
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
  runtimeWaiting: boolean;
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
    runtimeSectionStatus: payload.runtimeSectionStatus ?? undefined,
    runtimeWaiting: payload.runtimeWaiting,
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

export interface ProctorRouteController {
  alerts: ProctorAlert[];
  auditLogs: SessionAuditLog[];
  degradedLiveMode: boolean;
  error: string | null;
  isLoading: boolean;
  lastSuccessfulRefreshAt: string | null;
  wsConnected: boolean | null;
  notes: SessionNote[];
  runtimeSnapshots: ExamSessionRuntime[];
  roomClock: ServerClockSnapshot;
  schedules: ExamSchedule[];
  scheduleMetrics: Record<string, ProctorScheduleMetrics>;
  sessions: StudentSession[];
  selectedScheduleId: string | null;
  setSelectedScheduleId: Dispatch<SetStateAction<string | null>>;
  violationRules: ViolationRule[];
  handleCompleteExam: (scheduleId: string) => Promise<void>;
  handleEndSectionNow: (scheduleId: string) => Promise<void>;
  handleExtendCurrentSection: (scheduleId: string, minutes: number) => Promise<void>;
  handlePauseCohort: (scheduleId: string) => Promise<void>;
  handleResumeCohort: (scheduleId: string) => Promise<void>;
  handleStartScheduledSession: (scheduleId: string) => Promise<void>;
  reload: () => Promise<void>;
  setAlerts: Dispatch<SetStateAction<ProctorAlert[]>>;
  setNotes: Dispatch<SetStateAction<SessionNote[]>>;
  setSessions: Dispatch<SetStateAction<StudentSession[]>>;
  setViolationRules: Dispatch<SetStateAction<ViolationRule[]>>;
  evaluateViolationRules: (scheduleId: string, studentSessions: StudentSession[]) => Promise<void>;
}

export interface ProctorRouteControllerOptions {
  providerKey?: "sat" | "ielts" | "act";
  initialScheduleId?: string | null;
}

export function useProctorRouteController(
  options: ProctorRouteControllerOptions = {}
): ProctorRouteController {
  const queryClient = useQueryClient();
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [runtimeSnapshots, setRuntimeSnapshots] = useState<ExamSessionRuntime[]>([]);
  // One accepted server instant for the whole room: the stamp of the freshest
  // payload plus the local instant it arrived. See mergeProctorRuntime for why
  // the runtime projection alone cannot be trusted to be the freshest read.
  const [roomClock, setRoomClock] = useState<ServerClockSnapshot>({ serverNow: null, receivedAt: 0 });
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [alerts, setAlerts] = useState<ProctorAlert[]>([]);
  const [auditLogs, setAuditLogs] = useState<SessionAuditLog[]>([]);
  const [notes, setNotes] = useState<SessionNote[]>([]);
  const [violationRules, setViolationRules] = useState<ViolationRule[]>([]);
  const [scheduleMetrics, setScheduleMetrics] = useState<Record<string, ProctorScheduleMetrics>>(
    {}
  );
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(
    options.initialScheduleId ?? null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [degradedLiveMode, setDegradedLiveMode] = useState(false);
  const [wsConnected, setWsConnected] = useState<boolean | null>(null);
  // Poll floors: summary 10s, detail 15s. Tighter cadences burned through
  // the shared global rate-limit bucket that also guards auth session
  // reads; the dedicated polling/heartbeat tiers now bound each class.
  const [summaryPollIntervalMs, setSummaryPollIntervalMs] = useState(10_000);
  const [detailPollIntervalMs, setDetailPollIntervalMs] = useState(15_000);
  const scheduleStudentIdsRef = useRef<Map<string, Set<string>>>(new Map());

  const summariesQuery = useProctorSessionSummaries(summaryPollIntervalMs, options.providerKey);
  const summaries = useMemo(() => summariesQuery.data ?? [], [summariesQuery.data]);
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

    const scheduleStillExists = summaries.some(
      (summary) => summary.schedule.id === selectedScheduleId
    );
    if (!scheduleStillExists) {
      setSelectedScheduleId(null);
      return;
    }
  }, [selectedScheduleId, summaries, summariesQuery.data]);

  const detailScheduleIds = useMemo(() => {
    if (!selectedScheduleId) {
      return [];
    }
    return [selectedScheduleId];
  }, [selectedScheduleId]);

  const detailQueryState = useQueries({
    queries: detailScheduleIds.map((scheduleId) => ({
      queryKey: proctorKeys.detail(scheduleId),
      queryFn: () => fetchProctorSessionDetail(scheduleId),
      ...liveQueryPolicy,
      refetchInterval: detailPollIntervalMs,
    })),
    combine: (results) => ({
      details: results
        .map((result) => result.data)
        .filter((detail): detail is ProctorSessionDetailPayload => detail !== undefined),
      hasPendingDetail: results.some((result) => result.isPending),
      error: results.find((result) => result.error)?.error ?? null,
    }),
  });

  const acceptRoomClock = useCallback((candidates: Array<string | null | undefined>) => {
    const serverNow = newestServerNow(candidates);
    if (!serverNow) return;
    setRoomClock((current) =>
      current.serverNow === serverNow ? current : { serverNow, receivedAt: Date.now() }
    );
  }, []);

  const applyMonitoringState = useCallback(
    (nextSummaries: typeof summaries, details: ProctorSessionDetailPayload[]) => {
      const filteredSummaries = nextSummaries.filter(
        (summary) => !proctorFacade.isPreviewRuntimeCohortName(summary.schedule.cohortName)
      );
      const filteredDetails = details.filter(
        (detail) => !proctorFacade.isPreviewRuntimeCohortName(detail.schedule.cohortName)
      );

      if (filteredSummaries.length === 0) {
        scheduleStudentIdsRef.current.clear();
        setSchedules([]);
        setRuntimeSnapshots([]);
        setRoomClock({ serverNow: null, receivedAt: 0 });
        setScheduleMetrics({});
        setSessions([]);
        setAlerts([]);
        setAuditLogs([]);
        setNotes([]);
        setViolationRules([]);
        setSummaryPollIntervalMs(10_000);
        setDetailPollIntervalMs(15_000);
        return;
      }

      acceptRoomClock([
        ...filteredSummaries.map((summary) => summary.runtime?.serverNow ?? null),
        ...filteredDetails.flatMap((detail) => [
          detail.runtime?.serverNow ?? null,
          ...detail.sessions.map((session) => session.runtimeServerNow ?? null),
        ]),
      ]);

      const metrics: Record<string, ProctorScheduleMetrics> = {};
      for (const summary of filteredSummaries) {
        const studentCount = summary.studentCount ?? 0;
        const joinReadyCount = summary.joinReadyCount ?? studentCount;
        const joinTotalCount = Math.max(summary.joinTotalCount ?? studentCount, joinReadyCount);
        metrics[summary.schedule.id] = {
          studentCount,
          activeCount: summary.activeCount ?? 0,
          joinReadyCount,
          joinTotalCount,
          alertCount: summary.alertCount ?? 0,
          violationCount: summary.violationCount ?? 0,
          degradedLiveMode: summary.degradedLiveMode,
        };
      }

      const degradedMode = filteredSummaries.some((summary) => summary.degradedLiveMode);
      setDegradedLiveMode(degradedMode);
      // Degraded live mode polls faster to recover, but never below the
      // floors that protect the shared rate-limit budget.
      setSummaryPollIntervalMs(degradedMode ? 5_000 : 10_000);
      setDetailPollIntervalMs(degradedMode ? 8_000 : 15_000);
      setScheduleMetrics(metrics);
      setSchedules(filteredSummaries.map((summary) => proctorFacade.mapSchedule(summary.schedule)));
      for (const detail of filteredDetails) {
        const scheduleId = detail.schedule.id;
        scheduleStudentIdsRef.current.set(
          scheduleId,
          new Set(detail.sessions.map((session) => session.studentId))
        );
      }

      setRuntimeSnapshots((current) => {
        // Summary refreshes omit the detail-only exam plan. Merge them into the
        // existing runtime instead of replacing it, so a poll that arrives
        // before its detail query cannot erase the run sheet.
        const bySchedule = new Map(
          filteredSummaries.map((summary) => {
            const schedule = proctorFacade.mapSchedule(summary.schedule);
            const mapped = proctorFacade.mapRuntime(summary.runtime, schedule);
            return [
              schedule.id,
              mergeProctorRuntime(
                current.find((runtime) => runtime.scheduleId === schedule.id),
                mapped,
              ),
            ] as const;
          }),
        );
        for (const detail of filteredDetails) {
          const schedule = proctorFacade.mapSchedule(detail.schedule);
          const mapped = proctorFacade.mapRuntime(detail.runtime, schedule);
          const existing = bySchedule.get(detail.schedule.id);
          bySchedule.set(
            detail.schedule.id,
            mergeProctorRuntime(
              existing,
              mapped,
              (detail.presence ?? []).map(mapBackendProctorPresence),
            ),
          );
        }
        return [...bySchedule.values()];
      });

      // Revision-guarded session merge: a WS runtime_snapshot arriving
      // between poll and apply must not be clobbered by older poll data.
      // Merge by id, keeping the entry with the newer lastActivity; the WS
      // path only ever advances revisions (see handleRuntimeSnapshot).
      setSessions((current) => {
        const incoming = filteredDetails
          .flatMap((detail) => detail.sessions)
          .map(mapBackendSessionSummary)
          .sort(sortSessionsByLastActivity);
        if (current.length === 0) {
          return incoming;
        }
        const incomingById = new Map(incoming.map((session) => [session.id, session]));
        const merged = current.map((existing) => {
          const next = incomingById.get(existing.id);
          if (!next) {
            return existing;
          }
          incomingById.delete(existing.id);
          return next.lastActivity >= existing.lastActivity ? next : existing;
        });
        return [...merged, ...incomingById.values()].sort(sortSessionsByLastActivity);
      });
      // Merge-by-id+updatedAt: server poll results merge into local state so
      // optimistic acknowledge edits and locally-created notes/rules made
      // while a request is in flight are preserved (server wins only on newer
      // updatedAt).
      const mergeById = <T extends { id: string; updatedAt?: string }>(
        current: T[],
        incoming: T[]
      ): T[] => {
        if (current.length === 0) {
          return incoming;
        }
        const incomingById = new Map(incoming.map((row) => [row.id, row]));
        const merged = current.map((existing) => {
          const next = incomingById.get(existing.id);
          if (!next) {
            return existing;
          }
          incomingById.delete(existing.id);
          const existingTs = existing.updatedAt ?? "";
          const nextTs = next.updatedAt ?? "";
          return nextTs >= existingTs ? { ...existing, ...next } : existing;
        });
        return [...merged, ...incomingById.values()];
      };
      setAlerts((current) =>
        mergeById(
          current,
          filteredDetails.flatMap((detail) => detail.alerts).map(mapBackendAlert)
        ).sort(sortAlertsByTimestamp)
      );
      setAuditLogs((current) =>
        mergeById(
          current,
          filteredDetails.flatMap((detail) => detail.auditLogs).map(mapBackendAuditLog)
        )
      );
      setNotes((current) =>
        mergeById(current, filteredDetails.flatMap((detail) => detail.notes).map(mapBackendNote))
      );
      setViolationRules((current) =>
        mergeById(
          current,
          filteredDetails.flatMap((detail) => detail.violationRules).map(mapBackendViolationRule)
        )
      );
    },
    [acceptRoomClock]
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

    applyMonitoringState(summariesQuery.data, detailQueryState.details);
    setLastSuccessfulRefreshAt(new Date().toISOString());
    setError(null);
    setIsLoading(detailQueryState.hasPendingDetail);
  }, [
    applyMonitoringState,
    detailQueryState.details,
    detailQueryState.hasPendingDetail,
    detailQueryState.error,
    summariesQuery.data,
    summariesQuery.error,
  ]);

  const refresh = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: proctorKeys.sessions(options.providerKey) });
    await Promise.all(
      detailScheduleIds.map((scheduleId) =>
        queryClient.refetchQueries({ queryKey: proctorKeys.detail(scheduleId) })
      )
    );
  }, [detailScheduleIds, options.providerKey, queryClient]);

  const refreshSchedule = useCallback(
    async (scheduleId: string) => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: proctorKeys.sessions() }),
        queryClient.refetchQueries({ queryKey: proctorKeys.detail(scheduleId) }),
      ]);
    },
    [queryClient]
  );

  const loadMonitoringState = refresh;

  const handleLiveUpdate = useCallback(
    (event: LiveUpdateEvent) => {
      const scheduleId = getLiveUpdateScheduleId(event);
      if (!scheduleId) {
        void refresh();
        return;
      }

      if (selectedScheduleId !== scheduleId) {
        void refresh().catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : "Failed to refresh live data");
        });
        return;
      }

      void refreshSchedule(scheduleId).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Failed to refresh live data");
      });
    },
    [refresh, refreshSchedule, selectedScheduleId]
  );

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
        setRuntimeSnapshots((current) => {
          const existing = current.find((runtime) => runtime.scheduleId === scheduleId);
          // A frame is a read like any other: the same-revision tie-break applies,
          // so a live section keeps receiving its fresher clock over the socket
          // while a late or duplicated frame still cannot move it backwards.
          if (existing && !runtimeProjectionSupersedes(existing, mapped)) return current;
          return [
            ...current.filter((runtime) => runtime.scheduleId !== scheduleId),
            mergeProctorRuntime(existing, mapped),
          ];
        });
      } catch {
        // Pull-based refresh remains the recovery path for malformed frames.
      }
    },
    [acceptRoomClock, schedules, selectedScheduleId]
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

  const handleStartScheduledSession = useCallback(
    async (scheduleId: string) => {
      const result = await proctorFacade.delivery.startRuntime(scheduleId, "Proctor");
      if (!result.success) {
        throw new Error(result.error ?? "Failed to start runtime");
      }
      await loadMonitoringState();
    },
    [loadMonitoringState]
  );

  const handlePauseCohort = useCallback(
    async (scheduleId: string) => {
      const result = await proctorFacade.delivery.pauseRuntime(scheduleId, "Proctor");
      if (!result.success) {
        throw new Error(result.error ?? "Failed to pause runtime");
      }
      await loadMonitoringState();
    },
    [loadMonitoringState]
  );

  const handleResumeCohort = useCallback(
    async (scheduleId: string) => {
      const result = await proctorFacade.delivery.resumeRuntime(scheduleId, "Proctor");
      if (!result.success) {
        throw new Error(result.error ?? "Failed to resume runtime");
      }
      await loadMonitoringState();
    },
    [loadMonitoringState]
  );

  const handleEndSectionNow = useCallback(
    async (scheduleId: string) => {
      const runtime = runtimeSnapshots.find((candidate) => candidate.scheduleId === scheduleId);
      const expectedActiveSectionKey =
        runtime?.activeSectionKey ?? runtime?.currentSectionKey ?? undefined;
      const result = await proctorFacade.delivery.endCurrentSectionNow(
        scheduleId,
        "Proctor",
        expectedActiveSectionKey,
        runtime?.revision ?? undefined
      );
      if (!result.success) {
        setError(result.error ?? "Failed to end section");
      } else {
        setError(null);
      }
      await loadMonitoringState();
    },
    [loadMonitoringState, runtimeSnapshots]
  );

  const handleExtendCurrentSection = useCallback(
    async (scheduleId: string, minutes: number) => {
      const runtime = runtimeSnapshots.find((candidate) => candidate.scheduleId === scheduleId);
      const expectedActiveSectionKey =
        runtime?.activeSectionKey ?? runtime?.currentSectionKey ?? undefined;
      const result = await proctorFacade.delivery.extendCurrentSection(
        scheduleId,
        "Proctor",
        minutes,
        expectedActiveSectionKey,
        runtime?.revision ?? undefined
      );
      if (!result.success) {
        setError(result.error ?? "Failed to extend section");
      } else {
        setError(null);
      }
      await loadMonitoringState();
    },
    [loadMonitoringState, runtimeSnapshots]
  );

  const handleCompleteExam = useCallback(
    async (scheduleId: string) => {
      await proctorFacade.delivery.completeRuntime(scheduleId, "Proctor");
      await loadMonitoringState();
    },
    [loadMonitoringState]
  );

  // Fired-rule dedupe: a rule fires once while its condition remains true for
  // a session. Warning/pause actions append or mutate session state, so using
  // the raw violation count would fire the same rule again after its own
  // action was recorded.
  const firedAutoRulesRef = useRef<Set<string>>(new Set());
  const violationRulesRef = useRef(violationRules);
  violationRulesRef.current = violationRules;
  const evaluateViolationRules = useCallback(
    async (scheduleId: string, studentSessions: StudentSession[]) => {
      const rules = violationRulesRef.current.filter((rule) => rule.scheduleId === scheduleId);
      const activeRules = rules.filter((rule) => rule.isEnabled);

      if (activeRules.length === 0) {
        return;
      }

      const notifyAlerts: ProctorAlert[] = [];

      for (const session of studentSessions) {
        if (session.scheduleId !== scheduleId) {
          continue;
        }

        for (const rule of activeRules) {
          let shouldTrigger = false;

          switch (rule.triggerType) {
            case "violation_count":
              shouldTrigger = session.violations.length >= rule.threshold;
              break;
            case "specific_violation_type":
              shouldTrigger =
                session.violations.filter(
                  (violation) => violation.type === rule.specificViolationType
                ).length >= rule.threshold;
              break;
            case "severity_threshold":
              shouldTrigger =
                session.violations.filter(
                  (violation) => violation.severity === rule.specificSeverity
                ).length >= rule.threshold;
              break;
          }

          const fireKey = `${rule.id}::${session.id}`;
          if (!shouldTrigger) {
            firedAutoRulesRef.current.delete(fireKey);
            continue;
          }

          if (session.status === "terminated") {
            continue;
          }

          // Dedupe until the trigger condition drops below its threshold.
          if (firedAutoRulesRef.current.has(fireKey)) {
            continue;
          }

          if (rule.action === "warn") {
            const result = await proctorFacade.delivery.warnStudent(
              session.id,
              `Auto-warning triggered by ${rule.triggerType}`,
              "system"
            );
            if (!result.success) {
              continue;
            }
          } else if (rule.action === "pause") {
            const result = await proctorFacade.delivery.pauseStudentAttempt(session.id, "system");
            if (!result.success) {
              continue;
            }
          } else if (rule.action === "notify_proctor") {
            const latestViolationId = session.violations.at(-1)?.id ?? "none";
            notifyAlerts.push({
              id: `auto-rule-notify:${rule.id}:${session.id}:${latestViolationId}:${session.violations.length}`,
              severity: rule.specificSeverity ?? "high",
              type: "RULE_NOTIFY_PROCTOR",
              studentName: session.name,
              studentId: session.studentId,
              timestamp: new Date().toISOString(),
              message: `Auto-rule notification: ${rule.triggerType} threshold reached for ${session.name}.`,
              isAcknowledged: false,
            });
          } else if (rule.action === "terminate") {
            const result = await proctorFacade.delivery.terminateStudentAttempt(
              session.id,
              "system"
            );
            if (!result.success) {
              continue;
            }
          }
          firedAutoRulesRef.current.add(fireKey);
        }
      }

      // Keep the explicit evaluator contract fresh even when no threshold
      // was met; the caller also uses this method after a manual refresh.
      await loadMonitoringState();

      if (notifyAlerts.length > 0) {
        setAlerts((currentAlerts) => {
          const existingIds = new Set(currentAlerts.map((alert) => alert.id));
          const nextAlerts = notifyAlerts.filter((alert) => !existingIds.has(alert.id));
          if (nextAlerts.length === 0) {
            return currentAlerts;
          }
          return [...nextAlerts, ...currentAlerts].sort(sortAlertsByTimestamp);
        });
      }
    },
    [loadMonitoringState]
  );

  // Evaluate rules at the selected monitoring boundary so automatic
  // responses work for both polling and WebSocket recovery without requiring
  // a proctor to call an internal callback manually.
  const autoEvaluationSignature = useMemo(() => {
    if (!selectedScheduleId || isLoading) {
      return null;
    }

    const activeRules = violationRules
      .filter((rule) => rule.scheduleId === selectedScheduleId && rule.isEnabled)
      .map((rule) => ({
        id: rule.id,
        triggerType: rule.triggerType,
        threshold: rule.threshold,
        specificViolationType: rule.specificViolationType ?? null,
        specificSeverity: rule.specificSeverity ?? null,
        action: rule.action,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (activeRules.length === 0) {
      return null;
    }

    const scopedSessions = sessions
      .filter((session) => session.scheduleId === selectedScheduleId)
      .map((session) => ({
        id: session.id,
        status: session.status,
        violations: session.violations.map((violation) =>
          `${violation.id}:${violation.type}:${violation.severity}`
        ),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

    return JSON.stringify({ rules: activeRules, sessions: scopedSessions });
  }, [isLoading, selectedScheduleId, sessions, violationRules]);

  const lastAutoEvaluationSignatureRef = useRef<string | null>(null);
  const autoEvaluationInFlightRef = useRef(false);
  const [autoEvaluationTick, setAutoEvaluationTick] = useState(0);

  useEffect(() => {
    if (!autoEvaluationSignature || !selectedScheduleId) {
      lastAutoEvaluationSignatureRef.current = null;
      return;
    }
    if (
      autoEvaluationSignature === lastAutoEvaluationSignatureRef.current ||
      autoEvaluationInFlightRef.current
    ) {
      return;
    }

    lastAutoEvaluationSignatureRef.current = autoEvaluationSignature;
    autoEvaluationInFlightRef.current = true;
    void evaluateViolationRules(selectedScheduleId, sessions)
      .catch((evaluationError) => {
        setError(
          evaluationError instanceof Error
            ? evaluationError.message
            : "Failed to evaluate violation rules"
        );
      })
      .finally(() => {
        autoEvaluationInFlightRef.current = false;
        setAutoEvaluationTick((current) => current + 1);
      });
  }, [
    autoEvaluationSignature,
    autoEvaluationTick,
    evaluateViolationRules,
    isLoading,
    selectedScheduleId,
    sessions,
  ]);

  return {
    alerts,
    auditLogs,
    degradedLiveMode,
    error,
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
    setSelectedScheduleId,
    violationRules,
    handleCompleteExam,
    handleEndSectionNow,
    handleExtendCurrentSection,
    handlePauseCohort,
    handleResumeCohort,
    handleStartScheduledSession,
    reload: refresh,
    setAlerts,
    setNotes,
    setSessions,
    setViolationRules,
    evaluateViolationRules,
  };
}
