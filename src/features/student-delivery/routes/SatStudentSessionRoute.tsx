import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ErrorSurface } from '@components/ui/ErrorSurface';
import { LoadingSurface } from '@components/ui/LoadingSurface';
import { ExamQuestionRenderer } from '../../exam-rendering/api/ExamQuestionRenderer';
import { SatExamShell } from '../ui/SatExamShell';
import { SatCalculatorPanel } from '../ui/tools/SatCalculatorPanel';
import { SatReferenceSheetPanel } from '../ui/tools/SatReferenceSheetPanel';
import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryModule,
  AssessmentModuleAttemptSnapshot,
  AssessmentResult,
} from '../contracts/assessmentDelivery';
import { assessmentDeliveryApi } from '../api/assessmentDeliveryApi';
import { createSatRunnerState, satRunnerReducer } from '../application/satRunnerReducer';
import { calculatorWorkspaceKey, clearCalculatorWorkspace, clearCalculatorWorkspacesForAttempt } from '../application/satCalculatorWorkspace';
import { useSatIntegrityControl } from '../application/useSatIntegrityControl';

export interface SatStudentSessionRouteProps {
  scheduleId: string;
  attemptId: string;
  onExit: () => void | Promise<void>;
}

function moduleForAttempt(data: AssessmentDeliveryBootstrap, attempt: AssessmentModuleAttemptSnapshot | undefined) {
  if (!attempt) return null;
  return data.sections
    .flatMap((section) => section.modules)
    .find((module) => module.id === attempt.moduleId) ?? null;
}

function findActiveAttempt(data: AssessmentDeliveryBootstrap) {
  return data.attempt.moduleAttempts.find((module) => module.state === 'active');
}

function findPendingAttempt(data: AssessmentDeliveryBootstrap) {
  return findActiveAttempt(data)
    ?? data.attempt.moduleAttempts.find((module) => module.state === 'not_started');
}

function findCurrentModule(data: AssessmentDeliveryBootstrap) {
  return moduleForAttempt(data, findPendingAttempt(data));
}

function findAttemptForModule(data: AssessmentDeliveryBootstrap, moduleId: string) {
  return data.attempt.moduleAttempts.find((candidate) => candidate.moduleId === moduleId);
}

function sectionForModule(data: AssessmentDeliveryBootstrap, moduleId: string) {
  return data.sections.find((section) => section.modules.some((module) => module.id === moduleId));
}

function studentModuleTitle(module: AssessmentDeliveryModule) {
  return module.adaptiveRole === 'lower_branch' || module.adaptiveRole === 'higher_branch'
    ? 'Module 2'
    : 'Module 1';
}

function moduleTools(module: AssessmentDeliveryModule): Record<string, boolean> {
  if (Array.isArray(module.toolPolicy)) {
    return Object.fromEntries(module.toolPolicy.map((tool) => [tool, true]));
  }
  return Object.fromEntries(
    Object.entries(module.toolPolicy)
      .filter(([, enabled]) => enabled !== false && enabled !== null)
      .map(([tool]) => [tool, true]),
  );
}

function snapshotRemainingSeconds(
  attempt: AssessmentModuleAttemptSnapshot | undefined,
  snapshotReceivedAt: number,
  now: number,
) {
  if (!attempt) return 0;
  if (attempt.pausedAt || !attempt.startedAt) return Math.max(0, attempt.remainingSeconds);
  const elapsedSinceSnapshot = Math.max(0, Math.floor((now - snapshotReceivedAt) / 1000));
  return Math.max(0, attempt.remainingSeconds - elapsedSinceSnapshot);
}

function breakRemainingSeconds(
  data: AssessmentDeliveryBootstrap,
  attempt: AssessmentModuleAttemptSnapshot | undefined,
  snapshotReceivedAt: number,
  now: number,
) {
  if (!attempt?.availableAt) return 0;
  const serverDelaySeconds = Math.max(
    0,
    Math.ceil((Date.parse(attempt.availableAt) - Date.parse(data.serverNow)) / 1000),
  );
  const elapsedSinceSnapshot = Math.max(0, Math.floor((now - snapshotReceivedAt) / 1000));
  return Math.max(0, serverDelaySeconds - elapsedSinceSnapshot);
}

