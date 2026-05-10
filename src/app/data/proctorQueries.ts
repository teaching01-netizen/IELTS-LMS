import { useQuery } from '@tanstack/react-query';
import { proctorFacade } from '../../features/proctor/application/proctorFacade';
import { liveQueryPolicy, queryKeys } from './queryClient';

export type ProctorSessionSummaryPayload = {
  schedule: Parameters<typeof proctorFacade.mapSchedule>[0];
  runtime: Parameters<typeof proctorFacade.mapRuntime>[0];
  studentCount?: number | undefined;
  activeCount?: number | undefined;
  joinReadyCount?: number | undefined;
  joinTotalCount?: number | undefined;
  alertCount?: number | undefined;
  violationCount?: number | undefined;
  degradedLiveMode: boolean;
};

export type ProctorSessionDetailPayload = {
  schedule: Parameters<typeof proctorFacade.mapSchedule>[0];
  runtime: Parameters<typeof proctorFacade.mapRuntime>[0];
  sessions: Array<{
    attemptId: string;
    studentId: string;
    studentName: string;
    studentEmail: string;
    scheduleId: string;
    status: import('../../types').StudentSession['status'];
    currentSection: import('../../types').StudentSession['currentSection'];
    timeRemaining: number;
    runtimeStatus: import('../../types').StudentSession['runtimeStatus'];
    runtimeCurrentSection?: import('../../types').StudentSession['runtimeCurrentSection'] | null | undefined;
    runtimeTimeRemainingSeconds: number;
    runtimeSectionStatus?: import('../../types').StudentSession['runtimeSectionStatus'] | null | undefined;
    runtimeWaiting: boolean;
    violations: import('../../types').StudentSession['violations'];
    warnings: number;
    lastActivity: string;
    examId: string;
    examName: string;
  }>;
  alerts: Array<{
    id: string;
    severity: import('../../types').ProctorAlert['severity'];
    type: string;
    studentName: string;
    studentId: string;
    timestamp: string;
    message: string;
    isAcknowledged: boolean;
  }>;
  auditLogs: Array<{
    id: string;
    scheduleId: string;
    actor: string;
    actionType: import('../../types').SessionAuditLog['actionType'];
    targetStudentId?: string | null | undefined;
    payload?: Record<string, unknown> | null | undefined;
    createdAt: string;
  }>;
  notes: Array<{
    id: string;
    scheduleId: string;
    author: string;
    category: import('../../types').SessionNote['category'] | string;
    content: string;
    isResolved?: boolean | undefined;
    createdAt: string;
  }>;
  presence: Array<{
    proctorId: string;
    proctorName: string;
    joinedAt: string;
    lastHeartbeatAt: string;
  }>;
  violationRules: Array<{
    id: string;
    scheduleId: string;
    triggerType: import('../../types').ViolationRule['triggerType'];
    threshold: number;
    specificViolationType?: string | null | undefined;
    specificSeverity?: import('../../types').ViolationRule['specificSeverity'] | null | undefined;
    action: import('../../types').ViolationRule['action'];
    isEnabled: boolean;
    createdAt: string;
    createdBy: string;
  }>;
  degradedLiveMode: boolean;
};

export function buildDashboardDetailEndpoint(scheduleId: string) {
  return `/v1/proctor/sessions/${scheduleId}?mode=dashboard&auditLimit=200&alertLimit=100`;
}

export function fetchProctorSessionSummaries() {
  return proctorFacade.backendGet<ProctorSessionSummaryPayload[]>('/v1/proctor/sessions');
}

export function fetchProctorSessionDetail(scheduleId: string) {
  return proctorFacade.backendGet<ProctorSessionDetailPayload>(buildDashboardDetailEndpoint(scheduleId));
}

export function useProctorSessionSummaries(refetchInterval: number) {
  return useQuery({
    queryKey: queryKeys.proctoring.sessions(),
    queryFn: fetchProctorSessionSummaries,
    ...liveQueryPolicy,
    refetchInterval,
  });
}
