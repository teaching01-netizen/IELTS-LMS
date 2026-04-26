import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countAnsweredQuestions, countQuestionSlots } from '@services/examAdapterService';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { AccessibilitySettings } from './AccessibilitySettings';
import { HelpModal } from './HelpModal';
import { Lobby } from './Lobby';
import { PreCheck } from './PreCheck';
import { QuestionNavigator } from './QuestionNavigator';
import { StudentFooter } from './StudentFooter';
import { StudentHeader } from './StudentHeader';
import { StudentListening } from './StudentListening';
import { StudentReading } from './StudentReading';
import { StudentSpeaking } from './StudentSpeaking';
import { StudentWriting } from './StudentWriting';
import { SubmitConfirmation } from './SubmitConfirmation';
import { WarningOverlay } from './WarningOverlay';
import { getFullscreenElement, requestStudentFullscreen } from './fullscreen';
import { getStudentTypographyScale } from './accessibilityScale';
import { getStudentHighlightClassName } from './highlightPalette';
import { StudentHighlightPersistenceProvider, clearStudentHighlights } from './highlightPersistence';
import { useStudentTabletMode } from './tabletMode';
import { shouldOfferTimeExtension } from './timeExtensionPolicy';
import { useStudentAttempt } from './providers/StudentAttemptProvider';
import { useStudentRuntime } from './providers/StudentRuntimeProvider';
import { useStudentUI } from './providers/StudentUIProvider';
import { isRuntimeStructurallyCompleted, isVerifiedTerminalStudentState } from './providers/verifiedTerminalState';
import { useZoomScrollAnchoring } from './useZoomScrollAnchoring';

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
    case 'syncing_reconnect':
      return {
        title: 'Reconnecting session',
        message:
          'Attempt data is being reconciled before the exam can continue.',
        badge: 'Syncing',
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
}

