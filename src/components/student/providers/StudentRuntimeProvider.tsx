import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useReducer,
  type ReactNode,
} from 'react';
import {
  getEnabledModules,
  getFirstQuestionIdForModule,
  getStudentQuestionsForModule,
  type StudentQuestionDescriptor,
} from '@services/examAdapterService';
import type { ExamState, ModuleType, Violation, ViolationSeverity, QuestionAnswer } from '../../../types';
import type { ExamSessionRuntime, RuntimeStatus } from '../../../types/domain';
import type {
  AttemptSyncState,
  StudentAnswerValue,
  StudentAttempt,
} from '../../../types/studentAttempt';

export type ExamPhase = 'pre-check' | 'lobby' | 'exam' | 'post-exam';
export type StudentAnswer = QuestionAnswer;
export type BlockingReason =
  | 'cohort_paused'
  | 'proctor_paused'
  | 'not_started'
  | 'waiting_for_runtime'
  | 'waiting_for_advance'
  | 'offline'
  | 'syncing_reconnect'
  | 'heartbeat_lost'
  | 'device_mismatch'
  | null;

interface RuntimeReducerState {
  phase: ExamPhase;
  currentModule: ModuleType;
  currentQuestionId: string | null;
  timeRemaining: number;
  elapsedTime: number;
  answers: Record<string, StudentAnswer | undefined>;
  writingAnswers: Record<string, string>;
  flags: Record<string, boolean>;
  waitingForCohortAdvance: boolean;
  violations: Violation[];
  fullscreenViolationCount: number;
  proctorStatus: StudentAttempt['proctorStatus'];
  proctorNote: string | null;
  blockingReasonOverride: Exclude<
    BlockingReason,
    'cohort_paused' | 'proctor_paused' | 'not_started' | 'waiting_for_runtime' | 'waiting_for_advance' | null
  > | null;
  attemptSyncState: AttemptSyncState;
}

interface RuntimeBlockingState {
  active: boolean;
  reason: BlockingReason;
  runtimeStatus: RuntimeStatus | null;
  timeRemaining: number;
}

interface RuntimeState extends RuntimeReducerState {
  allQuestions: StudentQuestionDescriptor[];
  blocking: RuntimeBlockingState;
  displayTimeRemaining: number | undefined;
  runtimeBacked: boolean;
  runtimeStatus: RuntimeStatus | null;
  submitRequiresConfirmation: boolean;
}

interface RuntimeActions {
  setPhase: (phase: ExamPhase) => void;
  setCurrentModule: (module: ModuleType) => void;
  setCurrentQuestionId: (id: string | null) => void;
  setTimeRemaining: (time: number) => void;
  resetElapsedTime: () => void;
  setAnswer: (questionId: string, answer: StudentAnswer) => void;
  setWritingAnswer: (taskId: string, text: string) => void;
  toggleFlag: (questionId: string) => void;
  submitModule: () => void;
  startExam: () => void;
  addViolation: (type: string, severity: ViolationSeverity, description: string) => void;
  clearViolations: () => void;
  terminateExam: () => void;
  setBlockingReason: (reason: RuntimeReducerState['blockingReasonOverride']) => void;
  setAttemptSyncState: (state: AttemptSyncState) => void;
}

