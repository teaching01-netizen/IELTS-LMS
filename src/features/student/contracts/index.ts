/**
 * Student Feature Contracts
 * 
 * Explicit type contracts for the student surface.
 * These define the stable interfaces at student product boundaries.
 */

import { ExamState } from '../../../types';
import { ExamSessionRuntime } from '../../../types/domain';

/**
 * Student exam phases
 */
export type StudentExamPhase = 'pre-check' | 'lobby' | 'exam' | 'post-exam';

/**
 * Props passed to StudentSessionRoute from parent (router)
 */
export interface StudentSessionRouteProps {
  // Schedule ID from route params
  scheduleId: string;
}

/**
 * Student data contracts
 */
export interface StudentData {
  // Exam state (content and config)
  state: ExamState;
  
  // Runtime snapshot (if runtime-backed)
  runtimeSnapshot?: ExamSessionRuntime | null;
}

/**
 * Student operation callbacks
 */
export interface StudentOperationCallbacks {
  // Exit student mode
  onExit: () => void;
}

/**
 * Complete student props contract
 */
export interface StudentProps extends StudentSessionRouteProps, StudentData, StudentOperationCallbacks {}

/**
 * Student provider contracts
 * These define the contracts for student-specific providers
 */

/**
 * StudentSessionProvider contract
 */
export interface StudentSessionProviderProps {
  // Exam config
  config: ExamState['config'];
  
  // Whether the session is runtime-backed
  runtimeBacked: boolean;
  
  // Runtime snapshot (if runtime-backed)
  runtimeSnapshot?: ExamSessionRuntime | null;
}

/**
 * NavigationProvider contract
 */
export interface NavigationProviderProps {
  // Exam state
  state: ExamState;
  
  // Whether the session is runtime-backed
  runtimeBacked: boolean;
  
  // Runtime snapshot (if runtime-backed)
  runtimeSnapshot?: {
    currentSectionKey?: string;
  } | null;
}
