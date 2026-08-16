import React, { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getEnabledModules,
  getFirstQuestionIdForModule,
} from '@student/application/studentExamContentFacade';
import { StudentAppWrapper } from './StudentAppWrapper';
import type { ExamState, ModuleType } from '../../types';
import type { StudentAttempt } from '../../types/studentAttempt';

interface StudentExamPreviewProps {
  state: ExamState;
  examId: string;
  initialModule?: ModuleType | null | undefined;
}

function resolvePreviewModule(
  state: ExamState,
  initialModule: ModuleType | null | undefined,
  rawQueryModule: string | null,
): ModuleType {
  const enabledModules = getEnabledModules(state.config);
  if (initialModule && enabledModules.includes(initialModule)) {
    return initialModule;
  }

  const queryModule = rawQueryModule?.trim().toLowerCase() as ModuleType | undefined;
  if (queryModule && enabledModules.includes(queryModule)) {
    return queryModule;
  }

  return enabledModules[0] ?? 'reading';
}

function getInitialQuestionId(state: ExamState, module: ModuleType): string | null {
  if (module === 'reading' || module === 'listening') {
    return getFirstQuestionIdForModule(state, module);
  }

  if (module === 'writing') {
    return state.config.sections.writing.tasks[0]?.id ?? 'task1';
  }

  return null;
}

function createPreviewAttemptSnapshot(
  state: ExamState,
  examId: string,
  module: ModuleType,
): StudentAttempt {
  const nowIso = new Date().toISOString();
  const attemptId = `preview-attempt-${examId}`;

  return {
    id: attemptId,
    scheduleId: `preview-schedule-${examId}`,
    studentKey: `preview-student-${examId}`,
    examId,
    revision: 1,
    publishedVersionId: null,
    examTitle: state.title,
    candidateId: 'preview',
    candidateName: 'Preview Candidate',
    candidateEmail: 'preview@example.invalid',
    phase: 'exam',
    currentModule: module,
    currentQuestionId: getInitialQuestionId(state, module),
    answers: {},
    writingAnswers: {},
    flags: {},
    violations: [],
    proctorStatus: 'active',
    proctorNote: null,
    proctorUpdatedAt: null,
    proctorUpdatedBy: null,
    lastWarningId: null,
    lastAcknowledgedWarningId: null,
    submittedAt: null,
    integrity: {
      preCheck: {
        completedAt: nowIso,
        browserFamily: 'other',
        browserVersion: null,
        screenDetailsSupported: true,
        heartbeatReady: true,
        acknowledgedSafariLimitation: false,
        checks: [],
      },
      deviceFingerprintHash: null,
      clientSessionId: `preview-client-${examId}`,
      lastDisconnectAt: null,
      lastReconnectAt: null,
      lastHeartbeatAt: nowIso,
      lastHeartbeatStatus: 'ok',
    },
    recovery: {
      lastRecoveredAt: null,
      lastLocalMutationAt: null,
      lastPersistedAt: null,
      lastDroppedMutations: null,
      pendingMutationCount: 0,
      serverAcceptedThroughSeq: 0,
      clientSessionId: `preview-client-${examId}`,
      syncState: 'saved',
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function StudentExamPreview({ state, examId, initialModule }: StudentExamPreviewProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const previewModule = useMemo(
    () => resolvePreviewModule(state, initialModule, searchParams.get('module')),
    [state, initialModule, searchParams],
  );
  const previewAttemptSnapshot = useMemo(
    () => createPreviewAttemptSnapshot(state, examId, previewModule),
    [state, examId, previewModule],
  );
  const previewState = useMemo(
    () => ({
      ...state,
      activeModule: previewModule,
    }),
    [state, previewModule],
  );

  const handleExit = () => {
    window.close();
    navigate(`/builder/${examId}/builder`, { replace: true });
  };

  return (
    <StudentAppWrapper
      allowPreviewStart
      key={`legacy-preview-${examId}-${previewModule}`}
      state={previewState}
      onExit={handleExit}
      scheduleId={previewAttemptSnapshot.scheduleId}
      attemptSnapshot={previewAttemptSnapshot}
      showSubmitControls={false}
      allowExitDuringExam
      persistenceEnabled={false}
      enableMonitoring={false}
    />
  );
}
