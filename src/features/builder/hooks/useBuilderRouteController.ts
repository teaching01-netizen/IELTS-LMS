import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getExamStateFromEntity } from '@services/examAdapterService';
import { examLifecycleService } from '@services/examLifecycleService';
import { examRepository } from '@services/examRepository';
import type { ExamState } from '../../../types';
import type { ExamEntity } from '../../../types/domain';

export interface BuilderRouteController {
  error: string | null;
  exam: ExamEntity | undefined;
  isLoading: boolean;
  state: ExamState | null;
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

      const examState = await getExamStateFromEntity(entity, examRepository);

      setExam(entity);
      setState(examState);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load exam');
    } finally {
      setIsLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    void loadExam();
  }, [loadExam]);

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
    },
    [examId, state],
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
      await loadExam();
    },
    [examId, loadExam],
  );

  const handleSchedulePublish = useCallback(
    async (scheduledTime: string) => {
      if (!examId) {
        return;
      }

      await examLifecycleService.schedulePublish(examId, 'System', scheduledTime);
      await loadExam();
    },
    [examId, loadExam],
  );

  const handleUnpublish = useCallback(
    async (reason?: string) => {
      if (!examId) {
        return;
      }

      await examLifecycleService.unpublishExam(examId, 'System', reason);
      await loadExam();
    },
    [examId, loadExam],
  );

  const handleArchive = useCallback(async () => {
    if (!examId) {
      return;
    }

    await examLifecycleService.archiveExam(examId, 'System');
    await loadExam();
  }, [examId, loadExam]);

  return {
    error,
    exam,
    isLoading,
    state,
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
