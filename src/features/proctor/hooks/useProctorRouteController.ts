import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useAsyncPolling } from '@app/hooks/useAsyncPolling';
import { examDeliveryService } from '@services/examDeliveryService';
import { examRepository } from '@services/examRepository';
import type { ProctorAlert, StudentSession, ViolationRule } from '../../../types';
import type { ExamSchedule, ExamSessionRuntime } from '../../../types/domain';
import { logger } from '../../../utils/logger';

const MOCK_SESSIONS: StudentSession[] = [
  {
    id: 's1',
    studentId: 'STU-0042',
    name: 'John Doe',
    email: 'john.doe@email.com',
    scheduleId: 'sched-1',
    status: 'active',
    currentSection: 'reading',
    timeRemaining: 3600,
    runtimeStatus: 'live',
    runtimeCurrentSection: 'reading',
    runtimeTimeRemainingSeconds: 3600,
    runtimeWaiting: false,
    violations: [],
    warnings: 0,
    lastActivity: new Date().toISOString(),
    examId: 'exam-1',
    examName: 'IELTS Academic Practice A',
  },
];

const MOCK_ALERTS: ProctorAlert[] = [
  {
    id: 'a1',
    severity: 'high',
    type: 'SCREEN_CAPTURE',
    studentName: 'Ali Ahmed',
    studentId: 'STU-0023',
    timestamp: new Date().toISOString(),
    message: 'Screen capture attempt detected',
    isAcknowledged: false,
  },
];

const useMockData = import.meta.env.DEV;

export interface ProctorRouteController {
  alerts: ProctorAlert[];
  error: string | null;
  isLoading: boolean;
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
  setSessions: Dispatch<SetStateAction<StudentSession[]>>;
  setViolationRules: Dispatch<SetStateAction<ViolationRule[]>>;
  evaluateViolationRules: (scheduleId: string, studentSessions: StudentSession[]) => Promise<void>;
}

