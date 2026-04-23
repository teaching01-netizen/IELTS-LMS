/**
 * Domain Model for Exam Lifecycle Management
 *
 * This file defines the authoritative domain entities for the exam system.
 * All UI and business logic should work with these types, not the legacy Exam type.
 */

import type { ExamState, ExamConfig, ModuleType } from '../types';
import type {
  StudentAttempt as StudentAttemptRecord,
  StudentAttemptMutation as PendingAttemptMutation,
  StudentHeartbeatEvent,
  StudentPreCheckResult as PreCheckResult,
} from './studentAttempt';

/**
 * Schema version for migration support.
 * Increment this when making breaking changes to the data model.
 */
export const SCHEMA_VERSION = 3;

/**
 * Exam lifecycle states with proper workflow
 */
export type ExamStatus = 
  | 'draft' 
  | 'in_review' 
  | 'approved' 
  | 'rejected'
  | 'scheduled' 
  | 'published' 
  | 'archived'
  | 'unpublished';

/**
 * Visibility settings for exams
 */
export type ExamVisibility = 'private' | 'organization' | 'public';

/**
 * Actions that can be performed on exams (for audit log)
 */
export type ExamAction =
  | 'created'
  | 'draft_saved'
  | 'submitted_for_review'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'unpublished'
  | 'scheduled'
  | 'archived'
  | 'restored'
  | 'cloned'
  | 'version_created'
  | 'version_restored'
  | 'permissions_updated';

/**
 * Transition guards for status changes
 */
export type StatusTransition = {
  from: ExamStatus;
  to: ExamStatus;
  allowed: boolean;
  requireActor?: 'admin' | 'owner' | 'reviewer' | undefined;
};

/**
 * Authoritative exam entity - the single source of truth for exam metadata
 * Replaces the legacy Exam type which had duplicated metadata
 */
export interface ExamEntity {
  id: string;
  slug: string;
  title: string;
  type: 'Academic' | 'General Training';
  status: ExamStatus;
  visibility: ExamVisibility;
  owner: string;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | undefined;
  archivedAt?: string | undefined;
  
  // Version pointers
  currentDraftVersionId: string | null;
  currentPublishedVersionId: string | null;
  
  // Permissions summary (simplified for now, can be expanded)
  canEdit: boolean;
  canPublish: boolean;
  canDelete: boolean;
  
  // Denormalized counts for performance (kept in sync via service)
  totalQuestions?: number | undefined;
  totalReadingQuestions?: number | undefined;
  totalListeningQuestions?: number | undefined;
  
  // Schema version for migration
  schemaVersion: number;
}

/**
 * Immutable snapshot of an exam version
 * Editing a published exam creates a new version, never mutates an existing one
 */
export interface ExamVersionValidationSnapshot {
  isValid: boolean;
  errorCount: number;
  warningCount: number;
  lastValidatedAt: string;
}

export interface ExamVersion {
  id: string;
  examId: string;
  versionNumber: number;
  parentVersionId: string | null;
  
  // Immutable snapshots
  contentSnapshot: ExamState;
  configSnapshot: ExamConfig;
  validationSnapshot?: ExamVersionValidationSnapshot | undefined;
  
  // Metadata
  createdBy: string;
  createdAt: string;
  publishNotes?: string | undefined;
  
  // Version state
  isDraft: boolean;
  isPublished: boolean;
}

/**
 * Summary representation of an exam version for list views.
 * Excludes heavy immutable snapshots; fetch full version details by ID when needed.
 */
export interface ExamVersionSummary {
  id: string;
  examId: string;
  versionNumber: number;
  parentVersionId: string | null;
  validationSnapshot?: ExamVersionValidationSnapshot | undefined;
  createdBy: string;
  createdAt: string;
  publishNotes?: string | undefined;
  isDraft: boolean;
  isPublished: boolean;
}

/**
 * Audit event for exam lifecycle tracking
 */
export interface ExamEvent {
  id: string;
  examId: string;
  versionId?: string | undefined;
  actor: string;
  action: ExamAction;
  fromState?: ExamStatus | undefined;
  toState?: ExamStatus | undefined;
  timestamp: string;
  payload?: Record<string, unknown> | undefined;
}

/**
 * Schedule linked to a specific published exam version
 * This ensures scheduled sessions always use immutable versions
 */
export interface ExamSchedule {
  id: string;
  examId: string;
  examTitle: string;
  publishedVersionId: string; // Always points to immutable version
  
  // Schedule details
  cohortName: string;
  institution?: string | undefined;
  startTime: string;
  endTime: string;
  plannedDurationMinutes: number;
  deliveryMode: 'proctor_start';
  
  // Recurrence settings
  recurrence?: {
    type: 'none' | 'daily' | 'weekly' | 'monthly';
    interval: number;
    endDate?: string | undefined;
  } | undefined;
  
  // Buffer settings
  bufferBeforeMinutes?: number | undefined;
  bufferAfterMinutes?: number | undefined;
  
  // Auto controls
  autoStart: boolean;
  autoStop: boolean;
  
  // Status
  status: 'scheduled' | 'live' | 'completed' | 'cancelled';
  
