import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useAsyncPolling } from '@app/hooks/useAsyncPolling';
import { examDeliveryService } from '@services/examDeliveryService';
import { examRepository } from '@services/examRepository';
import { studentAttemptRepository } from '@services/studentAttemptRepository';
import type {
  ProctorAlert,
  SessionAuditLog,
  SessionNote,
  StudentSession,
  ViolationRule,
  ViolationSeverity,
} from '../../../types';
import type { ExamSchedule, ExamSessionRuntime } from '../../../types/domain';
import type { StudentAttempt } from '../../../types/studentAttempt';

const ALERT_ACTION_TYPES = new Set<SessionAuditLog['actionType']>([
  'VIOLATION_DETECTED',
  'HEARTBEAT_LOST',
  'DEVICE_CONTINUITY_FAILED',
  'NETWORK_DISCONNECTED',
  'AUTO_ACTION',
  'STUDENT_WARN',
  'STUDENT_PAUSE',
  'STUDENT_TERMINATE',
]);

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getSessionStatus(attempt: StudentAttempt): StudentSession['status'] {
  if (attempt.proctorStatus === 'terminated' || attempt.phase === 'post-exam') {
    return 'terminated';
  }

  if (attempt.proctorStatus === 'paused') {
    return 'paused';
  }

  if (attempt.integrity.lastHeartbeatStatus === 'lost') {
    return 'connecting';
  }

  if (attempt.proctorStatus === 'warned') {
    return 'warned';
  }

  if (attempt.phase === 'exam') {
    return 'active';
  }

  return 'idle';
}

function getLastActivityTimestamp(
  attempt: StudentAttempt,
  heartbeatTimestamps: string[],
  auditTimestamps: string[],
) {
  const timestamps = [
    attempt.updatedAt,
    attempt.integrity.lastHeartbeatAt,
    ...heartbeatTimestamps,
    ...auditTimestamps,
  ].filter((value): value is string => Boolean(value));

  if (timestamps.length === 0) {
    return attempt.updatedAt;
  }

  return timestamps.reduce((latest, current) =>
    new Date(current).getTime() > new Date(latest).getTime() ? current : latest,
  );
}

function getAlertSeverity(
  log: SessionAuditLog,
  attempt: StudentAttempt | undefined,
): ViolationSeverity {
  const payloadSeverity = log.payload?.['severity'];
  if (
    payloadSeverity === 'low' ||
    payloadSeverity === 'medium' ||
    payloadSeverity === 'high' ||
    payloadSeverity === 'critical'
  ) {
    return payloadSeverity;
  }

  if (log.actionType === 'DEVICE_CONTINUITY_FAILED' || log.actionType === 'STUDENT_TERMINATE') {
    return 'critical';
  }

  if (log.actionType === 'HEARTBEAT_LOST' || log.actionType === 'NETWORK_DISCONNECTED') {
    return 'high';
  }

  if (log.actionType === 'STUDENT_WARN') {
    return 'medium';
  }

  return (
    attempt?.violations.find((violation) => violation.id === log.payload?.['warningId'])?.severity ??
    'medium'
  );
}

function getAlertMessage(log: SessionAuditLog): string {
  const payloadMessage =
    log.payload?.['message'] ??
    log.payload?.['description'] ??
    log.payload?.['reason'] ??
    null;

  if (typeof payloadMessage === 'string' && payloadMessage.length > 0) {
    return payloadMessage;
  }

  switch (log.actionType) {
    case 'HEARTBEAT_LOST':
      return 'Candidate heartbeat was lost.';
    case 'DEVICE_CONTINUITY_FAILED':
      return 'Device continuity validation failed.';
    case 'NETWORK_DISCONNECTED':
      return 'Candidate went offline.';
    case 'STUDENT_WARN':
      return 'Proctor warning issued.';
    case 'STUDENT_PAUSE':
      return 'Candidate session paused by proctor.';
    case 'STUDENT_TERMINATE':
      return 'Candidate session terminated by proctor.';
    default:
      return 'Monitoring alert detected.';
  }
}

