import type { Dispatch, SetStateAction } from "react";
import type { ServerClockSnapshot } from "@shared/hooks/useAuthoritativeDeadlineClock";
import type {
  ProctorAlert,
  SessionAuditLog,
  SessionNote,
  StudentSession,
  ViolationRule,
} from "../../../types";
import type { ExamSchedule, ExamSessionRuntime } from "../../../types/domain";
import type { ProctorScheduleMetrics } from "../contracts";
import { useProctorCommands, type ProctorCommands } from "./useProctorCommands";
import { useProctorMonitoring, type ProctorRouteControllerOptions } from "./useProctorMonitoring";

export type { ProctorRouteControllerOptions };

/**
 * Route-facing composition of proctor monitoring (queries + room projection)
 * and staff commands. Views read the projection and call typed commands;
 * no server entity has a setter here.
 */
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
  /**
   * The room's clock, already resolved: the accepted server instant when one has
   * landed, otherwise the selected runtime's own stamp. Consumers pass this
   * straight to the clocks they render.
   */
  roomClock: ServerClockSnapshot | null;
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
  /** Student, alert, note, and rule commands with typed outcomes. */
  commands: ProctorCommands;
  evaluateViolationRules: (scheduleId: string, studentSessions: StudentSession[]) => Promise<void>;
}

export function useProctorRouteController(
  options: ProctorRouteControllerOptions = {}
): ProctorRouteController {
  const monitoring = useProctorMonitoring(options);
  const commands = useProctorCommands(monitoring);

  return {
    alerts: monitoring.alerts,
    auditLogs: monitoring.auditLogs,
    degradedLiveMode: monitoring.degradedLiveMode,
    error: monitoring.error,
    isLoading: monitoring.isLoading,
    lastSuccessfulRefreshAt: monitoring.lastSuccessfulRefreshAt,
    wsConnected: monitoring.wsConnected,
    notes: monitoring.notes,
    runtimeSnapshots: monitoring.runtimeSnapshots,
    roomClock: monitoring.roomClock,
    schedules: monitoring.schedules,
    scheduleMetrics: monitoring.scheduleMetrics,
    sessions: monitoring.sessions,
    selectedScheduleId: monitoring.selectedScheduleId,
    setSelectedScheduleId: monitoring.setSelectedScheduleId,
    violationRules: monitoring.violationRules,
    handleCompleteExam: commands.handleCompleteExam,
    handleEndSectionNow: commands.handleEndSectionNow,
    handleExtendCurrentSection: commands.handleExtendCurrentSection,
    handlePauseCohort: commands.handlePauseCohort,
    handleResumeCohort: commands.handleResumeCohort,
    handleStartScheduledSession: commands.handleStartScheduledSession,
    reload: monitoring.refresh,
    commands,
    evaluateViolationRules: commands.evaluateViolationRules,
  };
}
