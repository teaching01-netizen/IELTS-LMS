/**
 * Admin Feature Contracts
 * 
 * Explicit type contracts for the admin surface.
 * These define the stable interfaces at admin product boundaries.
 */

import { ExamConfig, ExamType } from '../../../types';
import {
  BulkOperationResult,
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
  onNavigate: (mode: 'builder' | 'student' | 'admin' | 'proctor') => void;
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
    type: ExamType,
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
  onBulkDuplicate?: (examIds: string[], titlePattern?: string) => Promise<BulkOperationResult>;
  onBulkExport?: (examIds: string[]) => Promise<BulkOperationResult>;
  onBulkDelete?: (examIds: string[]) => Promise<BulkOperationResult>;
}

/**
 * Complete admin props contract
 */
export type AdminProps = AdminRootProps;
