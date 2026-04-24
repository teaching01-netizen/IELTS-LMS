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
  countAnsweredQuestions,
  countQuestionSlots,
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
import { isRuntimeStructurallyCompleted } from './verifiedTerminalState';

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
  submittedModules: ModuleType[];
  answers: Record<string, StudentAnswer | undefined>;
  writingAnswers: Record<string, string>;
  flags: Record<string, boolean>;
  waitingForCohortAdvance: boolean;
  violations: Violation[];
  fullscreenViolationCount: number;
  proctorStatus: StudentAttempt['proctorStatus'];
  proctorNote: string | null;
  submittedAt: string | null;
  blockingReasonOverride: Exclude<
    BlockingReason,
    'cohort_paused' | 'not_started' | 'waiting_for_runtime' | 'waiting_for_advance' | null
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
  runtimeSnapshot: ExamSessionRuntime | null;
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
  pauseExam: () => void;
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
      preserveLocalAdvance?: boolean;
    }
  | {
      type: 'hydrate_proctor';
      snapshot: StudentAttempt;
      runtimeBacked: boolean;
      runtimeSnapshot: ExamSessionRuntime | null;
    }
  | {
      type: 'hydrate_attempt';
      snapshot: StudentAttempt;
      runtimeBacked: boolean;
      runtimeSnapshot: ExamSessionRuntime | null;
      runtimeFirstQuestionId: string | null;
    }
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
      runtimeStructurallyCompleted: boolean;
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
  timeRemainingSeconds: number,
): RuntimeBlockingState {
  const runtimeStatus = runtimeBacked ? runtimeSnapshot?.status ?? 'not_started' : null;
  const timeRemaining = timeRemainingSeconds;

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
      timeRemaining,
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
  const verifiedTerminal =
    attemptSnapshot?.proctorStatus === 'terminated' ||
    Boolean(attemptSnapshot?.submittedAt) ||
    isRuntimeStructurallyCompleted(runtimeSnapshot);

  if (verifiedTerminal) {
    return 'post-exam';
  }

  if (!attemptSnapshot) {
    return 'pre-check';
  }

  if (runtimeBacked && !attemptSnapshot.integrity.preCheck?.completedAt) {
    return 'pre-check';
  }

  if (!runtimeBacked && attemptSnapshot.phase === 'post-exam') {
    return 'post-exam';
  }

  // Guard against transient/incorrect post-exam phases until terminal state is verified.
  if (attemptSnapshot.phase === 'post-exam') {
    return 'exam';
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
  const firstQuestionId = getFirstQuestionIdForModule(examState, firstModule);
  const attemptQuestionId =
    !runtimeBacked || attemptSnapshot?.currentModule === firstModule
      ? attemptSnapshot?.currentQuestionId ?? null
      : null;

  return {
    phase: getInitialPhase(runtimeBacked, runtimeSnapshot, attemptSnapshot),
    currentModule: firstModule,
    currentQuestionId: attemptQuestionId ?? (runtimeBacked ? firstQuestionId : null),
    timeRemaining: runtimeBacked ? runtimeSnapshot?.currentSectionRemainingSeconds ?? 0 : 0,
    elapsedTime: 0,
    submittedModules: [],
    answers: attemptSnapshot?.answers ?? {},
    writingAnswers: attemptSnapshot?.writingAnswers ?? {},
    flags: attemptSnapshot?.flags ?? {},
    waitingForCohortAdvance: false,
    violations: attemptSnapshot?.violations ?? [],
    fullscreenViolationCount: countFullscreenViolations(attemptSnapshot?.violations ?? []),
    proctorStatus: attemptSnapshot?.proctorStatus ?? 'active',
    proctorNote: attemptSnapshot?.proctorNote ?? null,
    submittedAt: attemptSnapshot?.submittedAt ?? null,
    blockingReasonOverride: null,
    attemptSyncState: attemptSnapshot?.recovery.syncState ?? 'idle',
  };
}

function mergeViolations(snapshot: Violation[], local: Violation[]): Violation[] {
  if (local.length === 0) {
    return snapshot;
  }

  if (snapshot.length === 0) {
    return local;
  }

  const seen = new Set<string>();
  const merged: Violation[] = [];

  for (const violation of snapshot) {
    if (seen.has(violation.id)) {
      continue;
    }
    seen.add(violation.id);
    merged.push(violation);
  }

  for (const violation of local) {
    if (seen.has(violation.id)) {
      continue;
    }
    seen.add(violation.id);
    merged.push(violation);
  }

  return merged;
}

function runtimeReducer(
  state: RuntimeReducerState,
  action: RuntimeAction,
): RuntimeReducerState {
  switch (action.type) {
    case 'hydrate_runtime': {
      const moduleChanged = action.nextModule !== state.currentModule;
      const terminalVerified =
        state.proctorStatus === 'terminated' ||
        Boolean(state.submittedAt) ||
        isRuntimeStructurallyCompleted(action.snapshot);
      if (action.preserveLocalAdvance && !terminalVerified) {
        return state;
      }
      const nextPhase =
        terminalVerified
          ? 'post-exam'
          : state.phase === 'pre-check'
            ? 'pre-check'
            : state.phase === 'lobby'
              ? 'lobby'
              : 'exam';
      const nextQuestionId = moduleChanged ? action.nextQuestionId : state.currentQuestionId;
      const snapshotTimeRemaining = action.snapshot?.currentSectionRemainingSeconds;
      const nextTimeRemaining =
        typeof snapshotTimeRemaining === 'number' ? snapshotTimeRemaining : state.timeRemaining;
      const nextWaitingForCohortAdvance =
        state.waitingForCohortAdvance && !moduleChanged && !terminalVerified;

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
    case 'hydrate_proctor': {
      const nextProctorStatus = action.snapshot.proctorStatus;
      const nextProctorNote = action.snapshot.proctorNote ?? null;
      const mergedViolations = mergeViolations(action.snapshot.violations, state.violations);
      const nextSubmittedAt = state.submittedAt ?? action.snapshot.submittedAt ?? null;
      const terminalVerified =
        nextProctorStatus === 'terminated' ||
        Boolean(nextSubmittedAt) ||
        isRuntimeStructurallyCompleted(action.runtimeSnapshot);
      const nextPhase =
        terminalVerified
          ? 'post-exam'
          : action.snapshot.phase === 'post-exam'
            ? action.runtimeBacked
              ? state.phase === 'pre-check'
                ? 'pre-check'
                : 'exam'
              : 'post-exam'
            : state.phase;

      if (
        state.phase === nextPhase &&
        state.proctorStatus === nextProctorStatus &&
        state.proctorNote === nextProctorNote &&
        state.submittedAt === nextSubmittedAt &&
        JSON.stringify(state.violations) === JSON.stringify(mergedViolations)
      ) {
        return state;
      }

      return {
        ...state,
        phase: nextPhase,
        violations: mergedViolations,
        fullscreenViolationCount: countFullscreenViolations(mergedViolations),
        proctorStatus: nextProctorStatus,
        proctorNote: nextProctorNote,
        submittedAt: nextSubmittedAt,
      };
    }
    case 'hydrate_attempt': {
      const runtimeModule = action.runtimeBacked
        ? action.runtimeSnapshot?.currentSectionKey ?? null
        : null;
      const nextCurrentModule = runtimeModule ?? action.snapshot.currentModule;
      const moduleChanged = nextCurrentModule !== state.currentModule;
      const nextCurrentQuestionId = action.runtimeBacked
        ? moduleChanged
          ? action.runtimeFirstQuestionId
          : state.currentQuestionId ?? action.runtimeFirstQuestionId
        : action.snapshot.currentQuestionId;
      const nextSubmittedAt = state.submittedAt ?? action.snapshot.submittedAt ?? null;
      const terminalVerified =
        action.snapshot.proctorStatus === 'terminated' ||
        Boolean(nextSubmittedAt) ||
        isRuntimeStructurallyCompleted(action.runtimeSnapshot);
      const nextPhase = terminalVerified
        ? 'post-exam'
        : action.snapshot.phase === 'post-exam'
          ? action.runtimeBacked
            ? state.phase === 'pre-check'
              ? 'pre-check'
              : 'exam'
            : 'post-exam'
          : action.snapshot.phase;
      const mergedViolations = mergeViolations(action.snapshot.violations, state.violations);

      if (
        state.phase === nextPhase &&
        state.currentModule === nextCurrentModule &&
        state.currentQuestionId === nextCurrentQuestionId &&
        JSON.stringify(state.answers) === JSON.stringify(action.snapshot.answers) &&
        JSON.stringify(state.writingAnswers) === JSON.stringify(action.snapshot.writingAnswers) &&
        JSON.stringify(state.flags) === JSON.stringify(action.snapshot.flags) &&
        JSON.stringify(state.violations) === JSON.stringify(mergedViolations) &&
        state.proctorStatus === action.snapshot.proctorStatus &&
        state.proctorNote === action.snapshot.proctorNote &&
        state.submittedAt === nextSubmittedAt &&
        state.attemptSyncState === action.snapshot.recovery.syncState
      ) {
        return state;
      }

      return {
        ...state,
        phase: nextPhase,
        currentModule: nextCurrentModule,
        currentQuestionId: nextCurrentQuestionId,
        answers: action.snapshot.answers,
        writingAnswers: action.snapshot.writingAnswers,
        flags: action.snapshot.flags,
        violations: mergedViolations,
        fullscreenViolationCount: countFullscreenViolations(mergedViolations),
        proctorStatus: action.snapshot.proctorStatus,
        proctorNote: action.snapshot.proctorNote,
        submittedAt: nextSubmittedAt,
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
        const terminalVerified =
          state.proctorStatus === 'terminated' ||
          Boolean(state.submittedAt) ||
          action.runtimeStructurallyCompleted;

        if (terminalVerified && action.runtimeStatus === 'completed') {
          return {
            ...state,
            phase: 'post-exam',
            waitingForCohortAdvance: false,
          };
        }

        if (!action.nextModule) {
          return {
            ...state,
            phase: 'post-exam',
            currentModule: state.currentModule,
            currentQuestionId: null,
            submittedModules: Array.from(new Set([...state.submittedModules, state.currentModule])),
            waitingForCohortAdvance: false,
          };
        }

        return {
          ...state,
          currentModule: action.nextModule,
          currentQuestionId: action.nextQuestionId,
          timeRemaining: action.nextDurationSeconds,
          elapsedTime: 0,
          submittedModules: Array.from(new Set([...state.submittedModules, state.currentModule])),
          waitingForCohortAdvance: false,
        };
      }

      if (!action.nextModule) {
        return {
          ...state,
          phase: 'post-exam',
          currentQuestionId: null,
          submittedModules: Array.from(new Set([...state.submittedModules, state.currentModule])),
        };
      }

      return {
        ...state,
        currentModule: action.nextModule,
        currentQuestionId: action.nextQuestionId,
        timeRemaining: action.nextDurationSeconds,
        elapsedTime: 0,
        submittedModules: Array.from(new Set([...state.submittedModules, state.currentModule])),
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
  const lastHydratedProctorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!attemptSnapshot) {
      return;
    }

    const proctorFingerprint = [
      attemptSnapshot.id,
      attemptSnapshot.proctorUpdatedAt ?? '',
      attemptSnapshot.proctorStatus,
      attemptSnapshot.proctorNote ?? '',
      attemptSnapshot.lastWarningId ?? '',
      attemptSnapshot.lastAcknowledgedWarningId ?? '',
      attemptSnapshot.submittedAt ?? '',
      String(attemptSnapshot.violations.length),
    ].join(':');

    if (lastHydratedProctorRef.current === proctorFingerprint) {
      return;
    }

    lastHydratedProctorRef.current = proctorFingerprint;
    dispatch({
      type: 'hydrate_proctor',
      snapshot: attemptSnapshot,
      runtimeBacked,
      runtimeSnapshot,
    });
  }, [attemptSnapshot, runtimeBacked, runtimeSnapshot]);

  useEffect(() => {
    if (!attemptSnapshot) {
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
      runtimeBacked,
      runtimeSnapshot,
      runtimeFirstQuestionId: runtimeSnapshot?.currentSectionKey
        ? getFirstQuestionIdForModule(state, runtimeSnapshot.currentSectionKey)
        : null,
    });
  }, [attemptSnapshot, runtimeBacked, runtimeSnapshot, runtimeState.attemptSyncState, state]);

  useEffect(() => {
    if (!runtimeBacked) {
      return;
    }

    if (!runtimeSnapshot) {
      return;
    }

    const nextModule =
      runtimeSnapshot?.currentSectionKey ?? enabledModules[0] ?? runtimeState.currentModule;
    const latestSubmittedModule = runtimeState.submittedModules[runtimeState.submittedModules.length - 1] ?? null;
    const submittedIndex =
      latestSubmittedModule !== null ? enabledModules.indexOf(latestSubmittedModule) : -1;
    const expectedLocalModule =
      submittedIndex >= 0 ? enabledModules[submittedIndex + 1] ?? null : null;
    const preserveLocalAdvance =
      latestSubmittedModule !== null &&
      runtimeSnapshot?.currentSectionKey === latestSubmittedModule &&
      runtimeState.currentModule === expectedLocalModule;
    dispatch({
      type: 'hydrate_runtime',
      nextModule,
      nextQuestionId: getFirstQuestionIdForModule(state, nextModule),
      snapshot: runtimeSnapshot,
      preserveLocalAdvance,
    });
  }, [
    enabledModules,
    runtimeBacked,
    runtimeSnapshot,
    runtimeState.currentModule,
    runtimeState.submittedModules,
    state,
  ]);

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
  const displayTimeRemaining =
    runtimeState.phase === 'exam' ? runtimeState.timeRemaining : undefined;
  const unansweredSubmissionPolicy = state.config.progression.unansweredSubmissionPolicy ?? 'confirm';
  const answeredSlots = useMemo(
    () => countAnsweredQuestions(allQuestions, runtimeState.answers),
    [allQuestions, runtimeState.answers],
  );
  const totalSlots = useMemo(
    () => countQuestionSlots(allQuestions),
    [allQuestions],
  );
  const hasUnanswered = totalSlots > 0 && answeredSlots < totalSlots;
  const submitRequiresConfirmation =
    runtimeState.phase === 'exam' &&
    (runtimeState.currentModule === 'reading' || runtimeState.currentModule === 'listening') &&
    hasUnanswered &&
    unansweredSubmissionPolicy !== 'allow';

  useEffect(() => {
    if (!runtimeBacked) {
      return;
    }

    if (runtimeState.phase !== 'exam' || runtimeState.timeRemaining <= 0) {
      return;
    }

    if (blocking.active) {
      return;
    }

    if (runtimeStatus !== 'live') {
      return;
    }

    const activeSection = runtimeSnapshot?.currentSectionKey
      ? runtimeSnapshot.sections.find(
          (section) => section.sectionKey === runtimeSnapshot.currentSectionKey,
        )
      : null;
    if (activeSection?.status === 'paused') {
      return;
    }

    const timerId = window.setInterval(() => {
      dispatch({ type: 'tick' });
    }, 1_000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [
    blocking.active,
    runtimeBacked,
    runtimeSnapshot,
    runtimeState.phase,
    runtimeState.timeRemaining,
    runtimeStatus,
  ]);

  const setPhase = useCallback((phase: ExamPhase) => {
    dispatch({ type: 'set_phase', phase });
  }, []);

  const setCurrentModule = useCallback((module: ModuleType) => {
    if (
      state.config.progression.lockAfterSubmit &&
      runtimeState.submittedModules.includes(module)
    ) {
      return;
    }

    dispatch({
      type: 'set_current_module',
      module,
      firstQuestionId: getFirstQuestionIdForModule(state, module),
    });
  }, [runtimeState.submittedModules, state]);

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
      runtimeStructurallyCompleted: isRuntimeStructurallyCompleted(runtimeSnapshot),
      nextModule,
      nextQuestionId: nextModule ? getFirstQuestionIdForModule(state, nextModule) : null,
      nextDurationSeconds: nextModule ? state.config.sections[nextModule].duration * 60 : 0,
    });
  }, [enabledModules, runtimeBacked, runtimeSnapshot, runtimeState.currentModule, runtimeStatus, state]);

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

  const pauseExam = useCallback(() => {
    dispatch({ type: 'set_blocking_reason', reason: 'proctor_paused' });
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
      runtimeSnapshot: runtimeBacked ? runtimeSnapshot : null,
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
      pauseExam,
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
    pauseExam,
    displayTimeRemaining,
    onExit,
    resetElapsedTime,
    runtimeBacked,
    runtimeSnapshot,
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
