import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useAuthoritativeDeadlineClock } from "@shared/hooks/useAuthoritativeDeadlineClock";
import type { ExamSessionRuntime } from "../../../types/domain";
import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryModule,
  AssessmentResult,
  AssessmentTimingSnapshot,
} from "../contracts/assessmentDelivery";
import { normalizeSatAnnotations, responseForQuestion } from "../domain/satResponses";
import {
  breakRemainingSeconds,
  mergeAuthoritativeTiming,
  snapshotRemainingSeconds,
  timingForAttempt,
} from "../domain/satTiming";
import { resolveSatToolCapabilities } from "../domain/satTools";
import {
  configureSatDeliveryAttempt,
  satDeliveryGateway,
} from "../infrastructure/satDeliveryGateway";
import {
  calculatorWorkspaceKey,
  clearCalculatorWorkspace,
  clearCalculatorWorkspacesForAttempt,
} from "../infrastructure/satCalculatorWorkspace";
import { clearSatReadingPreferences } from "../infrastructure/satReadingPreferencesStore";
import { createSatRunnerState, satRunnerReducer } from "../application/satRunnerReducer";
import {
  findActiveAttempt,
  findAttemptForModule,
  findCurrentModule,
  findPendingAttempt,
  matchesFinalModuleState,
  moduleForAttempt,
  sectionForModule,
  shouldAutoStartInitialModule,
  shouldAutoStartNextSectionAfterBreak,
} from "../application/satRuntimeSelectors";
import { useSatIntegrityControl } from "./useSatIntegrityControl";
import { useSatResponsePersistence } from "./useSatResponsePersistence";

export interface UseSatExamControllerOptions {
  scheduleId: string;
  attemptId: string;
  candidateId: string;
  runtimeSnapshot?: ExamSessionRuntime | null;
  liveSocketConnected?: boolean;
  attemptUpdateToken?: number;
}

