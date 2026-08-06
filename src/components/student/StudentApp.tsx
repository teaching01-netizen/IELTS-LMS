import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countAnsweredQuestions, countQuestionSlots } from '@services/examAdapterService';
import { Button } from '../ui/Button';
import { AccessibilitySettings } from './AccessibilitySettings';
import { Lobby } from './Lobby';
import { PreCheck } from './PreCheck';
import { StudentExamWorkspace } from './StudentExamWorkspace';
import { StudentHeader } from './StudentHeader';
import { StudentPostExamView } from './StudentPostExamView';
import { StudentSubmissionPendingPanel } from './StudentSubmissionPendingPanel';
import { SubmitConfirmation } from './SubmitConfirmation';
import { WarningOverlay } from './WarningOverlay';
import { useStudentAutoSubmitBoundary } from './useStudentAutoSubmitBoundary';
import {
  canDecreaseStudentPassageReadability,
  canIncreaseStudentPassageReadability,
  getStudentPassageReadabilityLabel,
  getStudentTypographyScale,
} from './accessibilityScale';
import { StudentHighlightSelectionManagerProvider } from './highlightSelectionManager';
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
import { emitAnswerMutationDebugLog } from './answerMutationDebug';
import { isStudentHighlightToolContextActive } from './studentHighlightToolContext';
import { installExamPageZoomGuard } from './examPageZoomGuard';
import { getBlockingCopy } from './blockingCopy';
import type { StudentAnswerMutationMeta, StudentAnswerValue } from '../../types/studentAttempt';

function formatRuntimeTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

interface StudentAppProps {
  showSubmitControls?: boolean | undefined;
  allowPreviewStart?: boolean | undefined;
}

