import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorSurface, LoadingSurface } from '@components/ui';
import { StudentAppWrapper } from '@components/student/StudentAppWrapper';
import { useBuilderRouteController } from '@builder/hooks/useBuilderRouteController';
import { getEnabledModules } from '../../exam-authoring/api/examAuthoringGateway';
import { useAuthSession } from '../../auth/api/authSession';
import { useStudentSessionRouteData } from '@student/api/studentSessionRouteData';
import {
  resolvePreviewRuntimeSession,
  type PreviewRuntimeSession,
} from '../services/previewRuntimeSessionService';
import type { ModuleType } from '../../../types';

const MODULE_KEYS: ModuleType[] = ['listening', 'reading', 'writing', 'speaking'];

export function ExamPreviewRoute() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuthSession();
  const controller = useBuilderRouteController(examId);
  const [previewSession, setPreviewSession] = useState<PreviewRuntimeSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  const requestedModule = useMemo<ModuleType | null>(() => {
    const raw = searchParams.get('module');
    if (!raw) {
      return null;
    }
    const normalized = raw.trim().toLowerCase();
    return MODULE_KEYS.includes(normalized as ModuleType) ? (normalized as ModuleType) : null;
  }, [searchParams]);

  const resolvedExam = controller.exam ?? null;
  const resolvedState = controller.state ?? null;
  const resolvedAuthorUserId = session?.user?.id ?? null;
  const enabledModules = resolvedState ? getEnabledModules(resolvedState.config) : [];
  const previewModule =
    requestedModule && enabledModules.includes(requestedModule)
      ? requestedModule
      : enabledModules[0] ?? 'reading';

  useEffect(() => {
    if (
      !examId
      || controller.isLoading
      || controller.error
      || !resolvedExam
      || !resolvedState
      || !resolvedAuthorUserId
    ) {
      return;
    }

    let cancelled = false;

    setSessionLoading(true);
    setSessionError(null);
    setPreviewSession(null);

    void (async () => {
      try {
        const resolved = await resolvePreviewRuntimeSession({
          exam: resolvedExam,
          state: resolvedState,
          authorUserId: resolvedAuthorUserId,
          requestedModule,
        });

        if (cancelled) {
          return;
        }

        if (resolved.module !== previewModule) {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.set('module', resolved.module);
          setSearchParams(nextParams, { replace: true });
        }

        setPreviewSession(resolved);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSessionError(error instanceof Error ? error.message : 'Failed to start preview runtime.');
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    examId,
    controller.isLoading,
    controller.error,
    resolvedAuthorUserId,
    resolvedExam,
    resolvedState,
    previewModule,
    requestedModule,
    searchParams,
    setSearchParams,
  ]);

  if (!examId) {
    return (
      <ErrorSurface
        title="Preview unavailable"
        description="Exam ID not found."
      />
    );
  }

  if (controller.isLoading) {
    return <LoadingSurface label="Loading preview…" />;
  }

  if (controller.error) {
    return (
      <ErrorSurface
        title="Preview load failed"
        description={controller.error}
        actionLabel="Retry"
        onAction={() => {
          void controller.reload();
        }}
      />
    );
  }

  if (!resolvedState) {
    return (
      <ErrorSurface
        title="Preview unavailable"
        description="The requested exam could not be loaded."
      />
    );
  }

  if (!resolvedExam) {
    return (
      <ErrorSurface
        title="Preview unavailable"
        description="Exam metadata not found."
      />
    );
  }

  if (!resolvedAuthorUserId) {
    return (
      <ErrorSurface
        title="Preview unavailable"
        description="Author session not available."
      />
    );
  }

  const handleModuleChange = (nextModule: ModuleType) => {
    if (nextModule === previewModule) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('module', nextModule);
    setSearchParams(nextParams, { replace: true });
  };

  if (sessionLoading) {
    return <LoadingSurface label="Starting runtime preview…" />;
  }

  if (sessionError) {
    return (
      <ErrorSurface
        title="Preview session failed"
        description={sessionError}
      />
    );
  }

  if (!previewSession) {
    return <LoadingSurface label="Preparing preview session…" />;
  }

  return (
    <RuntimePreviewSurface
      examId={examId}
      enabledModules={enabledModules}
      previewModule={previewModule}
      onModuleChange={handleModuleChange}
      previewSession={previewSession}
      onExit={() => navigate(`/builder/${examId}/builder`, { replace: true })}
    />
  );
}

function RuntimePreviewSurface({
  examId,
  enabledModules,
  previewModule,
  onModuleChange,
  previewSession,
  onExit,
}: {
  examId: string;
  enabledModules: ModuleType[];
  previewModule: ModuleType;
  onModuleChange: (nextModule: ModuleType) => void;
  previewSession: PreviewRuntimeSession;
  onExit: () => void;
}) {
  const {
    answerInvariantRollout,
    attemptSnapshot,
    error,
    isLoading,
    refreshRuntime,
    runtimeSnapshot,
    state,
  } = useStudentSessionRouteData(previewSession.scheduleId, previewSession.studentId);

  if (isLoading) {
    return <LoadingSurface label="Loading runtime preview…" />;
  }

  if (error) {
    return (
      <ErrorSurface
        title="Runtime preview failed"
        description={error}
      />
    );
  }

  if (!state) {
    return (
      <ErrorSurface
        title="Runtime preview unavailable"
        description="Preview state not found."
      />
    );
  }

  return (
    <>
      <div className="fixed top-20 right-3 md:right-4 lg:right-6 z-[120] rounded-md border border-gray-200 bg-white/95 shadow-sm px-3 py-1.5 backdrop-blur">
        <label className="text-xs font-semibold text-gray-700">
          Preview section
          <select
            aria-label="Preview section"
            value={previewModule}
            onChange={(event) => onModuleChange(event.target.value as ModuleType)}
            className="ml-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-800"
          >
            {enabledModules.map((module) => (
              <option key={module} value={module}>
                {module.charAt(0).toUpperCase() + module.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <StudentAppWrapper
        allowPreviewStart
        key={`preview-runtime-${examId}-${previewModule}-${previewSession.scheduleId}`}
        state={state}
        onExit={onExit}
        attemptSnapshot={attemptSnapshot}
        scheduleId={previewSession.scheduleId}
        onRuntimeRefresh={refreshRuntime}
        runtimeSnapshot={runtimeSnapshot}
        answerInvariantRollout={answerInvariantRollout}
        showSubmitControls={false}
        allowExitDuringExam
        persistenceEnabled={false}
        enableMonitoring={false}
      />
    </>
  );
}