export function useSatExamController({
  scheduleId,
  attemptId,
  candidateId,
  runtimeSnapshot = null,
  liveSocketConnected = false,
  attemptUpdateToken = 0,
}: UseSatExamControllerOptions) {
  const [state, dispatch] = useReducer(
    satRunnerReducer,
    createSatRunnerState(scheduleId, attemptId)
  );
  const [data, setData] = useState<AssessmentDeliveryBootstrap | null>(null);
  const [snapshotReceivedAt, setSnapshotReceivedAt] = useState(() => Date.now());
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const timeoutSubmissionKeyRef = useRef<string | null>(null);
  const initialAutoStartKeyRef = useRef<string | null>(null);
  const nextSectionAutoStartRef = useRef<{ key: string; attemptedAt: number } | null>(null);

  useEffect(() => {
    configureSatDeliveryAttempt(scheduleId, attemptId, candidateId);
  }, [attemptId, candidateId, scheduleId]);

  const handleSavedRevision = useCallback((questionId: string, revision: number) => {
    dispatch({ type: "responseSaved", questionId, revision });
  }, []);

  const persistence = useSatResponsePersistence({
    scheduleId,
    attemptId,
    gateway: satDeliveryGateway,
    onSavedRevision: handleSavedRevision,
  });
  const hydrateBootstrap = persistence.hydrateBootstrap;

  const applyPayload = useCallback(
    (payload: AssessmentDeliveryBootstrap) => {
      setData((current) => {
        const timing = mergeAuthoritativeTiming(current?.timing ?? null, payload.timing);
        return timing === payload.timing ? payload : { ...payload, timing };
      });
      setSnapshotReceivedAt(Date.now());
      setResult(payload.result);
      setError(null);
      hydrateBootstrap(payload);
    },
    [hydrateBootstrap]
  );

  const refresh = useCallback(
    async (surfaceError = false) => {
      try {
        const payload = await satDeliveryGateway.bootstrap(scheduleId, attemptId);
        applyPayload(payload);
        return payload;
      } catch (loadError) {
        if (surfaceError) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load the SAT attempt."
          );
        }
        return null;
      }
    },
    [applyPayload, attemptId, scheduleId]
  );

  useEffect(() => {
    let mounted = true;
    void satDeliveryGateway
      .bootstrap(scheduleId, attemptId)
      .then((payload) => {
        if (!mounted) return;
        applyPayload(payload);
        dispatch({ type: "bootstrapLoaded", assessmentId: payload.versionId });
      })
      .catch((loadError: unknown) => {
        if (mounted) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load the SAT attempt."
          );
        }
      });
    return () => {
      mounted = false;
    };
  }, [applyPayload, attemptId, scheduleId]);

  useEffect(() => {
    if (data?.timing.timingModel === "cohort_stage_v2") return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [data?.timing.timingModel]);

  useEffect(() => {
    if (state.phase === "complete" || state.phase === "submitting") return;
    const intervalMs = liveSocketConnected ? 20_000 : 2_000;
    const timer = window.setInterval(() => {
      void refresh(false);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [liveSocketConnected, refresh, state.phase]);

  useEffect(() => {
    if (
      !runtimeSnapshot?.revision ||
      (data?.timing.timingModel !== "cohort_stage_v2" &&
        data?.timing.timingModel !== "cohort_section_v3")
    )
      return;
    void refresh(false);
  }, [data?.timing.timingModel, refresh, runtimeSnapshot?.revision]);

  useEffect(() => {
    if (attemptUpdateToken <= 0) return;
    void refresh(false);
  }, [attemptUpdateToken, refresh]);

  useSatIntegrityControl({
    scheduleId,
    attemptId,
    expectedDeviceFingerprintHash: data?.deviceFingerprintHash ?? null,
    enforceInteractionGuards: state.phase === "module" || state.phase === "review",
  });

  const hydrateModuleResponses = useCallback(
    (payload: AssessmentDeliveryBootstrap, module: AssessmentDeliveryModule) => {
      const questionIds = new Set(module.questions.map((question) => question.examQuestionId));
      for (const response of payload.attempt.responses) {
        if (!questionIds.has(response.examQuestionId)) continue;
        const answer =
          typeof response.response === "string" || typeof response.response === "number"
            ? String(response.response)
            : "";
        dispatch({
          type: "hydrateResponse",
          revision: response.revision,
          response: {
            questionId: response.examQuestionId,
            answer,
            markedForReview: response.markedForReview,
            eliminatedOptionIds: [...response.eliminatedOptions],
            annotations: normalizeSatAnnotations(response.annotations),
          },
        });
      }
    },
    []
  );

  const startModuleFrom = useCallback(
    (payload: AssessmentDeliveryBootstrap, module: AssessmentDeliveryModule) => {
      const section = sectionForModule(payload, module.id);
      const attempt = findAttemptForModule(payload, module.id);
      if (!section || !attempt?.startedAt) return;
      const timing = timingForAttempt(payload, attempt);
      dispatch({
        type: "routeToModule",
        sectionKey: section.sectionKey === "math" ? "math" : "reading-writing",
        moduleKey: module.moduleKey,
        questionIds: module.questions.map((question) => question.examQuestionId),
        startedAt: timing.startedAt,
        endsAt: timing.endsAt,
        toolCapabilities: resolveSatToolCapabilities(module.toolPolicy),
      });
      hydrateModuleResponses(payload, module);
    },
    [hydrateModuleResponses]
  );

  useEffect(() => {
    if (!data || state.phase !== "directions") return;
    const activeAttempt = findActiveAttempt(data);
    const activeModule = moduleForAttempt(data, activeAttempt);
    if (activeAttempt?.startedAt && activeModule) startModuleFrom(data, activeModule);
  }, [data, startModuleFrom, state.phase]);

  useEffect(() => {
    if (!data) return;
    const terminalWithoutResult =
      data.proctorStatus === "terminated" ||
      data.scheduleRuntimeStatus === "completed" ||
      data.scheduleRuntimeStatus === "cancelled";
    if (!terminalWithoutResult) return;
    clearSatReadingPreferences(scheduleId, attemptId);
  }, [attemptId, data, scheduleId]);

  useEffect(() => {
    if (!data?.result || state.phase === "complete") return;
    clearCalculatorWorkspacesForAttempt(scheduleId, attemptId);
    clearSatReadingPreferences(scheduleId, attemptId);
    setResult(data.result);
    dispatch({
      type: "recover",
      state: {
        phase: "complete",
        scheduleId,
        candidateId: attemptId,
        assessmentId: data.versionId,
        resultId: data.result.id,
      },
    });
  }, [attemptId, data, scheduleId, state.phase]);

  const runtimeTiming = useMemo<AssessmentTimingSnapshot | null>(() => {
    if (!data || !runtimeSnapshot) return null;
    const timingModel = data.timing.timingModel;
    if (timingModel !== "cohort_stage_v2" && timingModel !== "cohort_section_v3") return null;
    if (runtimeSnapshot.timingModel !== timingModel) return null;
    const stageKey = runtimeSnapshot.currentSectionKey as string | null;
    const stageStatus =
      runtimeSnapshot.sections.find(
        (section) => section.sectionKey === runtimeSnapshot.currentSectionKey
      )?.status ?? null;
    return {
      authority: "cohort_runtime",
      timingModel,
      stageKey,
      stageStatus,
      serverNow: runtimeSnapshot.serverNow ?? data.timing.serverNow,
      deadlineAt: runtimeSnapshot.currentSectionDeadlineAt ?? null,
      remainingSeconds: runtimeSnapshot.currentSectionRemainingSeconds,
      runtimeRevision: runtimeSnapshot.revision ?? data.timing.runtimeRevision,
    };
  }, [data, runtimeSnapshot]);
  const effectiveTiming = useMemo(
    () => (data ? mergeAuthoritativeTiming(data.timing, runtimeTiming ?? data.timing) : null),
    [data, runtimeTiming]
  );
  const authoritativeRemainingSeconds = useAuthoritativeDeadlineClock({
    deadlineAt: effectiveTiming?.deadlineAt ?? null,
    serverNow: effectiveTiming?.serverNow ?? null,
    fallbackSeconds: effectiveTiming?.remainingSeconds ?? 0,
    running: data?.scheduleRuntimeStatus === "live" && effectiveTiming?.stageStatus === "live",
  });

  const pendingModule = useMemo(() => (data ? findCurrentModule(data) : null), [data]);
  const pendingAttempt = useMemo(
    () => (data && pendingModule ? findAttemptForModule(data, pendingModule.id) : undefined),
    [data, pendingModule]
  );
  const cohortRuntimeTiming =
    effectiveTiming?.timingModel === "cohort_stage_v2" ||
    effectiveTiming?.timingModel === "cohort_section_v3";
  const pendingBreakSeconds = data
    ? cohortRuntimeTiming
      ? effectiveTiming?.stageKey?.startsWith("sat:break:")
        ? authoritativeRemainingSeconds
        : 0
      : breakRemainingSeconds(data, pendingAttempt, snapshotReceivedAt, now)
    : 0;
  const pendingSection = data && pendingModule ? sectionForModule(data, pendingModule.id) : null;
  const pendingExpectedStageKey =
    pendingSection && pendingModule
      ? effectiveTiming?.timingModel === "cohort_section_v3"
        ? pendingSection.sectionKey
        : `${pendingSection.sectionKey}:${pendingModule.adaptiveRole === "base" ? "m1" : "m2"}`
      : null;
  const pendingStageReady =
    !cohortRuntimeTiming ||
    (effectiveTiming?.stageKey === pendingExpectedStageKey &&
      effectiveTiming?.stageStatus === "live" &&
      data?.scheduleRuntimeStatus === "live");
  const pendingSectionWaitSeconds =
    data &&
    pendingSection &&
    effectiveTiming?.timingModel === "cohort_section_v3" &&
    data.scheduleRuntimeStatus === "live" &&
    effectiveTiming.stageKey &&
    !effectiveTiming.stageKey.startsWith("sat:break:") &&
    effectiveTiming.stageKey !== pendingSection.sectionKey
      ? authoritativeRemainingSeconds
      : 0;

  const startPendingModule = useCallback(async () => {
    if (!data || !pendingModule || isStarting) return;
    setIsStarting(true);
    setError(null);
    try {
      const payload = await satDeliveryGateway.startModule(scheduleId, attemptId, {
        moduleId: pendingModule.id,
      });
      applyPayload(payload);
      const activeAttempt = findActiveAttempt(payload);
      const activeModule = moduleForAttempt(payload, activeAttempt);
      if (activeModule) startModuleFrom(payload, activeModule);
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : "The SAT module could not be started."
      );
    } finally {
      setIsStarting(false);
    }
  }, [applyPayload, attemptId, data, isStarting, pendingModule, scheduleId, startModuleFrom]);

  useEffect(() => {
    if (
      !data ||
      state.phase !== "directions" ||
      !pendingModule ||
      !shouldAutoStartInitialModule(
        data,
        pendingModule,
        pendingSection?.displayOrder ?? null,
        pendingStageReady
      )
    ) {
      return;
    }
    const autoStartKey = `${attemptId}:${pendingModule.id}`;
    if (initialAutoStartKeyRef.current === autoStartKey) return;
    initialAutoStartKeyRef.current = autoStartKey;
    void startPendingModule();
  }, [
    attemptId,
    data,
    pendingModule,
    pendingSection,
    pendingStageReady,
    startPendingModule,
    state.phase,
  ]);

  useEffect(() => {
    if (
      !data ||
      !pendingModule ||
      !["break", "directions"].includes(state.phase) ||
      isStarting ||
      !shouldAutoStartNextSectionAfterBreak(
        data,
        pendingModule,
        pendingSection?.displayOrder ?? null,
        pendingStageReady,
        pendingBreakSeconds,
        pendingSectionWaitSeconds
      )
    ) {
      return;
    }

    const autoStartKey = `${attemptId}:${pendingModule.id}:${effectiveTiming?.runtimeRevision ?? "legacy"}`;
    const lastAttempt = nextSectionAutoStartRef.current;
    const attemptedAt = Date.now();
    if (lastAttempt?.key === autoStartKey && attemptedAt - lastAttempt.attemptedAt < 2_000) {
      return;
    }

    nextSectionAutoStartRef.current = { key: autoStartKey, attemptedAt };
    void startPendingModule();
  }, [
    attemptId,
    data,
    effectiveTiming?.runtimeRevision,
    isStarting,
    now,
    pendingBreakSeconds,
    pendingModule,
    pendingSection,
    pendingSectionWaitSeconds,
    pendingStageReady,
    startPendingModule,
    state.phase,
  ]);

  const submitModule = useCallback(
    async (moduleId: string) => {
      if (isSubmitting) return;
      const submittedModuleAttemptId = data ? findAttemptForModule(data, moduleId)?.id : undefined;
      setIsSubmitting(true);
      setError(null);
      try {
        await persistence.flush();
        const next = await satDeliveryGateway.submitModule(scheduleId, attemptId, { moduleId });
        if (submittedModuleAttemptId) {
          clearCalculatorWorkspace(
            calculatorWorkspaceKey(scheduleId, attemptId, submittedModuleAttemptId)
          );
        }
        applyPayload(next);
        const nextAttempt = findPendingAttempt(next);
        const nextModule = moduleForAttempt(next, nextAttempt);
        if (!nextModule) {
          dispatch({ type: "submit" });
          const finalResult = await satDeliveryGateway.submitAssessment(scheduleId, attemptId, {
            submissionId: attemptId,
          });
          clearCalculatorWorkspacesForAttempt(scheduleId, attemptId);
          clearSatReadingPreferences(scheduleId, attemptId);
          setResult(finalResult);
          dispatch({ type: "completed", resultId: finalResult.id });
          return;
        }

        const currentSection = data ? sectionForModule(data, moduleId) : null;
        const nextSection = sectionForModule(next, nextModule.id);
        if (currentSection && nextSection && nextSection.id !== currentSection.id) {
          dispatch({
            type: "startBreak",
            nextSectionKey: nextSection.sectionKey === "math" ? "math" : "reading-writing",
            resumeAt: nextAttempt?.availableAt ?? next.serverNow,
          });
        } else {
          dispatch({ type: "showDirections" });
        }
      } catch (submitError) {
        const refreshed = await refresh(false);
        if (refreshed?.result) {
          clearCalculatorWorkspacesForAttempt(scheduleId, attemptId);
          clearSatReadingPreferences(scheduleId, attemptId);
          setResult(refreshed.result);
          dispatch({
            type: "recover",
            state: {
              phase: "complete",
              scheduleId,
              candidateId: attemptId,
              assessmentId: refreshed.versionId,
              resultId: refreshed.result.id,
            },
          });
          return;
        }

        if (refreshed) {
          const nextAttempt = findPendingAttempt(refreshed);
          const nextModule = moduleForAttempt(refreshed, nextAttempt);
          if (nextModule && nextModule.id !== moduleId) {
            if (submittedModuleAttemptId) {
              clearCalculatorWorkspace(
                calculatorWorkspaceKey(scheduleId, attemptId, submittedModuleAttemptId)
              );
            }
            dispatch({ type: "showDirections" });
            return;
          }
        }
        setError(submitError instanceof Error ? submitError.message : "Module submission failed.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [applyPayload, attemptId, data, isSubmitting, persistence, refresh, scheduleId]
  );

  const stateModule = useMemo(() => {
    if (!data || (state.phase !== "module" && state.phase !== "review")) return null;
    return (
      data.sections
        .flatMap((section) => section.modules)
        .find((candidate) => candidate.moduleKey === state.moduleKey) ?? null
    );
  }, [data, state]);

  const stateModuleAttempt = useMemo(
    () => (data && stateModule ? findAttemptForModule(data, stateModule.id) : undefined),
    [data, stateModule]
  );

  const stateSection = useMemo(() => {
    if (!data || !stateModule) return null;
    return sectionForModule(data, stateModule.id) ?? null;
  }, [data, stateModule]);

  useEffect(() => {
    if (!data || (state.phase !== "module" && state.phase !== "review") || !stateModule) return;
    for (const question of stateModule.questions) {
      const pending = persistence.pendingDrafts[question.examQuestionId];
      if (!pending) continue;
      const current = state.responses[question.examQuestionId];
      const sameDraft =
        current &&
        current.answer === pending.answer &&
        current.markedForReview === pending.markedForReview &&
        JSON.stringify(current.eliminatedOptionIds) ===
          JSON.stringify(pending.eliminatedOptionIds) &&
        JSON.stringify(current.annotations) === JSON.stringify(pending.annotations);
      const serverRevision =
        data.attempt.responses.find(
          (response) => response.examQuestionId === question.examQuestionId
        )?.revision ?? 0;
      const revision = Math.max(
        state.responseRevisions[question.examQuestionId] ?? 0,
        serverRevision
      );
      if (sameDraft && state.responseRevisions[question.examQuestionId] === revision) continue;
      dispatch({ type: "hydrateResponse", revision, response: pending });
    }
  }, [data, persistence.pendingDrafts, state, stateModule]);

  const personalModuleRemainingSeconds = stateModuleAttempt
    ? snapshotRemainingSeconds(stateModuleAttempt, snapshotReceivedAt, now)
    : 0;
  const remainingSeconds =
    effectiveTiming?.timingModel === "cohort_stage_v2"
      ? authoritativeRemainingSeconds
      : effectiveTiming?.timingModel === "cohort_section_v3"
        ? stateSection && effectiveTiming.stageKey === stateSection.sectionKey
          ? Math.min(personalModuleRemainingSeconds, authoritativeRemainingSeconds)
          : 0
        : personalModuleRemainingSeconds;

  const saveContext = useCallback(
    (interactionType: "typing" | "discrete") => {
      if (!stateModuleAttempt) return undefined;
      return {
        moduleAttemptId: stateModuleAttempt.id,
        stageKey: effectiveTiming?.stageKey ?? null,
        runtimeRevision: effectiveTiming?.runtimeRevision ?? null,
        remainingSeconds,
        interactionType,
      };
    },
    [
      effectiveTiming?.runtimeRevision,
      effectiveTiming?.stageKey,
      remainingSeconds,
      stateModuleAttempt,
    ]
  );

  useEffect(() => {
    if (
      (state.phase !== "module" && state.phase !== "review") ||
      !stateModule ||
      !stateModuleAttempt
    ) {
      return;
    }
    const key = `${stateModule.id}:${stateModuleAttempt.id}`;
    if (remainingSeconds > 0) {
      if (timeoutSubmissionKeyRef.current !== key) timeoutSubmissionKeyRef.current = null;
      return;
    }
    if (stateModuleAttempt.pausedAt || timeoutSubmissionKeyRef.current === key) return;
    timeoutSubmissionKeyRef.current = key;
    void submitModule(stateModule.id);
  }, [remainingSeconds, state.phase, stateModule, stateModuleAttempt, submitModule]);

  useEffect(() => {
    if (!data || (state.phase !== "module" && state.phase !== "review") || !stateModule) return;
    const attempt = findAttemptForModule(data, stateModule.id);
    if (attempt && matchesFinalModuleState(attempt.state)) {
      const nextAttempt = findPendingAttempt(data);
      const nextModule = moduleForAttempt(data, nextAttempt);
      if (nextModule && nextModule.id !== stateModule.id) {
        dispatch({ type: "showDirections" });
      }
    }
  }, [data, state.phase, stateModule]);

  const currentResponse = useCallback(
    (questionId: string) => {
      if (state.phase !== "module" && state.phase !== "review") return null;
      return responseForQuestion(state.responses, questionId);
    },
    [state]
  );

  const setAnswer = useCallback(
    (questionId: string, answer: string) => {
      const current = currentResponse(questionId);
      if (!current) return;
      const next = { ...current, answer };
      const question = stateModule?.questions.find(
        (candidate) => candidate.examQuestionId === questionId
      );
      const interactionType =
        question?.questionType === "student_produced_response" ? "typing" : "discrete";
      dispatch({ type: "setAnswer", questionId, value: answer });
      persistence.save(next, saveContext(interactionType));
    },
    [currentResponse, persistence, saveContext, stateModule]
  );

  const toggleReview = useCallback(
    (questionId: string) => {
      const current = currentResponse(questionId);
      if (!current) return;
      const next = { ...current, markedForReview: !current.markedForReview };
      dispatch({ type: "setReviewFlag", questionId, flagged: next.markedForReview });
      persistence.save(next, saveContext("discrete"));
    },
    [currentResponse, persistence, saveContext]
  );

  const toggleEliminatedOption = useCallback(
    (questionId: string, optionId: string) => {
      const current = currentResponse(questionId);
      if (!current) return;
      const eliminatedOptionIds = current.eliminatedOptionIds.includes(optionId)
        ? current.eliminatedOptionIds.filter((candidate) => candidate !== optionId)
        : [...current.eliminatedOptionIds, optionId];
      const next = { ...current, eliminatedOptionIds };
      dispatch({ type: "toggleEliminatedOption", questionId, optionId });
      persistence.save(next, saveContext("discrete"));
    },
    [currentResponse, persistence, saveContext]
  );

  const setAnnotationNote = useCallback(
    (questionId: string, note: string) => {
      const current = currentResponse(questionId);
      if (!current) return;
      const annotations = { version: 1 as const, note: note.slice(0, 2_000) };
      const next = { ...current, annotations };
      dispatch({ type: "setAnnotations", questionId, annotations });
      persistence.save(next, saveContext("typing"));
    },
    [currentResponse, persistence, saveContext]
  );

  const returnToQuestion = useCallback((questionIndex: number) => {
    dispatch({ type: "selectQuestion", questionIndex });
    dispatch({ type: "returnToModule" });
  }, []);

  const blocked = Boolean(
    data && (data.proctorStatus === "paused" || data.scheduleRuntimeStatus === "paused")
  );
  const warning = data?.proctorStatus === "warned" ? data.proctorNote : null;

  return {
    state,
    data,
    result,
    error,
    setError,
    isSubmitting,
    isStarting,
    pendingModule,
    pendingBreakSeconds,
    pendingSectionWaitSeconds,
    pendingStageReady,
    effectiveTiming,
    stateModule,
    stateModuleAttempt,
    stateSection,
    remainingSeconds,
    blocked,
    warning,
    persistence,
    commands: {
      startPendingModule,
      submitModule,
      setAnswer,
      toggleReview,
      toggleEliminatedOption,
      setAnnotationNote,
      selectQuestion: (questionIndex: number) =>
        dispatch({ type: "selectQuestion", questionIndex }),
      returnToQuestion,
      previousQuestion: () =>
        dispatch({
          type: "selectQuestion",
          questionIndex: state.phase === "module" ? state.questionIndex - 1 : 0,
        }),
      nextQuestion: () =>
        dispatch({
          type: "selectQuestion",
          questionIndex: state.phase === "module" ? state.questionIndex + 1 : 0,
        }),
      reviewModule: () => dispatch({ type: "reviewModule" }),
      returnToModule: () => dispatch({ type: "returnToModule" }),
      showDirections: () => dispatch({ type: "showDirections" }),
      toggleCalculator: () => dispatch({ type: "toggleTool", tool: "calculator" }),
      toggleReference: () => dispatch({ type: "toggleTool", tool: "reference_sheet" }),
      closeTool: () => dispatch({ type: "closeTool" }),
    },
  };
}