function mapAttemptsToSessions(
  attempts: StudentAttempt[],
  schedules: ExamSchedule[],
  runtimes: ExamSessionRuntime[],
  auditLogs: SessionAuditLog[],
  heartbeatMap: Map<string, string[]>,
): StudentSession[] {
  return attempts
    .filter((attempt) => schedules.some((schedule) => schedule.id === attempt.scheduleId))
    .map((attempt) => {
      const runtime = runtimes.find((candidate) => candidate.scheduleId === attempt.scheduleId);
      const auditTimestamps = auditLogs
        .filter((log) => log.targetStudentId === attempt.id)
        .map((log) => log.timestamp);
      const heartbeatTimestamps = heartbeatMap.get(attempt.id) ?? [];
      const warningCount = attempt.violations.filter(
        (violation) =>
          violation.type === 'PROCTOR_WARNING' || violation.type === 'AUTO_WARNING',
      ).length;

      return {
        id: attempt.id,
        studentId: attempt.candidateId,
        name: attempt.candidateName,
        email: attempt.candidateEmail,
        scheduleId: attempt.scheduleId,
        status: getSessionStatus(attempt),
        currentSection: attempt.currentModule,
        timeRemaining: runtime?.currentSectionRemainingSeconds ?? 0,
        runtimeStatus: runtime?.status ?? 'not_started',
        runtimeCurrentSection: runtime?.currentSectionKey ?? attempt.currentModule,
        runtimeTimeRemainingSeconds: runtime?.currentSectionRemainingSeconds ?? 0,
        runtimeSectionStatus: runtime?.sections.find(
          (section) => section.sectionKey === runtime.currentSectionKey,
        )?.status,
        runtimeWaiting: runtime?.waitingForNextSection ?? false,
        violations: attempt.violations,
        warnings: warningCount,
        lastActivity: getLastActivityTimestamp(attempt, heartbeatTimestamps, auditTimestamps),
        examId: attempt.examId,
        examName: attempt.examTitle,
      };
    })
    .sort(
      (left, right) =>
        new Date(right.lastActivity).getTime() - new Date(left.lastActivity).getTime(),
    );
}

function mapAuditLogsToAlerts(
  auditLogs: SessionAuditLog[],
  sessions: StudentSession[],
  attempts: StudentAttempt[],
): ProctorAlert[] {
  const sessionsByAttemptId = new Map(sessions.map((session) => [session.id, session]));
  const attemptsById = new Map(attempts.map((attempt) => [attempt.id, attempt]));

  return auditLogs
    .filter((log) => ALERT_ACTION_TYPES.has(log.actionType))
    .map((log) => {
      const session = log.targetStudentId ? sessionsByAttemptId.get(log.targetStudentId) : null;
      const attempt = log.targetStudentId ? attemptsById.get(log.targetStudentId) : null;

      return {
        id: `alert-${log.id}`,
        severity: getAlertSeverity(log, attempt ?? undefined),
        type: log.actionType,
        studentName: session?.name ?? attempt?.candidateName ?? 'Candidate',
        studentId: session?.studentId ?? attempt?.candidateId ?? 'unknown',
        timestamp: log.timestamp,
        message: getAlertMessage(log),
        isAcknowledged: false,
      } satisfies ProctorAlert;
    })
    .sort(
      (left, right) =>
        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
    );
}

export interface ProctorRouteController {
  alerts: ProctorAlert[];
  auditLogs: SessionAuditLog[];
  error: string | null;
  isLoading: boolean;
  notes: SessionNote[];
  runtimeSnapshots: ExamSessionRuntime[];
  schedules: ExamSchedule[];
  sessions: StudentSession[];
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
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [runtimeSnapshots, setRuntimeSnapshots] = useState<ExamSessionRuntime[]>([]);
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [alerts, setAlerts] = useState<ProctorAlert[]>([]);
  const [auditLogs, setAuditLogs] = useState<SessionAuditLog[]>([]);
  const [notes, setNotes] = useState<SessionNote[]>([]);
  const [violationRules, setViolationRules] = useState<ViolationRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const syncRuntimeSnapshots = useCallback(async (sourceSchedules: ExamSchedule[]) => {
    if (sourceSchedules.length === 0) {
      setRuntimeSnapshots([]);
      return [];
    }

    const snapshots = (
      await Promise.all(
        sourceSchedules.map(async (schedule) => {
          try {
            return await examDeliveryService.getRuntimeSnapshot(schedule.id);
          } catch {
            return null;
          }
        }),
      )
    ).filter((snapshot): snapshot is ExamSessionRuntime => Boolean(snapshot));

    setRuntimeSnapshots(snapshots);
    return snapshots;
  }, []);

  const loadMonitoringState = useCallback(async () => {
    const loadedSchedules = await examRepository.getAllSchedules();
    const [nextRuntimeSnapshots, allAttempts, nextAuditLogs, nextNotes] = await Promise.all([
      syncRuntimeSnapshots(loadedSchedules),
      studentAttemptRepository.getAllAttempts(),
      examRepository.getAllAuditLogs(),
      examRepository.getAllSessionNotes(),
    ]);

    const heartbeatEntries = await Promise.all(
      allAttempts.map(async (attempt) => ({
        attemptId: attempt.id,
        timestamps: (await studentAttemptRepository.getHeartbeatEvents(attempt.id)).map(
          (event) => event.timestamp,
        ),
      })),
    );

    const heartbeatMap = new Map(
      heartbeatEntries.map((entry) => [entry.attemptId, entry.timestamps]),
    );
    const nextSessions = mapAttemptsToSessions(
      allAttempts,
      loadedSchedules,
      nextRuntimeSnapshots,
      nextAuditLogs,
      heartbeatMap,
    );

    setSchedules(loadedSchedules);
    setAuditLogs(nextAuditLogs);
    setNotes(nextNotes);
    setSessions(nextSessions);
    setAlerts(mapAuditLogsToAlerts(nextAuditLogs, nextSessions, allAttempts));
  }, [syncRuntimeSnapshots]);

