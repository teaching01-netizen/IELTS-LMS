import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  countAnsweredQuestions,
  countQuestionSlots,
} from '@student/application/studentExamContentFacade';
import { Button } from '../ui/Button';
import { AlertTriangle } from 'lucide-react';
import { AccessibilitySettings } from './AccessibilitySettings';
import { StudentExamPhaseRenderer } from './StudentExamPhaseRenderer';
import { StudentExamWorkspaceSession } from './StudentExamWorkspaceSession';
import './StudentHeader';
import './layout/CompactStudentHeader';
import { StudentExamShell } from './layout/StudentExamShell';
import { StudentExamViewport } from './layout/StudentExamViewport';
import { useStudentExamViewport } from './layout/useStudentExamViewport';
import { useStudentExamPageLock } from './layout/useStudentExamPageLock';
import { useStudentFocusedControlVisibility } from './layout/useStudentFocusedControlVisibility';
import { useStudentLayoutEnvironment } from './layout/useStudentLayoutEnvironment';
import './SubmitConfirmation';
import { WarningOverlay } from './WarningOverlay';
import './useStudentAutoSubmitBoundary';
import {
  getStudentPassageReadabilityGeometry,
  getStudentTypographyScale,
} from './accessibilityScale';
import { StudentHighlightSelectionManagerProvider } from './highlightSelectionManager';
import { useStudentSubmissionOrchestration } from './useStudentSubmissionOrchestration';
import './timeExtensionPolicy';
import { useStudentWarningVisibility } from './useStudentWarningVisibility';
import { useStudentAttempt } from './providers/StudentAttemptProvider';
import { useStudentRuntime, useStudentRuntimeSession } from './providers/StudentRuntimeProvider';
import { useStudentUI } from './providers/StudentUIProvider';
import { useKeyboardSubmitHandler } from './providers/StudentKeyboardProvider';
import { useExamCommands } from '@student/hooks/exam-session/useExamCommands';
import { useStudentExamSessionStore } from '@student/hooks/exam-session/StudentExamSessionProvider';
import { createStudentSubmissionCommands } from '@student/application/exam-session/submissionCommands';
import {
  isRuntimeStructurallyCompleted,
  isVerifiedTerminalStudentState,
} from './providers/verifiedTerminalState';
import { resolveObjectiveAnswerUpdate } from './resolveObjectiveAnswerUpdate';
import { useZoomScrollAnchoring } from './useZoomScrollAnchoring';
import { emitAnswerMutationDebugLog } from './answerMutationDebug';
import { isStudentHighlightToolContextActive } from './studentHighlightToolContext';
import type { StudentAnswerMutationMeta, StudentAnswerValue } from '../../types/studentAttempt';

import { StudentExamHeaderClock } from './StudentExamHeaderClock';
import { StudentExamClockEffects } from './StudentExamClockEffects';
import { StudentExamTimeRemaining } from './StudentExamTimeRemaining';

function getBlockingCopy(
  reason: ReturnType<typeof useStudentRuntime>['state']['blocking']['reason']
) {
  switch (reason) {
    case 'cohort_paused':
      return {
        title: 'Cohort paused',
        message:
          'The proctor has paused delivery. Your current section will resume when the cohort restarts.',
        badge: 'Paused',
        contextLabel: 'Cohort Runtime',
      };
    case 'proctor_paused':
      return {
        title: 'Individual session paused',
        message: 'This session is paused for review. Wait for resume instructions.',
        badge: 'Paused',
        contextLabel: 'Proctor Review',
      };
    case 'not_started':
      return {
        title: 'Waiting for start',
        message: 'The proctor has not started this cohort yet.',
        badge: 'Locked',
        contextLabel: 'Cohort Runtime',
      };
    case 'waiting_for_advance':
      return {
        title: 'Waiting for cohort advance',
        message:
          'The proctor is preparing the next section. Please wait for the cohort to advance.',
        badge: 'Waiting',
        contextLabel: 'Cohort Runtime',
      };
    case 'waiting_for_runtime':
      return {
        title: 'Waiting for runtime',
        message: 'The exam runtime is synchronizing before the next section can continue.',
        badge: 'Waiting',
        contextLabel: 'Session Runtime',
      };
    case 'offline':
      return {
        title: 'Connection lost',
        message:
          'Your session is paused while connectivity is unavailable. Recovery will resume after reconnection.',
        badge: 'Offline',
        contextLabel: 'Session Recovery',
      };
    case 'heartbeat_lost':
      return {
        title: 'Heartbeat lost',
        message:
          'The secure session heartbeat was interrupted. The exam remains paused until continuity is restored.',
        badge: 'Review',
        contextLabel: 'Integrity Hold',
      };
    case 'device_mismatch':
      return {
        title: 'Device review required',
        message:
          'This session no longer matches the original device continuity check. Wait for proctor review.',
        badge: 'Blocked',
        contextLabel: 'Integrity Hold',
      };
    case 'storage_unavailable':
      return {
        title: 'Answer storage unavailable',
        message:
          'Your browser cannot safely store new answers right now. Keep this tab open and contact the proctor.',
        badge: 'Blocked',
        contextLabel: 'Session Recovery',
      };
    default:
      return null;
  }
}

function formatRuntimeTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

interface StudentAppProps {
  showSubmitControls?: boolean | undefined;
  allowPreviewStart?: boolean | undefined;
  allowExitDuringExam?: boolean | undefined;
}

export function StudentApp({
  showSubmitControls = true,
  allowPreviewStart = false,
  allowExitDuringExam = false,
}: StudentAppProps) {
  void allowExitDuringExam;
  const {
    state: runtimeState,
    actions: runtimeActions,
    examState: examState,
    onExit: onExit,
  } = useStudentRuntimeSession();
  const { actions: attemptActions, state: attemptState } = useStudentAttempt();
  const examSessionCommands = useExamCommands();
  const examSessionStore = useStudentExamSessionStore();
  const { state: uiState, actions: uiActions } = useStudentUI();
  const { registerSubmitHandler } = useKeyboardSubmitHandler();
  const layoutEnvironment = useStudentLayoutEnvironment();
  const layoutMode = layoutEnvironment.layoutMode;
  const tabletMode =
    layoutMode === 'medium' &&
    (layoutEnvironment.hasTouch || layoutEnvironment.primaryPointer === 'coarse');
  const autoSaveStatus =
    runtimeState.attemptSyncState === 'syncing_reconnect'
      ? 'syncing'
      : runtimeState.attemptSyncState === 'idle'
        ? null
        : runtimeState.attemptSyncState;
  const studentTypography = useMemo(
    () => getStudentTypographyScale(uiState.accessibilitySettings.fontSize),
    [uiState.accessibilitySettings.fontSize]
  );
  const passageReadabilityGeometry = useMemo(
    () =>
      getStudentPassageReadabilityGeometry(
        uiState.accessibilitySettings.passageReadabilityLevel
      ),
    [uiState.accessibilitySettings.passageReadabilityLevel]
  );
  useZoomScrollAnchoring(uiState.accessibilitySettings.zoom * studentTypography.fontScale);
  const blockingCopy = getBlockingCopy(runtimeState.blocking.reason);
  const { resetHighlightTool } = uiActions;
  const timeExtensionReason =
    typeof uiState.timeExtensionReason === 'string' ? uiState.timeExtensionReason : '';
  const timeExtensionDialogRef = useRef<HTMLDialogElement>(null);
  const highlightColor = uiState.accessibilitySettings.highlightColor;
  const highlightEnabled = true;
  const attemptAnswers = useMemo(
    () => attemptState.attempt?.answers ?? {},
    [attemptState.attempt?.answers]
  );
  const attemptWritingAnswers = useMemo(
    () => attemptState.attempt?.writingAnswers ?? {},
    [attemptState.attempt?.writingAnswers]
  );
  const attemptFlags = useMemo(
    () => attemptState.attempt?.flags ?? {},
    [attemptState.attempt?.flags]
  );
  const studentShellStyle = useMemo(
    () =>
      ({
        zoom: tabletMode ? 1 : uiState.accessibilitySettings.zoom,
        fontSize: studentTypography.rootFontSize,
        lineHeight: studentTypography.lineHeight,
        ['--student-meta-font-size' as string]: studentTypography.metaFontSize,
        ['--student-chip-font-size' as string]: studentTypography.chipFontSize,
        ['--student-control-font-size' as string]: studentTypography.controlFontSize,
        ['--student-preview-font-size' as string]: studentTypography.previewFontSize,
        ['--student-passage-font-size' as string]: studentTypography.passageFontSize,
        ['--student-passage-title-font-size' as string]: studentTypography.passageTitleFontSize,
        ['--student-passage-h1-font-size' as string]: studentTypography.passageH1FontSize,
        ['--student-passage-h2-font-size' as string]: studentTypography.passageH2FontSize,
        ['--student-passage-h3-font-size' as string]: studentTypography.passageH3FontSize,
        ['--student-passage-line-height' as string]: (
          Number.parseFloat(studentTypography.passageLineHeight) *
          passageReadabilityGeometry.lineHeightFactor
        ).toFixed(2),
        ['--student-passage-measure' as string]: passageReadabilityGeometry.measure,
        ['--student-question-font-size' as string]: studentTypography.questionFontSize,
        ['--student-question-line-height' as string]: studentTypography.questionLineHeight,
      }) as React.CSSProperties,
    [passageReadabilityGeometry, studentTypography, tabletMode, uiState.accessibilitySettings.zoom]
  );
  const runtimeStateRef = useRef(runtimeState);
  const runtimeActionsRef = useRef(runtimeActions);
  const attemptActionsRef = useRef(attemptActions);
  const examSessionCommandsRef = useRef(examSessionCommands);
  const attemptFlagsRef = useRef(attemptFlags);
  const uiActionsRef = useRef(uiActions);
  const latestAnswersRef = useRef(attemptAnswers);
  const liveObjectiveAnswersRef = useRef(attemptAnswers);
  const liveWritingAnswersRef = useRef(attemptWritingAnswers);
  const writingDraftCommitRef = useRef<(() => void) | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [warningSeverity, setWarningSeverity] = useState<'medium' | 'high' | 'critical'>('medium');
  const blockingOverlayRef = useRef<HTMLDivElement | null>(null);
  const finalSubmitOverlayRef = useRef<HTMLDivElement | null>(null);
  const submitConfirmModuleRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    runtimeStateRef.current = runtimeState;
    runtimeActionsRef.current = runtimeActions;
    attemptActionsRef.current = attemptActions;
    examSessionCommandsRef.current = examSessionCommands;
    attemptFlagsRef.current = attemptFlags;
    uiActionsRef.current = uiActions;
  }, [attemptActions, attemptFlags, examSessionCommands, runtimeActions, runtimeState, uiActions]);

  const reconcileLiveAnswerCacheNow = useCallback(() => {
    latestAnswersRef.current = liveObjectiveAnswersRef.current;
  }, []);
  const latestPendingWarning = useMemo(() => {
    const warnings =
      attemptState.attempt?.violations.filter(
        (violation) => violation.type === 'PROCTOR_WARNING'
      ) ?? [];
    const latestWarning = warnings[warnings.length - 1];
    if (!latestWarning) {
      return null;
    }

    if (latestWarning.id === attemptState.attempt?.lastAcknowledgedWarningId) {
      return null;
    }

    return latestWarning;
  }, [attemptState.attempt]);

  const verifiedTerminalState = useMemo(
    () =>
      isVerifiedTerminalStudentState({
        attempt: attemptState.attempt,
        runtimeSnapshot: runtimeState.runtimeSnapshot,
      }),
    [attemptState.attempt, runtimeState.runtimeSnapshot]
  );
  const shouldRenderPostExam =
    verifiedTerminalState !== 'not_terminal' ||
    (!runtimeState.runtimeBacked && runtimeState.phase === 'post-exam');
  const effectivePhase =
    runtimeState.phase === 'post-exam' && !shouldRenderPostExam ? 'exam' : runtimeState.phase;
  const runtimeCompletionVerified = isRuntimeStructurallyCompleted(runtimeState.runtimeSnapshot);
  const runtimeSubmissionPending =
    runtimeState.runtimeBacked &&
    runtimeState.runtimeStatus === 'completed' &&
    runtimeCompletionVerified &&
    verifiedTerminalState === 'not_terminal';
  const examViewportActive = effectivePhase === 'exam';
  const examViewport = useStudentExamViewport(examViewportActive);
  useStudentExamPageLock(examViewportActive);
  useStudentFocusedControlVisibility(examViewportActive && examViewport.keyboardOpen);

  useEffect(() => {
    latestAnswersRef.current = attemptAnswers;
    liveObjectiveAnswersRef.current = attemptAnswers;
    liveWritingAnswersRef.current = attemptWritingAnswers;
  }, [attemptAnswers, attemptWritingAnswers, runtimeState]);

  const commitWritingDraft = useCallback(() => {
    writingDraftCommitRef.current?.();
  }, []);

  const submissionCommands = useMemo(
    () =>
      createStudentSubmissionCommands({
        store: examSessionStore,
        drafts: {
          async commitAll() {
            reconcileLiveAnswerCacheNow();
            commitWritingDraft();
          },
          async flushDurability() {
            attemptActions.flushAnswerDurabilityNow();
          },
        },
        transport: {
          flushPending: attemptActions.flushPending,
          submit: attemptActions.submitAttempt,
        },
      }),
    [attemptActions, commitWritingDraft, examSessionStore, reconcileLiveAnswerCacheNow]
  );

  const { finalSubmitStatus, flushAndSubmitCurrentModuleWithRetry, retryFinalSubmit } =
    useStudentSubmissionOrchestration({
      runtimeState: {
        runtimeBacked: runtimeState.runtimeBacked,
        runtimeStatus: runtimeState.runtimeStatus,
        currentModule: runtimeState.currentModule,
      },
      runtimeStateRef,
      attemptId: attemptState.attemptId,
      finalSubmissionPending: attemptState.attempt?.recovery.finalSubmissionPending ?? false,
      runtimeCompletionVerified,
      shouldRenderPostExam: shouldRenderPostExam && !runtimeSubmissionPending,
      reconcileLiveAnswerCacheNow,
      commitWritingDraft,
      attemptActions: {
        flushPending: attemptActions.flushPending,
        submitAttempt: attemptActions.submitAttempt,
      },
      runtimeActions: {
        transitionBlocking: runtimeActions.transitionBlocking,
        submitModule: runtimeActions.submitModule,
      },
      submissionCommands,
    });
  const flushAndSubmitCurrentModuleWithRetryRef = useRef(flushAndSubmitCurrentModuleWithRetry);
  useLayoutEffect(() => {
    flushAndSubmitCurrentModuleWithRetryRef.current = flushAndSubmitCurrentModuleWithRetry;
  }, [flushAndSubmitCurrentModuleWithRetry]);

  useEffect(() => {
    const isHighlightCapableContext = isStudentHighlightToolContextActive({
      phase: effectivePhase,
      module: runtimeState.currentModule,
      blockingReason: runtimeState.blocking.reason,
      submitConfirmOpen: uiState.showSubmitConfirm,
      finalSubmitIdle: finalSubmitStatus === 'idle',
    });

    if (!isHighlightCapableContext && uiState.accessibilitySettings.highlightToolMode !== 'off') {
      resetHighlightTool();
    }
  }, [
    effectivePhase,
    finalSubmitStatus,
    resetHighlightTool,
    runtimeState.blocking.reason,
    runtimeState.currentModule,
    uiState.accessibilitySettings.highlightToolMode,
    uiState.showSubmitConfirm,
  ]);

  useEffect(() => {
    uiActionsRef.current.setShowSubmitConfirm(false);
    uiActionsRef.current.setShowNavigator(false);
  }, [runtimeState.currentModule]);

  useEffect(() => {
    if (runtimeState.blocking.active && blockingCopy) {
      blockingOverlayRef.current?.focus();
    }
  }, [blockingCopy, runtimeState.blocking.active]);

  useEffect(() => {
    if (
      runtimeState.runtimeBacked &&
      runtimeState.runtimeStatus === 'completed' &&
      runtimeCompletionVerified &&
      finalSubmitStatus !== 'idle'
    ) {
      finalSubmitOverlayRef.current?.focus();
    }
  }, [
    finalSubmitStatus,
    runtimeCompletionVerified,
    runtimeState.runtimeBacked,
    runtimeState.runtimeStatus,
  ]);

  useEffect(() => {
    if (!latestPendingWarning) {
      setWarningOpen(false);
      return;
    }

    setWarningMessage(latestPendingWarning.description);
    setWarningSeverity(
      latestPendingWarning.severity === 'low' ? 'medium' : latestPendingWarning.severity
    );
    setWarningOpen(true);
  }, [latestPendingWarning]);

  const {
    latestTabSwitchViolation,
    shouldShowTabSwitchWarning,
    tabSwitchSeverity,
    latestSecondaryScreenViolation,
    shouldShowSecondaryScreenWarning,
    latestScreenshotViolation,
    shouldShowScreenshotWarning,
    latestTranslationViolation,
    shouldShowTranslationWarning,
    acknowledgeTabSwitch,
    acknowledgeSecondaryScreen,
    acknowledgeScreenshot,
    acknowledgeTranslation,
  } = useStudentWarningVisibility({
    effectivePhase,
    violations: runtimeState.violations,
    security: {
      tabSwitchRule: examState.config.security.tabSwitchRule,
      detectSecondaryScreen: examState.config.security.detectSecondaryScreen,
      antiScreenshotGuardEnabled: examState.config.security.antiScreenshotGuardEnabled,
      preventTranslation: examState.config.security.preventTranslation,
    },
  });

  useEffect(() => {
    const dialog = timeExtensionDialogRef.current;
    if (!dialog) return;

    if (uiState.showTimeExtensionRequest && !uiState.timeExtensionGranted && !dialog.open) {
      dialog.showModal();
    } else if ((!uiState.showTimeExtensionRequest || uiState.timeExtensionGranted) && dialog.open) {
      dialog.close();
    }

    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [uiState.showTimeExtensionRequest, uiState.timeExtensionGranted]);

  const handleTimeExtensionRequest = () => {
    if (timeExtensionReason.trim()) {
      uiActions.grantTimeExtension(5);
      runtimeActions.setTimeRemaining(runtimeState.timeRemaining + 300);
    }
  };

  const answeredCount = countAnsweredQuestions(runtimeState.allQuestions, attemptAnswers);
  const totalQuestions = countQuestionSlots(runtimeState.allQuestions);
  const unansweredSubmissionPolicy =
    examState.config.progression.unansweredSubmissionPolicy ?? 'confirm';
  const submitRequiresConfirmation =
    effectivePhase === 'exam' &&
    (runtimeState.currentModule === 'reading' || runtimeState.currentModule === 'listening') &&
    totalQuestions > 0 &&
    answeredCount < totalQuestions &&
    unansweredSubmissionPolicy !== 'allow';

  const performModuleSubmit = useCallback(async () => {
    const currentRuntimeState = runtimeStateRef.current;
    if (currentRuntimeState.runtimeBacked) {
      const fingerprint = `manual:${currentRuntimeState.currentModule}`;
      await flushAndSubmitCurrentModuleWithRetryRef.current(fingerprint);
      return;
    }

    reconcileLiveAnswerCacheNow();
    writingDraftCommitRef.current?.();
    runtimeActionsRef.current.submitModule();
  }, [reconcileLiveAnswerCacheNow]);

  useEffect(
    () => registerSubmitHandler(performModuleSubmit),
    [performModuleSubmit, registerSubmitHandler]
  );

  const handleModuleSubmit = useCallback(async () => {
    if (submitRequiresConfirmation) {
      submitConfirmModuleRef.current = runtimeStateRef.current.currentModule;
      uiActionsRef.current.setShowSubmitConfirm(true);
      return;
    }

    await performModuleSubmit();
  }, [performModuleSubmit, submitRequiresConfirmation]);

  const confirmModuleSubmit = useCallback(async () => {
    uiActionsRef.current.setShowSubmitConfirm(false);
    if (submitConfirmModuleRef.current !== runtimeStateRef.current.currentModule) {
      return;
    }
    await performModuleSubmit();
  }, [performModuleSubmit]);

  const handleAnswerChange = useCallback(
    (questionId: string, answer: StudentAnswerValue, meta?: StudentAnswerMutationMeta) => {
      if (runtimeStateRef.current.blocking.reason === 'storage_unavailable') {
        return;
      }
      const currentValue = latestAnswersRef.current[questionId];
      const resolvedAnswer = resolveObjectiveAnswerUpdate(currentValue, answer, meta);
      emitAnswerMutationDebugLog('StudentApp.handleAnswerChange', {
        questionId,
        incomingAnswer: answer,
        currentValue,
        resolvedAnswer,
        mutationMeta: meta ?? null,
      });

      latestAnswersRef.current = {
        ...latestAnswersRef.current,
        [questionId]: resolvedAnswer,
      };
      liveObjectiveAnswersRef.current = {
        ...liveObjectiveAnswersRef.current,
        [questionId]: resolvedAnswer,
      };
      examSessionCommandsRef.current.setObjectiveAnswer(questionId, resolvedAnswer, meta);
      attemptActionsRef.current.persistAnswer(questionId, resolvedAnswer, meta);
    },
    []
  );

  const handleFlagToggle = useCallback((questionId: string) => {
    if (runtimeStateRef.current.blocking.reason === 'storage_unavailable') {
      return;
    }
    const nextFlagged = !attemptFlagsRef.current[questionId];
    examSessionCommandsRef.current.toggleFlag(questionId);
    attemptActionsRef.current.persistFlag(questionId, nextFlagged);
  }, []);

  const registerLiveObjectiveAnswer = useCallback(
    (questionId: string, value: StudentAnswerValue) => {
      liveObjectiveAnswersRef.current = {
        ...liveObjectiveAnswersRef.current,
        [questionId]: value,
      };
    },
    []
  );

  const registerLiveWritingAnswer = useCallback((taskId: string, text: string) => {
    liveWritingAnswersRef.current = {
      ...liveWritingAnswersRef.current,
      [taskId]: text,
    };
  }, []);

  const handleWritingChange = useCallback((taskId: string, text: string) => {
    if (runtimeStateRef.current.blocking.reason === 'storage_unavailable') {
      return;
    }
    liveWritingAnswersRef.current = {
      ...liveWritingAnswersRef.current,
      [taskId]: text,
    };
    examSessionCommandsRef.current.setWritingAnswer(taskId, text);
    attemptActionsRef.current.persistWritingAnswer(taskId, text);
  }, []);

  const registerWritingDraftCommit = useCallback((commitDraft: (() => void) | null) => {
    writingDraftCommitRef.current = commitDraft;
  }, []);

  const handleNavigate = useCallback((questionId: string) => {
    examSessionCommandsRef.current.setNavigation(runtimeStateRef.current.currentModule, questionId);
    runtimeActionsRef.current.setCurrentQuestionId(questionId);
  }, []);

  const openAccessibility = useCallback(() => {
    uiActionsRef.current.setShowAccessibility(true);
  }, []);
  const openNavigator = useCallback(() => {
    uiActionsRef.current.setShowNavigator(true);
  }, []);
  const closeNavigator = useCallback(() => {
    uiActionsRef.current.setShowNavigator(false);
  }, []);
  const showNavigatorForModule =
    runtimeState.currentModule === 'reading' ||
    runtimeState.currentModule === 'listening' ||
    runtimeState.currentModule === 'writing';

  const blockingOverlay =
    runtimeState.blocking.active && blockingCopy ? (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm p-4">
        <div
          ref={blockingOverlayRef}
          tabIndex={-1}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="blocking-overlay-title"
          className="max-w-md w-full bg-white rounded-lg border border-gray-200 shadow-xl p-6 md:p-8 text-center"
        >
          <p className="text-[length:var(--student-meta-font-size)] font-semibold uppercase tracking-wide text-gray-500 mb-3">
            {blockingCopy.contextLabel}
          </p>
          <h2 id="blocking-overlay-title" className="text-2xl font-black text-gray-900 mb-3">{blockingCopy.title}</h2>
          <p className="text-sm text-gray-700 leading-6">
            {runtimeState.proctorNote ?? blockingCopy.message}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <div className="px-3 py-1 rounded-sm bg-gray-50 border border-gray-100 text-xs font-bold uppercase tracking-widest text-gray-700">
              Remaining {formatRuntimeTime(runtimeState.blocking.timeRemaining)}
            </div>
            <div className="px-3 py-1 rounded-sm bg-amber-50 border border-amber-700 text-xs font-bold uppercase tracking-widest text-amber-900">
              {blockingCopy.badge}
            </div>
          </div>
        </div>
      </div>
    ) : null;

  const finalSubmitOverlay =
    runtimeState.runtimeBacked &&
    runtimeState.runtimeStatus === 'completed' &&
    runtimeCompletionVerified &&
    finalSubmitStatus !== 'idle' ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm p-4">
        <div
          ref={finalSubmitOverlayRef}
          tabIndex={-1}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="final-submit-overlay-title"
          className="max-w-md w-full bg-white rounded-lg border border-gray-200 shadow-xl p-6 md:p-8 text-center"
        >
          <p className="text-[length:var(--student-meta-font-size)] font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Submission
          </p>
          <h2 id="final-submit-overlay-title" className="text-2xl font-black text-gray-900 mb-3">Submitting your exam</h2>
          <p className="text-sm text-gray-700 leading-6">
            {finalSubmitStatus === 'failed'
              ? 'We could not confirm submission yet. Stay on this page and check your connection.'
              : 'Please keep this page open while we finalize your submission.'}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <div className="px-3 py-1 rounded-sm bg-gray-50 border border-gray-100 text-xs font-bold uppercase tracking-widest text-gray-700">
              {finalSubmitStatus === 'submitting'
                ? 'Submitting'
                : finalSubmitStatus === 'retrying'
                  ? 'Retrying'
                  : 'Needs attention'}
            </div>
            <div className="px-3 py-1 rounded-sm bg-amber-50 border border-amber-700 text-xs font-bold uppercase tracking-widest text-amber-900">
              Do not close
            </div>
          </div>
          {finalSubmitStatus === 'failed' ? (
            <div className="mt-6 flex flex-col items-stretch gap-2">
              <Button variant="primary" onClick={retryFinalSubmit} className="h-11 text-base font-semibold">
                Retry Submission
              </Button>
              <p className="text-xs text-gray-500 leading-5">
                Your answers are safe on this device. If submission keeps failing, contact your proctor.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    ) : null;

  const droppedMutations = attemptState.attempt?.recovery.lastDroppedMutations ?? null;
  const droppedMutationsBanner = droppedMutations ? (
    <div
      role="status"
      className="fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto w-full max-w-lg rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 shadow-xl flex items-start gap-3">
        <AlertTriangle size={16} className="text-amber-700 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">Some answers could not be saved</p>
          <p className="mt-0.5 text-xs leading-5 text-amber-800">
            {droppedMutations.count} change{droppedMutations.count === 1 ? '' : 's'}{' '}
            {droppedMutations.count === 1 ? 'was' : 'were'} not recorded. Check with your proctor
            if you think an answer is missing.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void attemptActions.dismissDroppedMutationsBanner()}
          className="flex-shrink-0 text-xs font-bold text-amber-900 hover:underline"
        >
          Got it
        </button>
      </div>
    </div>
  ) : null;

  if (shouldRenderPostExam || effectivePhase !== 'exam') {
    return (
      <StudentExamPhaseRenderer
        phase={effectivePhase}
        shouldRenderPostExam={shouldRenderPostExam}
        examState={examState}
        allowPreviewStart={allowPreviewStart}
        shellStyle={studentShellStyle}
        verifiedTerminalState={verifiedTerminalState}
        finalSubmitOverlay={finalSubmitOverlay}
        onExit={onExit}
      />
    );
  }

  return (
    <StudentExamShell
      layoutMode={layoutMode}
      highContrast={uiState.accessibilitySettings.highContrast}
      touchMode={tabletMode}
      style={studentShellStyle}
      keyboardOpen={examViewportActive ? examViewport.keyboardOpen : false}
      examHeight={examViewportActive ? examViewport.stableExamHeight : null}
    >
      {
        <StudentExamClockEffects
          effectivePhase={effectivePhase}
          autoSubmitEnabled={examState.config.progression.autoSubmit}
          config={examState.config}
          flushAndSubmitCurrentModuleWithRetry={flushAndSubmitCurrentModuleWithRetry}
        />
      }
      <style>{`
        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        textarea:-webkit-autofill,
        textarea:-webkit-autofill:hover,
        textarea:-webkit-autofill:focus,
        select:-webkit-autofill,
        select:-webkit-autofill:hover,
        select:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0px 1000px white inset;
          transition: background-color 5000s ease-in-out 0s;
        }
      `}</style>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      {layoutMode === 'compact' ? (
        <StudentExamHeaderClock
          compact={true}
          moduleLabel={`${runtimeState.currentModule.charAt(0).toUpperCase()}${runtimeState.currentModule.slice(1)}`}
          testTakerId={attemptState.attempt?.candidateId ?? undefined}
          autoSaveStatus={autoSaveStatus}
          highlightEnabled={highlightEnabled}
          highlightToolMode={uiState.accessibilitySettings.highlightToolMode}
          highlightColor={highlightColor}
          onToggleHighlightMode={uiActions.toggleHighlightMode}
          onSelectHighlightColor={uiActions.setHighlightColor}
          onSelectEraseMode={uiActions.toggleEraseMode}
          onOpenAccessibility={openAccessibility}
          onOpenNavigator={showNavigatorForModule ? openNavigator : undefined}
        />
      ) : (
        <StudentExamHeaderClock
          compact={false}
          moduleLabel={
            runtimeState.currentModule.charAt(0).toUpperCase() + runtimeState.currentModule.slice(1)
          }
          testTakerId={attemptState.attempt?.candidateId ?? undefined}
          autoSaveStatus={autoSaveStatus}
          highlightEnabled={highlightEnabled}
          highlightToolMode={uiState.accessibilitySettings.highlightToolMode}
          highlightColor={highlightColor}
          onToggleHighlightMode={uiActions.toggleHighlightMode}
          onSelectHighlightColor={uiActions.setHighlightColor}
          onSelectEraseMode={uiActions.toggleEraseMode}
          tabletMode={tabletMode}
          onOpenAccessibility={openAccessibility}
          onOpenNavigator={showNavigatorForModule ? openNavigator : undefined}
          isExamActive={effectivePhase === 'exam'}
        />
      )}
      <StudentExamViewport>
        <StudentHighlightSelectionManagerProvider>
          <StudentExamWorkspaceSession
            examState={examState}
            allQuestions={runtimeState.allQuestions}
            tabletMode={tabletMode}
            layoutMode={layoutMode}
            showSubmitControls={showSubmitControls}
            contentZoom={uiState.accessibilitySettings.zoom}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
            playbackRate={uiState.accessibilitySettings.playbackRate}
            showNavigator={uiState.showNavigator}
            security={examState.config.security}
            onNavigate={handleNavigate}
            onObjectiveAnswerChange={handleAnswerChange}
            onFlagToggle={handleFlagToggle}
            onWritingChange={handleWritingChange}
            onModuleSubmit={handleModuleSubmit}
            onRegisterWritingDraftCommit={registerWritingDraftCommit}
            onRegisterLiveObjectiveAnswer={registerLiveObjectiveAnswer}
            onRegisterLiveWritingAnswer={registerLiveWritingAnswer}
            onPlaybackRateChange={uiActions.setPlaybackRate}
            onOpenNavigator={openNavigator}
            onCloseNavigator={closeNavigator}
          />
        </StudentHighlightSelectionManagerProvider>
      </StudentExamViewport>
      {droppedMutationsBanner}
      {blockingOverlay}
      {finalSubmitOverlay}
      {examState.config.progression.showWarnings ? (
        <WarningOverlay
          isOpen={warningOpen}
          severity={warningSeverity}
          message={warningMessage}
          onAcknowledge={() => {
            if (latestPendingWarning) {
              void attemptActions.acknowledgeProctorWarning(latestPendingWarning.id);
            }
            setWarningOpen(false);
          }}
        />
      ) : null}
      {shouldShowScreenshotWarning ? (
        <WarningOverlay
          isOpen
          severity="high"
          appearance="blackout"
          message={
            latestScreenshotViolation?.description ??
            'Screenshot attempt detected. The exam screen has been hidden. Acknowledge to continue.'
          }
          showCountdown={false}
          onAcknowledge={() => {
            acknowledgeScreenshot();
          }}
        />
      ) : null}
      {examState.config.progression.showWarnings ? (
        <WarningOverlay
          isOpen={shouldShowTabSwitchWarning}
          severity={tabSwitchSeverity}
          message={
            latestTabSwitchViolation?.description ??
            'Tab switching detected. You must remain on the examination page at all times.'
          }
          showCountdown={false}
          onAcknowledge={() => {
            acknowledgeTabSwitch();
          }}
        />
      ) : null}
      {examState.config.progression.showWarnings ? (
        <WarningOverlay
          isOpen={shouldShowTranslationWarning}
          severity="medium"
          message={
            latestTranslationViolation?.description ??
            'Translation tools detected. Please disable translation and continue in the original language.'
          }
          showCountdown={false}
          onAcknowledge={() => {
            acknowledgeTranslation();
          }}
        />
      ) : null}
      {examState.config.progression.showWarnings ? (
        <WarningOverlay
          isOpen={shouldShowSecondaryScreenWarning}
          severity="high"
          message={
            latestSecondaryScreenViolation?.description ??
            'Multiple screens detected. Please disconnect additional displays to continue.'
          }
          showCountdown={false}
          onAcknowledge={() => {
            acknowledgeSecondaryScreen();
          }}
        />
      ) : null}
      <StudentExamTimeRemaining
        isOpen={uiState.showSubmitConfirm}
        onClose={() => uiActions.setShowSubmitConfirm(false)}
        onConfirm={confirmModuleSubmit}
        answeredCount={answeredCount}
        totalQuestions={totalQuestions}
        flaggedCount={Object.values(attemptFlags).filter(Boolean).length}
        unansweredSubmissionPolicy={unansweredSubmissionPolicy}
      />
      <dialog
        ref={timeExtensionDialogRef}
        onClose={() => uiActions.setShowTimeExtensionRequest(false)}
        className="rounded-lg shadow-xl max-w-md w-full p-6 md:p-8"
        aria-labelledby="time-extension-title"
      >
        <h2 id="time-extension-title" className="text-xl font-black text-gray-900 mb-3">
          Request Time Extension
        </h2>
        <p className="text-sm text-gray-700 leading-6 mb-4">
          You have 5 minutes remaining. If you need additional time due to accessibility needs, you
          may request an extension.
        </p>
        <div className="mb-4">
          <label
            htmlFor="extension-reason"
            className="block text-sm font-semibold text-gray-900 mb-2"
          >
            Please explain why you need an extension:
            <textarea
              id="extension-reason"
              value={timeExtensionReason}
              onChange={(event) => uiActions.setTimeExtensionReason(event.target.value)}
              className="mt-2 w-full border border-gray-300 rounded-sm px-3 py-2 min-h-[120px] font-normal"
              aria-describedby="extension-reason-hint"
              aria-label="Time extension reason"
            />
          </label>
          <span id="extension-reason-hint" className="sr-only">
            Enter the reason for your time extension request
          </span>
        </div>
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => uiActions.setShowTimeExtensionRequest(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleTimeExtensionRequest} disabled={!timeExtensionReason.trim()}>
            Request +5 Minutes
          </Button>
        </div>
      </dialog>
      <AccessibilitySettings
        isOpen={uiState.showAccessibility}
        onClose={() => uiActions.setShowAccessibility(false)}
        fontSize={uiState.accessibilitySettings.fontSize}
        highContrast={uiState.accessibilitySettings.highContrast}
        zoom={uiState.accessibilitySettings.zoom}
        passageReadabilityLevel={uiState.accessibilitySettings.passageReadabilityLevel}
        playbackRate={uiState.accessibilitySettings.playbackRate}
        onFontSizeChange={uiActions.setFontSize}
        onHighContrastToggle={uiActions.toggleHighContrast}
        onZoomChange={uiActions.setZoom}
        onPassageReadabilityChange={uiActions.setPassageReadabilityLevel}
        onPlaybackRateChange={uiActions.setPlaybackRate}
        onResetDefaults={uiActions.resetAccessibilitySettings}
      />
    </StudentExamShell>
  );
}
