import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOptionalAuthSession } from '../../auth/api/authSession';
import { examAuthoringFacade } from '../../exam-authoring/api/examAuthoringFacade';
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

function resolveStaffActor(session: { user: { id: string; displayName?: string | null | undefined; email?: string } } | null | undefined): string | null {
  const user = session?.user;
  if (!user) return null;
  const candidate = user.displayName?.trim() || user.id?.trim() || user.email?.trim() || '';
  return candidate === '' ? null : candidate;
}

export function useBuilderRouteController(
  examId?: string,
): BuilderRouteController {
  const navigate = useNavigate();
  const authSession = useOptionalAuthSession();
  const staffActor = resolveStaffActor(authSession?.session ?? null);

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
      const entity = await examAuthoringFacade.repository.getExamById(examId);
      if (!entity) {
        // Exam was deleted or never existed: leave exam/state unset and error
        // null so routes render their "Exam Not Found" surface with a way
        // back to Admin, instead of a Retry that can never succeed.
        return;
      }

      try {
        const examState = await examAuthoringFacade.getExamStateFromEntity(
          entity,
          examAuthoringFacade.repository,
        );

        setExam(entity);
        setState(examState);
        return;
      } catch (versionError) {
        // Clone-database exams can lose their draft pointer (orphan NULL/NULL
        // rows). Heal once via the draft-reopen endpoint, then retry the load
        // so Retry is not the only path back into the builder.
        const healed = await examAuthoringFacade.lifecycle.reopenDraftVersion(examId);
        if (!healed) {
          throw versionError;
        }
        const healedEntity = await examAuthoringFacade.repository.getExamById(examId);
        if (!healedEntity) {
          throw versionError;
        }
        const examState = await examAuthoringFacade.getExamStateFromEntity(
          healedEntity,
          examAuthoringFacade.repository,
        );
        setExam(healedEntity);
        setState(examState);
        return;
      }
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
      let actor = staffActor;
      if (!actor && authSession) {
        const refreshedSession = await authSession.refresh();
        actor = resolveStaffActor(refreshedSession);
      }
      if (!actor) {
        throw new Error('Sign in required: saving a draft is blocked without an authenticated staff user.');
      }
      const result = await examAuthoringFacade.lifecycle.saveDraft(examId, resolvedContent, actor);

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to save draft');
      }

      setState(resolvedContent);
    },
    [authSession, examId, state, staffActor],
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

      if (!staffActor) {
        throw new Error('Sign in required: publish is blocked without an authenticated staff user.');
      }
      await examAuthoringFacade.lifecycle.publishExam(examId, staffActor, notes);
      await loadExam();
    },
    [examId, loadExam, staffActor],
  );

  const handleSchedulePublish = useCallback(
    async (scheduledTime: string) => {
      if (!examId) {
        return;
      }

      if (!staffActor) {
        throw new Error('Sign in required: scheduling is blocked without an authenticated staff user.');
      }
      await examAuthoringFacade.lifecycle.schedulePublish(examId, staffActor, scheduledTime);
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
      await examAuthoringFacade.lifecycle.unpublishExam(examId, staffActor, reason);
      await loadExam();
    },
    [examId, loadExam, staffActor],
  );

  const handleArchive = useCallback(async () => {
    if (!examId) {
      return;
    }

    if (!staffActor) {
      throw new Error('Sign in required: archive is blocked without an authenticated staff user.');
    }
    await examAuthoringFacade.lifecycle.archiveExam(examId, staffActor);
    await loadExam();
  }, [examId, loadExam, staffActor]);

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