function timingForAttempt(
  data: AssessmentDeliveryBootstrap,
  attempt: AssessmentModuleAttemptSnapshot,
) {
  const startedAt = attempt.startedAt ?? data.serverNow;
  const endsAt = attempt.deadlineAt
    ?? new Date(Date.parse(data.serverNow) + Math.max(0, attempt.remainingSeconds) * 1000).toISOString();
  return { startedAt, endsAt };
}

export function SatStudentSessionRoute({ scheduleId, attemptId, onExit }: SatStudentSessionRouteProps) {
  const [state, dispatch] = useReducer(satRunnerReducer, createSatRunnerState(scheduleId, attemptId));
  const [data, setData] = useState<AssessmentDeliveryBootstrap | null>(null);
  const [snapshotReceivedAt, setSnapshotReceivedAt] = useState(() => Date.now());
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const responseRevisionsRef = useRef(new Map<string, number>());
  const pendingResponseSavesRef = useRef(new Map<string, Promise<void>>());
  const timeoutSubmissionKeyRef = useRef<string | null>(null);

  const applyPayload = useCallback((payload: AssessmentDeliveryBootstrap) => {
    setData(payload);
    setSnapshotReceivedAt(Date.now());
    setResult(payload.result);
    setError(null);
    for (const response of payload.attempt.responses) {
      responseRevisionsRef.current.set(response.examQuestionId, response.revision);
    }
  }, []);

  const refresh = useCallback(async (surfaceError = false) => {
    try {
      const payload = await assessmentDeliveryApi.bootstrap(scheduleId, attemptId);
      applyPayload(payload);
      return payload;
    } catch (loadError) {
      if (surfaceError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load the SAT attempt.');
      }
      return null;
    }
  }, [applyPayload, attemptId, scheduleId]);

  useEffect(() => {
    let mounted = true;
    void assessmentDeliveryApi.bootstrap(scheduleId, attemptId)
      .then((payload) => {
        if (!mounted) return;
        applyPayload(payload);
        dispatch({ type: 'bootstrapLoaded', assessmentId: payload.versionId });
      })
      .catch((loadError: unknown) => {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Unable to load the SAT attempt.');
      });
    return () => { mounted = false; };
  }, [applyPayload, attemptId, scheduleId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (state.phase === 'complete' || state.phase === 'submitting') return;
    const timer = window.setInterval(() => { void refresh(false); }, 2_500);
    return () => window.clearInterval(timer);
  }, [refresh, state.phase]);

  useSatIntegrityControl({
    scheduleId,
    attemptId,
    expectedDeviceFingerprintHash: data?.deviceFingerprintHash ?? null,
    enforceInteractionGuards: state.phase === 'module' || state.phase === 'review',
  });

  const hydrateModuleResponses = useCallback((payload: AssessmentDeliveryBootstrap, module: AssessmentDeliveryModule) => {
    for (const response of payload.attempt.responses.filter((candidate) =>
      module.questions.some((question) => question.examQuestionId === candidate.examQuestionId))) {
      if (typeof response.response === 'string' || typeof response.response === 'number') {
        dispatch({ type: 'setResponse', questionId: response.examQuestionId, value: String(response.response) });
      }
      dispatch({ type: 'responseSaved', questionId: response.examQuestionId, revision: response.revision });
      if (response.markedForReview) {
        dispatch({ type: 'setReviewFlag', questionId: response.examQuestionId, flagged: true });
      }
      for (const optionId of response.eliminatedOptions) {
        dispatch({ type: 'toggleEliminatedOption', questionId: response.examQuestionId, optionId });
      }
    }
  }, []);

  const startModuleFrom = useCallback((payload: AssessmentDeliveryBootstrap, module: AssessmentDeliveryModule) => {
    const section = sectionForModule(payload, module.id);
    const attempt = findAttemptForModule(payload, module.id);
    if (!section || !attempt?.startedAt) return;
    const timing = timingForAttempt(payload, attempt);
    dispatch({
      type: 'routeToModule',
      sectionKey: section.sectionKey === 'math' ? 'math' : 'reading-writing',
      moduleKey: module.moduleKey,
      questionIds: module.questions.map((question) => question.examQuestionId),
      startedAt: timing.startedAt,
      endsAt: timing.endsAt,
      tools: moduleTools(module),
    });
    hydrateModuleResponses(payload, module);
  }, [hydrateModuleResponses]);

  useEffect(() => {
    if (!data || state.phase !== 'directions') return;
    const activeAttempt = findActiveAttempt(data);
    const activeModule = moduleForAttempt(data, activeAttempt);
    if (activeAttempt?.startedAt && activeModule) startModuleFrom(data, activeModule);
  }, [data, startModuleFrom, state.phase]);

  useEffect(() => {
    if (!data?.result || state.phase === 'complete') return;
    clearCalculatorWorkspacesForAttempt(scheduleId, attemptId);
    setResult(data.result);
    dispatch({
      type: 'recover',
      state: {
        phase: 'complete',
        scheduleId,
        candidateId: attemptId,
        assessmentId: data.versionId,
        resultId: data.result.id,
      },
    });
  }, [attemptId, data, scheduleId, state.phase]);

  const pendingModule = useMemo(() => data ? findCurrentModule(data) : null, [data]);
  const pendingAttempt = useMemo(
    () => data && pendingModule ? findAttemptForModule(data, pendingModule.id) : undefined,
    [data, pendingModule],
  );
  const pendingBreakSeconds = data
    ? breakRemainingSeconds(data, pendingAttempt, snapshotReceivedAt, now)
    : 0;

  const startPendingModule = async () => {
    if (!data || !pendingModule || isStarting) return;
    setIsStarting(true);
    setError(null);
    try {
      const payload = await assessmentDeliveryApi.startModule(scheduleId, attemptId, { moduleId: pendingModule.id });
      applyPayload(payload);
      const activeAttempt = findActiveAttempt(payload);
      const activeModule = moduleForAttempt(payload, activeAttempt);
      if (activeModule) startModuleFrom(payload, activeModule);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'The SAT module could not be started.');
    } finally {
      setIsStarting(false);
    }
  };

  const saveResponse = (questionId: string, value: string, markedForReview: boolean, eliminatedOptions: string[]) => {
    if (!data) return;
    const previous = pendingResponseSavesRef.current.get(questionId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(async () => {
      setPendingSaveCount((count) => count + 1);
      try {
        const revision = responseRevisionsRef.current.get(questionId) ?? 0;
        const saved = await assessmentDeliveryApi.saveResponse(scheduleId, attemptId, questionId, {
          revision,
          response: value || null,
          markedForReview,
          eliminatedOptions,
          annotations: {},
        });
        responseRevisionsRef.current.set(questionId, saved.revision);
        dispatch({ type: 'responseSaved', questionId, revision: saved.revision });
      } finally {
        setPendingSaveCount((count) => Math.max(0, count - 1));
      }
    });
    pendingResponseSavesRef.current.set(questionId, pending);
    void pending.catch((saveError: unknown) => {
      setError(saveError instanceof Error ? saveError.message : 'Response save failed.');
    }).finally(() => {
      if (pendingResponseSavesRef.current.get(questionId) === pending) {
        pendingResponseSavesRef.current.delete(questionId);
      }
    });
  };

  const flushResponseSaves = async () => {
    await Promise.all([...pendingResponseSavesRef.current.values()]);
  };

  const handleSubmitModule = useCallback(async (moduleId: string) => {
    if (isSubmitting) return;
    const submittedModuleAttemptId = data ? findAttemptForModule(data, moduleId)?.id : undefined;
    setIsSubmitting(true);
    setError(null);
    try {
      await flushResponseSaves();
      const next = await assessmentDeliveryApi.submitModule(scheduleId, attemptId, { moduleId });
      if (submittedModuleAttemptId) {
        clearCalculatorWorkspace(calculatorWorkspaceKey(scheduleId, attemptId, submittedModuleAttemptId));
      }
      applyPayload(next);
      const nextAttempt = findPendingAttempt(next);
      const nextModule = moduleForAttempt(next, nextAttempt);
      if (!nextModule) {
        dispatch({ type: 'submit' });
        const finalResult = await assessmentDeliveryApi.submitAssessment(scheduleId, attemptId, { submissionId: attemptId });
        clearCalculatorWorkspacesForAttempt(scheduleId, attemptId);
        setResult(finalResult);
        dispatch({ type: 'completed', resultId: finalResult.id });
        return;
      }
      const currentSection = data ? sectionForModule(data, moduleId) : null;
      const nextSection = sectionForModule(next, nextModule.id);
      if (currentSection && nextSection && nextSection.id !== currentSection.id) {
        dispatch({
          type: 'startBreak',
          nextSectionKey: nextSection.sectionKey === 'math' ? 'math' : 'reading-writing',
          resumeAt: nextAttempt?.availableAt ?? next.serverNow,
        });
      } else {
        dispatch({ type: 'showDirections' });
      }
    } catch (submitError) {
      const refreshed = await refresh(false);
      if (refreshed) {
        if (refreshed.result) {
          clearCalculatorWorkspacesForAttempt(scheduleId, attemptId);
          setResult(refreshed.result);
          dispatch({
            type: 'recover',
            state: {
              phase: 'complete', scheduleId, candidateId: attemptId,
              assessmentId: refreshed.versionId, resultId: refreshed.result.id,
            },
          });
          return;
        }
        const nextAttempt = findPendingAttempt(refreshed);
        const nextModule = moduleForAttempt(refreshed, nextAttempt);
        if (nextModule && nextModule.id !== moduleId) {
          if (submittedModuleAttemptId) {
            clearCalculatorWorkspace(calculatorWorkspaceKey(scheduleId, attemptId, submittedModuleAttemptId));
          }
          dispatch({ type: 'showDirections' });
          return;
        }
      }
      setError(submitError instanceof Error ? submitError.message : 'Module submission failed.');
    } finally {
      setIsSubmitting(false);
    }
  }, [applyPayload, attemptId, data, isSubmitting, refresh, scheduleId]);

  const stateModule = useMemo(() => {
    if (!data || (state.phase !== 'module' && state.phase !== 'review')) return null;
    return data.sections.flatMap((section) => section.modules)
      .find((candidate) => candidate.moduleKey === state.moduleKey) ?? null;
  }, [data, state]);
  const stateModuleAttempt = useMemo(
    () => data && stateModule ? findAttemptForModule(data, stateModule.id) : undefined,
    [data, stateModule],
  );
  const remainingSeconds = stateModuleAttempt
    ? snapshotRemainingSeconds(stateModuleAttempt, snapshotReceivedAt, now)
    : 0;

  useEffect(() => {
    if ((state.phase !== 'module' && state.phase !== 'review') || !stateModule || !stateModuleAttempt) return;
    const key = `${stateModule.id}:${stateModuleAttempt.id}`;
    if (remainingSeconds > 0) {
      if (timeoutSubmissionKeyRef.current !== key) timeoutSubmissionKeyRef.current = null;
      return;
    }
    if (stateModuleAttempt.pausedAt || timeoutSubmissionKeyRef.current === key) return;
    timeoutSubmissionKeyRef.current = key;
    void handleSubmitModule(stateModule.id);
  }, [handleSubmitModule, remainingSeconds, state.phase, stateModule, stateModuleAttempt]);

  useEffect(() => {
    if (!data || (state.phase !== 'module' && state.phase !== 'review') || !stateModule) return;
    const attempt = findAttemptForModule(data, stateModule.id);
    if (attempt && matchesFinalState(attempt.state)) {
      const nextAttempt = findPendingAttempt(data);
      const nextModule = moduleForAttempt(data, nextAttempt);
      if (nextModule && nextModule.id !== stateModule.id) dispatch({ type: 'showDirections' });
    }
  }, [data, state.phase, stateModule]);

  if (error && !data) {
    return <ErrorSurface title="SAT delivery unavailable" description={error} actionLabel="Exit" onAction={() => void onExit()} />;
  }
  if (!data) return <LoadingSurface label="Loading Digital SAT…" />;
  if (data.result || state.phase === 'complete') return <CompleteScreen result={data.result ?? result} onExit={onExit} />;
  if (data.proctorStatus === 'terminated') return <TerminatedScreen note={data.proctorNote} onExit={onExit} />;
  if (data.scheduleRuntimeStatus === 'completed' || data.scheduleRuntimeStatus === 'cancelled') {
    return <TerminatedScreen note="The proctor has ended this exam session." onExit={onExit} />;
  }

  const blocked = data.proctorStatus === 'paused' || data.scheduleRuntimeStatus === 'paused';
  const warning = data.proctorStatus === 'warned' ? data.proctorNote : null;

  if (state.phase === 'directions') {
    if (pendingBreakSeconds > 0 && pendingModule) {
      const section = sectionForModule(data, pendingModule.id);
      return (
        <BreakScreen
          nextSectionKey={section?.sectionKey === 'math' ? 'math' : 'reading-writing'}
          remainingSeconds={pendingBreakSeconds}
        />
      );
    }
    return (
      <DirectionsScreen
        module={pendingModule}
        runtimeStatus={data.scheduleRuntimeStatus}
        proctorStatus={data.proctorStatus}
        isStarting={isStarting}
        error={error}
        onStart={() => void startPendingModule()}
        onExit={onExit}
      />
    );
  }
  if (state.phase === 'break') {
    return (
      <BreakScreen
        nextSectionKey={state.nextSectionKey}
        remainingSeconds={pendingBreakSeconds}
        {...(pendingBreakSeconds <= 0 ? { onContinue: () => dispatch({ type: 'showDirections' }) } : {})}
      />
    );
  }
  if (state.phase === 'submitting') return <LoadingSurface label="Finalizing SAT responses…" />;
  if (state.phase !== 'module' && state.phase !== 'review') {
    return <ErrorSurface title="SAT state unavailable" description="The assessment state could not be recovered." actionLabel="Exit" onAction={() => void onExit()} />;
  }
  if (!stateModule || !stateModuleAttempt) {
    return <LoadingSurface label="Refreshing SAT module…" />;
  }
  if (state.phase === 'review') {
    return (
      <>
        {warning ? <ControlBanner tone="warning">Proctor message: {warning}</ControlBanner> : null}
        {error ? <ControlBanner tone="error">{error}</ControlBanner> : null}
        {blocked ? <BlockingOverlay note={data.proctorNote} /> : null}
        <ReviewScreen
          module={stateModule}
          answers={state.answers}
          remainingLabel={formatTime(remainingSeconds)}
          onBack={() => dispatch({ type: 'returnToModule' })}
          onSubmit={() => void handleSubmitModule(stateModule.id)}
          isSubmitting={isSubmitting}
        />
      </>
    );
  }

  const questionId = state.questionIds[state.questionIndex];
  const question = stateModule.questions.find((candidate) => candidate.examQuestionId === questionId);
  if (!question) return <ErrorSurface title="SAT question unavailable" description="The active question could not be recovered." actionLabel="Exit" onAction={() => void onExit()} />;
  const eliminated = new Set(state.eliminatedOptionIds[question.examQuestionId] ?? []);
  const answer = state.answers[question.examQuestionId];

  const answeredQuestionIds = new Set(
    Object.entries(state.answers)
      .filter(([, value]) => value.trim().length > 0)
      .map(([id]) => id),
  );
  const calculatorAvailable = state.toolState['calculator'] !== undefined;
  const referenceAvailable = state.toolState['reference_sheet'] !== undefined;
  const interactionBlocked = blocked || isSubmitting;

  const toggleReview = () => {
    const flagged = !(state.reviewFlags[question.examQuestionId] ?? false);
    dispatch({ type: 'setReviewFlag', questionId: question.examQuestionId, flagged });
    saveResponse(question.examQuestionId, state.answers[question.examQuestionId] ?? '', flagged, [...eliminated]);
  };

  return (
    <>
      {warning ? <ControlBanner tone="warning">Proctor message: {warning}</ControlBanner> : null}
      {error ? <ControlBanner tone="error">{error}</ControlBanner> : null}
      {blocked ? <BlockingOverlay note={data.proctorNote} /> : null}
      {isSubmitting ? <SubmissionOverlay /> : null}
      <SatExamShell
        sectionLabel={state.sectionKey === 'math' ? 'Math' : 'Reading & Writing'}
        moduleTitle={studentModuleTitle(stateModule)}
        remainingLabel={formatTime(remainingSeconds)}
        saveStatus={pendingSaveCount > 0 ? 'saving' : 'saved'}
        questionIndex={state.questionIndex}
        questionCount={state.questionIds.length}
        answered={answeredQuestionIds}
        questionIds={state.questionIds}
        reviewFlags={state.reviewFlags}
        currentQuestionId={question.examQuestionId}
        calculatorAvailable={calculatorAvailable}
        calculatorOpen={Boolean(state.toolState['calculator'])}
        referenceAvailable={referenceAvailable}
        referenceOpen={Boolean(state.toolState['reference_sheet'])}
        blocked={interactionBlocked}
        onSelectQuestion={(questionIndex) => dispatch({ type: 'selectQuestion', questionIndex })}
        onToggleReview={toggleReview}
        onToggleCalculator={() => dispatch({ type: 'setToolState', tool: 'calculator', open: !state.toolState['calculator'] })}
        onToggleReference={() => dispatch({ type: 'setToolState', tool: 'reference_sheet', open: !state.toolState['reference_sheet'] })}
        onPrevious={() => dispatch({ type: 'selectQuestion', questionIndex: state.questionIndex - 1 })}
        onNext={() => dispatch({ type: 'selectQuestion', questionIndex: state.questionIndex + 1 })}
        onReviewModule={() => dispatch({ type: 'reviewModule' })}
      >
        <ExamQuestionRenderer
          question={question}
          {...(answer === undefined ? {} : { answer })}
          eliminatedOptionIds={eliminated}
          disabled={interactionBlocked}
          onAnswerChange={(value) => {
            dispatch({ type: 'setResponse', questionId: question.examQuestionId, value });
            saveResponse(
              question.examQuestionId,
              value,
              state.reviewFlags[question.examQuestionId] ?? false,
              [...eliminated],
            );
          }}
        />
      </SatExamShell>
      {calculatorAvailable ? (
        <SatCalculatorPanel
          open={Boolean(state.toolState['calculator'])}
          scheduleId={scheduleId}
          attemptId={attemptId}
          moduleAttemptId={stateModuleAttempt.id}
          disabled={interactionBlocked}
          onClose={() => dispatch({ type: 'setToolState', tool: 'calculator', open: false })}
        />
      ) : null}
      {referenceAvailable ? (
        <SatReferenceSheetPanel
          open={Boolean(state.toolState['reference_sheet'])}
          onClose={() => dispatch({ type: 'setToolState', tool: 'reference_sheet', open: false })}
        />
      ) : null}
    </>
  );
}

