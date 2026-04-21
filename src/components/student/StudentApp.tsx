import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  countAnsweredQuestions,
  countQuestionSlots,
} from '@services/examAdapterService';
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
import { shouldOfferTimeExtension } from './timeExtensionPolicy';
import { useStudentAttempt } from './providers/StudentAttemptProvider';
import { useStudentRuntime } from './providers/StudentRuntimeProvider';
import { useStudentUI } from './providers/StudentUIProvider';

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
        message:
          'Your section is locked until the cohort advances.',
        badge: 'Locked',
        contextLabel: 'Cohort Runtime',
      };
    case 'waiting_for_runtime':
      return {
        title: 'Waiting for cohort advance',
        message:
          'The next section will open when the cohort timing allows it.',
        badge: 'Waiting',
        contextLabel: 'Cohort Runtime',
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

export function StudentApp() {
  const { state: runtimeState, actions: runtimeActions, examState, onExit } = useStudentRuntime();
  const { actions: attemptActions, state: attemptState } = useStudentAttempt();
  const { state: uiState, actions: uiActions } = useStudentUI();
  const [finalSubmitStatus, setFinalSubmitStatus] = useState<'idle' | 'submitting' | 'retrying' | 'failed'>('idle');
  const blockingCopy = getBlockingCopy(runtimeState.blocking.reason);
  const { setShowTimeExtensionRequest } = uiActions;
  const autoSubmitFingerprintRef = useRef<string | null>(null);
  const runtimeFinalSubmitRef = useRef<string | null>(null);
  const finalSubmitInFlightRef = useRef<Promise<void> | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [warningSeverity, setWarningSeverity] = useState<'medium' | 'high' | 'critical'>(
    'medium',
  );
  const [lastAcknowledgedSecurityViolationId, setLastAcknowledgedSecurityViolationId] =
    useState<string | null>(null);
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

  const latestTabSwitchViolation = useMemo(() => {
    if (runtimeState.phase !== 'exam') {
      return null;
    }

    if (examState.config.security.tabSwitchRule !== 'warn') {
      return null;
    }

    const tabSwitchViolations = runtimeState.violations.filter(
      (violation) => violation.type === 'TAB_SWITCH',
    );
    return tabSwitchViolations[tabSwitchViolations.length - 1] ?? null;
  }, [examState.config.security.tabSwitchRule, runtimeState.phase, runtimeState.violations]);

  const shouldShowTabSwitchWarning =
    Boolean(latestTabSwitchViolation) &&
    latestTabSwitchViolation?.id !== lastAcknowledgedSecurityViolationId;

  const tabSwitchSeverity =
    latestTabSwitchViolation?.severity === 'high' || latestTabSwitchViolation?.severity === 'critical'
      ? latestTabSwitchViolation.severity
      : 'medium';

  useEffect(() => {
    if (!examState.config.progression.autoSubmit) {
      autoSubmitFingerprintRef.current = null;
      return;
    }

    if (runtimeState.phase !== 'exam') {
      autoSubmitFingerprintRef.current = null;
      return;
    }

    if (runtimeState.blocking.active) {
      return;
    }

    if (runtimeState.displayTimeRemaining !== 0) {
      return;
    }

    const fingerprint = `${runtimeState.runtimeBacked ? 'runtime' : 'self'}:${runtimeState.currentModule}`;
    if (autoSubmitFingerprintRef.current === fingerprint) {
      return;
    }

    autoSubmitFingerprintRef.current = fingerprint;
    void (async () => {
      const flushed = await attemptActions.flushPending();
      if (!flushed) {
        runtimeActions.setBlockingReason(navigator.onLine ? 'syncing_reconnect' : 'offline');
        return;
      }

      runtimeActions.setBlockingReason(null);
      runtimeActions.submitModule();
    })();
  }, [
    attemptActions,
    examState.config.progression.autoSubmit,
    runtimeActions,
    runtimeState.blocking.active,
    runtimeState.currentModule,
    runtimeState.displayTimeRemaining,
    runtimeState.phase,
    runtimeState.runtimeBacked,
  ]);
  const shouldShowTimeExtension = shouldOfferTimeExtension({
    config: examState.config,
    phase: runtimeState.phase,
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

  const submitCurrentModule = async () => {
    runtimeActions.submitModule();
  };

  const handleModuleSubmit = async () => {
    if (runtimeState.runtimeBacked) {
      const flushed = await attemptActions.flushPending();
      if (!flushed) {
        runtimeActions.setBlockingReason(navigator.onLine ? 'syncing_reconnect' : 'offline');
        return;
      }

      runtimeActions.setBlockingReason(null);
      runtimeActions.submitModule();
      return;
    }

    if (runtimeState.submitRequiresConfirmation) {
      uiActions.setShowSubmitConfirm(true);
      return;
    }

    await submitCurrentModule();
  };

  const confirmModuleSubmit = async () => {
    uiActions.setShowSubmitConfirm(false);
    await submitCurrentModule();
  };

  useEffect(() => {
    if (!runtimeState.runtimeBacked) {
      runtimeFinalSubmitRef.current = null;
      finalSubmitInFlightRef.current = null;
      setFinalSubmitStatus('idle');
      return;
    }

    if (runtimeState.runtimeStatus !== 'completed') {
      runtimeFinalSubmitRef.current = null;
      finalSubmitInFlightRef.current = null;
      setFinalSubmitStatus('idle');
      return;
    }

    if (runtimeState.phase === 'post-exam') {
      return;
    }

    if (attemptState.attempt?.phase === 'post-exam') {
      setFinalSubmitStatus('idle');
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
    attemptState.attempt?.phase,
    attemptState.attemptId,
    runtimeState.phase,
    runtimeState.runtimeBacked,
    runtimeState.runtimeStatus,
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

  const blockingOverlay =
    runtimeState.blocking.active && blockingCopy ? (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm p-4">
        <div className="max-w-md w-full bg-white rounded-sm border border-gray-100 shadow-2xl p-6 md:p-8 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-500 mb-3">
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
    runtimeState.phase !== 'post-exam' &&
    attemptState.attempt?.phase !== 'post-exam' &&
    finalSubmitStatus !== 'idle' ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm p-4">
        <div className="max-w-md w-full bg-white rounded-sm border border-gray-100 shadow-2xl p-6 md:p-8 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-500 mb-3">
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

  if (runtimeState.phase === 'pre-check') {
    return (
      <div className="flex flex-col h-screen w-full bg-gray-50 font-sans text-gray-900">
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
        {blockingOverlay}
        {finalSubmitOverlay}
      </div>
    );
  }

  if (!runtimeState.runtimeBacked && runtimeState.phase === 'lobby') {
    return (
      <div className="flex flex-col h-screen w-full bg-gray-50 font-sans text-gray-900">
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

  if (runtimeState.phase === 'post-exam') {
    const isProctorTerminated = runtimeState.proctorStatus === 'terminated';
    return (
      <div className="flex flex-col items-center justify-center h-full w-full bg-gray-50 p-4 font-sans text-gray-900">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <main id="main-content" role="main" className="flex flex-col items-center justify-center">
          <div className="bg-white p-6 md:p-8 rounded-lg shadow-md max-w-2xl w-full text-center">
            <h1 className="text-3xl font-bold mb-4">
              {isProctorTerminated ? 'Session terminated' : '🎉 Examination Complete!'}
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
            <Button onClick={onExit}>Exit Exam Platform</Button>
          </div>
        </main>
        {finalSubmitOverlay}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col h-screen w-full bg-gray-50 font-sans text-gray-900 transition-all ${
        uiState.accessibilitySettings.highContrast ? 'high-contrast' : ''
      }`}
      style={{
        fontSize:
          uiState.accessibilitySettings.fontSize === 'small'
            ? '14px'
            : uiState.accessibilitySettings.fontSize === 'large'
              ? '18px'
              : '16px',
      }}
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
        totalSectionTime={examState.config.sections[runtimeState.currentModule]?.duration * 60 || 0}
        onOpenAccessibility={() => uiActions.setShowAccessibility(true)}
        onOpenNavigator={
          runtimeState.currentModule === 'reading' || runtimeState.currentModule === 'listening'
            ? () => uiActions.setShowNavigator(true)
            : undefined
        }
        isExamActive={runtimeState.phase === 'exam'}
      />

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

      <HelpModal isOpen={uiState.showHelp} onClose={() => uiActions.setShowHelp(false)} />

      <SubmitConfirmation
        isOpen={uiState.showSubmitConfirm}
        onClose={() => uiActions.setShowSubmitConfirm(false)}
        onConfirm={confirmModuleSubmit}
        answeredCount={answeredCount}
        totalQuestions={totalQuestions}
        flaggedCount={Object.values(runtimeState.flags).filter(Boolean).length}
        timeRemaining={runtimeState.displayTimeRemaining}
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
  );
}
