/**
 * Builder Feature Contracts
 * 
 * Explicit type contracts for the builder surface.
 * These define the stable interfaces at builder product boundaries.
 */

import { ExamState } from '../../../types';
import { ExamEntity, ExamVersionSummary } from '../../../types/domain';

/**
 * Props passed to BuilderRoot from parent (router)
 */
export interface BuilderRootProps {
  // Exam ID from route params
  examId: string;
}

/**
 * Builder state callbacks
 */
export interface BuilderStateCallbacks {
  // Update exam content
  onUpdateExamContent: (newContent: ExamState | ((prev: ExamState) => ExamState)) => void;
  
  // Save draft
  onSaveDraft: () => void;
  
  // Publish exam
  onPublish: (notes?: string) => void;
  
  // Navigate to route-backed surfaces from the builder
  onReturnToAdmin: () => void;
  onOpenScheduling: () => void;
}

/**
 * Version management callbacks
 */
export interface BuilderVersionCallbacks {
  versions: ExamVersionSummary[];
  publishReadiness: {
    isValid: boolean;
    errorCount: number;
    warningCount: number;
  };
  onSchedulePublish: () => void;
  onUnpublish: () => void;
  onArchive: () => void;
}

/**
 * Complete builder props contract
 */
export interface BuilderProps extends BuilderRootProps, BuilderStateCallbacks, BuilderVersionCallbacks {
  // Current exam state
  state: ExamState;
  
  // Current exam entity
  exam?: ExamEntity;
}
