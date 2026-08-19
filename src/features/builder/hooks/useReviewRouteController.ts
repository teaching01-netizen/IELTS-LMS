import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { examAuthoringFacade } from '../../exam-authoring/api/examAuthoringFacade';
import type { ExamState } from '../../../types';
import type {
  ExamEntity,
  ExamSchedule,
  ExamVersionSummary,
  PublishReadiness,
} from '../../../types/domain';

export interface ReviewRouteController {
  error: string | null;
  exam: ExamEntity | undefined;
  isLoading: boolean;
  state: ExamState | null;
  versions: ExamVersionSummary[];
  schedules: ExamSchedule[];
  publishReadiness: PublishReadiness | undefined;
  handlePublish: (notes?: string) => Promise<void>;
  handleRepublishLatestDraft: () => Promise<{ success: boolean; error?: string }>;
  handleSchedulePublish: (scheduledTime: string) => Promise<void>;
  handleUnpublish: (reason?: string) => Promise<void>;
  handleRestoreVersion: (versionId: string) => Promise<void>;
  handleNavigateToBuilder: (field?: string) => void;
  handleOpenScheduling: () => void;
  /** Loads the draft content snapshot only when scheduling UI opens. */
  loadScheduleContent: () => Promise<void>;
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
  const [versions, setVersions] = useState<ExamVersionSummary[]>([]);
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [publishReadiness, setPublishReadiness] = useState<PublishReadiness | undefined>(
    undefined,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const examRef = useRef<ExamEntity | undefined>(undefined);
  const loadedDraftVersionIdRef = useRef<string | null>(null);

  const loadExam = useCallback(async () => {
    if (!examId) {
      setError('Exam ID not found');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const entity = await examAuthoringFacade.repository.getExamById(examId);
      if (!entity) {
        throw new Error('Exam not found');
      }

      const [allVersions, allSchedules, readiness] = await Promise.all([
        examAuthoringFacade.repository.getVersionSummaries(examId),
        examAuthoringFacade.repository.getSchedulesByExam(examId),
        examAuthoringFacade.lifecycle.getPublishReadiness(examId),
      ]);

      examRef.current = entity;
      setExam(entity);
      setVersions(allVersions);
      setSchedules(allSchedules);
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

  const loadScheduleContent = useCallback(async () => {
    const entity = examRef.current;
    const versionId = entity?.currentDraftVersionId ?? entity?.currentPublishedVersionId ?? null;
    if (!versionId || loadedDraftVersionIdRef.current === versionId) {
      return;
    }

    const version = await examAuthoringFacade.repository.getVersionById(versionId);
    const snapshot = version?.contentSnapshot ?? null;
    setState(snapshot ? examAuthoringFacade.hydrateExamState(snapshot) : null);
    loadedDraftVersionIdRef.current = versionId;
  }, []);

  const handlePublish = useCallback(
    async (notes?: string) => {
      if (!examId) {
        return;
      }

      await examAuthoringFacade.lifecycle.publishExam(examId, 'System', notes);
      await loadExam();
    },
    [examId, loadExam],
  );

  const handleRepublishLatestDraft = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!examId) {
      return { success: false, error: 'Exam ID not found' };
    }

    const sourceExam = await examAuthoringFacade.repository.getExamById(examId);
    if (!sourceExam) {
      return { success: false, error: 'Source exam not found' };
    }

    if (!sourceExam.canPublish) {
      return { success: false, error: 'You do not have permission to republish this exam.' };
    }

    const result = await examAuthoringFacade.lifecycle.republishVersion(examId, sourceExam.currentDraftVersionId ?? 'latest', 'System');
    if (!result.success) {
      return {
        success: false,
        error: result.error ?? 'Could not republish. Existing schedules are unchanged.',
      };
    }

    await loadExam();
    return { success: true };
  }, [examId, loadExam]);

  const handleSchedulePublish = useCallback(
    async (scheduledTime: string) => {
      if (!examId) {
        return;
      }

      await examAuthoringFacade.lifecycle.schedulePublish(examId, 'System', scheduledTime);
      await loadExam();
    },
    [examId, loadExam],
  );

  const handleUnpublish = useCallback(
    async (reason?: string) => {
      if (!examId) {
        return;
      }

      await examAuthoringFacade.lifecycle.unpublishExam(examId, 'System', reason);
      await loadExam();
    },
    [examId, loadExam],
  );

  const handleRestoreVersion = useCallback(
    async (versionId: string) => {
      if (!examId) {
        return;
      }

      await examAuthoringFacade.lifecycle.restoreVersionAsDraft(examId, versionId, 'System');
      await loadExam();
    },
    [examId, loadExam],
  );

  const handleNavigateToBuilder = useCallback((field?: string) => {
    if (!examId) {
      return;
    }
    const params = new URLSearchParams();
    if (field) {
      params.set('jumpField', field);
    }
    navigate(`/builder/${examId}/builder${params.toString() ? `?${params.toString()}` : ''}`);
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
    await examAuthoringFacade.repository.saveSchedule(schedule);
    await loadExam();
  }, [loadExam]);

  const handleBackToAdmin = useCallback(() => {
    navigate('/admin');
  }, [navigate]);

  return {
    error,
    exam,
    isLoading,
    state,
    versions,
    schedules,
    publishReadiness,
    handlePublish,
    handleRepublishLatestDraft,
    handleSchedulePublish,
    handleUnpublish,
    handleRestoreVersion,
    handleNavigateToBuilder,
    handleOpenScheduling,
    loadScheduleContent,
    handleCreateSchedule,
    handleBackToAdmin,
    reload: loadExam,
  };
}
