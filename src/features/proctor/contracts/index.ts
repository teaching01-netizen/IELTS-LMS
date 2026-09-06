/**
 * Proctor Feature Contracts
 * 
 * Explicit type contracts for the proctor surface.
 * These define the stable interfaces at proctor product boundaries.
 */

import { ProctorAlert, SessionAuditLog, SessionNote, StudentSession, ViolationRule } from '../../../types';
import { ExamSchedule, ExamSessionRuntime } from '../../../types/domain';

export interface ProctorScheduleMetrics {
  studentCount: number;
  activeCount: number;
  joinReadyCount?: number | undefined;
  joinTotalCount?: number | undefined;
  alertCount: number;
  violationCount: number;
  degradedLiveMode: boolean;
}

/**
 * Props passed to ProctorRoot from parent (router)
 */
export type ProctorRootProps = Record<string, never>;

/**
 * Proctor data contracts
 */
export interface ProctorData {
  // Active schedules
  schedules: ExamSchedule[];
  
  // Runtime snapshots for live sessions
  runtimeSnapshots: ExamSessionRuntime[];

  // Summary metrics keyed by scheduleId
  scheduleMetrics: Record<string, ProctorScheduleMetrics>;
  
  // Student sessions
  sessions: StudentSession[];
  
  // Proctor alerts
  alerts: ProctorAlert[];

  // Durable monitoring evidence
  auditLogs: SessionAuditLog[];
  notes: SessionNote[];
  violationRules: ViolationRule[];
}

/**
 * Proctor operation callbacks
 */
export interface ProctorOperationCallbacks {
  // Exit proctor mode
  onExit: () => void;
  onSwitchToSat?: (() => void) | undefined;
  
  // Update sessions
  onUpdateSessions: (sessions: StudentSession[]) => void;
  
  // Update alerts
  onUpdateAlerts: (alerts: ProctorAlert[]) => void;

  // Update notes
  onUpdateNotes: (notes: SessionNote[]) => void;

  // Update schedule-scoped automatic violation responses
  onUpdateRules: (rules: ViolationRule[]) => void;
  
  // Navigate to other surfaces
  onNavigate?: (mode: 'builder' | 'student' | 'admin' | 'proctor') => void;
  
  // Cohort control operations
  onStartScheduledSession: (scheduleId: string) => Promise<void>;
  onPauseCohort: (scheduleId: string) => Promise<void>;
  onResumeCohort: (scheduleId: string) => Promise<void>;
  onEndSectionNow: (scheduleId: string) => Promise<void>;
  onExtendCurrentSection: (scheduleId: string, minutes: number) => Promise<void>;
  onCompleteExam: (scheduleId: string) => Promise<void>;
  onOpenAnswerHistory?: (attemptId: string) => void;
}

/**
 * Complete proctor props contract
 */
export interface ProctorProps {
  // From ProctorRootProps
  // No required props from route params
  
  // From ProctorData
  schedules: ExamSchedule[];
  runtimeSnapshots: ExamSessionRuntime[];
  scheduleMetrics: Record<string, ProctorScheduleMetrics>;
  sessions: StudentSession[];
  alerts: ProctorAlert[];
  auditLogs: SessionAuditLog[];
  notes: SessionNote[];
  violationRules: ViolationRule[];

  // Optional connection status (non-fatal if stale data exists)
  connectionError?: string | null | undefined;

  // Live-connection detail for the header pill (all optional; pill falls back to Live)
  degradedLiveMode?: boolean | undefined;
  wsConnected?: boolean | null | undefined;
  lastSuccessfulRefreshAt?: string | null | undefined;

  // Cohort selection (controlled)
  selectedScheduleId: string | null;
  onSelectScheduleId: (scheduleId: string | null) => void;
  
  // From ProctorOperationCallbacks
  onExit: () => void;
  onSwitchToSat?: (() => void) | undefined;
  onUpdateSessions: (sessions: StudentSession[]) => void;
  onUpdateAlerts: (alerts: ProctorAlert[]) => void;
  onUpdateNotes: (notes: SessionNote[]) => void;
  onUpdateRules: (rules: ViolationRule[]) => void;
  onNavigate?: (mode: 'builder' | 'student' | 'admin' | 'proctor') => void;
  onStartScheduledSession: (scheduleId: string) => Promise<void>;
  onPauseCohort: (scheduleId: string) => Promise<void>;
  onResumeCohort: (scheduleId: string) => Promise<void>;
  onEndSectionNow: (scheduleId: string) => Promise<void>;
  onExtendCurrentSection: (scheduleId: string, minutes: number) => Promise<void>;
  onCompleteExam: (scheduleId: string) => Promise<void>;
  onOpenAnswerHistory?: (attemptId: string) => void;
}
