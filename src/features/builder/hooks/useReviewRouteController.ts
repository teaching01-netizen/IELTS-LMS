import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOptionalAuthSession } from '../../auth/api/authSession';
import { examAuthoringFacade } from '../../exam-authoring/api/examAuthoringFacade';
import type { ExamState } from '../../../types';
import type {
  ExamEntity,
  ExamEvent,
  ExamSchedule,
  ExamVersionSummary,
  PublishReadiness,
  VersionDiff,
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
  handleRepublishVersion: (versionId: string) => Promise<{ success: boolean; error?: string }>;
  loadEvents: () => Promise<ExamEvent[]>;
  compareVersions: (versionIdA: string, versionIdB: string) => Promise<VersionDiff | null>;
  handleNavigateToBuilder: (field?: string) => void;
  handleOpenScheduling: () => void;
  /** Loads the draft content snapshot only when scheduling UI opens. */
  loadScheduleContent: () => Promise<void>;
  handleCreateSchedule: (schedule: ExamSchedule) => Promise<void>;
  handleBackToAdmin: () => void;
  reload: () => Promise<void>;
}

function resolveStaffActor(session: { user: { id: string; displayName?: string | null | undefined; email?: string } } | null | undefined): string | null {
  const user = session?.user;
  if (!user) return null;
  const candidate = user.displayName?.trim() || user.id?.trim() || user.email?.trim() || '';
  return candidate === '' ? null : candidate;
}

export function useReviewRouteController(
  examId?: string,
): ReviewRouteController {
  const navigate = useNavigate();
  const authSession = useOptionalAuthSession();
  const staffActor = resolveStaffActor(authSession?.session ?? null);

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
        // Exam was deleted or never existed: leave exam/state unset and error
        // null so the route renders an "Exam Not Found" surface with a way
        // back to Admin, instead of a Retry that can never succeed.
        return;
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
      if (!staffActor) {
        throw new Error('Sign in required: publish is blocked without an authenticated staff user.');
      }

      const result = await examAuthoringFacade.lifecycle.publishExam(examId, staffActor, notes);
      if (!result.success) {
        throw new Error(result.error ?? 'Could not publish the exam. Please try again.');
      }
      await loadExam();
    },
    [examId, loadExam, staffActor],
  );

  const handleRepublishLatestDraft = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!examId) {
      return { success: false, error: 'Exam ID not found' };
    }
    if (!staffActor) {
      return { success: false, error: 'Sign in required: republish is blocked without an authenticated staff user.' };
    }

    const sourceExam = await examAuthoringFacade.repository.getExamById(examId);
    if (!sourceExam) {
      return { success: false, error: 'Source exam not found' };
    }

    if (!sourceExam.canPublish) {
      return { success: false, error: 'You do not have permission to republish this exam.' };
    }

    // No literal 'latest' fallback: republish requires an actual draft version id,
    // otherwise the result would be ambiguous about what was republished.
    const draftVersionId = sourceExam.currentDraftVersionId;
    if (!draftVersionId) {
      return { success: false, error: 'No draft version available to republish.' };
    }
    const result = await examAuthoringFacade.lifecycle.republishVersion(examId, draftVersionId, staffActor);
    if (!result.success) {
      return {
        success: false,
        error: result.error ?? 'Could not republish. Existing schedules are unchanged.',
      };
    }

    await loadExam();
    return { success: true };
  }, [examId, loadExam, staffActor]);

  const handleSchedulePublish = useCallback(
    async (scheduledTime: string) => {
      if (!examId) {
        return;
      }

      if (!staffActor) {
        throw new Error('Sign in required: scheduling is blocked without an authenticated staff user.');
      }

      const result = await examAuthoringFacade.lifecycle.schedulePublish(examId, staffActor, scheduledTime);
      if (!result.success) {
        throw new Error(result.error ?? 'Could not schedule the exam. Please try again.');
      }
      await loadExam();
    },
    [examId, loadExam, staffActor],
  );

  const handleUnpublish = useCallback(
    async (reason?: string) => {
      if (!examId) {
        return;
      }

      if (!staffActor) {
        throw new Error('Sign in required: unpublish is blocked without an authenticated staff user.');
      }

      const result = await examAuthoringFacade.lifecycle.unpublishExam(examId, staffActor, reason);
      if (!result.success) {
        throw new Error(result.error ?? 'Could not unpublish the exam. Please try again.');
      }
      await loadExam();
    },
    [examId, loadExam, staffActor],
  );

  const handleRestoreVersion = useCallback(
    async (versionId: string) => {
      if (!examId) {
        return;
      }
      if (!staffActor) {
        throw new Error('Sign in required: restore is blocked without an authenticated staff user.');
      }
      if (!versionId) {
        throw new Error('Select a version to restore.');
      }
      await examAuthoringFacade.lifecycle.restoreVersionAsDraft(examId, versionId, staffActor);
      await loadExam();
    },
    [examId, loadExam, staffActor],
  );

  const handleRepublishVersion = useCallback(
    async (versionId: string): Promise<{ success: boolean; error?: string }> => {
      if (!examId) {
        return { success: false, error: 'Exam ID not found' };
      }
      if (!staffActor) {
        return { success: false, error: 'Sign in required: republish is blocked without an authenticated staff user.' };
      }
      if (!versionId) {
        return { success: false, error: 'Select a version to republish.' };
      }
      const result = await examAuthoringFacade.lifecycle.republishVersion(examId, versionId, staffActor);
      if (!result.success) {
        return { success: false, error: result.error ?? 'Could not republish this version.' };
      }
      await loadExam();
      return { success: true };
    },
    [examId, loadExam, staffActor],
  );

  const loadEvents = useCallback(async (): Promise<ExamEvent[]> => {
    if (!examId) {
      return [];
    }
    return examAuthoringFacade.repository.getEvents(examId);
  }, [examId]);

  const compareVersions = useCallback(async (versionIdA: string, versionIdB: string): Promise<VersionDiff | null> => {
    if (!examId) {
      return null;
    }
    if (!versionIdA || !versionIdB) {
      throw new Error('Select two versions to compare.');
    }
    if (versionIdA === versionIdB) {
      throw new Error('Select two different versions to compare.');
    }
    return examAuthoringFacade.lifecycle.compareVersions(examId, versionIdA, versionIdB);
  }, [examId]);

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
    handleRepublishVersion,
    loadEvents,
    compareVersions,
    handleNavigateToBuilder,
    handleOpenScheduling,
    loadScheduleContent,
    handleCreateSchedule,
    handleBackToAdmin,
    reload: loadExam,
  };
}
