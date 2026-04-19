import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hydrateExamState } from '@services/examAdapterService';
import { examLifecycleService } from '@services/examLifecycleService';
import { examRepository } from '@services/examRepository';
import type { ExamState } from '../../../types';
import type { ExamEntity, ExamVersion, PublishReadiness, ExamSchedule } from '../../../types/domain';

export interface ReviewRouteController {
  error: string | null;
  exam: ExamEntity | undefined;
  isLoading: boolean;
  state: ExamState | null;
  versions: ExamVersion[];
  publishReadiness: PublishReadiness | undefined;
  handlePublish: (notes?: string) => Promise<void>;
  handleSchedulePublish: (scheduledTime: string) => Promise<void>;
  handleUnpublish: (reason?: string) => Promise<void>;
  handleRestoreVersion: (versionId: string) => Promise<void>;
  handleRepublishVersion: (versionId: string) => Promise<void>;
  handleNavigateToBuilder: () => void;
  handleOpenScheduling: () => void;
  handleCreateSchedule: (schedule: ExamSchedule) => Promise<void>;
  handleBackToAdmin: () => void;
  reload: () => Promise<void>;
}

export function useReviewRouteController(
  examId?: string,
): ReviewRouteController {
  const navigate = useNavigate();

  const [state, setState] = useState<ExamState | null>(null);
  const [exam, setExam] = useState<ExamEntity | undefined>(undefined);
  const [versions, setVersions] = useState<ExamVersion[]>([]);
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

      const examState = entity.currentDraftVersionId
        ? await examRepository.getVersionById(entity.currentDraftVersionId).then(v => v?.contentSnapshot ?? null)
        : null;
      const [allVersions, readiness] = await Promise.all([
        examRepository.getAllVersions(examId),
        examLifecycleService.getPublishReadiness(examId),
      ]);

      setExam(entity);
      setState(examState ? hydrateExamState(examState) : null);
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

  const handleRestoreVersion = useCallback(
    async (versionId: string) => {
      if (!examId) {
        return;
      }

      await examLifecycleService.restoreVersionAsDraft(examId, versionId, 'System');
      await loadExam();
    },
    [examId, loadExam],
  );

  const handleRepublishVersion = useCallback(
    async (versionId: string) => {
      if (!examId) {
        return;
      }

      await examLifecycleService.republishVersion(examId, versionId, 'System');
      await loadExam();
    },
    [examId, loadExam],
  );

  const handleNavigateToBuilder = useCallback(() => {
    if (!examId) {
      return;
    }
    navigate(`/builder/${examId}/builder`);
  }, [examId, navigate]);

  const handleOpenScheduling = useCallback(() => {
    if (!examId) {
      return;
    }

    navigate('/admin/scheduling', {
      state: {
        initialScheduleDraft: {
          examId,
          openCreateModal: true,
        },
      },
    });
  }, [examId, navigate]);

  const handleCreateSchedule = useCallback(async (schedule: ExamSchedule) => {
    await examRepository.saveSchedule(schedule);
  }, []);

  const handleBackToAdmin = useCallback(() => {
    navigate('/admin');
  }, [navigate]);

  return {
    error,
    exam,
    isLoading,
    state,
    versions,
    publishReadiness,
    handlePublish,
    handleSchedulePublish,
    handleUnpublish,
    handleRestoreVersion,
    handleRepublishVersion,
    handleNavigateToBuilder,
    handleOpenScheduling,
    handleCreateSchedule,
    handleBackToAdmin,
    reload: loadExam,
  };
}
