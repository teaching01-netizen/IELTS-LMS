import React, { useEffect } from 'react';
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
          'You submitted early. Your section is locked until the cohort advances.',
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
  const { actions: attemptActions } = useStudentAttempt();
  const { state: uiState, actions: uiActions } = useStudentUI();
  const blockingCopy = getBlockingCopy(runtimeState.blocking.reason);
  const { setShowTimeExtensionRequest } = uiActions;
  const autoSaveStatus =
    runtimeState.attemptSyncState === 'saving'
      ? 'saving'
      : runtimeState.attemptSyncState === 'syncing_reconnect'
        ? 'syncing'
        : runtimeState.attemptSyncState === 'offline'
          ? 'offline'
          : runtimeState.attemptSyncState === 'saved'
            ? 'saved'
            : null;

  const shouldShowTimeExtension = !runtimeState.runtimeBacked && 
    runtimeState.phase === 'exam' && 
    runtimeState.displayTimeRemaining === 300;

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

  const handleModuleSubmit = () => {
    if (runtimeState.submitRequiresConfirmation) {
      uiActions.setShowSubmitConfirm(true);
      return;
    }

    runtimeActions.submitModule();
  };

  const confirmModuleSubmit = () => {
    uiActions.setShowSubmitConfirm(false);
    runtimeActions.submitModule();
  };

  const answeredCount = countAnsweredQuestions(runtimeState.allQuestions, runtimeState.answers);
  const totalQuestions = countQuestionSlots(runtimeState.allQuestions);

  if (runtimeState.phase === 'pre-check') {
    return (
      <div className="flex flex-col h-screen w-full bg-gray-50 font-sans text-gray-900">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <main id="main-content" role="main">
          <PreCheck
            config={examState.config}
            onComplete={(result) => {
              void attemptActions.recordPreCheckResult(result);
              runtimeActions.setPhase(runtimeState.runtimeBacked ? 'exam' : 'lobby');
            }}
            onExit={onExit}
          />
        </main>
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
      </div>
    );
  }

  if (runtimeState.phase === 'post-exam') {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full bg-gray-50 p-4 font-sans text-gray-900">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <main id="main-content" role="main" className="flex flex-col items-center justify-center">
          <div className="bg-white p-6 md:p-8 rounded-lg shadow-md max-w-2xl w-full text-center">
            <h1 className="text-3xl font-bold mb-4">🎉 Examination Complete!</h1>
            <p className="text-gray-600 mb-8">
              Congratulations! You have completed all modules of the IELTS examination.
            </p>
            <Button onClick={onExit}>Exit Exam Platform</Button>
          </div>
        </main>
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
        timeRemaining={runtimeState.displayTimeRemaining}
        elapsedTime={runtimeState.elapsedTime}
        totalSectionTime={examState.config.sections[runtimeState.currentModule]?.duration * 60 || 0}
        autoSaveStatus={autoSaveStatus}
        onOpenAccessibility={() => uiActions.setShowAccessibility(true)}
        isExamActive={runtimeState.phase === 'exam'}
      />

      <main id="main-content" className="flex-1 overflow-hidden relative flex flex-col" role="main">
        {runtimeState.currentModule === 'reading' ? (
          <StudentReading
            state={examState}
            answers={runtimeState.answers}
            onAnswerChange={runtimeActions.setAnswer}
            currentQuestionId={runtimeState.currentQuestionId}
            onNavigate={runtimeActions.setCurrentQuestionId}
            flags={runtimeState.flags}
            onToggleFlag={runtimeActions.toggleFlag}
          />
        ) : null}
        {runtimeState.currentModule === 'listening' ? (
          <StudentListening
            state={examState}
            answers={runtimeState.answers}
            onAnswerChange={runtimeActions.setAnswer}
            currentQuestionId={runtimeState.currentQuestionId}
            onNavigate={runtimeActions.setCurrentQuestionId}
            flags={runtimeState.flags}
            onToggleFlag={runtimeActions.toggleFlag}
          />
        ) : null}
        {runtimeState.currentModule === 'writing' ? (
          <StudentWriting
            state={examState}
            writingAnswers={runtimeState.writingAnswers}
            onWritingChange={runtimeActions.setWritingAnswer}
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

      {runtimeState.blocking.active && blockingCopy ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm p-4">
          <div className="max-w-md w-full bg-white rounded-sm border border-gray-100 shadow-2xl p-6 md:p-8 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-500 mb-3">
              {blockingCopy.contextLabel}
            </p>
            <h2 className="text-2xl font-black text-gray-900 mb-3">{blockingCopy.title}</h2>
            <p className="text-sm text-gray-700 leading-6">{blockingCopy.message}</p>
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
      ) : null}

      {(runtimeState.currentModule === 'reading' ||
        runtimeState.currentModule === 'listening') ? (
        <StudentFooter
          questions={runtimeState.allQuestions}
          currentQuestionId={runtimeState.currentQuestionId}
          onNavigate={runtimeActions.setCurrentQuestionId}
          answers={runtimeState.answers}
          flags={runtimeState.flags}
          onToggleFlag={runtimeActions.toggleFlag}
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

      <WarningOverlay
        isOpen={false}
        severity="medium"
        message=""
        onAcknowledge={() => {}}
      />

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