function matchesFinalState(state: string) {
  return state === 'submitted' || state === 'locked';
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function DirectionsScreen({
  module,
  runtimeStatus,
  proctorStatus,
  isStarting,
  error,
  onStart,
  onExit,
}: {
  module: AssessmentDeliveryModule | null;
  runtimeStatus: string;
  proctorStatus: string;
  isStarting: boolean;
  error: string | null;
  onStart: () => void;
  onExit: () => void | Promise<void>;
}) {
  const canStart = Boolean(module) && runtimeStatus === 'live' && proctorStatus !== 'paused' && proctorStatus !== 'terminated';
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-[#f5f5f7] p-5">
      <div className="w-full max-w-xl space-y-5 rounded-[28px] border border-black/10 bg-white p-8 shadow-sm sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Digital SAT</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{module ? studentModuleTitle(module) : 'Next module'}</h1>
        <p className="text-slate-600">
          You have {module ? Math.round(module.durationSeconds / 60) : 0} minutes. The official timer starts on the server only after you press Start.
        </p>
        {runtimeStatus !== 'live' ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Waiting for the proctor to start the exam session.</p>
        ) : null}
        {proctorStatus === 'paused' ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Your attempt is paused by the proctor.</p>
        ) : null}
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="flex gap-3">
          <button type="button" onClick={onStart} disabled={!canStart || isStarting} className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40">
            {isStarting ? 'Starting…' : 'Start module'}
          </button>
          <button type="button" onClick={() => void onExit()} className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Exit</button>
        </div>
      </div>
    </div>
  );
}