  const loadSchedules = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      await loadMonitoringState();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load proctor data');
    } finally {
      setIsLoading(false);
    }
  }, [loadMonitoringState]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  useAsyncPolling(loadMonitoringState, {
    enabled: !isLoading && !error,
    intervalMs: 1_000,
    maxIntervalMs: 4_000,
  });

  const handleStartScheduledSession = useCallback(
    async (scheduleId: string) => {
      await examDeliveryService.startRuntime(scheduleId, 'Proctor');
      await loadMonitoringState();
    },
    [loadMonitoringState],
  );

  const handlePauseCohort = useCallback(
    async (scheduleId: string) => {
      await examDeliveryService.pauseRuntime(scheduleId, 'Proctor');
      await loadMonitoringState();
    },
    [loadMonitoringState],
  );

  const handleResumeCohort = useCallback(
    async (scheduleId: string) => {
      await examDeliveryService.resumeRuntime(scheduleId, 'Proctor');
      await loadMonitoringState();
    },
    [loadMonitoringState],
  );

  const handleEndSectionNow = useCallback(
    async (scheduleId: string) => {
      await examDeliveryService.endCurrentSectionNow(scheduleId, 'Proctor');
      await loadMonitoringState();
    },
    [loadMonitoringState],
  );

  const handleExtendCurrentSection = useCallback(
    async (scheduleId: string, minutes: number) => {
      await examDeliveryService.extendCurrentSection(scheduleId, 'Proctor', minutes);
      await loadMonitoringState();
    },
    [loadMonitoringState],
  );

  const handleCompleteExam = useCallback(
    async (scheduleId: string) => {
      await examDeliveryService.completeRuntime(scheduleId, 'Proctor');
      await loadMonitoringState();
    },
    [loadMonitoringState],
  );

  const evaluateViolationRules = useCallback(
    async (scheduleId: string, studentSessions: StudentSession[]) => {
      const rules = await examRepository.getViolationRulesByScheduleId(scheduleId);
      const activeRules = rules.filter((rule) => rule.isEnabled);

      if (activeRules.length === 0) {
        return;
      }

      for (const session of studentSessions) {
        if (session.scheduleId !== scheduleId) {
          continue;
        }

        for (const rule of activeRules) {
          let shouldTrigger = false;

          switch (rule.triggerType) {
            case 'violation_count':
              shouldTrigger = session.violations.length >= rule.threshold;
              break;
            case 'specific_violation_type':
              shouldTrigger =
                session.violations.filter(
                  (violation) => violation.type === rule.specificViolationType,
                ).length >= rule.threshold;
              break;
            case 'severity_threshold':
              shouldTrigger =
                session.violations.filter(
                  (violation) => violation.severity === rule.specificSeverity,
                ).length >= rule.threshold;
              break;
          }

          if (!shouldTrigger) {
            continue;
          }

          await examRepository.saveAuditLog({
            id: generateId('audit'),
            timestamp: new Date().toISOString(),
            actor: 'system',
            actionType: 'AUTO_ACTION',
            targetStudentId: session.id,
            sessionId: scheduleId,
            payload: {
              ruleId: rule.id,
              ruleAction: rule.action,
              triggerType: rule.triggerType,
              threshold: rule.threshold,
              violationCount: session.violations.length,
            },
          });

          if (rule.action === 'warn') {
            await examDeliveryService.warnStudent(
              session.id,
              `Auto-warning triggered by ${rule.triggerType}`,
              'system',
            );
          } else if (rule.action === 'pause') {
            await examDeliveryService.pauseStudentAttempt(session.id, 'system');
          } else if (rule.action === 'terminate') {
            await examDeliveryService.terminateStudentAttempt(session.id, 'system');
          }
        }
      }

      await loadMonitoringState();
    },
    [loadMonitoringState],
  );

  return {
    alerts,
    auditLogs,
    error,
    isLoading,
    notes,
    runtimeSnapshots,
    schedules,
    sessions,
    violationRules,
    handleCompleteExam,
    handleEndSectionNow,
    handleExtendCurrentSection,
    handlePauseCohort,
    handleResumeCohort,
    handleStartScheduledSession,
    reload: loadSchedules,
    setAlerts,
    setNotes,
    setSessions,
    setViolationRules,
    evaluateViolationRules,
  };
}
