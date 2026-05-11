import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countAnsweredQuestions, countQuestionSlots } from '@services/examAdapterService';
import { Button } from '../ui/Button';
import { AccessibilitySettings } from './AccessibilitySettings';
import { HelpModal } from './HelpModal';
import { Lobby } from './Lobby';
import { PreCheck } from './PreCheck';
import { StudentExamWorkspace } from './StudentExamWorkspace';
import { StudentHeader } from './StudentHeader';
import { StudentPostExamView } from './StudentPostExamView';
import { SubmitConfirmation } from './SubmitConfirmation';
import { WarningOverlay } from './WarningOverlay';
import { useStudentAutoSubmitBoundary } from './useStudentAutoSubmitBoundary';
import { requestStudentFullscreen } from './fullscreen';
import {
  canDecreaseStudentPassageReadability,
  canIncreaseStudentPassageReadability,
  getStudentPassageReadabilityLabel,
  getStudentTypographyScale,
} from './accessibilityScale';
import { getStudentHighlightClassName } from './highlightPalette';
import { StudentHighlightPersistenceProvider, clearStudentHighlights } from './highlightPersistence';
import { useStudentFullscreenWarning } from './useStudentFullscreenWarning';
import { useStudentSubmissionOrchestration } from './useStudentSubmissionOrchestration';
import { useStudentTabletMode } from './tabletMode';
import { shouldOfferTimeExtension } from './timeExtensionPolicy';
import { useStudentWarningVisibility } from './useStudentWarningVisibility';
import { useStudentAttempt } from './providers/StudentAttemptProvider';
import { useStudentRuntime } from './providers/StudentRuntimeProvider';
import { useStudentUI } from './providers/StudentUIProvider';
import { isRuntimeStructurallyCompleted, isVerifiedTerminalStudentState } from './providers/verifiedTerminalState';
import { resolveObjectiveAnswerUpdate } from './resolveObjectiveAnswerUpdate';
import { useZoomScrollAnchoring } from './useZoomScrollAnchoring';
import { shouldLockViewportForExamSession } from './browserParityPolicy';
import { emitAnswerMutationDebugLog } from './answerMutationDebug';
import type { StudentAnswerMutationMeta, StudentAnswerValue } from '../../types/studentAttempt';

function getBlockingCopy(reason: ReturnType<typeof useStudentRuntime>['state']['blocking']['reason']) {
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
        message: 'The proctor is preparing the next section. Please wait for the cohort to advance.',
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
  allowExitDuringExam?: boolean | undefined;
}

