import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./styles/exam.css";
import {
  countAnsweredQuestions,
  countQuestionSlots,
  getEnabledModules,
} from "@student/application/studentExamContentFacade";
import { Button } from "../ui/Button";
import { LoadingMark } from "../ui/LoadingMark";
import { AlertTriangle } from "lucide-react";
import { AccessibilitySettings } from "./AccessibilitySettings";
import { IeltsAccessibilitySettings } from "./IeltsAccessibilitySettings";
import { isIeltsExamType } from "./layout/studentExamTypeContext";
import { isIeltsPersonalTimingModel, isIeltsSharedScheduleTimingModel } from "../../types/domain";
import { StudentExamPhaseRenderer } from "./StudentExamPhaseRenderer";
import { StudentExamWorkspaceSession } from "./StudentExamWorkspaceSession";
import "./StudentHeader";
import "./layout/CompactStudentHeader";
import { StudentExamShell } from "./layout/StudentExamShell";
import { StudentExamViewport } from "./layout/StudentExamViewport";
import { useStudentExamViewport } from "./layout/useStudentExamViewport";
import { useStudentExamPageLock } from "./layout/useStudentExamPageLock";
import {
  useMediaQuery,
  useRootTextScale,
  useSystemTextScale,
} from "./useSystemAccessibilityPreferences";
import { useStudentFocusedControlVisibility } from "./layout/useStudentFocusedControlVisibility";
import { useStudentLayoutEnvironment } from "./layout/useStudentLayoutEnvironment";
import "./SubmitConfirmation";
import { WarningOverlay } from "./WarningOverlay";
import "./useStudentAutoSubmitBoundary";
import {
  getStudentPassageReadabilityGeometry,
  getStudentTypographyScale,
} from "./accessibilityScale";
import { StudentHighlightSelectionManagerProvider } from "./highlightSelectionManager";
import { useStudentSubmissionOrchestration } from "./useStudentSubmissionOrchestration";
import "./timeExtensionPolicy";
import { useStudentWarningVisibility } from "./useStudentWarningVisibility";
import {
  EXAM_VISIBILITY_WARNING_ACKNOWLEDGE,
  EXAM_VISIBILITY_WARNING_MESSAGE,
  EXAM_VISIBILITY_WARNING_TITLE,
} from "@student/api/examVisibilityIntegrity";
import { useStudentAttempt } from "./providers/StudentAttemptProvider";
import {
  useStudentRuntime,
  useStudentRuntimeClock,
  useStudentRuntimeSession,
} from "./providers/StudentRuntimeProvider";
import { useStudentUI } from "./providers/StudentUIProvider";
import { useKeyboardSubmitHandler } from "./providers/StudentKeyboardProvider";
import { useExamCommands } from "@student/hooks/exam-session/useExamCommands";
import { useStudentExamSessionStore } from "@student/hooks/exam-session/StudentExamSessionProvider";
import { createStudentSubmissionCommands } from "@student/application/exam-session/submissionCommands";
import {
  isRuntimeStructurallyCompleted,
  isVerifiedTerminalStudentState,
} from "./providers/verifiedTerminalState";
import { resolveObjectiveAnswerUpdate } from "./resolveObjectiveAnswerUpdate";
import { useZoomScrollAnchoring } from "./useZoomScrollAnchoring";
import { emitAnswerMutationDebugLog } from "./answerMutationDebug";
import { isStudentHighlightToolContextActive } from "./studentHighlightToolContext";
import type { StudentAnswerMutationMeta, StudentAnswerValue } from "../../types/studentAttempt";
import type { ModuleType } from "../../types";
import { ensureBrowserClientSessionIdForAttempt } from "@student/api/studentAttemptGateway";
import { useIeltsCohortReadiness } from "@student/hooks/useIeltsCohortReadiness";
import { useIeltsSectionPreparation } from "@student/hooks/useIeltsSectionPreparation";
import { useIeltsOfflineCleanup } from "@student/hooks/useIeltsOfflineCleanup";
import { IeltsSharedSaveStatus } from "@student/ui/IeltsSharedSaveStatus";
import { emitStudentObservabilityMetric } from "../../utils/studentObservability";
import {
  IELTS_FAST_TRANSITIONS,
  IELTS_PREPARATION_WINDOW_SECONDS,
  isIeltsSectionContentAvailable,
} from "@student/application/ieltsSectionPreparation";

import { StudentExamHeaderClock } from "./StudentExamHeaderClock";
import { StudentExamClockEffects } from "./StudentExamClockEffects";
import { StudentExamTimeRemaining } from "./StudentExamTimeRemaining";

function getBlockingCopy(
  reason: ReturnType<typeof useStudentRuntime>["state"]["blocking"]["reason"]
) {
  switch (reason) {
    case "cohort_paused":
      return {
        title: "Cohort paused",
        message:
          "The proctor has paused delivery. Your current section will resume when the cohort restarts.",
        badge: "Paused",
        contextLabel: "Cohort Runtime",
      };
    case "proctor_paused":
      return {
        title: "Individual session paused",
        message: "This session is paused for review. Wait for resume instructions.",
        badge: "Paused",
        contextLabel: "Proctor Review",
      };
    case "not_started":
      return {
        title: "Waiting for start",
        message: "The proctor has not started this cohort yet.",
        badge: "Locked",
        contextLabel: "Cohort Runtime",
      };
    case "waiting_for_advance":
      return {
        title: "Waiting for cohort advance",
        message:
          "The proctor is preparing the next section. Please wait for the cohort to advance.",
        badge: "Waiting",
        contextLabel: "Cohort Runtime",
      };
    case "waiting_for_runtime":
      return {
        title: "Preparing your section",
        message: "Preparing the section for the shared room timer.",
        badge: "Waiting",
        contextLabel: "Session Runtime",
      };
    case "time_expired":
      return {
        title: "Saving your answers",
        message:
          "This section is complete. Please wait while your saved work is finalized and the exam continues.",
        badge: "Time",
        contextLabel: "Authoritative Clock",
      };
    case "offline":
      return {
        title: "Connection lost",
        message:
          "Your session is paused while connectivity is unavailable. Recovery will resume after reconnection.",
        badge: "Offline",
        contextLabel: "Session Recovery",
      };
    case "heartbeat_lost":
      return {
        title: "Heartbeat lost",
        message:
          "The secure session heartbeat was interrupted. The exam remains paused until continuity is restored.",
        badge: "Review",
        contextLabel: "Integrity Hold",
      };
    case "device_mismatch":
      return {
        title: "Device review required",
        message:
          "This session no longer matches the original device continuity check. Wait for proctor review.",
        badge: "Blocked",
        contextLabel: "Integrity Hold",
      };
    case "storage_unavailable":
      return {
        title: "Answer storage unavailable",
        message:
          "Your browser cannot safely store new answers right now. Keep this tab open and contact the proctor.",
        badge: "Blocked",
        contextLabel: "Session Recovery",
      };
    default:
      return null;
  }
}

function formatRuntimeTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

interface StudentAppProps {
  showSubmitControls?: boolean | undefined;
  allowPreviewStart?: boolean | undefined;
  allowExitDuringExam?: boolean | undefined;
  onRuntimeRefresh?: (() => Promise<void>) | undefined;
}

export function StudentApp({
  showSubmitControls = true,
  allowPreviewStart = false,
  allowExitDuringExam = false,
  onRuntimeRefresh,
}: StudentAppProps) {
  void allowExitDuringExam;
  const {
    state: runtimeState,
    actions: runtimeActions,
    examState: examState,
    onExit: onExit,
  } = useStudentRuntimeSession();
  const { actions: attemptActions, state: attemptState } = useStudentAttempt();
  useIeltsOfflineCleanup({
    enabled: isIeltsSharedScheduleTimingModel(runtimeState.runtimeSnapshot?.timingModel),
    attempt: attemptState.attempt,
    pendingMutationCount: attemptState.pendingMutationCount,
    unacknowledgedEvidenceCount: attemptState.unacknowledgedEvidenceCount,
  });
  const personalTransitionClockSeconds = useStudentRuntimeClock();
  const usesPersonalIeltsTiming = isIeltsPersonalTimingModel(
    runtimeState.runtimeSnapshot?.timingModel
  );
  const sharedScheduleRoom = isIeltsSharedScheduleTimingModel(
    runtimeState.runtimeSnapshot?.timingModel
  );
  const readinessSectionKey = runtimeState.runtimeSnapshot?.currentSectionKey;
  const readinessSection = runtimeState.runtimeSnapshot?.sections.find(
    (section) => section.sectionKey === readinessSectionKey
  );
  const enabledModules = getEnabledModules(examState.config);
  const currentModuleIndex = runtimeState.currentModule
    ? enabledModules.indexOf(runtimeState.currentModule)
    : -1;
  // V2 fast transitions: one successor is prepared locally; activation waits
  // for the outgoing section's answer barrier (server eligibility is separate).
  const fastIeltsTransitions =
    IELTS_FAST_TRANSITIONS &&
    runtimeState.runtimeSnapshot?.timingModel === "ielts_cohort_personal_v2" &&
    isIeltsExamType(examState.type);
  const readinessSectionIndex = readinessSectionKey
    ? enabledModules.indexOf(readinessSectionKey as ModuleType)
    : -1;
  const outgoingSectionKey =
    readinessSectionIndex > 0 ? (enabledModules[readinessSectionIndex - 1] ?? null) : null;
  const successorSectionKey =
    currentModuleIndex >= 0 ? (enabledModules[currentModuleIndex + 1] ?? null) : null;
  const preparationStatus = useIeltsSectionPreparation({
    enabled:
      fastIeltsTransitions &&
      runtimeState.phase === "exam" &&
      Boolean(successorSectionKey) &&
      runtimeState.runtimeSnapshot?.personalSectionState === "active" &&
      typeof personalTransitionClockSeconds === "number" &&
      personalTransitionClockSeconds <= IELTS_PREPARATION_WINDOW_SECONDS,
    contextKey:
      attemptState.attempt && successorSectionKey
        ? [
            attemptState.attempt.id,
            attemptState.attempt.publishedVersionId ?? "",
            successorSectionKey,
            attemptState.attempt.controlEpoch ?? "",
            attemptState.attempt.leaseEpoch ?? "",
          ].join(":")
        : null,
    attemptId: attemptState.attempt?.id ?? null,
    contentAvailable: isIeltsSectionContentAvailable(examState, successorSectionKey),
  });
  // Preparation for the section now awaiting readiness carries over to it.
  const preparedSectionRef = useRef<{ key: string | null; ready: boolean }>({
    key: null,
    ready: false,
  });
  if (successorSectionKey && preparationStatus !== "idle") {
    preparedSectionRef.current = {
      key: successorSectionKey,
      ready: preparationStatus === "ready",
    };
  }
  // Metric: the client first observed the outgoing section's end, from the
  // clock reaching zero or from the projection moving on (whichever is first).
  const expiryEmittedRef = useRef<string | null>(null);
  const emitExpiryOnceRef = useRef((section: string | null | undefined) => {
    void section;
  });
  emitExpiryOnceRef.current = (section) => {
    const key = section ? `${attemptState.attempt?.id}:${section}` : null;
    if (!key || expiryEmittedRef.current === key) return;
    expiryEmittedRef.current = key;
    emitStudentObservabilityMetric("ielts_section_expiry", {
      reason: section,
      attemptId: attemptState.attempt?.id,
      scheduleId: attemptState.attempt?.scheduleId,
    });
  };
  const personalSectionNeedsTransitionRefresh =
    usesPersonalIeltsTiming &&
    isIeltsExamType(examState.type) &&
    runtimeState.phase === "exam" &&
    personalTransitionClockSeconds === 0 &&
    runtimeState.runtimeSnapshot?.personalSectionState === "active" &&
    runtimeState.runtimeSnapshot.currentSectionKey === runtimeState.currentModule &&
    currentModuleIndex >= 0 &&
    currentModuleIndex < enabledModules.length;

  useEffect(() => {
    if (!personalSectionNeedsTransitionRefresh || !onRuntimeRefresh) {
      return;
    }
    if (fastIeltsTransitions) emitExpiryOnceRef.current(runtimeStateRef.current.currentModule);

    let cancelled = false;
    let retryTimer: number | null = null;
    let retryDelayMs = 500;
    let failures = 0;
    const refreshAtPersonalBoundary = async () => {
      let refreshed = true;
      try {
        await onRuntimeRefresh();
      } catch {
        refreshed = false;
      }
      if (cancelled) {
        return;
      }
      if (fastIeltsTransitions) {
        // Healthy boundary refresh stays near 1s; only failures back off.
        failures = refreshed ? 0 : Math.min(failures + 1, 3);
        const delay = 1_000 * 2 ** failures * (0.9 + Math.random() * 0.2);
        retryTimer = window.setTimeout(() => {
          void refreshAtPersonalBoundary();
        }, delay);
        return;
      }
      if (!refreshed) {
        return;
      }
      retryTimer = window.setTimeout(() => {
        void refreshAtPersonalBoundary();
      }, retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, 8_000);
    };

    void refreshAtPersonalBoundary();
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [fastIeltsTransitions, onRuntimeRefresh, personalSectionNeedsTransitionRefresh]);

  const examSessionCommands = useExamCommands();
  const examSessionStore = useStudentExamSessionStore();
  const { state: uiState, actions: uiActions } = useStudentUI();
  const { registerSubmitHandler } = useKeyboardSubmitHandler();
  // HIG: IELTS follows the iPad's own Text Size and Increase Contrast
  // settings, on top of the exam's Tools preferences. ACT keeps its tuning.
  const isIeltsExam = examState.type !== "ACT";
  const systemTextScale = useSystemTextScale(isIeltsExam);
  useRootTextScale(systemTextScale);
  const prefersMoreContrast = useMediaQuery("(prefers-contrast: more)");
  const highContrast =
    uiState.accessibilitySettings.highContrast || (isIeltsExam && prefersMoreContrast);
  const layoutEnvironment = useStudentLayoutEnvironment(
    uiState.accessibilitySettings.zoom,
    getStudentTypographyScale(uiState.accessibilitySettings.fontSize).fontScale * systemTextScale
  );
  const layoutMode = layoutEnvironment.layoutMode;
  const tabletMode =
    layoutMode !== "phone" &&
    layoutMode !== "wide" &&
    (layoutEnvironment.hasTouch || layoutEnvironment.primaryPointer === "coarse");
  const autoSaveStatus =
    runtimeState.attemptSyncState === "syncing_reconnect"
      ? "syncing"
      : runtimeState.attemptSyncState === "idle"
        ? null
        : runtimeState.attemptSyncState;
  const studentTypography = useMemo(
    () => getStudentTypographyScale(uiState.accessibilitySettings.fontSize),
    [uiState.accessibilitySettings.fontSize]
  );
  const passageReadabilityGeometry = useMemo(
    () =>
      getStudentPassageReadabilityGeometry(uiState.accessibilitySettings.passageReadabilityLevel),
    [uiState.accessibilitySettings.passageReadabilityLevel]
  );
  useZoomScrollAnchoring(
    uiState.accessibilitySettings.zoom * studentTypography.fontScale * systemTextScale
  );
  const blockingCopy = useMemo(() => {
    const baseBlockingCopy = getBlockingCopy(runtimeState.blocking.reason);
    return usesPersonalIeltsTiming &&
      (runtimeState.blocking.reason === "waiting_for_runtime" ||
        runtimeState.blocking.reason === "waiting_for_advance")
      ? {
          ...baseBlockingCopy,
          title: "Preparing your section",
          message:
            "Your section starts automatically when its content, answer storage, and required audio are ready.",
          badge: "Preparing",
        }
      : baseBlockingCopy;
  }, [runtimeState.blocking.reason, usesPersonalIeltsTiming]);
  const { resetHighlightTool } = uiActions;
  const timeExtensionReason =
    typeof uiState.timeExtensionReason === "string" ? uiState.timeExtensionReason : "";
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
  // S1-C4: user zoom applies on all devices incl. tablets. The CSS `zoom`
  // property scales layout without breaking pinch-zoom (examPageZoomGuard
  // still forbids maximum-scale/user-scalable=no), so forcing 1 on tablets
  // denied low-vision users their setting with no alternative.
  const studentShellStyle = useMemo(
    () =>
      ({
        zoom: uiState.accessibilitySettings.zoom,
        ...(isIeltsExam
          ? { ["--student-exam-zoom" as string]: uiState.accessibilitySettings.zoom }
          : {}),
        fontSize: studentTypography.rootFontSize,
        lineHeight: studentTypography.lineHeight,
        ["--student-meta-font-size" as string]: studentTypography.metaFontSize,
        ["--student-chip-font-size" as string]: studentTypography.chipFontSize,
        ["--student-control-font-size" as string]: studentTypography.controlFontSize,
        ["--student-preview-font-size" as string]: studentTypography.previewFontSize,
        ["--student-passage-font-size" as string]: studentTypography.passageFontSize,
        ["--student-passage-title-font-size" as string]: studentTypography.passageTitleFontSize,
        ["--student-passage-h1-font-size" as string]: studentTypography.passageH1FontSize,
        ["--student-passage-h2-font-size" as string]: studentTypography.passageH2FontSize,
        ["--student-passage-h3-font-size" as string]: studentTypography.passageH3FontSize,
        ["--student-passage-line-height" as string]: (
          Number.parseFloat(studentTypography.passageLineHeight) *
          passageReadabilityGeometry.lineHeightFactor
        ).toFixed(2),
        ["--student-passage-measure" as string]: passageReadabilityGeometry.measure,
        ["--student-passage-prose-measure" as string]: passageReadabilityGeometry.proseMeasure,
        ["--student-question-font-size" as string]: studentTypography.questionFontSize,
        ["--student-question-line-height" as string]: studentTypography.questionLineHeight,
        ["--student-answer-font-size" as string]: studentTypography.answerFontSize,
        ["--student-answer-line-height" as string]: studentTypography.answerLineHeight,
        ["--student-writing-editor-font-size" as string]: studentTypography.writingEditorFontSize,
        ["--student-writing-editor-line-height" as string]:
          studentTypography.writingEditorLineHeight,
        ["--student-writing-prompt-font-size" as string]: studentTypography.writingPromptFontSize,
        ["--student-writing-prompt-line-height" as string]:
          studentTypography.writingPromptLineHeight,
      }) as React.CSSProperties,
    [isIeltsExam, passageReadabilityGeometry, studentTypography, uiState.accessibilitySettings.zoom]
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
  const [warningMessage, setWarningMessage] = useState("");
  const [warningSeverity, setWarningSeverity] = useState<"medium" | "high" | "critical">("medium");
  const blockingOverlayRef = useRef<HTMLDivElement | null>(null);
  const durabilityLeaseOverlayRef = useRef<HTMLDivElement | null>(null);
  const finalSubmitOverlayRef = useRef<HTMLDivElement | null>(null);
  const [leaseTakeoverPending, setLeaseTakeoverPending] = useState(false);
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
        (violation) => violation.type === "PROCTOR_WARNING"
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
  const finalModule = useMemo(() => {
    const enabledModules = getEnabledModules(examState.config);
    return enabledModules[enabledModules.length - 1] ?? null;
  }, [examState.config]);

  const verifiedTerminalState = useMemo(
    () =>
      isVerifiedTerminalStudentState({
        attempt: attemptState.attempt,
        runtimeSnapshot: runtimeState.runtimeSnapshot,
      }),
    [attemptState.attempt, runtimeState.runtimeSnapshot]
  );
  const shouldRenderPostExam =
    verifiedTerminalState !== "not_terminal" ||
    (!runtimeState.runtimeBacked && runtimeState.phase === "post-exam");
  const effectivePhase =
    runtimeState.phase === "post-exam" && !shouldRenderPostExam ? "exam" : runtimeState.phase;
  const [choiceEliminationEnabled, setChoiceEliminationEnabled] = useState(false);
  const choiceEliminationAvailable =
    examState.type === "ACT" &&
    runtimeState.currentModule === "science" &&
    effectivePhase === "exam";
  const toggleChoiceElimination = useCallback(() => {
    if (!choiceEliminationAvailable) {
      return;
    }

    setChoiceEliminationEnabled((enabled) => !enabled);
  }, [choiceEliminationAvailable]);
  const personalFinalSectionComplete =
    usesPersonalIeltsTiming &&
    isIeltsExamType(examState.type) &&
    finalModule !== null &&
    runtimeState.runtimeSnapshot?.currentSectionKey === finalModule &&
    runtimeState.runtimeSnapshot.personalSectionState === "completed";
  // The shared room can finish while a delayed candidate still has personal
  // sections to complete. IELTS submission follows that candidate's final
  // timeline, including when the shared runtime is naturally complete.
  const runtimeCompletionVerified =
    isRuntimeStructurallyCompleted(runtimeState.runtimeSnapshot) || personalFinalSectionComplete;
  const submissionRuntimeStatus = personalFinalSectionComplete
    ? "completed"
    : runtimeState.runtimeStatus;
  const runtimeSubmissionPending =
    runtimeState.runtimeBacked &&
    submissionRuntimeStatus === "completed" &&
    runtimeCompletionVerified &&
    verifiedTerminalState === "not_terminal";
  const examViewportActive = effectivePhase === "exam";
  const examViewport = useStudentExamViewport(examViewportActive);
  useStudentExamPageLock(examViewportActive);
  useStudentFocusedControlVisibility(examViewportActive && examViewport.keyboardOpen);

  useEffect(() => {
    latestAnswersRef.current = { ...latestAnswersRef.current, ...attemptAnswers };
    liveObjectiveAnswersRef.current = { ...liveObjectiveAnswersRef.current, ...attemptAnswers };
  }, [attemptAnswers]);

  useEffect(() => {
    liveWritingAnswersRef.current = { ...liveWritingAnswersRef.current, ...attemptWritingAnswers };
  }, [attemptWritingAnswers]);

  // The V2 engine owns response durability. The exam-session store remains a
  // presentation model for the shared IELTS workspace and is hydrated from the
  // authoritative V2-visible attempt state after recovery/acknowledgements.
  useEffect(() => {
    // Single batched write (React 19 auto-batches, one setState) with replace
    // semantics: removed keys disappear instead of lingering from earlier hydrations.
    examSessionStore.setState((state) => ({
      attempt: {
        ...state.attempt,
        answers: { ...attemptAnswers },
        writingAnswers: { ...attemptWritingAnswers },
      },
    }));
    for (const [questionId, flagged] of Object.entries(attemptFlags)) {
      const current = examSessionStore.getState().attempt.flags[questionId] ?? false;
      if (current !== flagged) {
        examSessionCommandsRef.current.toggleFlag(questionId);
      }
    }
  }, [attemptAnswers, attemptFlags, attemptWritingAnswers, examSessionStore]);

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
          flushPending: () => attemptActions.flushPending({ boundary: true }),
          submit: attemptActions.submitAttempt,
          submitAfterBarrier: attemptActions.submitAttemptAfterBarrier,
        },
      }),
    [attemptActions, commitWritingDraft, examSessionStore, reconcileLiveAnswerCacheNow]
  );

  const {
    boundarySave,
    confirmBoundarySaved,
    finalSubmitStatus,
    flushAndSubmitCurrentModuleWithRetry,
    retryFinalSubmit,
    moduleSubmitStatus,
    moduleSubmitError,
    retryModuleSubmit,
  } = useStudentSubmissionOrchestration({
    runtimeState: {
      runtimeBacked: runtimeState.runtimeBacked,
      runtimeStatus: submissionRuntimeStatus,
      currentModule: runtimeState.currentModule,
    },
    runtimeStateRef,
    attemptId: attemptState.attemptId,
    runtimeCompletionVerified,
    shouldRenderPostExam: shouldRenderPostExam && !runtimeSubmissionPending,
    isFinalModule: (module) => module === finalModule,
    reconcileLiveAnswerCacheNow,
    commitWritingDraft,
    attemptActions: {
      flushPending: () => attemptActions.flushPending({ boundary: true }),
      submitAttempt: attemptActions.submitAttempt,
      submitAttemptAfterBarrier: attemptActions.submitAttemptAfterBarrier,
    },
    runtimeActions: {
      transitionBlocking: runtimeActions.transitionBlocking,
      submitModule: runtimeActions.submitModule,
    },
    submissionCommands,
  });
  const readinessPending =
    Boolean(onRuntimeRefresh) &&
    examState.type !== "ACT" &&
    runtimeState.runtimeBacked &&
    runtimeState.phase === "exam" &&
    Boolean(readinessSection) &&
    (usesPersonalIeltsTiming
      ? runtimeState.currentModule !== runtimeState.runtimeSnapshot?.currentSectionKey ||
        (runtimeState.runtimeSnapshot?.personalSectionState !== "active" &&
          runtimeState.runtimeSnapshot?.personalSectionState !== "completed")
      : Boolean(
          readinessSection &&
          !readinessSection.actualStartAt &&
          readinessSection.status !== "completed"
        ));
  // Activation needs this client's evidence that the outgoing section settled;
  // after a reload that evidence is re-proved by rerunning the barrier.
  const readinessActivationAllowed =
    !outgoingSectionKey ||
    (boundarySave?.sectionKey === outgoingSectionKey && boundarySave.status === "saved");
  // A module submit can end without settling (e.g. the module already moved),
  // so any unsettled evidence for the outgoing section is re-proved here.
  const outgoingBoundarySettled =
    boundarySave?.sectionKey === outgoingSectionKey &&
    (boundarySave.status === "saved" || boundarySave.status === "attention");
  const needsBoundaryConfirmation =
    fastIeltsTransitions &&
    readinessPending &&
    Boolean(outgoingSectionKey) &&
    !outgoingBoundarySettled &&
    moduleSubmitStatus !== "submitting";
  // The orchestrator's callbacks change identity every render; key the
  // effect on the condition only so it cannot rerun on each render.
  const confirmBoundarySavedRef = useRef(confirmBoundarySaved);
  confirmBoundarySavedRef.current = confirmBoundarySaved;
  useEffect(() => {
    if (needsBoundaryConfirmation && outgoingSectionKey) {
      void confirmBoundarySavedRef.current(outgoingSectionKey);
    }
  }, [needsBoundaryConfirmation, outgoingSectionKey]);
  const readinessError = useIeltsCohortReadiness({
    scheduleId: attemptState.attempt?.scheduleId,
    attemptId: attemptState.attempt?.id ?? null,
    clientSessionId: attemptState.attempt
      ? ensureBrowserClientSessionIdForAttempt(attemptState.attempt)
      : null,
    sectionKey: readinessSectionKey ?? null,
    contentAvailable: isIeltsSectionContentAvailable(examState, readinessSectionKey),
    audioRequired: examState.config.sections.listening.audioPlaybackEnabled ?? true,
    pending: readinessPending,
    refreshRuntime: onRuntimeRefresh,
    sharedClock: !usesPersonalIeltsTiming,
    fastRetry: fastIeltsTransitions,
    activationAllowed: !fastIeltsTransitions || readinessActivationAllowed,
    storagePrepared:
      fastIeltsTransitions &&
      preparedSectionRef.current.key === readinessSectionKey &&
      preparedSectionRef.current.ready,
  });
  // Metric: first frame painted after the server confirmed the activation.
  const transitionSectionRef = useRef<string | null>(null);
  const personalSectionState = runtimeState.runtimeSnapshot?.personalSectionState;
  useEffect(() => {
    if (!fastIeltsTransitions) return;
    if (readinessPending) {
      transitionSectionRef.current = readinessSectionKey ?? null;
      emitExpiryOnceRef.current(outgoingSectionKey);
      return;
    }
    const section = transitionSectionRef.current;
    if (!section || personalSectionState !== "active") return;
    transitionSectionRef.current = null;
    requestAnimationFrame(() => {
      emitStudentObservabilityMetric("ielts_section_first_usable_frame", {
        reason: section,
        attemptId: attemptState.attempt?.id,
        scheduleId: attemptState.attempt?.scheduleId,
      });
    });
  }, [
    attemptState.attempt?.id,
    attemptState.attempt?.scheduleId,
    fastIeltsTransitions,
    outgoingSectionKey,
    personalSectionState,
    readinessPending,
    readinessSectionKey,
  ]);
  const boundarySaveNeedsAttention =
    fastIeltsTransitions &&
    readinessPending &&
    boundarySave?.sectionKey === outgoingSectionKey &&
    boundarySave?.status === "attention";
  const readinessErrorIsFinal = readinessError?.startsWith("Could not start") ?? false;
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
      finalSubmitIdle: finalSubmitStatus === "idle",
    });

    if (!isHighlightCapableContext && uiState.accessibilitySettings.highlightToolMode !== "off") {
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
    if (!choiceEliminationAvailable) {
      setChoiceEliminationEnabled(false);
    }
  }, [choiceEliminationAvailable]);

  useEffect(() => {
    if (runtimeState.blocking.active && blockingCopy) {
      blockingOverlayRef.current?.focus();
    }
  }, [blockingCopy, runtimeState.blocking.active]);

  useEffect(() => {
    if (attemptState.durabilityLeaseConflict) {
      durabilityLeaseOverlayRef.current?.focus();
    }
  }, [attemptState.durabilityLeaseConflict]);

  useEffect(() => {
    if (
      runtimeState.runtimeBacked &&
      submissionRuntimeStatus === "completed" &&
      runtimeCompletionVerified &&
      finalSubmitStatus !== "idle"
    ) {
      finalSubmitOverlayRef.current?.focus();
    }
  }, [
    finalSubmitStatus,
    runtimeCompletionVerified,
    runtimeState.runtimeBacked,
    submissionRuntimeStatus,
  ]);

  useEffect(() => {
    if (!latestPendingWarning) {
      setWarningOpen(false);
      return;
    }

    setWarningMessage(latestPendingWarning.description);
    setWarningSeverity(
      latestPendingWarning.severity === "low" ? "medium" : latestPendingWarning.severity
    );
    setWarningOpen(true);
  }, [latestPendingWarning]);

  const {
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

  const [timeExtensionNotice, setTimeExtensionNotice] = useState<string | null>(null);
  const handleTimeExtensionRequest = () => {
    if (!timeExtensionReason.trim()) return;
    if (runtimeState.runtimeBacked) {
      // Runtime-backed sessions own the authoritative clock; a local no-op
      // must still give feedback instead of silently doing nothing.
      setTimeExtensionNotice("Time extensions are managed by your proctor for this session.");
      return;
    }
    const nextTimeRemaining = runtimeState.timeRemaining + 300;
    uiActions.grantTimeExtension(5);
    // Apply to the authoritative stores (runtime + exam-session snapshot).
    runtimeActions.setTimeRemaining(nextTimeRemaining);
    examSessionStore.setState((state) => ({
      runtime: { ...state.runtime, displayTimeRemaining: nextTimeRemaining },
    }));
    setTimeExtensionNotice("5 extra minutes added.");
  };

  const answeredCount = countAnsweredQuestions(runtimeState.allQuestions, attemptAnswers);
  const totalQuestions = countQuestionSlots(runtimeState.allQuestions);
  const unansweredSubmissionPolicy =
    examState.config.progression.unansweredSubmissionPolicy ?? "confirm";
  const submitRequiresConfirmation =
    effectivePhase === "exam" &&
    (runtimeState.currentModule === "reading" ||
      runtimeState.currentModule === "listening" ||
      runtimeState.currentModule === "science") &&
    totalQuestions > 0 &&
    answeredCount < totalQuestions &&
    unansweredSubmissionPolicy !== "allow";

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
      if (
        runtimeStateRef.current.blocking.reason === "storage_unavailable" ||
        attemptState.durabilityLeaseConflict
      ) {
        return;
      }
      const currentValue = latestAnswersRef.current[questionId];
      const resolvedAnswer = resolveObjectiveAnswerUpdate(currentValue, answer, meta);
      emitAnswerMutationDebugLog("StudentApp.handleAnswerChange", {
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
    [attemptState.durabilityLeaseConflict]
  );

  const handleFlagToggle = useCallback(
    (questionId: string) => {
      if (
        runtimeStateRef.current.blocking.reason === "storage_unavailable" ||
        attemptState.durabilityLeaseConflict
      ) {
        return;
      }
      const nextFlagged = !attemptFlagsRef.current[questionId];
      examSessionCommandsRef.current.toggleFlag(questionId);
      attemptActionsRef.current.persistFlag(questionId, nextFlagged);
    },
    [attemptState.durabilityLeaseConflict]
  );

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

  const handleWritingChange = useCallback(
    (taskId: string, text: string) => {
      if (
        runtimeStateRef.current.blocking.reason === "storage_unavailable" ||
        attemptState.durabilityLeaseConflict
      ) {
        return;
      }
      liveWritingAnswersRef.current = {
        ...liveWritingAnswersRef.current,
        [taskId]: text,
      };
      examSessionCommandsRef.current.setWritingAnswer(taskId, text);
      attemptActionsRef.current.persistWritingAnswer(taskId, text);
    },
    [attemptState.durabilityLeaseConflict]
  );

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
    runtimeState.currentModule === "reading" ||
    runtimeState.currentModule === "listening" ||
    runtimeState.currentModule === "writing" ||
    runtimeState.currentModule === "science";

  const handleDurabilityLeaseTakeover = useCallback(async () => {
    if (leaseTakeoverPending) return;
    setLeaseTakeoverPending(true);
    try {
      await attemptActions.takeOverDurabilityLease();
    } finally {
      setLeaseTakeoverPending(false);
    }
  }, [attemptActions, leaseTakeoverPending]);

  const durabilityLeaseOverlay = attemptState.durabilityLeaseConflict ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm p-4">
      <div
        ref={durabilityLeaseOverlayRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="durability-lease-overlay-title"
        className="max-w-md w-full bg-white rounded-lg border border-gray-200 shadow-xl p-6 md:p-8 text-center"
      >
        <p className="text-[length:var(--student-meta-font-size)] font-semibold uppercase tracking-wide text-gray-500 mb-3">
          Session recovery
        </p>
        <h2 id="durability-lease-overlay-title" className="text-2xl font-black text-gray-900 mb-3">
          This session is open in another tab
        </h2>
        <p className="text-sm text-gray-700 leading-6">
          New answers are paused to protect your saved work. Take over this session here if this is
          the tab you want to continue using.
        </p>
        <Button
          variant="primary"
          onClick={() => void handleDurabilityLeaseTakeover()}
          disabled={leaseTakeoverPending}
          className="mt-6 h-11 w-full text-base font-semibold"
        >
          {leaseTakeoverPending ? "Taking over…" : "Take over this session"}
        </Button>
      </div>
    </div>
  ) : null;

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
          <h2 id="blocking-overlay-title" className="text-2xl font-black text-gray-900 mb-3">
            {readinessErrorIsFinal && usesPersonalIeltsTiming
              ? "Could not start"
              : blockingCopy.title}
          </h2>
          <p className="text-sm text-gray-700 leading-6">
            {runtimeState.proctorNote ??
              (usesPersonalIeltsTiming &&
              ["waiting_for_runtime", "waiting_for_advance"].includes(
                runtimeState.blocking.reason ?? ""
              )
                ? boundarySaveNeedsAttention
                  ? "We could not confirm that your answers from the previous section were saved. Your next section has not started. Stay on this page and retry, or ask the proctor for help."
                  : readinessError
                : null) ??
              (runtimeState.blocking.reason === "time_expired" &&
              moduleSubmitStatus === "submitting"
                ? "Saving your answers now. Keep this page open; it will continue automatically when they are saved."
                : runtimeState.blocking.reason === "time_expired" && moduleSubmitStatus === "failed"
                  ? (moduleSubmitError ??
                    "We could not confirm that your answers were saved. Please retry.")
                  : blockingCopy.message)}
          </p>
          {(runtimeState.blocking.reason === "time_expired" && moduleSubmitStatus !== "failed") ||
          ((!readinessError ||
            !usesPersonalIeltsTiming ||
            (fastIeltsTransitions && !readinessActivationAllowed && !boundarySaveNeedsAttention)) &&
            (runtimeState.blocking.reason === "waiting_for_runtime" ||
              runtimeState.blocking.reason === "waiting_for_advance")) ? (
            <div
              role="status"
              aria-label="Loading section"
              className="mt-6 flex items-center justify-center gap-3 text-sm text-gray-700"
            >
              <LoadingMark className="bg-gray-600" />
              <span>Loading…</span>
            </div>
          ) : (
            <div className="mt-6 flex items-center justify-center gap-3">
              <div className="px-3 py-1 rounded-sm bg-gray-50 border border-gray-100 text-xs font-bold uppercase tracking-widest text-gray-700">
                Remaining {formatRuntimeTime(runtimeState.blocking.timeRemaining)}
              </div>
              <div className="px-3 py-1 rounded-sm bg-amber-50 border border-amber-700 text-xs font-bold uppercase tracking-widest text-amber-900">
                {blockingCopy.badge}
              </div>
            </div>
          )}
          {runtimeState.blocking.reason === "time_expired" && moduleSubmitStatus === "failed" ? (
            <Button
              variant="primary"
              onClick={() =>
                void retryModuleSubmit(
                  `${runtimeState.runtimeBacked ? "runtime" : "self"}:${runtimeState.currentModule}`
                )
              }
              className="mt-6 h-11 text-base font-semibold"
            >
              Retry saving answers
            </Button>
          ) : null}
          {boundarySaveNeedsAttention && outgoingSectionKey ? (
            <Button
              variant="primary"
              onClick={() => void confirmBoundarySaved(outgoingSectionKey)}
              className="mt-6 h-11 text-base font-semibold"
            >
              Retry saving answers
            </Button>
          ) : null}
        </div>
      </div>
    ) : null;

  const finalSubmitOverlay =
    runtimeState.runtimeBacked &&
    runtimeState.runtimeStatus === "completed" &&
    runtimeCompletionVerified &&
    verifiedTerminalState === "not_terminal" &&
    finalSubmitStatus !== "idle" ? (
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
          <h2 id="final-submit-overlay-title" className="text-2xl font-black text-gray-900 mb-3">
            Submitting your exam
          </h2>
          <p className="text-sm text-gray-700 leading-6">
            {finalSubmitStatus === "failed"
              ? "We could not confirm submission yet. Stay on this page and check your connection."
              : "Please keep this page open while we finalize your submission."}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <div className="px-3 py-1 rounded-sm bg-gray-50 border border-gray-100 text-xs font-bold uppercase tracking-widest text-gray-700">
              {finalSubmitStatus === "submitting"
                ? "Submitting"
                : finalSubmitStatus === "retrying"
                  ? "Retrying"
                  : "Needs attention"}
            </div>
            <div className="px-3 py-1 rounded-sm bg-amber-50 border border-amber-700 text-xs font-bold uppercase tracking-widest text-amber-900">
              Do not close
            </div>
          </div>
          {finalSubmitStatus === "failed" ? (
            <div className="mt-6 flex flex-col items-stretch gap-2">
              <Button
                variant="primary"
                onClick={retryFinalSubmit}
                className="h-11 text-base font-semibold"
              >
                Retry Submission
              </Button>
              <p className="text-xs text-gray-500 leading-5">
                Your answers are safe on this device. If submission keeps failing, contact your
                proctor.
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
        <AlertTriangle
          size={16}
          className="text-amber-700 mt-0.5 flex-shrink-0"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">Some answers could not be saved</p>
          <p className="mt-0.5 text-xs leading-5 text-amber-800">
            {droppedMutations.count} change{droppedMutations.count === 1 ? "" : "s"}{" "}
            {droppedMutations.count === 1 ? "was" : "were"} not recorded. Check with your proctor if
            you think an answer is missing.
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

  if (shouldRenderPostExam || effectivePhase !== "exam") {
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

  const AccessibilitySheet = isIeltsExamType(examState.type)
    ? IeltsAccessibilitySettings
    : AccessibilitySettings;

  return (
    <StudentExamShell
      layoutMode={layoutMode}
      examType={examState.type}
      highContrast={highContrast}
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
          isFinalModule={(module) => module === finalModule}
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
      {layoutMode === "compact" || layoutMode === "phone" ? (
        <StudentExamHeaderClock
          compact={true}
          examType={examState.type}
          moduleLabel={`${runtimeState.currentModule.charAt(0).toUpperCase()}${runtimeState.currentModule.slice(1)}`}
          testTakerId={attemptState.attempt?.candidateId ?? undefined}
          autoSaveStatus={autoSaveStatus}
          highlightEnabled={highlightEnabled}
          highlightToolMode={uiState.accessibilitySettings.highlightToolMode}
          highlightColor={highlightColor}
          onToggleHighlightMode={uiActions.toggleHighlightMode}
          onSelectHighlightColor={uiActions.setHighlightColor}
          onSelectEraseMode={uiActions.toggleEraseMode}
          choiceEliminationAvailable={choiceEliminationAvailable}
          choiceEliminationEnabled={choiceEliminationEnabled}
          onToggleChoiceElimination={toggleChoiceElimination}
          onOpenAccessibility={openAccessibility}
          onOpenNavigator={showNavigatorForModule ? openNavigator : undefined}
        />
      ) : (
        <StudentExamHeaderClock
          compact={false}
          examType={examState.type}
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
          choiceEliminationAvailable={choiceEliminationAvailable}
          choiceEliminationEnabled={choiceEliminationEnabled}
          onToggleChoiceElimination={toggleChoiceElimination}
          tabletMode={tabletMode}
          onOpenAccessibility={openAccessibility}
          onOpenNavigator={showNavigatorForModule ? openNavigator : undefined}
          isExamActive={effectivePhase === "exam"}
        />
      )}
      {sharedScheduleRoom && effectivePhase === 'exam' ? (
        <IeltsSharedSaveStatus
          status={autoSaveStatus}
          needsReview={attemptState.quarantinedCount > 0}
        />
      ) : null}
      <StudentExamViewport>
        <StudentHighlightSelectionManagerProvider>
          <StudentExamWorkspaceSession
            examState={examState}
 listeningCheckpointAuthorization={attemptState.attempt ? {scheduleId:attemptState.attempt.scheduleId,attemptId:attemptState.attempt.id} : undefined}
            actMediaAuthorization={
              attemptState.attempt
                ? {
                    scheduleId: attemptState.attempt.scheduleId,
                    attemptId: attemptState.attemptId ?? attemptState.attempt.id,
                  }
                : undefined
            }
            // P2.5: per-attempt sessionStorage namespace for split ratio + tab
            // persistence. A title is a display value, not an identifier; the
            // attempt/version/module identity scopes candidate view state.
            // Preview (no attempt ID) falls back to a display-only key so
            // preview state never merges with live attempts.
            persistenceKeyBase={
              attemptState.attemptId
                ? `student-workspace:${attemptState.attemptId}:${attemptState.attempt?.publishedVersionId ?? "live"}:${runtimeState.currentModule}`
                : `student-workspace:preview:${examState.title}`
            }
            allQuestions={runtimeState.allQuestions}
            tabletMode={tabletMode}
            layoutMode={layoutMode}
            showSubmitControls={showSubmitControls}
            contentZoom={uiState.accessibilitySettings.zoom}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
            choiceEliminationEnabled={choiceEliminationEnabled}
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
      {durabilityLeaseOverlay}
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
            "Screenshot attempt detected. The exam screen has been hidden. Acknowledge to continue."
          }
          showCountdown={false}
          onAcknowledge={() => {
            acknowledgeScreenshot();
          }}
        />
      ) : null}
      {/*
        Integrity warning, NOT a progression warning: `progression.showWarnings`
        is an exam-authoring preference about general messaging and must never
        suppress a security hold. `security.tabSwitchRule === 'warn'` already
        gates this through `shouldShowTabSwitchWarning`, so an author who asked
        for a warning always gets one. No countdown and no auto-dismiss: the
        student leaves the hold only by acknowledging it.
      */}
      <WarningOverlay
        isOpen={shouldShowTabSwitchWarning}
        severity={tabSwitchSeverity}
        title={EXAM_VISIBILITY_WARNING_TITLE}
        message={EXAM_VISIBILITY_WARNING_MESSAGE}
        showCountdown={false}
        actionButton={{
          label: EXAM_VISIBILITY_WARNING_ACKNOWLEDGE,
          onClick: acknowledgeTabSwitch,
        }}
        onAcknowledge={acknowledgeTabSwitch}
      />
      {examState.config.progression.showWarnings ? (
        <WarningOverlay
          isOpen={shouldShowTranslationWarning}
          severity="medium"
          message={
            latestTranslationViolation?.description ??
            "Translation tools detected. Please disable translation and continue in the original language."
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
            "Multiple screens detected. Please disconnect additional displays to continue."
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
        {timeExtensionNotice ? (
          <p role="status" className="mb-4 text-sm font-semibold text-gray-700">
            {timeExtensionNotice}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setTimeExtensionNotice(null);
              uiActions.setShowTimeExtensionRequest(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleTimeExtensionRequest}
            disabled={!timeExtensionReason.trim()}
          >
            Request +5 Minutes
          </Button>
        </div>
      </dialog>
      <AccessibilitySheet
        isOpen={uiState.showAccessibility}
        onClose={() => uiActions.setShowAccessibility(false)}
        fontSize={uiState.accessibilitySettings.fontSize}
        highContrast={uiState.accessibilitySettings.highContrast}
        systemHighContrast={isIeltsExam && prefersMoreContrast}
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