interface RuntimeContextValue {
  state: RuntimeState;
  actions: RuntimeActions;
  examState: ExamState;
  onExit: () => void;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

interface StudentRuntimeProviderProps {
  children: ReactNode;
  state: ExamState;
  onExit: () => void;
  runtimeBacked?: boolean;
  runtimeSnapshot?: ExamSessionRuntime | null;
  attemptSnapshot?: StudentAttempt | null;
}

type RuntimeAction =
  | {
      type: 'hydrate_runtime';
      nextModule: ModuleType;
      nextQuestionId: string | null;
      snapshot: ExamSessionRuntime | null;
    }
  | { type: 'hydrate_attempt'; snapshot: StudentAttempt }
  | { type: 'set_phase'; phase: ExamPhase }
  | { type: 'set_current_module'; module: ModuleType; firstQuestionId: string | null }
  | { type: 'set_current_question_id'; id: string | null }
  | { type: 'set_time_remaining'; time: number }
  | { type: 'reset_elapsed_time' }
  | { type: 'tick' }
  | { type: 'set_answer'; questionId: string; answer: StudentAnswer }
  | { type: 'set_writing_answer'; taskId: string; text: string }
  | { type: 'toggle_flag'; questionId: string }
  | { type: 'start_exam'; firstModule: ModuleType; firstQuestionId: string | null; durationSeconds: number }
  | {
      type: 'submit_module';
      runtimeBacked: boolean;
      runtimeStatus: RuntimeStatus | null;
      nextModule: ModuleType | null;
      nextQuestionId: string | null;
      nextDurationSeconds: number;
    }
  | { type: 'add_violation'; violationType: string; severity: ViolationSeverity; description: string }
  | { type: 'clear_violations' }
  | { type: 'terminate_exam' }
  | {
      type: 'set_blocking_reason';
      reason: RuntimeReducerState['blockingReasonOverride'];
    }
  | { type: 'set_attempt_sync_state'; state: AttemptSyncState };

function countFullscreenViolations(violations: Violation[]) {
  return violations.filter((violation) => violation.type === 'FULLSCREEN_EXIT').length;
}

function deriveBlockingState(
  runtimeBacked: boolean,
  runtimeSnapshot: ExamSessionRuntime | null,
  waitingForCohortAdvance: boolean,
  proctorStatus: StudentAttempt['proctorStatus'],
  blockingReasonOverride: RuntimeReducerState['blockingReasonOverride'],
  fallbackTimeRemaining: number,
): RuntimeBlockingState {
  const runtimeStatus = runtimeBacked ? runtimeSnapshot?.status ?? 'not_started' : null;
  const timeRemaining = runtimeSnapshot?.currentSectionRemainingSeconds ?? fallbackTimeRemaining;

  if (blockingReasonOverride) {
    return {
      active: true,
      reason: blockingReasonOverride,
      runtimeStatus,
      timeRemaining,
    };
  }

  if (proctorStatus === 'paused') {
    return {
      active: true,
      reason: 'proctor_paused',
      runtimeStatus,
      timeRemaining,
    };
  }

  if (!runtimeBacked) {
    return {
      active: false,
      reason: null,
      runtimeStatus: null,
      timeRemaining: fallbackTimeRemaining,
    };
  }

  const activeSection = runtimeSnapshot?.currentSectionKey
    ? runtimeSnapshot.sections.find(
        (section) => section.sectionKey === runtimeSnapshot.currentSectionKey,
      )
    : null;

  if (runtimeStatus === 'paused' || activeSection?.status === 'paused') {
    return {
      active: true,
      reason: 'cohort_paused',
      runtimeStatus,
      timeRemaining,
    };
  }

  if (runtimeStatus === 'not_started') {
    return {
      active: true,
      reason: 'not_started',
      runtimeStatus,
      timeRemaining,
    };
  }

  if (waitingForCohortAdvance) {
    return {
      active: true,
      reason: 'waiting_for_advance',
      runtimeStatus,
      timeRemaining,
    };
  }

  if (runtimeSnapshot?.waitingForNextSection) {
    return {
      active: true,
      reason: 'waiting_for_runtime',
      runtimeStatus,
      timeRemaining,
    };
  }

  return {
    active: false,
    reason: null,
    runtimeStatus,
    timeRemaining,
  };
}

function getInitialPhase(
  runtimeBacked: boolean,
  runtimeSnapshot: ExamSessionRuntime | null,
  attemptSnapshot: StudentAttempt | null,
): ExamPhase {
  if (attemptSnapshot?.proctorStatus === 'terminated') {
    return 'post-exam';
  }

  if (runtimeSnapshot?.status === 'completed') {
    return 'post-exam';
  }

  if (!attemptSnapshot) {
    return 'pre-check';
  }

  if (runtimeBacked && !attemptSnapshot.integrity.preCheck?.completedAt) {
    return 'pre-check';
  }

  return attemptSnapshot.phase;
}

function createInitialRuntimeState(
  examState: ExamState,
  runtimeBacked: boolean,
  runtimeSnapshot: ExamSessionRuntime | null,
  attemptSnapshot: StudentAttempt | null,
): RuntimeReducerState {
  const enabledModules = getEnabledModules(examState.config);
  const firstModule =
    runtimeSnapshot?.currentSectionKey ??
    attemptSnapshot?.currentModule ??
    enabledModules[0] ??
    'listening';

  return {
    phase: getInitialPhase(runtimeBacked, runtimeSnapshot, attemptSnapshot),
    currentModule: firstModule,
    currentQuestionId:
      attemptSnapshot?.currentQuestionId ??
      (runtimeBacked ? getFirstQuestionIdForModule(examState, firstModule) : null),
    timeRemaining: runtimeBacked ? runtimeSnapshot?.currentSectionRemainingSeconds ?? 0 : 0,
    elapsedTime: 0,
    answers: attemptSnapshot?.answers ?? {},
    writingAnswers: attemptSnapshot?.writingAnswers ?? {},
    flags: attemptSnapshot?.flags ?? {},
    waitingForCohortAdvance: false,
    violations: attemptSnapshot?.violations ?? [],
    fullscreenViolationCount: countFullscreenViolations(attemptSnapshot?.violations ?? []),
    proctorStatus: attemptSnapshot?.proctorStatus ?? 'active',
    proctorNote: attemptSnapshot?.proctorNote ?? null,
    blockingReasonOverride: null,
    attemptSyncState: attemptSnapshot?.recovery.syncState ?? 'idle',
  };
}

function runtimeReducer(
  state: RuntimeReducerState,
  action: RuntimeAction,
): RuntimeReducerState {
  switch (action.type) {
    case 'hydrate_runtime': {
      const runtimeStatus = action.snapshot?.status ?? 'not_started';
      const moduleChanged = action.nextModule !== state.currentModule;
      const nextPhase =
        state.proctorStatus === 'terminated' || runtimeStatus === 'completed'
          ? 'post-exam'
          : state.phase === 'pre-check'
            ? 'pre-check'
            : 'exam';
      const nextQuestionId = moduleChanged ? action.nextQuestionId : state.currentQuestionId;
      const nextTimeRemaining = action.snapshot?.currentSectionRemainingSeconds ?? state.timeRemaining;
      const nextWaitingForCohortAdvance =
        state.waitingForCohortAdvance && !moduleChanged && runtimeStatus !== 'completed';

      if (
        state.phase === nextPhase &&
        state.currentModule === action.nextModule &&
        state.currentQuestionId === nextQuestionId &&
        state.timeRemaining === nextTimeRemaining &&
        state.waitingForCohortAdvance === nextWaitingForCohortAdvance
      ) {
        return state;
      }

      return {
        ...state,
        phase: nextPhase,
        currentModule: action.nextModule,
        currentQuestionId: nextQuestionId,
        timeRemaining: nextTimeRemaining,
        waitingForCohortAdvance: nextWaitingForCohortAdvance,
      };
    }
    case 'hydrate_attempt': {
      const nextPhase =
        action.snapshot.proctorStatus === 'terminated'
          ? 'post-exam'
          : action.snapshot.phase;

      if (
        state.phase === nextPhase &&
        state.currentModule === action.snapshot.currentModule &&
        state.currentQuestionId === action.snapshot.currentQuestionId &&
        JSON.stringify(state.answers) === JSON.stringify(action.snapshot.answers) &&
        JSON.stringify(state.writingAnswers) === JSON.stringify(action.snapshot.writingAnswers) &&
        JSON.stringify(state.flags) === JSON.stringify(action.snapshot.flags) &&
        JSON.stringify(state.violations) === JSON.stringify(action.snapshot.violations) &&
        state.proctorStatus === action.snapshot.proctorStatus &&
        state.proctorNote === action.snapshot.proctorNote &&
        state.attemptSyncState === action.snapshot.recovery.syncState
      ) {
        return state;
      }

      return {
        ...state,
        phase: nextPhase,
        currentModule: action.snapshot.currentModule,
        currentQuestionId: action.snapshot.currentQuestionId,
        answers: action.snapshot.answers,
        writingAnswers: action.snapshot.writingAnswers,
        flags: action.snapshot.flags,
        violations: action.snapshot.violations,
        fullscreenViolationCount: countFullscreenViolations(action.snapshot.violations),
        proctorStatus: action.snapshot.proctorStatus,
        proctorNote: action.snapshot.proctorNote,
        attemptSyncState: action.snapshot.recovery.syncState,
      };
    }
    case 'set_phase':
      return {
        ...state,
        phase: action.phase,
      };
    case 'set_current_module':
      return {
        ...state,
        currentModule: action.module,
        currentQuestionId: action.firstQuestionId,
      };
    case 'set_current_question_id':
      return {
        ...state,
        currentQuestionId: action.id,
      };
    case 'set_time_remaining':
      return {
        ...state,
        timeRemaining: action.time,
      };
    case 'reset_elapsed_time':
      return {
        ...state,
        elapsedTime: 0,
      };
    case 'tick':
      return {
        ...state,
        timeRemaining: Math.max(0, state.timeRemaining - 1),
        elapsedTime: state.elapsedTime + 1,
      };
    case 'set_answer':
      return {
        ...state,
        answers: {
          ...state.answers,
          [action.questionId]: action.answer,
        },
      };
    case 'set_writing_answer':
      return {
        ...state,
        writingAnswers: {
          ...state.writingAnswers,
          [action.taskId]: action.text,
        },
      };
    case 'toggle_flag':
      return {
        ...state,
        flags: {
          ...state.flags,
          [action.questionId]: !state.flags[action.questionId],
        },
      };
    case 'start_exam':
      return {
        ...state,
        phase: 'exam',
        currentModule: action.firstModule,
        currentQuestionId: action.firstQuestionId,
        timeRemaining: action.durationSeconds,
        elapsedTime: 0,
      };
    case 'submit_module': {
      if (action.runtimeBacked) {
        return action.runtimeStatus === 'completed'
          ? {
              ...state,
              phase: 'post-exam',
              waitingForCohortAdvance: false,
            }
          : {
              ...state,
              waitingForCohortAdvance: true,
            };
      }

      if (!action.nextModule) {
        return {
          ...state,
          phase: 'post-exam',
          currentQuestionId: null,
        };
      }

      return {
        ...state,
        currentModule: action.nextModule,
        currentQuestionId: action.nextQuestionId,
        timeRemaining: action.nextDurationSeconds,
        elapsedTime: 0,
      };
    }
    case 'add_violation': {
      const newViolation: Violation = {
        id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: action.violationType,
        severity: action.severity,
        timestamp: new Date().toISOString(),
        description: action.description,
      };
      return {
        ...state,
        violations: [...state.violations, newViolation],
        fullscreenViolationCount:
          action.violationType === 'FULLSCREEN_EXIT'
            ? state.fullscreenViolationCount + 1
            : state.fullscreenViolationCount,
      };
    }
    case 'clear_violations':
      return {
        ...state,
        violations: [],
        fullscreenViolationCount: 0,
      };
    case 'terminate_exam':
      return {
        ...state,
        phase: 'post-exam',
      };
    case 'set_blocking_reason':
      if (state.blockingReasonOverride === action.reason) {
        return state;
      }
      return {
        ...state,
        blockingReasonOverride: action.reason,
      };
    case 'set_attempt_sync_state':
      if (state.attemptSyncState === action.state) {
        return state;
      }
      return {
        ...state,
        attemptSyncState: action.state,
      };
    default:
      return state;
  }
}

export function StudentRuntimeProvider({
  children,
  state,
  onExit,
  runtimeBacked = false,
  runtimeSnapshot = null,
  attemptSnapshot = null,
}: StudentRuntimeProviderProps) {
  const enabledModules = useMemo(() => getEnabledModules(state.config), [state.config]);
  const [runtimeState, dispatch] = useReducer(
    runtimeReducer,
    createInitialRuntimeState(state, runtimeBacked, runtimeSnapshot, attemptSnapshot),
  );
  const lastHydratedAttemptRef = useRef<string | null>(
    attemptSnapshot ? `${attemptSnapshot.id}:${attemptSnapshot.updatedAt}` : null,
  );

  useEffect(() => {
    if (!attemptSnapshot || runtimeState.phase === 'post-exam') {
      return;
    }

    if (
      runtimeState.attemptSyncState !== 'idle' &&
      runtimeState.attemptSyncState !== 'saved'
    ) {
      return;
    }

    const attemptFingerprint = `${attemptSnapshot.id}:${attemptSnapshot.updatedAt}`;
    if (lastHydratedAttemptRef.current === attemptFingerprint) {
      return;
    }

    lastHydratedAttemptRef.current = attemptFingerprint;
    dispatch({
      type: 'hydrate_attempt',
      snapshot: attemptSnapshot,
    });
  }, [attemptSnapshot, runtimeState.attemptSyncState, runtimeState.phase]);

  useEffect(() => {
    if (!runtimeBacked) {
      return;
    }

    const nextModule =
      runtimeSnapshot?.currentSectionKey ?? enabledModules[0] ?? runtimeState.currentModule;
    dispatch({
      type: 'hydrate_runtime',
      nextModule,
      nextQuestionId: getFirstQuestionIdForModule(state, nextModule),
      snapshot: runtimeSnapshot,
    });
  }, [enabledModules, runtimeBacked, runtimeSnapshot, runtimeState.currentModule, state]);

  useEffect(() => {
    if (
      runtimeBacked ||
      runtimeState.phase !== 'exam' ||
      runtimeState.timeRemaining <= 0 ||
      runtimeState.blockingReasonOverride
    ) {
      return;
    }

    const timerId = window.setInterval(() => {
      dispatch({ type: 'tick' });
    }, 1_000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [
    runtimeBacked,
    runtimeState.blockingReasonOverride,
    runtimeState.phase,
    runtimeState.timeRemaining,
  ]);

  const allQuestions = useMemo(
    () => getStudentQuestionsForModule(state, runtimeState.currentModule),
    [runtimeState.currentModule, state],
  );
  const blocking = useMemo(
    () =>
      deriveBlockingState(
        runtimeBacked,
        runtimeSnapshot,
        runtimeState.waitingForCohortAdvance,
        runtimeState.proctorStatus,
        runtimeState.blockingReasonOverride,
        runtimeState.timeRemaining,
      ),
    [
      runtimeBacked,
      runtimeState.proctorStatus,
      runtimeSnapshot,
      runtimeState.blockingReasonOverride,
      runtimeState.timeRemaining,
      runtimeState.waitingForCohortAdvance,
    ],
  );
  const runtimeStatus = runtimeBacked ? runtimeSnapshot?.status ?? 'not_started' : null;
  const displayTimeRemaining = runtimeBacked
    ? runtimeSnapshot?.currentSectionRemainingSeconds ?? runtimeState.timeRemaining
    : runtimeState.phase === 'exam'
      ? runtimeState.timeRemaining
      : undefined;
  const submitRequiresConfirmation =
    !runtimeBacked &&
    runtimeState.phase === 'exam' &&
    (runtimeState.currentModule === 'reading' || runtimeState.currentModule === 'listening');

  const setPhase = useCallback((phase: ExamPhase) => {
    dispatch({ type: 'set_phase', phase });
  }, []);

  const setCurrentModule = useCallback((module: ModuleType) => {
    dispatch({
      type: 'set_current_module',
      module,
      firstQuestionId: getFirstQuestionIdForModule(state, module),
    });
  }, [state]);

  const setCurrentQuestionId = useCallback((id: string | null) => {
    dispatch({ type: 'set_current_question_id', id });
  }, []);

  const setTimeRemaining = useCallback((time: number) => {
    dispatch({ type: 'set_time_remaining', time });
  }, []);

  const resetElapsedTime = useCallback(() => {
    dispatch({ type: 'reset_elapsed_time' });
  }, []);

  const setAnswer = useCallback((questionId: string, answer: StudentAnswer) => {
    dispatch({ type: 'set_answer', questionId, answer });
  }, []);

  const setWritingAnswer = useCallback((taskId: string, text: string) => {
    dispatch({ type: 'set_writing_answer', taskId, text });
  }, []);

  const toggleFlag = useCallback((questionId: string) => {
    dispatch({ type: 'toggle_flag', questionId });
  }, []);

  const startExam = useCallback(() => {
    const firstModule = enabledModules[0] ?? 'listening';

    dispatch({
      type: 'start_exam',
      firstModule,
      firstQuestionId: getFirstQuestionIdForModule(state, firstModule),
      durationSeconds: state.config.sections[firstModule].duration * 60,
    });
  }, [enabledModules, state]);

  const submitModule = useCallback(() => {
    const currentIndex = enabledModules.indexOf(runtimeState.currentModule);
    const nextModule = enabledModules[currentIndex + 1] ?? null;

    dispatch({
      type: 'submit_module',
      runtimeBacked,
      runtimeStatus,
      nextModule,
      nextQuestionId: nextModule ? getFirstQuestionIdForModule(state, nextModule) : null,
      nextDurationSeconds: nextModule ? state.config.sections[nextModule].duration * 60 : 0,
    });
  }, [enabledModules, runtimeBacked, runtimeState.currentModule, runtimeStatus, state]);

  const addViolation = useCallback((
    type: string,
    severity: ViolationSeverity,
    description: string,
  ) => {
    dispatch({ type: 'add_violation', violationType: type, severity, description });
  }, []);

  const clearViolations = useCallback(() => {
    dispatch({ type: 'clear_violations' });
  }, []);

  const terminateExam = useCallback(() => {
    dispatch({ type: 'terminate_exam' });
  }, []);

  const setBlockingReason = useCallback((
    reason: RuntimeReducerState['blockingReasonOverride'],
  ) => {
    dispatch({ type: 'set_blocking_reason', reason });
  }, []);

  const setAttemptSyncState = useCallback((nextState: AttemptSyncState) => {
    dispatch({ type: 'set_attempt_sync_state', state: nextState });
  }, []);

  const value = useMemo<RuntimeContextValue>(() => ({
    state: {
      ...runtimeState,
      allQuestions,
      blocking,
      displayTimeRemaining,
      runtimeBacked,
      runtimeStatus,
      submitRequiresConfirmation,
    },
    actions: {
      setPhase,
      setCurrentModule,
      setCurrentQuestionId,
      setTimeRemaining,
      resetElapsedTime,
      setAnswer,
      setWritingAnswer,
      toggleFlag,
      submitModule,
      startExam,
      addViolation,
      clearViolations,
      terminateExam,
      setBlockingReason,
      setAttemptSyncState,
    },
    examState: state,
    onExit,
  }), [
    addViolation,
    allQuestions,
    blocking,
    clearViolations,
    displayTimeRemaining,
    onExit,
    resetElapsedTime,
    runtimeBacked,
    runtimeState,
    runtimeStatus,
    setAnswer,
    setAttemptSyncState,
    setBlockingReason,
    setCurrentModule,
    setCurrentQuestionId,
    setPhase,
    setTimeRemaining,
    setWritingAnswer,
    startExam,
    state,
    submitModule,
    submitRequiresConfirmation,
    terminateExam,
    toggleFlag,
  ]);

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useStudentRuntime() {
  const context = useContext(RuntimeContext);
  if (!context) {
    throw new Error('useStudentRuntime must be used within StudentRuntimeProvider');
  }
  return context;
}