export function useProctorRouteController(): ProctorRouteController {
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [runtimeSnapshots, setRuntimeSnapshots] = useState<ExamSessionRuntime[]>([]);
  const [sessions, setSessions] = useState<StudentSession[]>(useMockData ? MOCK_SESSIONS : []);
  const [alerts, setAlerts] = useState<ProctorAlert[]>(useMockData ? MOCK_ALERTS : []);
  const [violationRules, setViolationRules] = useState<ViolationRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const syncRuntimeSnapshots = useCallback(
    async (sourceSchedules: ExamSchedule[]) => {
      if (sourceSchedules.length === 0) {
        setRuntimeSnapshots([]);
        return;
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
    },
    [],
  );

  const loadSchedules = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const loadedSchedules = await examRepository.getAllSchedules();
      setSchedules(loadedSchedules);
      await syncRuntimeSnapshots(loadedSchedules);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load proctor data');
    } finally {
      setIsLoading(false);
    }
  }, [syncRuntimeSnapshots]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  useAsyncPolling(
    async () => {
      const sourceSchedules =
        schedules.length > 0 ? schedules : await examRepository.getAllSchedules();
      setSchedules(sourceSchedules);
      await syncRuntimeSnapshots(sourceSchedules);
    },
    {
      enabled: !isLoading && !error,
      intervalMs: 1_000,
      maxIntervalMs: 4_000,
    },
  );

  const refreshSchedules = useCallback(async () => {
    const loadedSchedules = await examRepository.getAllSchedules();
    setSchedules(loadedSchedules);
    await syncRuntimeSnapshots(loadedSchedules);
  }, [syncRuntimeSnapshots]);

  const handleStartScheduledSession = useCallback(
    async (scheduleId: string) => {
      await examDeliveryService.startRuntime(scheduleId, 'Proctor');
      await refreshSchedules();
    },
    [refreshSchedules],
  );

  const handlePauseCohort = useCallback(
    async (scheduleId: string) => {
      await examDeliveryService.pauseRuntime(scheduleId, 'Proctor');
      await refreshSchedules();
    },
    [refreshSchedules],
  );

  const handleResumeCohort = useCallback(
    async (scheduleId: string) => {
      await examDeliveryService.resumeRuntime(scheduleId, 'Proctor');
      await refreshSchedules();
    },
    [refreshSchedules],
  );

  const handleEndSectionNow = useCallback(
    async (scheduleId: string) => {
      await examDeliveryService.endCurrentSectionNow(scheduleId, 'Proctor');
      await refreshSchedules();
    },
    [refreshSchedules],
  );

  const handleExtendCurrentSection = useCallback(
    async (scheduleId: string, minutes: number) => {
      await examDeliveryService.extendCurrentSection(scheduleId, 'Proctor', minutes);
      await refreshSchedules();
    },
    [refreshSchedules],
  );

  const handleCompleteExam = useCallback(
    async (scheduleId: string) => {
      await examDeliveryService.completeRuntime(scheduleId, 'Proctor');
      await refreshSchedules();
    },
    [refreshSchedules],
  );

  const evaluateViolationRules = useCallback(
    async (scheduleId: string, studentSessions: StudentSession[]) => {
      const rules = await examRepository.getViolationRulesByScheduleId(scheduleId);
      const activeRules = rules.filter(rule => rule.isEnabled);

      if (activeRules.length === 0) return;

      for (const session of studentSessions) {
        if (session.scheduleId !== scheduleId) continue;

        for (const rule of activeRules) {
          let shouldTrigger = false;

          switch (rule.triggerType) {
            case 'violation_count':
              if (session.violations.length >= rule.threshold) {
                shouldTrigger = true;
              }
              break;
            case 'specific_violation_type':
              const matchingViolations = session.violations.filter(
                v => v.type === rule.specificViolationType
              );
              if (matchingViolations.length >= rule.threshold) {
                shouldTrigger = true;
              }
              break;
            case 'severity_threshold':
              const severityViolations = session.violations.filter(
                v => v.severity === rule.specificSeverity
              );
              if (severityViolations.length >= rule.threshold) {
                shouldTrigger = true;
              }
              break;
          }

          if (shouldTrigger) {
            // Log the auto-action to audit trail
            const auditLog = {
              id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
              timestamp: new Date().toISOString(),
              actor: 'system',
              actionType: 'AUTO_ACTION' as const,
              targetStudentId: session.id,
              sessionId: scheduleId,
              payload: {
                ruleId: rule.id,
                ruleAction: rule.action,
                triggerType: rule.triggerType,
                threshold: rule.threshold,
                violationCount: session.violations.length
              }
            };
            await examRepository.saveAuditLog(auditLog);

            // Execute the action (for notify_proctor, just log it)
            if (rule.action === 'warn') {
              // Update session status
              const updatedSession = {
                ...session,
                status: 'warned' as const,
                warnings: session.warnings + 1,
                violations: [
                  ...session.violations,
                  {
                    id: Math.random().toString(36).slice(2, 11),
                    type: 'AUTO_WARNING',
                    severity: 'medium' as const,
                    timestamp: new Date().toISOString(),
                    description: `Auto-warning triggered by rule: ${rule.triggerType} threshold ${rule.threshold}`
                  }
                ]
              };
              // In a real implementation, this would update the session via the delivery service
              logger.warn('Auto-warn triggered for student:', session.id, updatedSession);
            } else if (rule.action === 'pause') {
              logger.warn('Auto-pause triggered for student:', session.id);
            } else if (rule.action === 'terminate') {
              logger.warn('Auto-terminate triggered for student:', session.id);
            }
            // notify_proctor just logs to audit, no session state change
          }
        }
      }
    },
    [],
  );

  return {
    alerts,
    error,
    isLoading,
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
    setSessions,
    setViolationRules,
    evaluateViolationRules,
  };
}