export function StudentApp({
  showSubmitControls = true,
  allowExitDuringExam = false,
}: StudentAppProps) {
  const { state: runtimeState, actions: runtimeActions, examState, onExit } = useStudentRuntime();
  const { actions: attemptActions, state: attemptState } = useStudentAttempt();
  const { state: uiState, actions: uiActions } = useStudentUI();
  const tabletMode = useStudentTabletMode();
  const shouldLockViewportForKeyboard = shouldLockViewportForExamSession(tabletMode);
  const canIncreasePassageReadability = canIncreaseStudentPassageReadability(
    uiState.accessibilitySettings.passageReadabilityLevel,
  );
  const canDecreasePassageReadability = canDecreaseStudentPassageReadability(
    uiState.accessibilitySettings.passageReadabilityLevel,
  );
  const studentTypography = getStudentTypographyScale(uiState.accessibilitySettings.fontSize);
  useZoomScrollAnchoring(uiState.accessibilitySettings.zoom * studentTypography.fontScale);
  const blockingCopy = getBlockingCopy(runtimeState.blocking.reason);
  const { setShowTimeExtensionRequest } = uiActions;
  const timeExtensionReason =
    typeof uiState.timeExtensionReason === 'string' ? uiState.timeExtensionReason : '';
  const highlightColor = uiState.accessibilitySettings.highlightColor;
  const highlightClassName = getStudentHighlightClassName(highlightColor);
  const highlightNamespace = useMemo(
    () => `attempt:${attemptState.attempt?.id ?? 'unknown'}`,
    [attemptState.attempt?.id],
  );
  const attemptAnswers = attemptState.attempt?.answers ?? {};
  const attemptWritingAnswers = attemptState.attempt?.writingAnswers ?? {};
  const attemptFlags = attemptState.attempt?.flags ?? {};
  const clearHighlights = useCallback(() => {
    clearStudentHighlights(highlightNamespace);
  }, [highlightNamespace]);
  const studentShellStyle = {
    height: 'var(--student-viewport-height, 100dvh)',
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
    ['--student-passage-line-height' as string]: studentTypography.passageLineHeight,
  } as React.CSSProperties;
  const runtimeStateRef = useRef(runtimeState);
  const latestAnswersRef = useRef(attemptAnswers);
  const liveObjectiveAnswersRef = useRef(attemptAnswers);
  const liveWritingAnswersRef = useRef(attemptWritingAnswers);
  const viewportLockForExamSessionRef = useRef<boolean | null>(null);
  const lockedViewportHeightRef = useRef<number | null>(null);
  const writingDraftCommitRef = useRef<(() => void) | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [warningSeverity, setWarningSeverity] = useState<'medium' | 'high' | 'critical'>(
    'medium',
  );
  const flushDomAnswerControlsNow = useCallback(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const controls = document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input, select, textarea',
    );

    controls.forEach((control) => {
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      control.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    });

    const contentEditables = document.querySelectorAll<HTMLElement>('[contenteditable="true"]');
    contentEditables.forEach((node) => {
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    });
  }, []);
  const reconcileLiveAnswerCacheNow = useCallback(() => {
    latestAnswersRef.current = liveObjectiveAnswersRef.current;
  }, []);
  const latestPendingWarning = useMemo(() => {
    const warnings =
      attemptState.attempt?.violations.filter((violation) => violation.type === 'PROCTOR_WARNING') ??
      [];
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
    [attemptState.attempt, runtimeState.runtimeSnapshot],
  );
  const shouldRenderPostExam =
    verifiedTerminalState !== 'not_terminal' ||
    (!runtimeState.runtimeBacked && runtimeState.phase === 'post-exam');
  const effectivePhase =
    runtimeState.phase === 'post-exam' && !shouldRenderPostExam ? 'exam' : runtimeState.phase;
  const runtimeCompletionVerified = isRuntimeStructurallyCompleted(runtimeState.runtimeSnapshot);

  useEffect(() => {
    runtimeStateRef.current = runtimeState;
    latestAnswersRef.current = attemptAnswers;
    liveObjectiveAnswersRef.current = attemptAnswers;
    liveWritingAnswersRef.current = attemptWritingAnswers;
  }, [attemptAnswers, attemptWritingAnswers, runtimeState]);

  useEffect(() => {
    if (effectivePhase !== 'exam') {
      viewportLockForExamSessionRef.current = null;
      lockedViewportHeightRef.current = null;
      return;
    }

    if (viewportLockForExamSessionRef.current === null) {
      viewportLockForExamSessionRef.current = shouldLockViewportForKeyboard;
    }
  }, [effectivePhase, shouldLockViewportForKeyboard]);

  const commitWritingDraft = useCallback(() => {
    writingDraftCommitRef.current?.();
  }, []);

  const {
    finalSubmitStatus,
    flushAndSubmitCurrentModuleWithRetry,
  } = useStudentSubmissionOrchestration({
    runtimeState: {
      runtimeBacked: runtimeState.runtimeBacked,
      runtimeStatus: runtimeState.runtimeStatus,
      currentModule: runtimeState.currentModule,
    },
    runtimeStateRef,
    attemptId: attemptState.attemptId,
    runtimeCompletionVerified,
    shouldRenderPostExam,
    flushDomAnswerControlsNow,
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
  });

  useEffect(() => {
    if (!latestPendingWarning) {
      setWarningOpen(false);
      return;
    }

    setWarningMessage(latestPendingWarning.description);
    setWarningSeverity(
      latestPendingWarning.severity === 'low' ? 'medium' : latestPendingWarning.severity,
    );
    setWarningOpen(true);
  }, [latestPendingWarning]);

  const {
    fullscreenWarningOpen,
    fullscreenWarningMessage,
    fullscreenWarningSeverity,
  } = useStudentFullscreenWarning({
    effectivePhase,
    showWarnings: examState.config.progression.showWarnings,
    requireFullscreen: examState.config.security.requireFullscreen,
    violations: runtimeState.violations,
  });

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
    fullscreenWarningOpen,
    violations: runtimeState.violations,
    security: {
      tabSwitchRule: examState.config.security.tabSwitchRule,
      detectSecondaryScreen: examState.config.security.detectSecondaryScreen,
      antiScreenshotGuardEnabled: examState.config.security.antiScreenshotGuardEnabled,
      preventTranslation: examState.config.security.preventTranslation,
    },
  });

  useStudentAutoSubmitBoundary({
    effectivePhase,
    autoSubmitEnabled: examState.config.progression.autoSubmit,
    runtimeState: {
      blockingActive: runtimeState.blocking.active,
      displayTimeRemaining: runtimeState.displayTimeRemaining ?? null,
      runtimeBacked: runtimeState.runtimeBacked,
      runtimeStatus: runtimeState.runtimeStatus,
      currentModule: runtimeState.currentModule,
      runtimeSnapshot: runtimeState.runtimeSnapshot,
    },
    flushAndSubmitCurrentModuleWithRetry,
  });

  useEffect(() => {
    if (effectivePhase !== 'exam') {
      return;
    }

    // Cleanup previously used to clear scheduled refresh timeouts; keep the
    // registry so the effect teardown never references an undefined identifier.
    const scheduledRefreshTimers = new Set<number>();

    const root = document.documentElement;
    const body = document.body;
    const tabletViewportSessionLocked = viewportLockForExamSessionRef.current === true;
    let stableViewportHeight =
      tabletViewportSessionLocked && lockedViewportHeightRef.current !== null
        ? lockedViewportHeightRef.current
        : Math.round(window.visualViewport?.height ?? window.innerHeight);
    const applyViewportHeight = (height: number) => {
      root.style.setProperty('--student-viewport-height', `${Math.max(0, Math.round(height))}px`);
    };

    const updateViewportHeight = () => {
      const visualViewport = window.visualViewport;
      const nextViewportHeight = Math.round(visualViewport?.height ?? window.innerHeight);
      if (!tabletViewportSessionLocked) {
        applyViewportHeight(nextViewportHeight);
        return;
      }

      if (lockedViewportHeightRef.current === null) {
        lockedViewportHeightRef.current = stableViewportHeight;
      } else {
        stableViewportHeight = lockedViewportHeightRef.current;
      }

      applyViewportHeight(stableViewportHeight);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (!tabletViewportSessionLocked) {
        return;
      }

      if (event.touches.length >= 2) {
        updateViewportHeight();
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!tabletViewportSessionLocked) {
        return;
      }

      if (event.touches.length >= 2) {
        updateViewportHeight();
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!tabletViewportSessionLocked) {
        return;
      }

      if (event.touches.length >= 2) {
        updateViewportHeight();
        return;
      }
      updateViewportHeight();
    };

    const handleWindowResize = () => {
      updateViewportHeight();
    };

    updateViewportHeight();
    root.classList.add('student-exam-active');
    body.classList.add('student-exam-active');
    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('orientationchange', handleWindowResize);
    window.visualViewport?.addEventListener('resize', updateViewportHeight);
    window.visualViewport?.addEventListener('scroll', updateViewportHeight);
    document.addEventListener('touchstart', handleTouchStart, true);
    document.addEventListener('touchmove', handleTouchMove, true);
    document.addEventListener('touchend', handleTouchEnd, true);
    document.addEventListener('touchcancel', handleTouchEnd, true);

    return () => {
      for (const timer of scheduledRefreshTimers) {
        window.clearTimeout(timer);
      }
      root.classList.remove('student-exam-active');
      body.classList.remove('student-exam-active');
      root.style.removeProperty('--student-viewport-height');
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('orientationchange', handleWindowResize);
      window.visualViewport?.removeEventListener('resize', updateViewportHeight);
      window.visualViewport?.removeEventListener('scroll', updateViewportHeight);
      document.removeEventListener('touchstart', handleTouchStart, true);
      document.removeEventListener('touchmove', handleTouchMove, true);
      document.removeEventListener('touchend', handleTouchEnd, true);
      document.removeEventListener('touchcancel', handleTouchEnd, true);
    };
  }, [effectivePhase, tabletMode]);

  const requestFullscreenFromOverlay = useMemo(() => {
    return {
      label: 'Return to Fullscreen',
      onClick: () => {
        void requestStudentFullscreen().catch(() => {
          // Best-effort only.
        });
      },
    };
  }, []);

  const shouldShowTimeExtension = shouldOfferTimeExtension({
    config: examState.config,
    phase: effectivePhase,
    runtimeBacked: runtimeState.runtimeBacked,
    displayTimeRemaining: runtimeState.displayTimeRemaining,
  });

  useEffect(() => {
    if (shouldShowTimeExtension) {
      setShowTimeExtensionRequest(true);
    }
  }, [shouldShowTimeExtension, setShowTimeExtensionRequest]);

  const handleTimeExtensionRequest = () => {
    if (timeExtensionReason.trim()) {
      uiActions.grantTimeExtension(5);
      runtimeActions.setTimeRemaining(runtimeState.timeRemaining + 300);
    }
  };

  const answeredCount = countAnsweredQuestions(runtimeState.allQuestions, attemptAnswers);
  const totalQuestions = countQuestionSlots(runtimeState.allQuestions);
  const unansweredSubmissionPolicy = examState.config.progression.unansweredSubmissionPolicy ?? 'confirm';
  const submitRequiresConfirmation =
    effectivePhase === 'exam' &&
    (runtimeState.currentModule === 'reading' || runtimeState.currentModule === 'listening') &&
    totalQuestions > 0 &&
    answeredCount < totalQuestions &&
    unansweredSubmissionPolicy !== 'allow';

  const performModuleSubmit = async () => {
    if (runtimeState.runtimeBacked) {
      const fingerprint = `manual:${runtimeState.currentModule}`;
      await flushAndSubmitCurrentModuleWithRetry(fingerprint);
      return;
    }

    flushDomAnswerControlsNow();
    reconcileLiveAnswerCacheNow();
    writingDraftCommitRef.current?.();
    runtimeActions.submitModule();
  };

  const handleModuleSubmit = async () => {
    if (submitRequiresConfirmation) {
      uiActions.setShowSubmitConfirm(true);
      return;
    }

    await performModuleSubmit();
  };

  const confirmModuleSubmit = async () => {
    uiActions.setShowSubmitConfirm(false);
    await performModuleSubmit();
  };

  const handleAnswerChange = (
    questionId: string,
    answer: StudentAnswerValue,
    meta?: StudentAnswerMutationMeta,
  ) => {
    if (runtimeState.blocking.reason === 'storage_unavailable') {
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
    attemptActions.persistAnswer(questionId, resolvedAnswer, meta);
  };

  const handleFlagToggle = (questionId: string) => {
    if (runtimeState.blocking.reason === 'storage_unavailable') {
      return;
    }
    const nextFlagged = !attemptFlags[questionId];
    attemptActions.persistFlag(questionId, nextFlagged);
  };

  const registerLiveObjectiveAnswer = useCallback(
    (questionId: string, value: StudentAnswerValue) => {
      liveObjectiveAnswersRef.current = {
        ...liveObjectiveAnswersRef.current,
        [questionId]: value,
      };
    },
    [],
  );

  const registerLiveWritingAnswer = useCallback((taskId: string, text: string) => {
    liveWritingAnswersRef.current = {
      ...liveWritingAnswersRef.current,
      [taskId]: text,
    };
  }, []);

  const handleWritingChange = (taskId: string, text: string) => {
    if (runtimeState.blocking.reason === 'storage_unavailable') {
      return;
    }
    liveWritingAnswersRef.current = {
      ...liveWritingAnswersRef.current,
      [taskId]: text,
    };
    attemptActions.persistWritingAnswer(taskId, text);
  };

  const registerWritingDraftCommit = useCallback((commitDraft: (() => void) | null) => {
    writingDraftCommitRef.current = commitDraft;
  }, []);

  const blockingOverlay =
    runtimeState.blocking.active && blockingCopy ? (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm p-4">
        <div className="max-w-md w-full bg-white rounded-sm border border-gray-100 shadow-2xl p-6 md:p-8 text-center">
          <p className="text-[length:var(--student-meta-font-size)] font-bold uppercase tracking-[0.3em] text-gray-500 mb-3">
            {blockingCopy.contextLabel}
          </p>
          <h2 className="text-2xl font-black text-gray-900 mb-3">{blockingCopy.title}</h2>
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
    !shouldRenderPostExam &&
    finalSubmitStatus !== 'idle' ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm p-4">
        <div className="max-w-md w-full bg-white rounded-sm border border-gray-100 shadow-2xl p-6 md:p-8 text-center">
          <p className="text-[length:var(--student-meta-font-size)] font-bold uppercase tracking-[0.3em] text-gray-500 mb-3">
            Submission
          </p>
          <h2 className="text-2xl font-black text-gray-900 mb-3">Submitting your exam</h2>
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
        </div>
      </div>
    ) : null;

  if (!shouldRenderPostExam && effectivePhase === 'pre-check') {
    return (
      <div className="flex flex-col h-screen w-full bg-gray-50 font-sans text-gray-900" style={studentShellStyle}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <main id="main-content" role="main">
          <PreCheck
            config={examState.config}
            onComplete={async (result) => {
              await attemptActions.recordPreCheckResult(result);
              runtimeActions.setPhase(runtimeState.runtimeBacked ? 'exam' : 'lobby');
            }}
            onExit={onExit}
          />
        </main>
        {finalSubmitOverlay}
      </div>
    );
  }

  if (!shouldRenderPostExam && !runtimeState.runtimeBacked && effectivePhase === 'lobby') {
    return (
      <div className="flex flex-col h-screen w-full bg-gray-50 font-sans text-gray-900" style={studentShellStyle}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <main id="main-content" role="main">
          <Lobby state={examState} onStart={runtimeActions.startExam} onExit={onExit} />
        </main>
        {finalSubmitOverlay}
      </div>
    );
  }

  if (shouldRenderPostExam) {
    const isProctorTerminated = verifiedTerminalState === 'terminated';
    const studentInfo = [
      { label: 'Student Name', value: attemptState.attempt?.candidateName },
      { label: 'Student ID', value: attemptState.attempt?.candidateId },
      { label: 'Email', value: attemptState.attempt?.candidateEmail },
      { label: 'Exam', value: attemptState.attempt?.examTitle ?? examState.title },
    ].filter((item): item is { label: string; value: string } => Boolean(item.value));

    return (
      <StudentPostExamView
        isProctorTerminated={isProctorTerminated}
        proctorNote={runtimeState.proctorNote}
        studentInfo={studentInfo}
        onExit={onExit}
        finalSubmitOverlay={finalSubmitOverlay}
      />
    );
  }

  return (
    <StudentHighlightPersistenceProvider namespace={highlightNamespace}>
      <div
      className={`student-exam-shell flex flex-col h-screen w-full bg-gray-50 font-sans text-gray-900 transition-all ${
        uiState.accessibilitySettings.highContrast ? 'high-contrast' : ''
      }`}
      style={studentShellStyle}
    >
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
      <StudentHeader
        onExit={onExit}
        testTakerId={attemptState.attempt?.candidateId ?? undefined}
        timeRemaining={runtimeState.displayTimeRemaining}
        tabletMode={tabletMode}
        onClearHighlights={clearHighlights}
        highlightEnabled={uiState.accessibilitySettings.highlightMode}
        highlightColor={highlightColor}
        onHighlightModeToggle={
          runtimeState.currentModule === 'reading' ||
          runtimeState.currentModule === 'listening'
            ? uiActions.toggleHighlightMode
            : undefined
        }
        onHighlightColorChange={uiActions.setHighlightColor}
        onOpenAccessibility={() => uiActions.setShowAccessibility(true)}
        onOpenNavigator={
          runtimeState.currentModule === 'reading' || runtimeState.currentModule === 'listening'
            ? () => uiActions.setShowNavigator(true)
            : undefined
        }
        isExamActive={effectivePhase === 'exam'}
        showExitButton={allowExitDuringExam || effectivePhase !== 'exam'}
        confirmExitWhenExamActive={!allowExitDuringExam}
      />

      <StudentExamWorkspace
        currentModule={runtimeState.currentModule}
        examState={examState}
        currentQuestionId={runtimeState.currentQuestionId}
        allQuestions={runtimeState.allQuestions}
        answers={attemptAnswers}
        writingAnswers={attemptWritingAnswers}
        flags={attemptFlags}
        tabletMode={tabletMode}
        showSubmitControls={showSubmitControls}
        contentZoom={uiState.accessibilitySettings.zoom}
        displayTimeRemaining={runtimeState.displayTimeRemaining}
        highlightEnabled={uiState.accessibilitySettings.highlightMode}
        highlightColor={highlightColor}
        highlightClassName={highlightClassName}
        passageReadabilityLabel={getStudentPassageReadabilityLabel(
          uiState.accessibilitySettings.passageReadabilityLevel,
        )}
        canIncreasePassageReadability={canIncreasePassageReadability}
        canDecreasePassageReadability={canDecreasePassageReadability}
        showNavigator={uiState.showNavigator}
        security={examState.config.security}
        onNavigate={runtimeActions.setCurrentQuestionId}
        onObjectiveAnswerChange={handleAnswerChange}
        onFlagToggle={handleFlagToggle}
        onWritingChange={handleWritingChange}
        onModuleSubmit={handleModuleSubmit}
        onRegisterWritingDraftCommit={registerWritingDraftCommit}
        onRegisterLiveObjectiveAnswer={registerLiveObjectiveAnswer}
        onRegisterLiveWritingAnswer={registerLiveWritingAnswer}
        onIncreasePassageReadability={uiActions.increasePassageReadability}
        onDecreasePassageReadability={uiActions.decreasePassageReadability}
        onResetPassageReadability={uiActions.resetPassageReadability}
        onCloseNavigator={() => uiActions.setShowNavigator(false)}
      />

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

      {examState.config.progression.showWarnings ? (
        <WarningOverlay
          isOpen={fullscreenWarningOpen}
          severity={fullscreenWarningSeverity}
          message={fullscreenWarningMessage}
          showCountdown={false}
          actionButton={requestFullscreenFromOverlay}
          onAcknowledge={() => {
            requestFullscreenFromOverlay.onClick();
          }}
        />
      ) : null}

      <HelpModal isOpen={uiState.showHelp} onClose={() => uiActions.setShowHelp(false)} />

      <SubmitConfirmation
        isOpen={uiState.showSubmitConfirm}
        onClose={() => uiActions.setShowSubmitConfirm(false)}
        onConfirm={confirmModuleSubmit}
        answeredCount={answeredCount}
        totalQuestions={totalQuestions}
        flaggedCount={Object.values(attemptFlags).filter(Boolean).length}
        timeRemaining={runtimeState.displayTimeRemaining}
        unansweredSubmissionPolicy={unansweredSubmissionPolicy}
      />

      {uiState.showTimeExtensionRequest && !uiState.timeExtensionGranted ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="time-extension-title"
        >
          <div className="max-w-md w-full bg-white rounded-sm border border-gray-100 shadow-2xl p-6 md:p-8">
            <h2 id="time-extension-title" className="text-xl font-black text-gray-900 mb-3">
              Request Time Extension
            </h2>
            <p className="text-sm text-gray-700 leading-6 mb-4">
              You have 5 minutes remaining. If you need additional time due to accessibility
              needs, you may request an extension.
            </p>
            <div className="mb-4">
              <label
                htmlFor="extension-reason"
                className="block text-sm font-semibold text-gray-900 mb-2"
              >
                Please explain why you need an extension:
              </label>
              <textarea
                id="extension-reason"
                value={timeExtensionReason}
                onChange={(event) => uiActions.setTimeExtensionReason(event.target.value)}
                className="w-full border border-gray-300 rounded-sm px-3 py-2 min-h-[120px]"
                aria-label="Extension reason"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => uiActions.setShowTimeExtensionRequest(false)}>
                Cancel
              </Button>
              <Button onClick={handleTimeExtensionRequest}>Request +5 Minutes</Button>
            </div>
          </div>
        </div>
      ) : null}

      <AccessibilitySettings
        isOpen={uiState.showAccessibility}
        onClose={() => uiActions.setShowAccessibility(false)}
        fontSize={uiState.accessibilitySettings.fontSize}
        highContrast={uiState.accessibilitySettings.highContrast}
        onFontSizeChange={uiActions.setFontSize}
        onHighContrastToggle={uiActions.toggleHighContrast}
      />
      </div>
    </StudentHighlightPersistenceProvider>
  );
}
