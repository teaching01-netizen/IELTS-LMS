import type { Exam, ExamConfig, ExamType } from '../../../types';
import type {
  BulkOperationResult,
  ExamEntity,
  ExamEvent,
  ExamVersionSummary,
  VersionDiff,
} from '../../../types/domain';

export interface ExamVersionHistoryProps {
  exam: ExamEntity;
  versions: ExamVersionSummary[];
  events: ExamEvent[];
  onRestoreVersion?: ((versionId: string) => void) | undefined;
  onRepublishVersion?: ((versionId: string) => void) | undefined;
  onCompareVersions?: ((versionIdA: string, versionIdB: string) => Promise<VersionDiff | null>) | undefined;
  onCloneExam?: ((examId: string, newTitle: string) => Promise<void>) | undefined;
}

export interface ExamListData {
  readonly entities: ExamEntity[];
  readonly exams: Exam[];
}

export interface DeleteExamInput {
  readonly examId: string;
  readonly actor: string;
}

export interface ExamListProps {
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
    type: ExamType,
    preset: ExamConfig['general']['preset'],
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
  onBulkDuplicate?: (examIds: string[], titlePattern?: string) => Promise<BulkOperationResult>;
  onBulkExport?: (examIds: string[]) => Promise<BulkOperationResult>;
  onBulkDelete?: (examIds: string[]) => Promise<BulkOperationResult>;
}