export function StudentApp({ showSubmitControls = true }: StudentAppProps) {
  const { state: runtimeState, actions: runtimeActions, examState, onExit } = useStudentRuntime();
  const { actions: attemptActions, state: attemptState } = useStudentAttempt();
  const { state: uiState, actions: uiActions } = useStudentUI();
  const tabletMode = useStudentTabletMode();
  const studentTypography = getStudentTypographyScale(uiState.accessibilitySettings.fontSize);
  useZoomScrollAnchoring(uiState.accessibilitySettings.zoom * studentTypography.fontScale);
  const [finalSubmitStatus, setFinalSubmitStatus] = useState<'idle' | 'submitting' | 'retrying' | 'failed'>('idle');
  const blockingCopy = getBlockingCopy(runtimeState.blocking.reason);
  const { setShowTimeExtensionRequest } = uiActions;
  const highlightColor = uiState.accessibilitySettings.highlightColor;
  const highlightClassName = getStudentHighlightClassName(highlightColor);
  const highlightNamespace = useMemo(
    () => `attempt:${attemptState.attempt?.id ?? 'unknown'}`,
    [attemptState.attempt?.id],
  );
  const clearHighlights = useCallback(() => {
    clearStudentHighlights(highlightNamespace);
  }, [highlightNamespace]);
  const studentShellStyle = {
    height: 'var(--student-viewport-height, 100dvh)',
    zoom: uiState.accessibilitySettings.zoom,
    fontSize: studentTypography.rootFontSize,
    lineHeight: studentTypography.lineHeight,
    ['--student-meta-font-size' as string]: studentTypography.metaFontSize,
    ['--student-chip-font-size' as string]: studentTypography.chipFontSize,
    ['--student-control-font-size' as string]: studentTypography.controlFontSize,
    ['--student-preview-font-size' as string]: studentTypography.previewFontSize,
  } as React.CSSProperties;
  const autoSubmitFingerprintRef = useRef<string | null>(null);
  const runtimeStateRef = useRef(runtimeState);
  const moduleSubmitInFlightRef = useRef<Promise<void> | null>(null);
  const moduleSubmitFingerprintRef = useRef<string | null>(null);
  const priorTimeRemainingRef = useRef<number | null>(null);
  const runtimeFinalSubmitRef = useRef<string | null>(null);
  const finalSubmitInFlightRef = useRef<Promise<void> | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [warningSeverity, setWarningSeverity] = useState<'medium' | 'high' | 'critical'>(
    'medium',
  );
  const [lastAcknowledgedSecurityViolationId, setLastAcknowledgedSecurityViolationId] =
    useState<string | null>(null);
  const [lastAcknowledgedSecondaryScreenViolationId, setLastAcknowledgedSecondaryScreenViolationId] =
    useState<string | null>(null);
  const [lastAcknowledgedTranslationViolationId, setLastAcknowledgedTranslationViolationId] =
    useState<string | null>(null);
  const [fullscreenWarningOpen, setFullscreenWarningOpen] = useState(false);
  const [fullscreenWarningMessage, setFullscreenWarningMessage] = useState(
    'Fullscreen mode is required. Please return to fullscreen to continue.',
  );
  const [fullscreenWarningSeverity, setFullscreenWarningSeverity] = useState<
    'medium' | 'high' | 'critical'
  >('high');
  const fullscreenGraceTimerRef = useRef<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(getFullscreenElement()));
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

  const droppedMutations = attemptState.attempt?.recovery.lastDroppedMutations ?? null;
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
  }, [runtimeState]);

  const flushAndSubmitCurrentModuleWithRetry = useMemo(() => {
    return async (fingerprint: string) => {
      if (
        moduleSubmitInFlightRef.current &&
        moduleSubmitFingerprintRef.current === fingerprint
      ) {
        await moduleSubmitInFlightRef.current;
        return;
      }

      const moduleKey = runtimeStateRef.current.currentModule;
      moduleSubmitFingerprintRef.current = fingerprint;

      const promise = (async () => {
        let attemptIndex = 0;

        while (true) {
          const latestState = runtimeStateRef.current;
          if (latestState.phase !== 'exam') {
            return;
          }

          if (latestState.currentModule !== moduleKey) {
            return;
          }

          const flushed = await attemptActions.flushPending();
          if (flushed) {
            runtimeActions.setBlockingReason(null);
            runtimeActions.submitModule();
            return;
          }

          runtimeActions.setBlockingReason(navigator.onLine ? 'syncing_reconnect' : 'offline');

          const backoffMs = Math.min(30_000, 1_000 * 2 ** attemptIndex);
          attemptIndex += 1;

          await new Promise<void>((resolve) => {
            window.setTimeout(() => resolve(), backoffMs);
          });
        }
      })();

      moduleSubmitInFlightRef.current = promise;
      try {
        await promise;
      } finally {
        if (moduleSubmitInFlightRef.current === promise) {
          moduleSubmitInFlightRef.current = null;
        }
      }
    };
  }, [attemptActions, runtimeActions]);

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

  useEffect(() => {
    const handleFullscreenUpdate = () => {
      setIsFullscreen(Boolean(getFullscreenElement()));
    };

    handleFullscreenUpdate();
    document.addEventListener('fullscreenchange', handleFullscreenUpdate);
    document.addEventListener('webkitfullscreenchange' as unknown as 'fullscreenchange', handleFullscreenUpdate);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenUpdate);
      document.removeEventListener(
        'webkitfullscreenchange' as unknown as 'fullscreenchange',
        handleFullscreenUpdate,
      );
    };
  }, []);

  const latestTabSwitchViolation = useMemo(() => {
    if (effectivePhase !== 'exam') {
      return null;
    }

    if (examState.config.security.tabSwitchRule !== 'warn') {
      return null;
    }

    const tabSwitchViolations = runtimeState.violations.filter(
      (violation) => violation.type === 'TAB_SWITCH',
    );
    return tabSwitchViolations[tabSwitchViolations.length - 1] ?? null;
  }, [effectivePhase, examState.config.security.tabSwitchRule, runtimeState.violations]);

  const shouldShowTabSwitchWarning =
    Boolean(latestTabSwitchViolation) &&
    latestTabSwitchViolation?.id !== lastAcknowledgedSecurityViolationId &&
    !fullscreenWarningOpen;

  const tabSwitchSeverity =
    latestTabSwitchViolation?.severity === 'high' || latestTabSwitchViolation?.severity === 'critical'
      ? latestTabSwitchViolation.severity
      : 'medium';

  const latestSecondaryScreenViolation = useMemo(() => {
    if (effectivePhase !== 'exam') {
      return null;
    }

    if (!examState.config.security.detectSecondaryScreen) {
      return null;
    }

    const violations = runtimeState.violations.filter(
      (violation) => violation.type === 'SECONDARY_SCREEN',
    );
    return violations[violations.length - 1] ?? null;
  }, [effectivePhase, examState.config.security.detectSecondaryScreen, runtimeState.violations]);

  const shouldShowSecondaryScreenWarning =
    Boolean(latestSecondaryScreenViolation) &&
    latestSecondaryScreenViolation?.id !== lastAcknowledgedSecondaryScreenViolationId &&
    !fullscreenWarningOpen;

  const latestTranslationViolation = useMemo(() => {
    if (effectivePhase !== 'exam') {
      return null;
    }

    if (examState.config.security.preventTranslation === false) {
      return null;
    }

    const violations = runtimeState.violations.filter(
      (violation) => violation.type === 'TRANSLATION_DETECTED',
    );
    return violations[violations.length - 1] ?? null;
  }, [effectivePhase, examState.config.security.preventTranslation, runtimeState.violations]);

  const shouldShowTranslationWarning =
    Boolean(latestTranslationViolation) &&
    latestTranslationViolation?.id !== lastAcknowledgedTranslationViolationId &&
    !fullscreenWarningOpen;

  const latestFullscreenExitViolation = useMemo(() => {
    if (effectivePhase !== 'exam') {
      return null;
    }

    if (!examState.config.security.requireFullscreen) {
      return null;
    }

    const violations = runtimeState.violations.filter(
      (violation) => violation.type === 'FULLSCREEN_EXIT',
    );
    return violations[violations.length - 1] ?? null;
  }, [effectivePhase, examState.config.security.requireFullscreen, runtimeState.violations]);

  useEffect(() => {
    if (fullscreenGraceTimerRef.current) {
      window.clearTimeout(fullscreenGraceTimerRef.current);
      fullscreenGraceTimerRef.current = null;
    }

    if (
      effectivePhase !== 'exam' ||
      !examState.config.progression.showWarnings ||
      !examState.config.security.requireFullscreen
    ) {
      setFullscreenWarningOpen(false);
      return;
    }

    if (!latestFullscreenExitViolation) {
      setFullscreenWarningOpen(false);
      return;
    }

    if (isFullscreen) {
      setFullscreenWarningOpen(false);
      return;
    }

    fullscreenGraceTimerRef.current = window.setTimeout(() => {
      if (getFullscreenElement()) {
        setFullscreenWarningOpen(false);
        return;
      }

      setFullscreenWarningMessage(
        latestFullscreenExitViolation.description ??
          'Fullscreen mode is required. Please return to fullscreen to continue.',
      );
      setFullscreenWarningSeverity(
        latestFullscreenExitViolation.severity === 'critical'
          ? 'critical'
          : latestFullscreenExitViolation.severity === 'high'
            ? 'high'
            : 'medium',
      );
      setFullscreenWarningOpen(true);
    }, 200);
  }, [
    effectivePhase,
    examState.config.progression.showWarnings,
    examState.config.security.requireFullscreen,
    isFullscreen,
    latestFullscreenExitViolation?.id,
  ]);

  useEffect(() => {
    if (isFullscreen) {
      setFullscreenWarningOpen(false);
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (effectivePhase !== 'exam') {
      return;
    }

    const root = document.documentElement;
    const body = document.body;

    const updateViewportHeight = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      root.style.setProperty('--student-viewport-height', `${Math.round(viewportHeight)}px`);
    };

    updateViewportHeight();
    root.classList.add('student-exam-active');
    body.classList.add('student-exam-active');
    window.addEventListener('resize', updateViewportHeight);
    window.addEventListener('orientationchange', updateViewportHeight);
    window.visualViewport?.addEventListener('resize', updateViewportHeight);
    window.visualViewport?.addEventListener('scroll', updateViewportHeight);

    return () => {
      root.classList.remove('student-exam-active');
      body.classList.remove('student-exam-active');
      root.style.removeProperty('--student-viewport-height');
      window.removeEventListener('resize', updateViewportHeight);
      window.removeEventListener('orientationchange', updateViewportHeight);
      window.visualViewport?.removeEventListener('resize', updateViewportHeight);
      window.visualViewport?.removeEventListener('scroll', updateViewportHeight);
    };
  }, [effectivePhase]);

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

  useEffect(() => {
    const priorTimeRemaining = priorTimeRemainingRef.current;
    priorTimeRemainingRef.current =
      typeof runtimeState.displayTimeRemaining === 'number'
        ? runtimeState.displayTimeRemaining
        : null;

    if (!examState.config.progression.autoSubmit) {
      autoSubmitFingerprintRef.current = null;
      return;
    }

    if (effectivePhase !== 'exam') {
      autoSubmitFingerprintRef.current = null;
      return;
    }

    if (runtimeState.blocking.active) {
      return;
    }

    if (typeof runtimeState.displayTimeRemaining !== 'number') {
      return;
    }

    if (runtimeState.runtimeBacked) {
      if (runtimeState.runtimeStatus !== 'live') {
        return;
      }

      const reachedZero = runtimeState.displayTimeRemaining === 0;
      const transitionedToZero =
        reachedZero && typeof priorTimeRemaining === 'number' && priorTimeRemaining > 0;
      const loadedAtZero = reachedZero && priorTimeRemaining === null;
      if (!transitionedToZero && !loadedAtZero) {
        return;
      }
    } else if (runtimeState.displayTimeRemaining !== 0) {
      return;
    }

    const fingerprint = `${runtimeState.runtimeBacked ? 'runtime' : 'self'}:${runtimeState.currentModule}`;
    if (autoSubmitFingerprintRef.current === fingerprint) {
      return;
    }

    autoSubmitFingerprintRef.current = fingerprint;
    void flushAndSubmitCurrentModuleWithRetry(fingerprint);
  }, [
    attemptActions,
    effectivePhase,
    examState.config.progression.autoSubmit,
    flushAndSubmitCurrentModuleWithRetry,
    runtimeActions,
    runtimeState.blocking.active,
    runtimeState.currentModule,
    runtimeState.displayTimeRemaining,
    runtimeState.runtimeBacked,
    runtimeState.runtimeStatus,
  ]);
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
    if (uiState.timeExtensionReason.trim()) {
      uiActions.grantTimeExtension(5);
      runtimeActions.setTimeRemaining(runtimeState.timeRemaining + 300);
    }
  };

  const performModuleSubmit = async () => {
    if (runtimeState.runtimeBacked) {
      const fingerprint = `manual:${runtimeState.currentModule}`;
      await flushAndSubmitCurrentModuleWithRetry(fingerprint);
      return;
    }

    runtimeActions.submitModule();
  };

  const handleModuleSubmit = async () => {
    if (runtimeState.submitRequiresConfirmation) {
      uiActions.setShowSubmitConfirm(true);
      return;
    }

    await performModuleSubmit();
  };

  const confirmModuleSubmit = async () => {
    uiActions.setShowSubmitConfirm(false);
    await performModuleSubmit();
  };

  useEffect(() => {
    if (!runtimeState.runtimeBacked) {
      runtimeFinalSubmitRef.current = null;
      finalSubmitInFlightRef.current = null;
      setFinalSubmitStatus('idle');
      return;
    }

    if (runtimeState.runtimeStatus !== 'completed' || !runtimeCompletionVerified) {
      runtimeFinalSubmitRef.current = null;
      finalSubmitInFlightRef.current = null;
      setFinalSubmitStatus('idle');
      return;
    }

    if (shouldRenderPostExam) {
      return;
    }

    const attemptId = attemptState.attemptId;
    if (!attemptId) {
      return;
    }

    if (runtimeFinalSubmitRef.current === attemptId) {
      return;
    }

    if (finalSubmitInFlightRef.current) {
      return;
    }

    finalSubmitInFlightRef.current = (async () => {
      const maxAttempts = 6;
      for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
        setFinalSubmitStatus(attemptIndex === 0 ? 'submitting' : 'retrying');

        try {
          const submitted = await attemptActions.submitAttempt();
          if (submitted) {
            runtimeFinalSubmitRef.current = attemptId;
            setFinalSubmitStatus('idle');
            return;
          }
        } catch {
          // ignore and retry
        }

        const backoffMs = Math.min(30_000, 1_000 * 2 ** attemptIndex);
        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), backoffMs);
        });
      }

      setFinalSubmitStatus('failed');
    })();

    void finalSubmitInFlightRef.current.finally(() => {
      finalSubmitInFlightRef.current = null;
    });
  }, [
    attemptActions,
    attemptState.attemptId,
    runtimeState.runtimeBacked,
    runtimeState.runtimeStatus,
    runtimeCompletionVerified,
    shouldRenderPostExam,
  ]);

  const handleAnswerChange = (questionId: string, answer: Parameters<typeof runtimeActions.setAnswer>[1]) => {
    runtimeActions.setAnswer(questionId, answer);
    attemptActions.persistAnswer(questionId, answer);
  };

  const handleFlagToggle = (questionId: string) => {
    const nextFlagged = !runtimeState.flags[questionId];
    runtimeActions.toggleFlag(questionId);
    attemptActions.persistFlag(questionId, nextFlagged);
  };

  const handleWritingChange = (taskId: string, text: string) => {
    runtimeActions.setWritingAnswer(taskId, text);
    attemptActions.persistWritingAnswer(taskId, text);
  };

  const answeredCount = countAnsweredQuestions(runtimeState.allQuestions, runtimeState.answers);
  const totalQuestions = countQuestionSlots(runtimeState.allQuestions);
  const unansweredSubmissionPolicy = examState.config.progression.unansweredSubmissionPolicy ?? 'confirm';

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
      <div className="flex flex-col items-center justify-center h-full w-full bg-gray-50 p-4 font-sans text-gray-900">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <main id="main-content" role="main" className="flex flex-col items-center justify-center">
          <div className="bg-white p-6 md:p-8 rounded-lg shadow-md max-w-2xl w-full text-center">
            <h1 className="text-3xl font-bold mb-4">
              {isProctorTerminated ? 'Session terminated' : 'IELTS Examination Complete!'}
            </h1>
            {isProctorTerminated ? (
              <div className="text-gray-600 mb-8 space-y-3">
                <p>Your session was terminated by the proctor.</p>
                {runtimeState.proctorNote ? (
                  <p className="text-gray-700">{runtimeState.proctorNote}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-gray-600 mb-8">
                Congratulations! You have completed all modules of the IELTS examination.
              </p>
            )}

            {studentInfo.length > 0 ? (
              <div className="mb-8 rounded-sm border border-gray-200 bg-gray-50 p-4 text-left">
                <div className="grid gap-3 sm:grid-cols-2">
                  {studentInfo.map((item) => (
                    <div key={item.label}>
                      <p className="text-[length:var(--student-meta-font-size)] font-bold uppercase tracking-[0.2em] text-gray-500">
                        {item.label}
                      </p>
                      <p className="mt-1 break-words text-sm font-semibold text-gray-900">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <Button onClick={onExit}>Exit Exam Platform</Button>
          </div>
        </main>
        {finalSubmitOverlay}
      </div>
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
        zoom={uiState.accessibilitySettings.zoom}
        onZoomIn={uiActions.zoomIn}
        onZoomOut={uiActions.zoomOut}
        onZoomReset={uiActions.resetZoom}
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
        showExitButton={effectivePhase !== 'exam'}
      />

      {droppedMutations ? (
        <div
          className="mx-3 md:mx-4 lg:mx-6 mt-3 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-3"
          role="status"
          aria-live="polite"
        >
          <AlertTriangle size={18} className="text-amber-700 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">
              {droppedMutations.count} unsent response{droppedMutations.count === 1 ? '' : 's'} discarded
            </div>
            <div className="text-amber-800">
              {droppedMutations.fromModule && droppedMutations.toModule ? (
                <>
                  The exam advanced from {droppedMutations.fromModule} to {droppedMutations.toModule} while you
                  were offline.
                </>
              ) : (
                <>The exam section changed while you were offline.</>
              )}
            </div>
          </div>
          <button
            type="button"
            className="p-1 rounded-sm hover:bg-amber-100 text-amber-800"
            aria-label="Dismiss notification"
            onClick={() => {
              void attemptActions.dismissDroppedMutationsBanner();
            }}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      <main id="main-content" className="flex-1 overflow-hidden relative flex flex-col" role="main">
        {runtimeState.currentModule === 'reading' ? (
          <StudentReading
            state={examState}
            answers={runtimeState.answers}
            onAnswerChange={handleAnswerChange}
            currentQuestionId={runtimeState.currentQuestionId}
            onNavigate={runtimeActions.setCurrentQuestionId}
            flags={runtimeState.flags}
            onToggleFlag={handleFlagToggle}
            tabletMode={tabletMode}
            highlightEnabled={uiState.accessibilitySettings.highlightMode}
            highlightColor={highlightColor}
            highlightClassName={highlightClassName}
          />
        ) : null}
        {runtimeState.currentModule === 'listening' ? (
          <StudentListening
            state={examState}
            answers={runtimeState.answers}
            onAnswerChange={handleAnswerChange}
            currentQuestionId={runtimeState.currentQuestionId}
            onNavigate={runtimeActions.setCurrentQuestionId}
            flags={runtimeState.flags}
            onToggleFlag={handleFlagToggle}
            tabletMode={tabletMode}
            highlightEnabled={uiState.accessibilitySettings.highlightMode}
            highlightColor={highlightColor}
            highlightClassName={highlightClassName}
          />
        ) : null}
        {runtimeState.currentModule === 'writing' ? (
          <StudentWriting
            state={examState}
            writingAnswers={runtimeState.writingAnswers}
            onWritingChange={handleWritingChange}
            onSubmit={handleModuleSubmit}
            currentQuestionId={runtimeState.currentQuestionId}
            onNavigate={runtimeActions.setCurrentQuestionId}
            timeRemaining={runtimeState.displayTimeRemaining}
            security={examState.config.security}
            showSubmitButton={showSubmitControls}
          />
        ) : null}
        {runtimeState.currentModule === 'speaking' ? (
          <StudentSpeaking
            state={examState}
            onSubmit={handleModuleSubmit}
            currentQuestionId={runtimeState.currentQuestionId}
            onNavigate={runtimeActions.setCurrentQuestionId}
          />
        ) : null}
      </main>

      {blockingOverlay}
      {finalSubmitOverlay}

      {(runtimeState.currentModule === 'reading' ||
        runtimeState.currentModule === 'listening') ? (
        <StudentFooter
          questions={runtimeState.allQuestions}
          currentQuestionId={runtimeState.currentQuestionId}
          onNavigate={runtimeActions.setCurrentQuestionId}
          answers={runtimeState.answers}
          flags={runtimeState.flags}
          onToggleFlag={handleFlagToggle}
          onSubmit={handleModuleSubmit}
          showSubmitButton={showSubmitControls}
          tabletMode={tabletMode}
        />
      ) : null}

      {uiState.showNavigator ? (
        <QuestionNavigator
          questions={runtimeState.allQuestions}
          answers={runtimeState.answers}
          flags={runtimeState.flags}
          currentQuestionId={runtimeState.currentQuestionId}
          onNavigate={(id) => {
            runtimeActions.setCurrentQuestionId(id);
            uiActions.setShowNavigator(false);
          }}
          onClose={() => uiActions.setShowNavigator(false)}
        />
      ) : null}

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
            if (latestTabSwitchViolation) {
              setLastAcknowledgedSecurityViolationId(latestTabSwitchViolation.id);
            }
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
            if (latestTranslationViolation) {
              setLastAcknowledgedTranslationViolationId(latestTranslationViolation.id);
            }
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
            if (latestSecondaryScreenViolation) {
              setLastAcknowledgedSecondaryScreenViolationId(latestSecondaryScreenViolation.id);
            }
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
        flaggedCount={Object.values(runtimeState.flags).filter(Boolean).length}
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
                value={uiState.timeExtensionReason}
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