  // Metadata
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/**
 * Runtime status for the whole cohort session
 */
export type RuntimeStatus = 'not_started' | 'live' | 'paused' | 'completed' | 'cancelled';

/**
 * Runtime status for a single section
 */
export type SectionRuntimeStatus = 'locked' | 'live' | 'paused' | 'completed';

/**
 * Section runtime tracking
 */
export interface SectionRuntimeState {
  sectionKey: ModuleType;
  label: string;
  order: number;
  plannedDurationMinutes: number;
  gapAfterMinutes: number;
  status: SectionRuntimeStatus;
  availableAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  pausedAt: string | null;
  accumulatedPausedSeconds: number;
  extensionMinutes: number;
  completionReason?: 'auto_timeout' | 'proctor_end' | 'proctor_complete' | 'cancelled' | undefined;
  projectedStartAt?: string | null | undefined;
  projectedEndAt?: string | null | undefined;
}

/**
 * Control event emitted while a cohort session is live
 */
export interface CohortControlEvent {
  id: string;
  scheduleId: string;
  runtimeId: string;
  examId: string;
  actor: string;
  action:
    | 'start_runtime'
    | 'pause_runtime'
    | 'resume_runtime'
    | 'extend_section'
    | 'end_section_now'
    | 'complete_runtime'
    | 'auto_timeout';
  sectionKey?: ModuleType | undefined;
  minutes?: number | undefined;
  reason?: string | undefined;
  timestamp: string;
  payload?: Record<string, unknown> | undefined;
}

/**
 * Cohort runtime snapshot persisted in local storage
 */
export interface ProctorPresence {
  proctorId: string;
  proctorName: string;
  joinedAt: string;
  lastHeartbeat: string;
}

export interface ExamSessionRuntime {
  id: string;
  scheduleId: string;
  examId: string;
  examTitle: string;
  cohortName: string;
  deliveryMode: 'proctor_start';
  status: RuntimeStatus;
  actualStartAt: string | null;
  actualEndAt: string | null;
  activeSectionKey: ModuleType | null;
  currentSectionKey: ModuleType | null;
  currentSectionRemainingSeconds: number;
  waitingForNextSection: boolean;
  isOverrun: boolean;
  totalPausedSeconds: number;
  sections: SectionRuntimeState[];
  proctorPresence?: ProctorPresence[] | undefined;
  createdAt: string;
  updatedAt: string;
}

/**
 * Result of a publish readiness check
 */
export interface PublishReadiness {
  canPublish: boolean;
  errors: Array<{
    field: string;
    message: string;
    severity: 'error' | 'warning';
  }>;
  warnings: Array<{
    field: string;
    message: string;
  }>;
  missingFields: string[];
  questionCounts: {
    reading: number;
    listening: number;
    total: number;
  };
}

/**
 * Result of a lifecycle transition
 */
export interface TransitionResult {
  success: boolean;
  exam?: ExamEntity | undefined;
  version?: ExamVersion | undefined;
  event?: ExamEvent | undefined;
  error?: string | undefined;
}

/**
 * Result of comparing two exam versions
 */
export interface VersionDiff {
  versionA: ExamVersion;
  versionB: ExamVersion;
  hasChanges: boolean;
  
  // Metadata diffs
  metadataDiff: {
    versionNumberChanged: boolean;
    parentVersionChanged: boolean;
    creatorChanged: boolean;
    createdAtChanged: boolean;
    publishNotesChanged: boolean;
  };
  
  // Config diffs
  configDiff: {
    generalChanged: boolean;
    sectionsChanged: {
      listening: boolean;
      reading: boolean;
      writing: boolean;
      speaking: boolean;
    };
    progressionChanged: boolean;
    scoringChanged: boolean;
    securityChanged: boolean;
  };
  
  // Content counts diff
  countsDiff: {
    readingPassages: { a: number; b: number; changed: boolean };
    readingQuestions: { a: number; b: number; changed: boolean };
    listeningParts: { a: number; b: number; changed: boolean };
    listeningQuestions: { a: number; b: number; changed: boolean };
  };
}

/**
 * Result of cloning an exam
 */
export interface CloneResult {
  success: boolean;
  exam?: ExamEntity | undefined;
  version?: ExamVersion | undefined;
  event?: ExamEvent | undefined;
  error?: string | undefined;
}

/**
 * Result of restoring a version
 */
export interface RestoreResult {
  success: boolean;
  exam?: ExamEntity | undefined;
  version?: ExamVersion | undefined;
  event?: ExamEvent | undefined;
  error?: string | undefined;
}

/**
 * Result of a bulk operation
 */
export interface BulkOperationResult {
  success: boolean;
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    examId: string;
    examTitle: string;
    success: boolean;
    error?: string | undefined;
  }>;
}

export type StudentAttemptStatus =
  | 'pre-check'
  | 'lobby'
  | 'exam'
  | 'post-exam'
  | 'submitted';

export type HeartbeatStatus = 'idle' | 'ok' | 'lost';

export type DeviceContinuityStatus = 'unknown' | 'verified' | 'mismatch';

export type {
  PendingAttemptMutation,
  PreCheckResult,
  StudentAttemptRecord as StudentAttempt,
  StudentHeartbeatEvent,
};
