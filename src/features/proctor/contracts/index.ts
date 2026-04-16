/**
 * Proctor Feature Contracts
 * 
 * Explicit type contracts for the proctor surface.
 * These define the stable interfaces at proctor product boundaries.
 */

import { StudentSession, ProctorAlert } from '../../../types';
import { ExamSchedule, ExamSessionRuntime } from '../../../types/domain';

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
  
  // Student sessions
  sessions: StudentSession[];
  
  // Proctor alerts
  alerts: ProctorAlert[];
}

/**
 * Proctor operation callbacks
 */
export interface ProctorOperationCallbacks {
  // Exit proctor mode
  onExit: () => void;
  
  // Update sessions
  onUpdateSessions: (sessions: StudentSession[]) => void;
  
  // Update alerts
  onUpdateAlerts: (alerts: ProctorAlert[]) => void;
  
  // Navigate to other surfaces
  onNavigate?: (mode: 'builder' | 'student' | 'admin' | 'proctor') => void;
  
  // Cohort control operations
  onStartScheduledSession: (scheduleId: string) => Promise<void>;
  onPauseCohort: (scheduleId: string) => Promise<void>;
  onResumeCohort: (scheduleId: string) => Promise<void>;
  onEndSectionNow: (scheduleId: string) => Promise<void>;
  onExtendCurrentSection: (scheduleId: string, minutes: number) => Promise<void>;
  onCompleteExam: (scheduleId: string) => Promise<void>;
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
  sessions: StudentSession[];
  alerts: ProctorAlert[];
  
  // From ProctorOperationCallbacks
  onExit: () => void;
  onUpdateSessions: (sessions: StudentSession[]) => void;
  onUpdateAlerts: (alerts: ProctorAlert[]) => void;
  onNavigate?: (mode: 'builder' | 'student' | 'admin' | 'proctor') => void;
  onStartScheduledSession: (scheduleId: string) => Promise<void>;
  onPauseCohort: (scheduleId: string) => Promise<void>;
  onResumeCohort: (scheduleId: string) => Promise<void>;
  onEndSectionNow: (scheduleId: string) => Promise<void>;
  onExtendCurrentSection: (scheduleId: string, minutes: number) => Promise<void>;
  onCompleteExam: (scheduleId: string) => Promise<void>;
}