function BreakScreen({ nextSectionKey, remainingSeconds, onContinue }: { nextSectionKey: string; remainingSeconds: number; onContinue?: () => void }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-[#f5f5f7] p-5">
      <div className="w-full max-w-lg space-y-4 rounded-[28px] border border-black/10 bg-white p-8 text-center shadow-sm sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Scheduled break</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Get ready for {nextSectionKey === 'math' ? 'Math' : 'Reading & Writing'}</h1>
        <p className="text-slate-600">{remainingSeconds > 0 ? `The next section opens in ${formatTime(remainingSeconds)}.` : 'Your next module is ready.'}</p>
        {onContinue ? <button type="button" onClick={onContinue} className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800">Continue</button> : null}
      </div>
    </div>
  );
}

function ReviewScreen({ module, answers, remainingLabel, onBack, onSubmit, isSubmitting }: { module: AssessmentDeliveryModule; answers: Record<string, string>; remainingLabel: string; onBack: () => void; onSubmit: () => void; isSubmitting: boolean }) {
  const answeredCount = Object.values(answers).filter((value) => value.trim().length > 0).length;
  const unansweredCount = Math.max(0, module.questions.length - answeredCount);
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-[#f5f5f7] p-5">
      <div className="w-full max-w-xl rounded-[24px] border border-black/10 bg-white p-7 shadow-sm sm:p-9">
        <div className="flex items-center justify-between gap-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Module review</p><span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm font-semibold tabular-nums">{remainingLabel}</span></div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Ready to submit?</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{answeredCount} of {module.questions.length} questions have responses. {unansweredCount > 0 ? `${unansweredCount} remain unanswered.` : 'Every question has a response.'}</p>
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onBack} disabled={isSubmitting} className="h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Back to questions</button>
          <button type="button" onClick={onSubmit} disabled={isSubmitting} className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40">{isSubmitting ? 'Submitting…' : 'Submit module'}</button>
        </div>
      </div>
    </div>
  );
}

