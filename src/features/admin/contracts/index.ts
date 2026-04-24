/**
 * Admin Feature Contracts
 * 
 * Explicit type contracts for the admin surface.
 * These define the stable interfaces at admin product boundaries.
 */

import { Exam, ExamConfig } from '../../../types';
import {
  BulkOperationResult,
  ExamEntity,
  ExamEvent,
  ExamSchedule,
  ExamVersionSummary,
  VersionDiff,
} from '../../../types/domain';

/**
 * Admin navigation modes
 */
export type AdminView = 'exams' | 'scheduling' | 'grading' | 'results' | 'settings';

/**
 * Props passed to AdminRoot from parent (AppShell or router)
 */
export interface AdminRootProps {
  // Navigation callback to switch between product surfaces
  onNavigate: (mode: 'builder' | 'student' | 'admin' | 'proctor') => void;
  
  // Exam data (loaded by admin bootstrap)
  exams: Exam[];
  examEntities: ExamEntity[];
  
  // Schedule data (loaded by admin bootstrap)
  schedules: ExamSchedule[];
  
  // Default config (loaded from localStorage)
  defaults: ExamConfig;
  setDefaults: (config: ExamConfig) => void;
}

/**
 * Exam operation callbacks
 */
export interface ExamOperationCallbacks {
  onEditExam: (id: string) => void;
  onCreateExam: (
    title: string,
    type: 'Academic' | 'General Training',
    preset: ExamConfig['general']['preset']
  ) => void;
  onCloneExam?: (examId: string, newTitle: string) => Promise<void>;
  onCreateFromTemplate?: (templateId: string, newTitle: string) => Promise<void>;
}

/**
 * Version management callbacks
 */
export interface VersionManagementCallbacks {
  onGetVersions: (examId: string) => Promise<ExamVersionSummary[]>;
  onGetEvents: (examId: string) => Promise<ExamEvent[]>;
  onRestoreVersion: (versionId: string) => Promise<void>;
  onRepublishVersion: (versionId: string) => Promise<void>;
  onCompareVersions: (versionIdA: string, versionIdB: string) => Promise<VersionDiff | null>;
}

/**
 * Schedule management callbacks
 */
export interface ScheduleManagementCallbacks {
  onCreateSchedule: (schedule: ExamSchedule) => Promise<void>;
  onUpdateSchedule: (schedule: ExamSchedule) => Promise<void>;
  onDeleteSchedule: (scheduleId: string) => Promise<void>;
  onStartScheduledSession: (scheduleId: string) => Promise<void>;
}

/**
 * Bulk operation callbacks
 */
export interface BulkOperationCallbacks {
  onBulkPublish?: (examIds: string[]) => Promise<BulkOperationResult>;
  onBulkUnpublish?: (examIds: string[]) => Promise<BulkOperationResult>;
  onBulkArchive?: (examIds: string[]) => Promise<BulkOperationResult>;
  onBulkDuplicate?: (examIds: string[]) => Promise<BulkOperationResult>;
  onBulkExport?: (examIds: string[]) => Promise<BulkOperationResult>;
  onBulkDelete?: (examIds: string[]) => Promise<BulkOperationResult>;
}

/**
 * Exam version history component contract
 */
export interface ExamVersionHistoryProps {
  exam: ExamEntity;
  versions: ExamVersionSummary[];
  events: ExamEvent[];
  onRestoreVersion?: ((versionId: string) => void) | undefined;
  onRepublishVersion?: ((versionId: string) => void) | undefined;
  onCompareVersions?: ((versionIdA: string, versionIdB: string) => Promise<VersionDiff | null>) | undefined;
  onCloneExam?: ((examId: string, newTitle: string) => Promise<void>) | undefined;
}

/**
 * AdminExams component contract
 * 
 * This is a subset of AdminProps for the AdminExams component specifically.
 * It doesn't extend AdminRootProps to avoid requiring schedules/defaults/setDefaults.
 */
export interface AdminExamsProps {
  onNavigate: (mode: 'builder' | 'student' | 'admin' | 'proctor') => void;
  exams: Exam[];
  examEntities?: ExamEntity[];
  versions?: ExamVersionSummary[];
  events?: ExamEvent[];
  onEditExam: (id: string) => void;
  onGoToConfig?: ((id: string) => void) | undefined;
  onGoToReview?: ((id: string) => void) | undefined;
  onCreateExam: (
    title: string,
    type: 'Academic' | 'General Training',
    preset: ExamConfig['general']['preset']
  ) => void;
  onCloneExam?: (examId: string, newTitle: string) => Promise<void>;
  onCreateFromTemplate?: (templateId: string, newTitle: string) => Promise<void>;
  onDeleteExam?: (examId: string) => Promise<void>;
  onGetVersions?: (examId: string) => Promise<ExamVersionSummary[]>;
  onGetEvents?: (examId: string) => Promise<ExamEvent[]>;
  onRestoreVersion?: (versionId: string) => Promise<void>;
  onRepublishVersion?: (versionId: string) => Promise<void>;
  onCompareVersions?: (versionIdA: string, versionIdB: string) => Promise<VersionDiff | null>;
  onBulkPublish?: (examIds: string[]) => Promise<BulkOperationResult>;
  onBulkUnpublish?: (examIds: string[]) => Promise<BulkOperationResult>;
  onBulkArchive?: (examIds: string[]) => Promise<BulkOperationResult>;
  onBulkDuplicate?: (examIds: string[]) => Promise<BulkOperationResult>;
  onBulkExport?: (examIds: string[]) => Promise<BulkOperationResult>;
  onBulkDelete?: (examIds: string[]) => Promise<BulkOperationResult>;
}

/**
 * Complete admin props contract
 */
export interface AdminProps extends AdminRootProps, ExamOperationCallbacks, VersionManagementCallbacks, ScheduleManagementCallbacks, BulkOperationCallbacks {}
