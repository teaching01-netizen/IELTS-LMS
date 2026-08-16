import { useQuery } from '@tanstack/react-query';
import { proctorFacade } from '../application/proctorFacade';
import type {
  ProctorAlert,
  SessionAuditLog,
  SessionNote,
  StudentSession,
  ViolationRule,
} from '../../../types';

export const liveQueryPolicy = {
  staleTime: 15_000,
  gcTime: 2 * 60_000,
} as const;

export const proctorKeys = {
  all: ['proctoring'] as const,
  sessions: () => [...proctorKeys.all, 'sessions'] as const,
  detail: (scheduleId: string) => [...proctorKeys.all, 'detail', scheduleId] as const,
};

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
    status: StudentSession['status'];
    currentSection: StudentSession['currentSection'];
    timeRemaining: number;
    runtimeStatus: StudentSession['runtimeStatus'];
    runtimeCurrentSection?: StudentSession['runtimeCurrentSection'] | null | undefined;
    runtimeTimeRemainingSeconds: number;
    runtimeSectionStatus?: StudentSession['runtimeSectionStatus'] | null | undefined;
    runtimeWaiting: boolean;
    violations: StudentSession['violations'];
    warnings: number;
    lastActivity: string;
    examId: string;
    examName: string;
  }>;
  alerts: Array<{
    id: string;
    severity: ProctorAlert['severity'];
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
    actionType: SessionAuditLog['actionType'];
    targetStudentId?: string | null | undefined;
    payload?: Record<string, unknown> | null | undefined;
    createdAt: string;
  }>;
  notes: Array<{
    id: string;
    scheduleId: string;
    author: string;
    category: SessionNote['category'] | string;
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
    triggerType: ViolationRule['triggerType'];
    threshold: number;
    specificViolationType?: string | null | undefined;
    specificSeverity?: ViolationRule['specificSeverity'] | null | undefined;
    action: ViolationRule['action'];
    isEnabled: boolean;
    createdAt: string;
    createdBy: string;
  }>;
  degradedLiveMode: boolean;
};

export function buildDashboardDetailEndpoint(scheduleId: string): string {
  return `/v1/proctor/sessions/${scheduleId}?mode=dashboard&auditLimit=200&alertLimit=100`;
}

export function fetchProctorSessionSummaries(): Promise<ProctorSessionSummaryPayload[]> {
  return proctorFacade.backendGet<ProctorSessionSummaryPayload[]>('/v1/proctor/sessions');
}

export function fetchProctorSessionDetail(
  scheduleId: string,
): Promise<ProctorSessionDetailPayload> {
  return proctorFacade.backendGet<ProctorSessionDetailPayload>(
    buildDashboardDetailEndpoint(scheduleId),
  );
}

export function useProctorSessionSummaries(refetchInterval: number) {
  return useQuery({
    queryKey: proctorKeys.sessions(),
    queryFn: fetchProctorSessionSummaries,
    ...liveQueryPolicy,
    refetchInterval,
  });
}