function ControlBanner({ children, tone }: { children: React.ReactNode; tone: 'warning' | 'error' }) {
  return <div className={`fixed left-1/2 top-[72px] z-[85] w-[min(92vw,680px)] -translate-x-1/2 rounded-xl px-4 py-2.5 text-center text-sm font-medium shadow-lg ${tone === 'warning' ? 'bg-amber-100 text-amber-950' : 'bg-red-100 text-red-900'}`}>{children}</div>;
}

function SubmissionOverlay() {
  return (
    <div className="fixed inset-0 z-[95] grid place-items-center bg-white/70 backdrop-blur-sm" role="status" aria-live="polite">
      <div className="rounded-[20px] border border-black/10 bg-white px-6 py-5 text-center shadow-xl">
        <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-950" />
        <p className="text-sm font-semibold text-slate-950">Finalizing module…</p>
        <p className="mt-1 text-xs text-slate-500">Your latest responses are being verified.</p>
      </div>
    </div>
  );
}

function BlockingOverlay({ note }: { note: string | null }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-white/20 bg-white p-8 text-center shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Paused by proctor</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Your timer is paused</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">{note || 'Wait for the proctor to resume your attempt. Your remaining module time is preserved.'}</p>
      </div>
    </div>
  );
}

function TerminatedScreen({ note, onExit }: { note: string | null; onExit: () => void | Promise<void> }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-[#f5f5f7] p-5">
      <div className="w-full max-w-lg space-y-4 rounded-[28px] border border-black/10 bg-white p-8 text-center shadow-sm sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-600">Session ended</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Your SAT attempt has ended</h1>
        <p className="text-slate-600">{note || 'Please contact the proctor if you need assistance.'}</p>
        <button type="button" onClick={() => void onExit()} className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800">Return</button>
      </div>
    </div>
  );
}

function CompleteScreen({ result, onExit }: { result: AssessmentResult | null; onExit: () => void | Promise<void> }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-[#f5f5f7] p-5">
      <div className="w-full max-w-lg space-y-4 rounded-[28px] border border-black/10 bg-white p-8 text-center shadow-sm sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Complete</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">SAT responses submitted</h1>
        <p className="text-slate-600">Your practice result is ready.</p>
        {result?.totalScore !== null && result?.totalScore !== undefined ? <p className="text-4xl font-semibold text-slate-900">{result.totalScore}</p> : null}
        <button type="button" onClick={() => void onExit()} className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800">Return</button>
      </div>
    </div>
  );
}
