import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useReducer,
  useState,
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
  StudentAttempt,
} from '../../../types/studentAttempt';
import {
  emitStudentObservabilityMetric,
  withStudentObservabilityDimensions,
} from '../../../utils/studentObservability';
import { isRuntimeStructurallyCompleted } from './verifiedTerminalState';
import {
  createBlockingMachineState,
  syncProctorBlockingMachine,
  transitionBlockingMachine,
  type BlockingMachineState,
  type ManagedBlockingReason,
} from './blockingStateMachine';

export type ExamPhase = 'pre-check' | 'lobby' | 'exam' | 'post-exam' | 'submitted';
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
  | 'storage_unavailable'
  | null;

interface RuntimeReducerState {
  phase: ExamPhase;
  currentModule: ModuleType;
  currentQuestionId: string | null;
  timeRemaining: number;
  currentSectionExtensionMinutes: number | null;
  elapsedTime: number;
  submittedModules: ModuleType[];
  waitingForCohortAdvance: boolean;
  violations: Violation[];
  proctorStatus: StudentAttempt['proctorStatus'];
  proctorNote: string | null;
  submittedAt: string | null;
  blockingReasonOverride: Exclude<
    BlockingReason,
    'cohort_paused' | 'not_started' | 'waiting_for_runtime' | 'waiting_for_advance' | null
  > | null;
  blockingMachine: BlockingMachineState;
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
  submitModule: () => void;
  startExam: () => void;
  addViolation: (
    type: string,
    severity: ViolationSeverity,
    description: string,
    violationId?: string,
    timestamp?: string,
  ) => void;
  clearViolations: () => void;
  pauseExam: () => void;
  terminateExam: () => void;
  transitionBlocking: (reason: ManagedBlockingReason, active?: boolean) => void;
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
  answerInvariantEnabled?: boolean;
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
      currentSectionExtensionMinutes: number | null;
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
  | {
      type: 'add_violation';
      violationType: string;
      severity: ViolationSeverity;
      description: string;
      violationId?: string;
      timestamp?: string;
    }
  | { type: 'clear_violations' }
  | { type: 'terminate_exam' }
  | { type: 'transition_blocking'; reason: ManagedBlockingReason; active: boolean }
  | { type: 'set_attempt_sync_state'; state: AttemptSyncState };

function getDroppedMutationMarker(
  dropped: StudentAttempt['recovery']['lastDroppedMutations'],
): string | null {
  if (!dropped) {
    return null;
  }

  return `${dropped.at}:${dropped.count}:${dropped.fromModule ?? ''}:${dropped.toModule ?? ''}:${dropped.reason}`;
}

function getRuntimeSectionExtensionMinutes(
  runtimeSnapshot: ExamSessionRuntime | null,
  sectionKey: string | null,
): number | null {
  if (!runtimeSnapshot || !sectionKey) {
    return null;
  }

  const section = runtimeSnapshot.sections.find((candidate) => candidate.sectionKey === sectionKey);
  return typeof section?.extensionMinutes === 'number' ? section.extensionMinutes : null;
}

function resolveRuntimeDisplayRemainingSeconds(options: {
  runtimeBacked: boolean;
  runtimeSnapshot: ExamSessionRuntime | null;
  phase: ExamPhase;
  fallbackSeconds: number;
  clockOffsetMs: number;
  nowMs: number;
}): number | null {
  if (!options.runtimeBacked || options.phase !== 'exam') {
    return null;
  }

  const runtime = options.runtimeSnapshot;
  if (!runtime || runtime.status !== 'live') {
    return options.fallbackSeconds;
  }

  const sectionKey = runtime.currentSectionKey;
  const activeSection = sectionKey
    ? runtime.sections.find((section) => section.sectionKey === sectionKey)
    : null;
  if (!activeSection || activeSection.status !== 'live' || activeSection.pausedAt) {
    return options.fallbackSeconds;
  }

  if (!runtime.currentSectionDeadlineAt) {
    return options.fallbackSeconds;
  }

  const deadlineMs = Date.parse(runtime.currentSectionDeadlineAt);
  if (!Number.isFinite(deadlineMs)) {
    return options.fallbackSeconds;
  }

  const adjustedNowMs = options.nowMs + options.clockOffsetMs;
  const remainingMs = Math.max(0, deadlineMs - adjustedNowMs);
  return Math.max(0, Math.ceil(remainingMs / 1_000));
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

  if (waitingForCohortAdvance || runtimeSnapshot?.waitingForNextSection) {
    return {
      active: true,
      reason: 'waiting_for_advance',
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

  if (runtimeBacked && attemptSnapshot.phase === 'pre-check') {
    return 'exam';
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
  const initialPhase = getInitialPhase(runtimeBacked, runtimeSnapshot, attemptSnapshot);
  const nonRuntimeSectionDurationMinutes = examState.config.sections[firstModule]?.duration ?? 0;
  const nonRuntimeSectionDurationSeconds = Number.isFinite(nonRuntimeSectionDurationMinutes)
    ? Math.max(0, nonRuntimeSectionDurationMinutes * 60)
    : 0;
  const blockingMachine = createBlockingMachineState(
    attemptSnapshot?.proctorStatus === 'paused' ? 'proctor_paused' : null,
  );

  return {
    phase: initialPhase,
    currentModule: firstModule,
    currentQuestionId: attemptQuestionId ?? (runtimeBacked ? firstQuestionId : null),
    timeRemaining: runtimeBacked
      ? runtimeSnapshot?.currentSectionRemainingSeconds ?? 0
      : initialPhase === 'exam'
        ? nonRuntimeSectionDurationSeconds
        : 0,
    currentSectionExtensionMinutes: runtimeBacked
      ? getRuntimeSectionExtensionMinutes(runtimeSnapshot, runtimeSnapshot?.currentSectionKey ?? firstModule)
      : null,
    elapsedTime: 0,
    submittedModules: [],
    waitingForCohortAdvance: false,
    violations: attemptSnapshot?.violations ?? [],
    proctorStatus: attemptSnapshot?.proctorStatus ?? 'active',
    proctorNote: attemptSnapshot?.proctorNote ?? null,
    submittedAt: attemptSnapshot?.submittedAt ?? null,
    blockingReasonOverride: blockingMachine.current,
    blockingMachine,
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
      const runtimeStatus = action.snapshot?.status ?? null;
      const hasActiveSection = Boolean(action.snapshot?.currentSectionKey);
      const shouldPromoteToExamPhase =
        !terminalVerified && (runtimeStatus === 'live' || runtimeStatus === 'paused' || hasActiveSection);
      if (action.preserveLocalAdvance && !terminalVerified) {
        return state;
      }
      const nextPhase =
        terminalVerified
          ? 'post-exam'
          : shouldPromoteToExamPhase
            ? 'exam'
            : state.phase === 'pre-check'
              ? 'pre-check'
              : state.phase === 'lobby'
                ? 'lobby'
                : 'exam';
      const nextQuestionId = moduleChanged ? action.nextQuestionId : state.currentQuestionId;
      const snapshotTimeRemaining = action.snapshot?.currentSectionRemainingSeconds;
      const nextTimeRemaining =
        typeof snapshotTimeRemaining === 'number' ? snapshotTimeRemaining : state.timeRemaining;
      const nextCurrentSectionExtensionMinutes =
        typeof action.currentSectionExtensionMinutes === 'number'
          ? action.currentSectionExtensionMinutes
          : moduleChanged
            ? null
            : state.currentSectionExtensionMinutes;
      const nextWaitingForCohortAdvance =
        state.waitingForCohortAdvance && !moduleChanged && !terminalVerified;

      if (
        state.phase === nextPhase &&
        state.currentModule === action.nextModule &&
        state.currentQuestionId === nextQuestionId &&
        state.timeRemaining === nextTimeRemaining &&
        state.currentSectionExtensionMinutes === nextCurrentSectionExtensionMinutes &&
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
        currentSectionExtensionMinutes: nextCurrentSectionExtensionMinutes,
        waitingForCohortAdvance: nextWaitingForCohortAdvance,
      };
    }
    case 'hydrate_proctor': {
      const nextProctorStatus = action.snapshot.proctorStatus;
      const nextProctorNote = action.snapshot.proctorNote ?? null;
      const mergedViolations = mergeViolations(action.snapshot.violations, state.violations);
      const nextSubmittedAt = state.submittedAt ?? action.snapshot.submittedAt ?? null;
      const nextBlockingMachine = syncProctorBlockingMachine(
        state.blockingMachine,
        nextProctorStatus,
      );
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
        state.blockingReasonOverride === nextBlockingMachine.current &&
        JSON.stringify(state.violations) === JSON.stringify(mergedViolations)
      ) {
        return state;
      }

      return {
        ...state,
        phase: nextPhase,
        violations: mergedViolations,
        proctorStatus: nextProctorStatus,
        proctorNote: nextProctorNote,
        submittedAt: nextSubmittedAt,
        blockingMachine: nextBlockingMachine,
        blockingReasonOverride: nextBlockingMachine.current,
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
      const runtimeStatus = action.runtimeBacked ? action.runtimeSnapshot?.status ?? null : null;
      const hasActiveSection = Boolean(action.runtimeSnapshot?.currentSectionKey);
      const shouldPromoteToExamPhase =
        action.runtimeBacked &&
        !terminalVerified &&
        (runtimeStatus === 'live' || runtimeStatus === 'paused' || hasActiveSection);
      const completedPreCheckInRuntimeBackedFlow =
        action.runtimeBacked && Boolean(action.snapshot.integrity.preCheck?.completedAt);
      const shouldPreserveExamPhaseAfterPreCheck =
        completedPreCheckInRuntimeBackedFlow &&
        state.phase === 'exam' &&
        action.snapshot.phase === 'pre-check' &&
        !shouldPromoteToExamPhase &&
        !terminalVerified;
      const nextPhase = terminalVerified
        ? 'post-exam'
        : shouldPreserveExamPhaseAfterPreCheck
          ? 'exam'
        : shouldPromoteToExamPhase
          ? 'exam'
        : action.snapshot.phase === 'post-exam'
          ? action.runtimeBacked
            ? state.phase === 'pre-check'
              ? 'pre-check'
              : 'exam'
            : 'post-exam'
          : action.snapshot.phase;
      const mergedViolations = mergeViolations(action.snapshot.violations, state.violations);
      const nextBlockingMachine = syncProctorBlockingMachine(
        state.blockingMachine,
        action.snapshot.proctorStatus,
      );

      if (
        state.phase === nextPhase &&
        state.currentModule === nextCurrentModule &&
        state.currentQuestionId === nextCurrentQuestionId &&
        JSON.stringify(state.violations) === JSON.stringify(mergedViolations) &&
        state.proctorStatus === action.snapshot.proctorStatus &&
        state.proctorNote === action.snapshot.proctorNote &&
        state.submittedAt === nextSubmittedAt &&
        state.blockingReasonOverride === nextBlockingMachine.current &&
        state.attemptSyncState === action.snapshot.recovery.syncState
      ) {
        return state;
      }

      return {
        ...state,
        phase: nextPhase,
        currentModule: nextCurrentModule,
        currentQuestionId: nextCurrentQuestionId,
        violations: mergedViolations,
        proctorStatus: action.snapshot.proctorStatus,
        proctorNote: action.snapshot.proctorNote,
        submittedAt: nextSubmittedAt,
        blockingMachine: nextBlockingMachine,
        blockingReasonOverride: nextBlockingMachine.current,
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
    case 'start_exam':
      return {
        ...state,
        phase: 'exam',
        currentModule: action.firstModule,
        currentQuestionId: action.firstQuestionId,
        timeRemaining: action.durationSeconds,
        currentSectionExtensionMinutes: null,
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
            currentSectionExtensionMinutes: null,
            waitingForCohortAdvance: false,
          };
        }

        if (!action.nextModule) {
          return {
            ...state,
            phase: 'post-exam',
            currentModule: state.currentModule,
            currentQuestionId: null,
            currentSectionExtensionMinutes: null,
            submittedModules: Array.from(new Set([...state.submittedModules, state.currentModule])),
            waitingForCohortAdvance: false,
          };
        }

        return {
          ...state,
          currentModule: action.nextModule,
          currentQuestionId: action.nextQuestionId,
          timeRemaining: action.nextDurationSeconds,
          currentSectionExtensionMinutes: null,
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
          currentSectionExtensionMinutes: null,
          submittedModules: Array.from(new Set([...state.submittedModules, state.currentModule])),
        };
      }

      return {
        ...state,
        currentModule: action.nextModule,
        currentQuestionId: action.nextQuestionId,
        timeRemaining: action.nextDurationSeconds,
        currentSectionExtensionMinutes: null,
        elapsedTime: 0,
        submittedModules: Array.from(new Set([...state.submittedModules, state.currentModule])),
      };
    }
    case 'add_violation': {
      const newViolation: Violation = {
        id: action.violationId ?? `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: action.violationType,
        severity: action.severity,
        timestamp: action.timestamp ?? new Date().toISOString(),
        description: action.description,
      };
      return {
        ...state,
        violations: [...state.violations, newViolation],
      };
    }
    case 'clear_violations':
      return {
        ...state,
        violations: [],
      };
    case 'terminate_exam':
      return {
        ...state,
        phase: 'post-exam',
      };
    case 'transition_blocking': {
      const nextBlockingMachine = transitionBlockingMachine(
        state.blockingMachine,
        action.reason,
        action.active,
      );
      if (state.blockingReasonOverride === nextBlockingMachine.current) {
        return state;
      }
      return {
        ...state,
        blockingMachine: nextBlockingMachine,
        blockingReasonOverride: nextBlockingMachine.current,
      };
    }
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
  answerInvariantEnabled = true,
  runtimeBacked = false,
  runtimeSnapshot = null,
  attemptSnapshot = null,
}: StudentRuntimeProviderProps) {
  const enabledModules = useMemo(() => getEnabledModules(state.config), [state.config]);
  const [runtimeState, dispatch] = useReducer(
    runtimeReducer,
    createInitialRuntimeState(state, runtimeBacked, runtimeSnapshot, attemptSnapshot),
  );
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [derivedClockNowMs, setDerivedClockNowMs] = useState(() => Date.now());
  const lastHydratedAttemptRef = useRef<string | null>(
    attemptSnapshot
      ? `${attemptSnapshot.id}:${attemptSnapshot.updatedAt}:${getDroppedMutationMarker(attemptSnapshot.recovery.lastDroppedMutations) ?? ''}`
      : null,
  );
  const lastHydratedProctorRef = useRef<string | null>(null);
  const lastHydratedAttemptIdRef = useRef<string | null>(attemptSnapshot?.id ?? null);
  const lastDroppedReconcileMarkerRef = useRef<string | null>(
    getDroppedMutationMarker(attemptSnapshot?.recovery.lastDroppedMutations ?? null),
  );

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

    const droppedMarker = getDroppedMutationMarker(attemptSnapshot.recovery.lastDroppedMutations);
    const sameAttempt = lastHydratedAttemptIdRef.current === attemptSnapshot.id;
    const shouldForceServerReconcile =
      sameAttempt &&
      Boolean(droppedMarker) &&
      droppedMarker !== lastDroppedReconcileMarkerRef.current;
    const attemptFingerprint = `${attemptSnapshot.id}:${attemptSnapshot.updatedAt}:${droppedMarker ?? ''}`;
    if (lastHydratedAttemptRef.current === attemptFingerprint) {
      return;
    }

    lastHydratedAttemptRef.current = attemptFingerprint;
    lastHydratedAttemptIdRef.current = attemptSnapshot.id;
    if (!sameAttempt || shouldForceServerReconcile) {
      lastDroppedReconcileMarkerRef.current = droppedMarker;
    }
    if (shouldForceServerReconcile) {
      emitStudentObservabilityMetric(
        'student_answer_reconcile_from_server_total',
        withStudentObservabilityDimensions({
          scheduleId: attemptSnapshot.scheduleId,
          attemptId: attemptSnapshot.id,
          endpoint: `/v1/student/sessions/${attemptSnapshot.scheduleId}/live`,
          statusCode: 200,
          reason: attemptSnapshot.recovery.lastDroppedMutations?.reason ?? 'UNKNOWN',
          syncState: runtimeState.attemptSyncState,
          answerInvariantEnabled,
          answerInvariantSource: 'runtime_provider',
        }),
      );
    }
    dispatch({
      type: 'hydrate_attempt',
      snapshot: attemptSnapshot,
      runtimeBacked,
      runtimeSnapshot,
      runtimeFirstQuestionId: runtimeSnapshot?.currentSectionKey
        ? getFirstQuestionIdForModule(state, runtimeSnapshot.currentSectionKey)
        : null,
    });
  }, [
    answerInvariantEnabled,
    attemptSnapshot,
    runtimeBacked,
    runtimeSnapshot,
    runtimeState.attemptSyncState,
    state,
  ]);

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
    const currentSectionExtensionMinutes = getRuntimeSectionExtensionMinutes(
      runtimeSnapshot,
      runtimeSnapshot.currentSectionKey ?? nextModule,
    );
    const sameSection = nextModule === runtimeState.currentModule;
    const reportedRemaining = runtimeSnapshot.currentSectionRemainingSeconds;
    const extensionIncreased =
      typeof currentSectionExtensionMinutes === 'number' &&
      (runtimeState.currentSectionExtensionMinutes === null ||
        currentSectionExtensionMinutes > runtimeState.currentSectionExtensionMinutes);
    const nonMonotonicJump =
      sameSection &&
      reportedRemaining > runtimeState.timeRemaining &&
      !extensionIncreased;
    if (nonMonotonicJump) {
      emitStudentObservabilityMetric(
        'student_timer_non_monotonic_jump_total',
        withStudentObservabilityDimensions({
          scheduleId: runtimeSnapshot.scheduleId,
          attemptId: attemptSnapshot?.id ?? null,
          endpoint: `/v1/student/sessions/${runtimeSnapshot.scheduleId}/live`,
          statusCode: 200,
          reason: 'same_section_positive_jump',
          runtimeStatus: runtimeSnapshot.status,
          currentSectionKey: runtimeSnapshot.currentSectionKey ?? null,
          previousRemainingSeconds: runtimeState.timeRemaining,
          reportedRemainingSeconds: reportedRemaining,
        }),
      );
    }
    dispatch({
      type: 'hydrate_runtime',
      nextModule,
      nextQuestionId: getFirstQuestionIdForModule(state, nextModule),
      snapshot: runtimeSnapshot,
      currentSectionExtensionMinutes,
      preserveLocalAdvance,
    });
  }, [
    attemptSnapshot?.id,
    enabledModules,
    runtimeBacked,
    runtimeSnapshot,
    runtimeState.currentSectionExtensionMinutes,
    runtimeState.currentModule,
    runtimeState.submittedModules,
    runtimeState.timeRemaining,
    state,
  ]);

  useEffect(() => {
    if (!runtimeBacked || !runtimeSnapshot?.serverNow) {
      return;
    }

    const serverNowMs = Date.parse(runtimeSnapshot.serverNow);
    if (!Number.isFinite(serverNowMs)) {
      return;
    }

    const sampledOffsetMs = serverNowMs - Date.now();
    setClockOffsetMs((previous) => {
      if (!Number.isFinite(previous)) {
        return sampledOffsetMs;
      }
      const drift = sampledOffsetMs - previous;
      if (Math.abs(drift) > 5_000) {
        return sampledOffsetMs;
      }
      return previous + drift * 0.25;
    });
  }, [runtimeBacked, runtimeSnapshot?.serverNow]);

  useEffect(() => {
    if (!runtimeBacked || runtimeState.phase !== 'exam') {
      return;
    }

    const timerId = window.setInterval(() => {
      setDerivedClockNowMs(Date.now());
    }, 250);

    return () => {
      window.clearInterval(timerId);
    };
  }, [runtimeBacked, runtimeState.phase]);

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
  const displayTimeRemaining = runtimeState.phase === 'exam'
    ? runtimeBacked
      ? resolveRuntimeDisplayRemainingSeconds({
          runtimeBacked,
          runtimeSnapshot,
          phase: runtimeState.phase,
          fallbackSeconds: runtimeState.timeRemaining,
          clockOffsetMs,
          nowMs: derivedClockNowMs,
        }) ?? runtimeState.timeRemaining
      : runtimeState.timeRemaining
    : undefined;
  const submitRequiresConfirmation = false;

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
    violationId?: string,
    timestamp?: string,
  ) => {
    dispatch({
      type: 'add_violation',
      violationType: type,
      severity,
      description,
      ...(violationId ? { violationId } : {}),
      ...(timestamp ? { timestamp } : {}),
    });
  }, []);

  const clearViolations = useCallback(() => {
    dispatch({ type: 'clear_violations' });
  }, []);

  const pauseExam = useCallback(() => {
    dispatch({ type: 'transition_blocking', reason: 'proctor_paused', active: true });
  }, []);

  const terminateExam = useCallback(() => {
    dispatch({ type: 'terminate_exam' });
  }, []);

  const transitionBlocking = useCallback((
    reason: ManagedBlockingReason,
    active = true,
  ) => {
    dispatch({ type: 'transition_blocking', reason, active });
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
      submitModule,
      startExam,
      addViolation,
      clearViolations,
      pauseExam,
      terminateExam,
      transitionBlocking,
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
    setAttemptSyncState,
    transitionBlocking,
    setCurrentModule,
    setCurrentQuestionId,
    setPhase,
    setTimeRemaining,
    startExam,
    state,
    submitModule,
    submitRequiresConfirmation,
    terminateExam,
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