export function StudentApp({
  showSubmitControls = true,
  allowPreviewStart = false,
}: StudentAppProps) {
  const { state: runtimeState, actions: runtimeActions, examState, onExit } = useStudentRuntime();
  const { actions: attemptActions, state: attemptState } = useStudentAttempt();
  const { state: uiState, actions: uiActions } = useStudentUI();
  const tabletMode = useStudentTabletMode();
  const canIncreasePassageReadability = canIncreaseStudentPassageReadability(
    uiState.accessibilitySettings.passageReadabilityLevel,
  );
  const canDecreasePassageReadability = canDecreaseStudentPassageReadability(
    uiState.accessibilitySettings.passageReadabilityLevel,
  );
  const studentTypography = getStudentTypographyScale(uiState.accessibilitySettings.fontSize);
  useZoomScrollAnchoring(uiState.accessibilitySettings.zoom * studentTypography.fontScale);
  const blockingCopy = getBlockingCopy(runtimeState.blocking.reason);
  // FEX-032: surface the attempt-layer sync state in the header. During normal
  // offline typing the blocking machine stays disengaged (blocking.reason
  // remains null), so the autoSaveStatus badge is the ONLY visible offline
  // surface. One-way mapping: StudentApp is the only place that passes the
  // prop. 'error' deliberately maps to null — the storage_unavailable
  // full-screen overlay IS the error surface; 'idle' means nothing is pending.
  const autoSaveStatus =
    runtimeState.attemptSyncState === 'offline'
      ? 'offline'
      : runtimeState.attemptSyncState === 'syncing_reconnect'
        ? 'syncing'
        : runtimeState.attemptSyncState === 'saving'
          ? 'saving'
          : runtimeState.attemptSyncState === 'saved'
            ? 'saved'
            : null;
  // A failed submit locks the exam against further editing while the attempt
  // layer retries with the same submission identity (FEX-051).
  const submissionPending = attemptState.pendingSubmission != null;
  // FEX-050: the final-submit pipeline must fire exactly once for a
  // structurally completed runtime with an un-finalized attempt. submittedAt
  // and proctor-terminated are authoritative end states; a durable pending
  // submission means the provider's retry loop owns the submission identity.
  const attemptFinalized =
    attemptState.attempt?.submittedAt != null ||
    attemptState.attempt?.proctorStatus === 'terminated';
  const answerControlsLocked = runtimeState.answerControlsLocked || submissionPending;
  const { resetHighlightTool, setShowTimeExtensionRequest } = uiActions;
  const timeExtensionReason =
    typeof uiState.timeExtensionReason === 'string' ? uiState.timeExtensionReason : '';
  const timeExtensionDialogRef = useRef<HTMLDialogElement>(null);
  const highlightColor = uiState.accessibilitySettings.highlightColor;
  const highlightEnabled = true;
  const attemptAnswers = attemptState.attempt?.answers ?? {};
  const attemptWritingAnswers = attemptState.attempt?.writingAnswers ?? {};
  const attemptFlags = attemptState.attempt?.flags ?? {};
  const studentShellStyle = {
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
    // Verified terminal state is absorbing: a stale nonterminal runtime
    // delivered after completion must not bounce the student back into the
    // workspace (FEX-012).
    (runtimeState.runtimeBacked && runtimeState.terminalVerified) ||
    (!runtimeState.runtimeBacked && runtimeState.phase === 'post-exam');
  const effectivePhase =
    runtimeState.phase === 'post-exam' && !shouldRenderPostExam ? 'exam' : runtimeState.phase;
  const runtimeCompletionVerified = isRuntimeStructurallyCompleted(runtimeState.runtimeSnapshot);

  useEffect(() => {
    if (effectivePhase !== 'exam') {
      return;
    }
    return installExamPageZoomGuard(document);
  }, [effectivePhase]);

  useEffect(() => {
    runtimeStateRef.current = runtimeState;
    latestAnswersRef.current = attemptAnswers;
    liveObjectiveAnswersRef.current = attemptAnswers;
    liveWritingAnswersRef.current = attemptWritingAnswers;
  }, [attemptAnswers, attemptWritingAnswers, runtimeState]);

  const commitWritingDraft = useCallback(() => {
    writingDraftCommitRef.current?.();
  }, []);

  const {
    finalSubmitStatus,
    flushAndSubmitCurrentModuleWithRetry,
    flushPendingAnswers,
  } = useStudentSubmissionOrchestration({
    runtimeState: {
      runtimeBacked: runtimeState.runtimeBacked,
      runtimeStatus: runtimeState.runtimeStatus,
      currentModule: runtimeState.currentModule,
    },
    runtimeStateRef,
    attemptId: attemptState.attemptId,
    runtimeCompletionVerified,
    attemptFinalized,
    pendingSubmissionActive: submissionPending,
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
    flushPendingAnswers,
    requestRuntimeRefresh: runtimeActions.refreshRuntime,
  });

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
  const unansweredSubmissionPolicy = examState.config.progression.unansweredSubmissionPolicy ?? 'confirm';
  const submitRequiresConfirmation =
    effectivePhase === 'exam' &&
    (runtimeState.currentModule === 'reading' || runtimeState.currentModule === 'listening') &&
    totalQuestions > 0 &&
    answeredCount < totalQuestions &&
    unansweredSubmissionPolicy !== 'allow';

  const performModuleSubmit = async () => {
    if (answerControlsLocked) {
      return;
    }
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
    if (answerControlsLocked || runtimeState.blocking.reason === 'storage_unavailable') {
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
    if (answerControlsLocked || runtimeState.blocking.reason === 'storage_unavailable') {
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
    if (answerControlsLocked || runtimeState.blocking.reason === 'storage_unavailable') {
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
          {/* FEX-070: the text portion is a polite live region so waiting and
              blocking changes are announced. The countdown chip and the badge
              stay OUTSIDE it — the countdown ticks every second and must not
              be announced. */}
          <div role="status" aria-live="polite">
            <p className="text-[length:var(--student-meta-font-size)] font-bold uppercase tracking-[0.3em] text-gray-500 mb-3">
              {blockingCopy.contextLabel}
            </p>
            <h2 className="text-2xl font-black text-gray-900 mb-3">{blockingCopy.title}</h2>
            <p className="text-sm text-gray-700 leading-6">
              {runtimeState.proctorNote ?? blockingCopy.message}
            </p>
          </div>
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

  const finalSubmitOverlay = submissionPending ? (
    <StudentSubmissionPendingPanel
      onRetryNow={() => {
        void attemptActions.submitAttempt();
      }}
    />
  ) : runtimeState.runtimeBacked &&
    runtimeState.runtimeStatus === 'completed' &&
    runtimeCompletionVerified &&
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
        <main id="main-content" role="main" tabIndex={-1}>
          <PreCheck
            config={examState.config}
            examTitle={attemptState.attempt?.examTitle ?? examState.title}
            candidateName={attemptState.attempt?.candidateName}
            candidateId={attemptState.attempt?.candidateId}
            onComplete={async (result) => {
              await attemptActions.recordPreCheckResult(result);
              runtimeActions.setPhase('lobby');
            }}
          />
        </main>
        {finalSubmitOverlay}
      </div>
    );
  }

  if (!shouldRenderPostExam && effectivePhase === 'lobby') {
    return (
      <div className="flex flex-col h-screen w-full bg-gray-50 font-sans text-gray-900" style={studentShellStyle}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <main id="main-content" role="main" tabIndex={-1}>
          <Lobby
            state={examState}
            candidateName={attemptState.attempt?.candidateName}
            candidateId={attemptState.attempt?.candidateId}
            onPreviewStart={allowPreviewStart ? runtimeActions.startExam : undefined}
          />
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

    // FEX-050: while the automatic final submit is in flight the completion
    // claim must not appear at all — the full-screen finalization overlay is
    // the only surface (no false success before the backend receipt; closing
    // and editing are blocked because no action is reachable). The receipt
    // flips the status to 'idle', which renders the completion view; when a
    // durable pending submission exists (FEX-051), the pending panel takes
    // precedence over the completion view behind it.
    if (finalSubmitStatus !== 'idle' && !submissionPending) {
      return (
        <div className="flex flex-col items-center justify-center h-full w-full bg-gray-50 p-4 font-sans text-gray-900">
          {finalSubmitOverlay}
        </div>
      );
    }

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
      <div
      className={`student-exam-shell h-screen w-full bg-gray-50 font-sans text-gray-900 transition-all ${
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
        testTakerId={attemptState.attempt?.candidateId ?? undefined}
        timeRemaining={runtimeState.displayTimeRemaining}
        autoSaveStatus={autoSaveStatus}
        highlightEnabled={highlightEnabled}
        highlightToolMode={uiState.accessibilitySettings.highlightToolMode}
        highlightColor={highlightColor}
        onToggleHighlightMode={uiActions.toggleHighlightMode}
        onSelectHighlightColor={uiActions.setHighlightColor}
        onSelectEraseMode={uiActions.toggleEraseMode}
        tabletMode={tabletMode}
        onOpenAccessibility={() => uiActions.setShowAccessibility(true)}
        onOpenNavigator={
          runtimeState.currentModule === 'reading' || runtimeState.currentModule === 'listening'
            ? () => uiActions.setShowNavigator(true)
            : undefined
        }
        isExamActive={effectivePhase === 'exam'}
      />

      <StudentHighlightSelectionManagerProvider>
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
          answerControlsLocked={answerControlsLocked}
          highlightEnabled={highlightEnabled}
          highlightColor={highlightColor}
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
      </StudentHighlightSelectionManagerProvider>

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
            latestScreenshotViolation?.description ||
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
            latestTabSwitchViolation?.description ||
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
            latestTranslationViolation?.description ||
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
            latestSecondaryScreenViolation?.description ||
            'Multiple screens detected. Please disconnect additional displays to continue.'
          }
          showCountdown={false}
          onAcknowledge={() => {
            acknowledgeSecondaryScreen();
          }}
        />
      ) : null}

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
            aria-describedby="extension-reason-hint"
          />
          <span id="extension-reason-hint" className="sr-only">
            Enter the reason for your time extension request
          </span>
        </div>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => uiActions.setShowTimeExtensionRequest(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleTimeExtensionRequest}>Request +5 Minutes</Button>
        </div>
      </dialog>

      <AccessibilitySettings
        isOpen={uiState.showAccessibility}
        onClose={() => uiActions.setShowAccessibility(false)}
        fontSize={uiState.accessibilitySettings.fontSize}
        highContrast={uiState.accessibilitySettings.highContrast}
        onFontSizeChange={uiActions.setFontSize}
        onHighContrastToggle={uiActions.toggleHighContrast}
      />
      </div>
  );
}
