import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getExamStateFromEntity } from '@services/examAdapterService';
import { examLifecycleService } from '@services/examLifecycleService';
import { examRepository } from '@services/examRepository';
import type { ExamState } from '../../../types';
import type { ExamEntity, ExamVersionSummary, PublishReadiness } from '../../../types/domain';

export interface BuilderRouteController {
  error: string | null;
  exam: ExamEntity | undefined;
  isLoading: boolean;
  publishReadiness: PublishReadiness | undefined;
  state: ExamState | null;
  versions: ExamVersionSummary[];
  handleArchive: () => Promise<void>;
  handleOpenScheduling: () => void;
  handlePublish: (notes?: string) => Promise<void>;
  handleReturnToAdmin: () => void;
  handleSaveDraft: (nextState?: ExamState) => Promise<void>;
  handleSchedulePublish: (scheduledTime: string) => Promise<void>;
  handleUnpublish: (reason?: string) => Promise<void>;
  handleUpdateExamContent: (
    nextContent: ExamState | ((previous: ExamState) => ExamState),
  ) => Promise<void>;
  reload: () => Promise<void>;
}

export function useBuilderRouteController(
  examId?: string,
): BuilderRouteController {
  const navigate = useNavigate();

  const [state, setState] = useState<ExamState | null>(null);
  const [exam, setExam] = useState<ExamEntity | undefined>(undefined);
  const [versions, setVersions] = useState<ExamVersionSummary[]>([]);
  const [publishReadiness, setPublishReadiness] = useState<PublishReadiness | undefined>(
    undefined,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadExam = useCallback(async () => {
    if (!examId) {
      setError('Exam ID not found');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const entity = await examRepository.getExamById(examId);
      if (!entity) {
        throw new Error('Exam not found');
      }

      const [examState, allVersions, readiness] = await Promise.all([
        getExamStateFromEntity(entity, examRepository),
        examRepository.getVersionSummaries(examId),
        examLifecycleService.getPublishReadiness(examId),
      ]);

      setExam(entity);
      setState(examState);
      setVersions(allVersions);
      setPublishReadiness(readiness);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load exam');
    } finally {
      setIsLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    void loadExam();
  }, [loadExam]);

  const refreshMetadata = useCallback(async () => {
    if (!examId) {
      return;
    }

    const [refreshedExam, refreshedVersions, readiness] = await Promise.all([
      examRepository.getExamById(examId),
      examRepository.getVersionSummaries(examId),
      examLifecycleService.getPublishReadiness(examId),
    ]);

    setExam(refreshedExam ?? undefined);
    setVersions(refreshedVersions);
    setPublishReadiness(readiness);
  }, [examId]);

  const handleUpdateExamContent = useCallback(
    async (nextContent: ExamState | ((previous: ExamState) => ExamState)) => {
      if (!examId || !state) {
        return;
      }

      const resolvedContent =
        typeof nextContent === 'function' ? nextContent(state) : nextContent;
      const result = await examLifecycleService.saveDraft(examId, resolvedContent, 'System');

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to save draft');
      }

      setState(resolvedContent);
      await refreshMetadata();
    },
    [examId, refreshMetadata, state],
  );

  const handleSaveDraft = useCallback(
    async (nextState?: ExamState) => {
      if (nextState) {
        await handleUpdateExamContent(nextState);
        return;
      }

      if (state) {
        await handleUpdateExamContent(state);
      }
    },
    [handleUpdateExamContent, state],
  );

  const handlePublish = useCallback(
    async (notes?: string) => {
      if (!examId) {
        return;
      }

      await examLifecycleService.publishExam(examId, 'System', notes);
      await refreshMetadata();
    },
    [examId, refreshMetadata],
  );

  const handleSchedulePublish = useCallback(
    async (scheduledTime: string) => {
      if (!examId) {
        return;
      }

      await examLifecycleService.schedulePublish(examId, 'System', scheduledTime);
      await refreshMetadata();
    },
    [examId, refreshMetadata],
  );

  const handleUnpublish = useCallback(
    async (reason?: string) => {
      if (!examId) {
        return;
      }

      await examLifecycleService.unpublishExam(examId, 'System', reason);
      await refreshMetadata();
    },
    [examId, refreshMetadata],
  );

  const handleArchive = useCallback(async () => {
    if (!examId) {
      return;
    }

    await examLifecycleService.archiveExam(examId, 'System');
    await refreshMetadata();
  }, [examId, refreshMetadata]);

  return {
    error,
    exam,
    isLoading,
    publishReadiness,
    state,
    versions,
    handleArchive,
    handleOpenScheduling: () => navigate('/admin/scheduling'),
    handlePublish,
    handleReturnToAdmin: () => navigate('/admin'),
    handleSaveDraft,
    handleSchedulePublish,
    handleUnpublish,
    handleUpdateExamContent,
    reload: loadExam,
  };
}
