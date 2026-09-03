import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useLiveUpdates, type LiveUpdateEvent } from "@shared/hooks/useLiveUpdates";
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
  error: string | null;
  isLoading: boolean;
  notes: SessionNote[];
  runtimeSnapshots: ExamSessionRuntime[];
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

export function useProctorRouteController(): ProctorRouteController {
  const queryClient = useQueryClient();
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [runtimeSnapshots, setRuntimeSnapshots] = useState<ExamSessionRuntime[]>([]);
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [alerts, setAlerts] = useState<ProctorAlert[]>([]);
  const [auditLogs, setAuditLogs] = useState<SessionAuditLog[]>([]);
  const [notes, setNotes] = useState<SessionNote[]>([]);
  const [violationRules, setViolationRules] = useState<ViolationRule[]>([]);
  const [scheduleMetrics, setScheduleMetrics] = useState<Record<string, ProctorScheduleMetrics>>(
    {}
  );
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaryPollIntervalMs, setSummaryPollIntervalMs] = useState(4_000);
  const [detailPollIntervalMs, setDetailPollIntervalMs] = useState(6_000);
  const scheduleStudentIdsRef = useRef<Map<string, Set<string>>>(new Map());

  const summariesQuery = useProctorSessionSummaries(summaryPollIntervalMs);
  const summaries = useMemo(() => summariesQuery.data ?? [], [summariesQuery.data]);
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
    }),
  });

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
        setScheduleMetrics({});
        setSessions([]);
        setAlerts([]);
        setAuditLogs([]);
        setNotes([]);
        setViolationRules([]);
        setSummaryPollIntervalMs(4_000);
        setDetailPollIntervalMs(6_000);
        return;
      }

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
      setSummaryPollIntervalMs(degradedMode ? 2_000 : 4_000);
      setDetailPollIntervalMs(degradedMode ? 3_000 : 6_000);
      setScheduleMetrics(metrics);
      setSchedules(filteredSummaries.map((summary) => proctorFacade.mapSchedule(summary.schedule)));
      setRuntimeSnapshots(
        filteredSummaries.map((summary) =>
          proctorFacade.mapRuntime(summary.runtime, proctorFacade.mapSchedule(summary.schedule))
        )
      );

      for (const detail of filteredDetails) {
        const scheduleId = detail.schedule.id;
        scheduleStudentIdsRef.current.set(
          scheduleId,
          new Set(detail.sessions.map((session) => session.studentId))
        );
      }

      setRuntimeSnapshots((current) => {
        const bySchedule = new Map(current.map((runtime) => [runtime.scheduleId, runtime]));
        for (const detail of filteredDetails) {
          const schedule = proctorFacade.mapSchedule(detail.schedule);
          bySchedule.set(detail.schedule.id, {
            ...proctorFacade.mapRuntime(detail.runtime, schedule),
            proctorPresence: (detail.presence ?? []).map(mapBackendProctorPresence),
          });
        }
        return [...bySchedule.values()];
      });

      setSessions(
        filteredDetails
          .flatMap((detail) => detail.sessions)
          .map(mapBackendSessionSummary)
          .sort(sortSessionsByLastActivity)
      );
      setAlerts(
        filteredDetails
          .flatMap((detail) => detail.alerts)
          .map(mapBackendAlert)
          .sort(sortAlertsByTimestamp)
      );
      setAuditLogs(filteredDetails.flatMap((detail) => detail.auditLogs).map(mapBackendAuditLog));
      setNotes(filteredDetails.flatMap((detail) => detail.notes).map(mapBackendNote));
      setViolationRules(
        filteredDetails.flatMap((detail) => detail.violationRules).map(mapBackendViolationRule)
      );
    },
    []
  );

  useEffect(() => {
    if (summariesQuery.error) {
      setError(
        summariesQuery.error instanceof Error
          ? summariesQuery.error.message
          : "Failed to load proctor data"
      );
      setIsLoading(false);
      return;
    }

    if (!summariesQuery.data) {
      return;
    }

    applyMonitoringState(summariesQuery.data, detailQueryState.details);
    setError(null);
    setIsLoading(detailQueryState.hasPendingDetail);
  }, [
    applyMonitoringState,
    detailQueryState.details,
    detailQueryState.hasPendingDetail,
    summariesQuery.data,
    summariesQuery.error,
  ]);

  const refresh = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: proctorKeys.sessions() });
    await Promise.all(
      detailScheduleIds.map((scheduleId) =>
        queryClient.refetchQueries({ queryKey: proctorKeys.detail(scheduleId) })
      )
    );
  }, [detailScheduleIds, queryClient]);

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

  useLiveUpdates({
    ...(selectedScheduleId ? { scheduleId: selectedScheduleId } : {}),
    onEvent: handleLiveUpdate,
  });

  const handleStartScheduledSession = useCallback(
    async (scheduleId: string) => {
      const result = await proctorFacade.delivery.startRuntime(scheduleId, "Proctor");
      if (!result.success) {
        setError(result.error ?? "Failed to start exam");
        return;
      }

      setError(null);
      await loadMonitoringState();
    },
    [loadMonitoringState]
  );

  const handlePauseCohort = useCallback(
    async (scheduleId: string) => {
      await proctorFacade.delivery.pauseRuntime(scheduleId, "Proctor");
      await loadMonitoringState();
    },
    [loadMonitoringState]
  );

  const handleResumeCohort = useCallback(
    async (scheduleId: string) => {
      await proctorFacade.delivery.resumeRuntime(scheduleId, "Proctor");
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
        expectedActiveSectionKey
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
        expectedActiveSectionKey
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

  const evaluateViolationRules = useCallback(
    async (scheduleId: string, studentSessions: StudentSession[]) => {
      const rules = violationRules.filter((rule) => rule.scheduleId === scheduleId);
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

          if (!shouldTrigger) {
            continue;
          }

          if (rule.action === "warn") {
            await proctorFacade.delivery.warnStudent(
              session.id,
              `Auto-warning triggered by ${rule.triggerType}`,
              "system"
            );
          } else if (rule.action === "pause") {
            await proctorFacade.delivery.pauseStudentAttempt(session.id, "system");
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
            await proctorFacade.delivery.terminateStudentAttempt(session.id, "system");
          }
        }
      }

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
    [loadMonitoringState, violationRules]
  );

  return {
    alerts,
    auditLogs,
    error,
    isLoading,
    notes,
    runtimeSnapshots,
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
