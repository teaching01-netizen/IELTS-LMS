import { useQuery, type QueryClient } from '@tanstack/react-query';
import { proctorFacade } from '../application/proctorFacade';
import { parseProctorSessionDetail, parseProctorSessionSummaries } from '../contracts/monitoringSchemas';
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

const PROCTOR_SUMMARY_POLL_FLOOR_MS = 10_000;

export const proctorKeys = {
  all: ['proctoring'] as const,
  sessions: (providerKey?: 'sat' | 'ielts' | 'act') => [...proctorKeys.all, 'sessions', providerKey ?? 'all'] as const,
  detail: (scheduleId: string) => [...proctorKeys.all, 'detail', scheduleId] as const,
};

/**
 * After a room lifecycle change (command, schedule edit): every provider's
 * summary family, plus the room's detail when `scheduleId` is given. A caller
 * that already refetches its own family and the detail passes
 * `exceptSummaries` and no `scheduleId`, so nothing is requested twice.
 */
export function invalidateRoomReads(
  queryClient: QueryClient,
  options: { scheduleId?: string; exceptSummaries?: ReturnType<typeof proctorKeys.sessions> } = {},
): Promise<void> {
  const { scheduleId, exceptSummaries } = options;
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: [...proctorKeys.all, 'sessions'],
      predicate: (query) => !exceptSummaries || query.queryKey[2] !== exceptSummaries[2],
    }),
    scheduleId ? queryClient.invalidateQueries({ queryKey: proctorKeys.detail(scheduleId) }) : undefined,
  ]).then(() => undefined);
}

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
    satStartState?: StudentSession['satStartState'];
    currentSection: StudentSession['currentSection'];
    timeRemaining: number;
    runtimeStatus: StudentSession['runtimeStatus'];
    runtimeCurrentSection?: StudentSession['runtimeCurrentSection'] | null | undefined;
    runtimeTimeRemainingSeconds: number;
    runtimeDeadlineAt?: string | null | undefined;
    runtimeServerNow?: string | null | undefined;
    runtimeModuleRole?: StudentSession['runtimeModuleRole'] | null | undefined;
    /** The server's name for `runtimeModuleRole` (SAT adaptive slot). */
    runtimeCurrentModuleRole?: StudentSession['runtimeModuleRole'] | null | undefined;
    runtimeModuleDeadlineAt?: string | null | undefined;
    runtimeModuleRemainingSeconds?: number | null | undefined;
    runtimeSectionStatus?: StudentSession['runtimeSectionStatus'] | null | undefined;
    /**
     * Runtime identity fence (SAT adaptive routing): the attempt revision and
     * the active module attempt's id/module id/revision. They order two
     * projections of the same candidate — heartbeat freshness (`lastActivity`)
     * only says when the student was last heard from and cannot say which
     * Module 2 the server routed them into.
     */
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
    ieltsPersonalStatus?: StudentSession['ieltsPersonalStatus'] | null | undefined;
    ieltsPersonalSectionKey?: StudentSession['ieltsPersonalSectionKey'] | null | undefined;
    ieltsPersonalDeadlineAt?: string | null | undefined;
    ieltsPersonalTimeRemainingSeconds?: number | null | undefined;
    ieltsOfflinePreparedSection?: string | null | undefined;
    ieltsOfflinePreparedAt?: string | null | undefined;
    draftEvidencePending?: number | null | undefined;
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

/** The detail read returns at most this many unacknowledged alerts (newest first). */
export const ALERT_WINDOW_LIMIT = 100;
/** The detail read returns at most this many audit entries (newest first). */
export const AUDIT_WINDOW_LIMIT = 200;

export function buildDashboardDetailEndpoint(scheduleId: string): string {
  return `/v1/proctor/sessions/${scheduleId}?mode=dashboard&auditLimit=${AUDIT_WINDOW_LIMIT}&alertLimit=${ALERT_WINDOW_LIMIT}`;
}

/** Room summaries for one provider family; the payload is checked at this boundary. */
export async function fetchProctorSessionSummaries(
  providerKey?: 'sat' | 'ielts' | 'act',
  signal?: AbortSignal,
): Promise<ProctorSessionSummaryPayload[]> {
  const query = providerKey ? `?providerKey=${encodeURIComponent(providerKey)}` : '';
  const payload = await proctorFacade.backendGet<unknown>(`/v1/proctor/sessions${query}`, signal ? { signal } : undefined);
  return parseProctorSessionSummaries(payload);
}

/** One room's dashboard detail; rejects a payload describing another room. */
export async function fetchProctorSessionDetail(
  scheduleId: string,
  signal?: AbortSignal,
): Promise<ProctorSessionDetailPayload> {
  const payload = await proctorFacade.backendGet<unknown>(
    buildDashboardDetailEndpoint(scheduleId),
    signal ? { signal } : undefined,
  );
  return parseProctorSessionDetail(scheduleId, payload);
}

export function useProctorSessionSummaries(
  refetchInterval: number,
  providerKey?: 'sat' | 'ielts' | 'act',
  /** Pages that only sometimes need session state (Delivery, for roles that can run sessions). */
  enabled = true,
  refetchOnMount?: boolean | 'always',
) {
  // Summary reads share the backend's rate-limit budget. Keep each observer at
  // the documented live-room floor; 0 remains the explicit polling-off value.
  const boundedRefetchInterval = refetchInterval > 0
    ? Math.max(refetchInterval, PROCTOR_SUMMARY_POLL_FLOOR_MS)
    : refetchInterval;
  return useQuery({
    queryKey: proctorKeys.sessions(providerKey),
    queryFn: ({ signal }) => fetchProctorSessionSummaries(providerKey, signal),
    ...liveQueryPolicy,
    refetchInterval: boundedRefetchInterval,
    ...(refetchOnMount === undefined ? {} : { refetchOnMount }),
    enabled,
  });
}
