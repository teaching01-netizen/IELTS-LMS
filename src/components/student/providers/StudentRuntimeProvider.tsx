import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
export type RuntimeContractIssue =
  | 'missing_active_section'
  | 'stale_paused_at'
  | 'invalid_remaining_seconds'
  | null;

interface RuntimeTimerAnchor {
  readonly sectionKey: ModuleType | null;
  readonly extensionMinutes: number;
  readonly deadlineMs: number;
}

interface RuntimeTimerAnchorOptions {
  readonly runtimeBacked: boolean;
  readonly phase: ExamPhase;
  readonly runtime: ExamSessionRuntime | null;
  readonly nowMs: number;
  readonly clockOffsetMs: number;
  readonly currentAnchor: RuntimeTimerAnchor | null;
}

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
  // Latch: once the student is verified terminal (attempt terminated /
  // submitted, or runtime structurally complete), later stale nonterminal
  // snapshots must not be able to unverify that state (FEX-012).
  // NOTE: the latch is intentionally revision-blind — the provider trusts
  // any structurally-completed snapshot it receives; correctness relies on
  // the route-data layer (useStudentSessionRouteData) discarding stale
  // out-of-order frames BEFORE they reach the provider.
  terminalVerified: boolean;
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
  runtimeContractIssue: RuntimeContractIssue;
  answerControlsLocked: boolean;
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
  refreshRuntime: () => Promise<void>;
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
  onRefreshRuntime?: (() => Promise<void>) | undefined;
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

function resolveAnchoredDeadlineMs(
  runtime: ExamSessionRuntime,
  nowMs: number,
  clockOffsetMs: number,
): number | null {
  if (!Number.isFinite(runtime.currentSectionRemainingSeconds) || runtime.currentSectionRemainingSeconds < 0) {
    return null;
  }

  const serverNowMs = runtime.serverNow ? Date.parse(runtime.serverNow) : Number.NaN;
  const anchoredBaseMs = Number.isFinite(serverNowMs)
    ? serverNowMs
    : nowMs + clockOffsetMs;
  return anchoredBaseMs + runtime.currentSectionRemainingSeconds * 1_000;
}

function getActiveRuntimeSection(
  runtime: ExamSessionRuntime | null,
): ExamSessionRuntime['sections'][number] | null {
  if (!runtime?.currentSectionKey) {
    return null;
  }

  return runtime.sections.find((section) => section.sectionKey === runtime.currentSectionKey) ?? null;
}

function getRuntimeContractIssue(
  runtimeBacked: boolean,
  phase: ExamPhase,
  runtime: ExamSessionRuntime | null,
): RuntimeContractIssue {
  if (!runtimeBacked || phase !== 'exam' || !runtime || runtime.status !== 'live') {
    return null;
  }

  if (!runtime.currentSectionKey) {
    return 'missing_active_section';
  }

  const activeSection = getActiveRuntimeSection(runtime);
  if (!activeSection) {
    return 'missing_active_section';
  }

  if (activeSection.pausedAt) {
    return 'stale_paused_at';
  }

  if (runtime.waitingForNextSection && activeSection.status === 'completed') {
    return null;
  }

  if (activeSection.status !== 'live') {
    return 'missing_active_section';
  }

  if (
    !Number.isFinite(runtime.currentSectionRemainingSeconds) ||
    runtime.currentSectionRemainingSeconds < 0
  ) {
    return 'invalid_remaining_seconds';
  }

  return null;
}

function getRuntimeExtensionMinutes(runtime: ExamSessionRuntime | null): number {
  const extensionMinutes = getActiveRuntimeSection(runtime)?.extensionMinutes;
  return typeof extensionMinutes === 'number' && Number.isFinite(extensionMinutes)
    ? Math.max(0, extensionMinutes)
    : 0;
}

function buildRuntimeTimerIdentity(runtime: ExamSessionRuntime | null): string | null {
  if (!runtime?.currentSectionKey) {
    return null;
  }

  return `${runtime.currentSectionKey}:${getRuntimeExtensionMinutes(runtime)}`;
}

function parseRuntimeDeadlineMs(runtime: ExamSessionRuntime | null): number | null {
  if (!runtime || typeof runtime.currentSectionDeadlineAt !== 'string') {
    return null;
  }

  const deadlineMs = Date.parse(runtime.currentSectionDeadlineAt);
  return Number.isFinite(deadlineMs) ? deadlineMs : null;
}

function resolveRuntimeTimerAnchor(
  options: RuntimeTimerAnchorOptions,
): RuntimeTimerAnchor | null {
  const {
    runtimeBacked,
    phase,
    runtime,
    nowMs,
    clockOffsetMs,
    currentAnchor,
  } = options;
  if (!runtimeBacked || phase !== 'exam' || !runtime || runtime.status !== 'live') {
    return null;
  }

  const sectionKey = runtime.currentSectionKey;
  const extensionMinutes = getRuntimeExtensionMinutes(runtime);
  const timerIdentityChanged =
    currentAnchor === null ||
    currentAnchor.sectionKey !== sectionKey ||
    extensionMinutes > currentAnchor.extensionMinutes;
  const validDeadlineMs = parseRuntimeDeadlineMs(runtime);
  const candidateDeadlineMs =
    validDeadlineMs ?? resolveAnchoredDeadlineMs(runtime, nowMs, clockOffsetMs);

  if (candidateDeadlineMs === null) {
    return currentAnchor;
  }

  if (timerIdentityChanged || currentAnchor === null) {
    return {
      sectionKey,
      extensionMinutes,
      deadlineMs: candidateDeadlineMs,
    };
  }

  // A same-section response may shorten the deadline (authoritative correction),
  // but it must never grant extra time without a verified extension.
  if (candidateDeadlineMs < currentAnchor.deadlineMs) {
    return {
      ...currentAnchor,
      deadlineMs: candidateDeadlineMs,
    };
  }

  return currentAnchor;
}

function runtimeTimerAnchorsEqual(
  left: RuntimeTimerAnchor | null,
  right: RuntimeTimerAnchor | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  return (
    left.sectionKey === right.sectionKey &&
    left.extensionMinutes === right.extensionMinutes &&
    left.deadlineMs === right.deadlineMs
  );
}

function resolveRuntimeDisplayRemainingSeconds(options: {
  runtimeBacked: boolean;
  runtimeSnapshot: ExamSessionRuntime | null;
  phase: ExamPhase;
  fallbackSeconds: number;
  clockOffsetMs: number;
  nowMs: number;
  authoritativeDeadlineMs: number | null;
}): number | null {
  if (!options.runtimeBacked || options.phase !== 'exam') {
    return null;
  }

  const runtime = options.runtimeSnapshot;
  if (!runtime || runtime.status !== 'live') {
    return options.fallbackSeconds;
  }

  const activeSection = getActiveRuntimeSection(runtime);
  if (!activeSection || activeSection.status !== 'live' || activeSection.pausedAt) {
    return options.fallbackSeconds;
  }

  const deadlineMs =
    options.authoritativeDeadlineMs ??
    parseRuntimeDeadlineMs(runtime) ??
    resolveAnchoredDeadlineMs(runtime, options.nowMs, options.clockOffsetMs);
  if (deadlineMs === null) {
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
  runtimeContractIssue: RuntimeContractIssue,
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

  if (
    runtimeContractIssue === 'missing_active_section' ||
    runtimeContractIssue === 'stale_paused_at' ||
    runtimeContractIssue === 'invalid_remaining_seconds'
  ) {
    return {
      active: true,
      reason: 'waiting_for_runtime',
      runtimeStatus,
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

  if (runtimeBacked && attemptSnapshot.integrity.preCheck?.completedAt) {
    const runtimeIsActive = runtimeSnapshot?.status === 'live' || runtimeSnapshot?.status === 'paused';
    return runtimeIsActive ? 'exam' : 'lobby';
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
  const terminalVerified =
    attemptSnapshot?.proctorStatus === 'terminated' ||
    Boolean(attemptSnapshot?.submittedAt) ||
    isRuntimeStructurallyCompleted(runtimeSnapshot);
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
    terminalVerified,
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
      // Only a waiting lobby (pre-check completed) may be promoted by an
      // active runtime; a pending pre-check must stay on the briefing, and an
      // already-advanced phase must never be demoted by a stale response.
      const shouldPromoteToExamPhase =
        state.phase === 'lobby' &&
        !terminalVerified &&
        (runtimeStatus === 'live' || runtimeStatus === 'paused');
      if (action.preserveLocalAdvance && !terminalVerified) {
        return state;
      }
      const nextPhase =
        terminalVerified
          ? 'post-exam'
          : shouldPromoteToExamPhase
            ? 'exam'
            : state.phase === 'pre-check' || state.phase === 'lobby'
              ? state.phase
              : state.phase === 'exam' || state.phase === 'post-exam'
                ? state.phase
                : 'lobby';
      const nextTerminalVerified = terminalVerified || state.terminalVerified;
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
        state.waitingForCohortAdvance === nextWaitingForCohortAdvance &&
        state.terminalVerified === nextTerminalVerified
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
        terminalVerified: nextTerminalVerified,
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
      const runtimeIsActive = action.runtimeSnapshot?.status === 'live' || action.runtimeSnapshot?.status === 'paused';
      const nextPhase =
        terminalVerified
          ? 'post-exam'
          : action.runtimeBacked && !runtimeIsActive && action.snapshot.integrity.preCheck?.completedAt
            ? state.phase === 'exam' || state.phase === 'post-exam'
              ? state.phase
              : 'lobby'
            : action.snapshot.phase === 'post-exam'
              ? action.runtimeBacked
                ? state.phase === 'pre-check'
                  ? 'pre-check'
                  : state.phase === 'post-exam'
                    ? 'post-exam'
                    : 'exam'
                : 'post-exam'
              : state.phase;
      const nextTerminalVerified = terminalVerified || state.terminalVerified;

      if (
        state.phase === nextPhase &&
        state.proctorStatus === nextProctorStatus &&
        state.proctorNote === nextProctorNote &&
        state.submittedAt === nextSubmittedAt &&
        state.blockingReasonOverride === nextBlockingMachine.current &&
        state.terminalVerified === nextTerminalVerified &&
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
        terminalVerified: nextTerminalVerified,
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
      // A student with a pending pre-check must stay on the briefing even when
      // the runtime is already active: promotion to the exam requires the
      // pre-check to be completed (FEX-010).
      const shouldPromoteToExamPhase =
        action.runtimeBacked &&
        !terminalVerified &&
        Boolean(action.snapshot.integrity.preCheck?.completedAt) &&
        (runtimeStatus === 'live' || runtimeStatus === 'paused');
      const completedPreCheckInRuntimeBackedFlow =
        action.runtimeBacked && Boolean(action.snapshot.integrity.preCheck?.completedAt);
      const nextPhase = terminalVerified
        ? 'post-exam'
        : shouldPromoteToExamPhase
          ? 'exam'
          : completedPreCheckInRuntimeBackedFlow
            ? state.phase === 'exam' || state.phase === 'post-exam'
              ? state.phase
              : 'lobby'
            : action.snapshot.phase === 'post-exam'
              ? action.runtimeBacked
                ? state.phase === 'pre-check'
                  ? 'pre-check'
                  : state.phase === 'post-exam'
                    ? 'post-exam'
                    : 'exam'
                : 'post-exam'
              : action.snapshot.phase;
      const nextTerminalVerified = terminalVerified || state.terminalVerified;
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
        state.terminalVerified === nextTerminalVerified &&
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
        terminalVerified: nextTerminalVerified,
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
            terminalVerified: true,
            currentSectionExtensionMinutes: null,
            waitingForCohortAdvance: false,
          };
        }

        if (!action.nextModule) {
          return {
            ...state,
            phase: 'post-exam',
            terminalVerified: true,
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
        // A client-side terminate is a genuinely terminal observation: latch
        // it so a runtime-backed student is not bounced back into the
        // workspace while the server attempt (proctorStatus: terminated)
        // catches up (FEX-012).
        terminalVerified: true,
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
  onRefreshRuntime,
}: StudentRuntimeProviderProps) {
  const enabledModules = useMemo(() => getEnabledModules(state.config), [state.config]);
  const [runtimeState, dispatch] = useReducer(
    runtimeReducer,
    createInitialRuntimeState(state, runtimeBacked, runtimeSnapshot, attemptSnapshot),
  );
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [derivedClockNowMs, setDerivedClockNowMs] = useState(() => Date.now());
  const runtimeSnapshotRef = useRef(runtimeSnapshot);
  runtimeSnapshotRef.current = runtimeSnapshot;
  const clockOffsetMsRef = useRef(clockOffsetMs);
  clockOffsetMsRef.current = clockOffsetMs;
  const attemptSnapshotRef = useRef(attemptSnapshot);
  attemptSnapshotRef.current = attemptSnapshot;
  const runtimeStateRef = useRef(runtimeState);
  runtimeStateRef.current = runtimeState;
  const lastTickMonotonicMsRef = useRef<number | null>(null);
  const lastTickWallMsRef = useRef<number | null>(null);
  const stallEmittedRef = useRef(false);
  const displayTimeRemainingRef = useRef<number | undefined>(undefined);
  const missingDeadlineEpisodeRef = useRef<string | null>(null);
  const runtimeTimerAnchorRef = useRef<RuntimeTimerAnchor | null>(null);
  // The anchor of the most recent *committed* render. Held in state so that
  // deadline resolution during render is a pure function of props/state: the
  // ref is only written after commit (layout effect) and must never be read
  // or written while React is rendering.
  const [committedRuntimeTimerAnchor, setCommittedRuntimeTimerAnchor] = useState<RuntimeTimerAnchor | null>(null);
  const lastDisplayedTimerRef = useRef<{ identity: string | null; value: number | undefined } | null>(null);
  const localZeroTimerIdentityRef = useRef<string | null>(null);
  const runtimeContractEpisodeRef = useRef<string | null>(null);
  const onRefreshRuntimeRef = useRef(onRefreshRuntime);
  onRefreshRuntimeRef.current = onRefreshRuntime;

  const lastHydratedAttemptRef = useRef<string | null>(
    attemptSnapshot
      ? `${attemptSnapshot.id}:${attemptSnapshot.updatedAt}:${getDroppedMutationMarker(attemptSnapshot.recovery.lastDroppedMutations) ?? ''}`
      : null,
  );
  const runtimeContractIssue = getRuntimeContractIssue(runtimeBacked, runtimeState.phase, runtimeSnapshot);
  const runtimeTimerIdentity =
    runtimeBacked && runtimeState.phase === 'exam' ? buildRuntimeTimerIdentity(runtimeSnapshot) : null;
  const resolvedRuntimeTimerAnchor = resolveRuntimeTimerAnchor({
    runtimeBacked,
    phase: runtimeState.phase,
    runtime: runtimeSnapshot,
    nowMs: derivedClockNowMs,
    clockOffsetMs,
    currentAnchor: committedRuntimeTimerAnchor,
  });
  const runtimeTimerDeadlineMs = resolvedRuntimeTimerAnchor?.deadlineMs ?? null;
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
    if (!runtimeBacked || runtimeState.phase !== 'exam' || !runtimeSnapshot) {
      runtimeContractEpisodeRef.current = null;
      missingDeadlineEpisodeRef.current = null;
      return;
    }
    if (runtimeSnapshot.status !== 'live') {
      runtimeContractEpisodeRef.current = null;
      missingDeadlineEpisodeRef.current = null;
      return;
    }

    const activeSection = getActiveRuntimeSection(runtimeSnapshot);
    if (runtimeContractIssue) {
      const episodeKey = `${runtimeContractIssue}:${runtimeSnapshot.scheduleId}:${runtimeSnapshot.currentSectionKey ?? 'none'}`;
      if (runtimeContractEpisodeRef.current === episodeKey) {
        return;
      }

      runtimeContractEpisodeRef.current = episodeKey;
      emitStudentObservabilityMetric(
        'student_timer_runtime_contract_mismatch_total',
        withStudentObservabilityDimensions({
          scheduleId: runtimeSnapshot.scheduleId,
          attemptId: attemptSnapshot?.id ?? null,
          endpoint: `/v1/student/sessions/${runtimeSnapshot.scheduleId}/live`,
          statusCode: 200,
          reason: runtimeContractIssue,
          syncState: runtimeState.attemptSyncState,
          runtimeRevision: runtimeSnapshot.revision ?? null,
          attemptRevision: attemptSnapshot?.revision ?? null,
          runtimeStatus: runtimeSnapshot.status,
          currentSectionKey: runtimeSnapshot.currentSectionKey ?? null,
          sectionStatus: activeSection?.status ?? null,
          snapshotRemainingSeconds: runtimeSnapshot.currentSectionRemainingSeconds,
          deadlineAt: runtimeSnapshot.currentSectionDeadlineAt ?? null,
          serverNow: runtimeSnapshot.serverNow ?? null,
          documentVisibilityState:
            typeof document === 'undefined' || typeof document.visibilityState !== 'string'
              ? null
              : document.visibilityState,
          navigatorOnline: typeof navigator === 'undefined' ? null : navigator.onLine,
        }),
      );

      if (onRefreshRuntimeRef.current) {
        void Promise.resolve(onRefreshRuntimeRef.current()).catch(() => {});
      }
      return;
    }

    runtimeContractEpisodeRef.current = null;
    const remainingSecondsFinite =
      Number.isFinite(runtimeSnapshot.currentSectionRemainingSeconds) &&
      runtimeSnapshot.currentSectionRemainingSeconds >= 0;

    let deadlineIssue: 'missing_live_deadline' | 'invalid_deadline' | null = null;
    if (runtimeSnapshot.currentSectionDeadlineAt === null || runtimeSnapshot.currentSectionDeadlineAt === undefined) {
      deadlineIssue = remainingSecondsFinite ? 'missing_live_deadline' : null;
    } else if (
      typeof runtimeSnapshot.currentSectionDeadlineAt !== 'string' ||
      !Number.isFinite(Date.parse(runtimeSnapshot.currentSectionDeadlineAt))
    ) {
      deadlineIssue = remainingSecondsFinite ? 'invalid_deadline' : null;
    }

    if (deadlineIssue === null || !activeSection) {
      missingDeadlineEpisodeRef.current = null;
      return;
    }

    const episodeKey = `${deadlineIssue}:${runtimeSnapshot.scheduleId}:${runtimeSnapshot.currentSectionKey ?? 'none'}`;
    if (missingDeadlineEpisodeRef.current === episodeKey) {
      return;
    }
    missingDeadlineEpisodeRef.current = episodeKey;

    const anchoredDeadlineMs = resolveAnchoredDeadlineMs(
      runtimeSnapshot,
      Date.now(),
      clockOffsetMsRef.current,
    );
    emitStudentObservabilityMetric(
      deadlineIssue === 'invalid_deadline'
        ? 'student_timer_invalid_deadline_total'
        : 'student_timer_missing_deadline_total',
      withStudentObservabilityDimensions({
        scheduleId: runtimeSnapshot.scheduleId,
        attemptId: attemptSnapshot?.id ?? null,
        endpoint: `/v1/student/sessions/${runtimeSnapshot.scheduleId}/live`,
        statusCode: 200,
        reason: deadlineIssue,
        syncState: runtimeState.attemptSyncState,
        runtimeRevision: runtimeSnapshot.revision ?? null,
        attemptRevision: attemptSnapshot?.revision ?? null,
        runtimeStatus: runtimeSnapshot.status,
        currentSectionKey: runtimeSnapshot.currentSectionKey ?? null,
        sectionStatus: activeSection.status,
        snapshotRemainingSeconds: runtimeSnapshot.currentSectionRemainingSeconds,
        deadlineAt: runtimeSnapshot.currentSectionDeadlineAt ?? null,
        serverNow: runtimeSnapshot.serverNow ?? null,
        documentVisibilityState:
          typeof document === 'undefined' || typeof document.visibilityState !== 'string'
            ? null
            : document.visibilityState,
        navigatorOnline: typeof navigator === 'undefined' ? null : navigator.onLine,
        anchoredDeadlineMs,
        missingDeadline: deadlineIssue === 'missing_live_deadline',
      }),
    );

    if (onRefreshRuntimeRef.current) {
      void Promise.resolve(onRefreshRuntimeRef.current()).catch(() => {});
    }
  }, [
    attemptSnapshot?.id,
    attemptSnapshot?.revision,
    runtimeBacked,
    runtimeContractIssue,
    runtimeSnapshot,
    runtimeState.attemptSyncState,
    runtimeState.phase,
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

  // Commit the timer anchor only after the corresponding snapshot actually
  // commits. Layout effect: runs synchronously at commit, before paint and
  // before any passive effect or subsequent render, so an abandoned render
  // can never leak its deadline into the ref or the committed tree.
  // State drives render, the ref drives effects, and this layout effect
  // reconciles both at commit.
  useLayoutEffect(() => {
    const nextAnchor = resolveRuntimeTimerAnchor({
      runtimeBacked,
      phase: runtimeState.phase,
      runtime: runtimeSnapshot,
      nowMs: Date.now(),
      clockOffsetMs,
      currentAnchor: runtimeTimerAnchorRef.current,
    });
    runtimeTimerAnchorRef.current = nextAnchor;
    setCommittedRuntimeTimerAnchor((previous) =>
      runtimeTimerAnchorsEqual(previous, nextAnchor) ? previous : nextAnchor,
    );
  }, [clockOffsetMs, runtimeBacked, runtimeSnapshot, runtimeState.phase]);

  useEffect(() => {
    if (!runtimeBacked || runtimeState.phase !== 'exam') {
      return;
    }

    const scheduleVisibleSecondTick = () => {
      const deadlineMs = runtimeTimerAnchorRef.current?.deadlineMs ?? null;
      if (deadlineMs === null) {
        return 1_000;
      }

      const adjustedNowMs = Date.now() + clockOffsetMsRef.current;
      const remainingMs = Math.max(0, deadlineMs - adjustedNowMs);
      const msUntilNextVisibleSecond = remainingMs % 1_000;
      return Math.max(100, msUntilNextVisibleSecond === 0 ? 1_000 : msUntilNextVisibleSecond + 5);
    };

    let cancelled = false;
    let timerId: number | null = null;

    const tick = () => {
      if (cancelled) {
        return;
      }
      setDerivedClockNowMs(Date.now());
      timerId = window.setTimeout(tick, scheduleVisibleSecondTick());
    };

    timerId = window.setTimeout(tick, scheduleVisibleSecondTick());

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    runtimeBacked,
    runtimeState.phase,
    runtimeTimerIdentity,
    runtimeSnapshot?.status,
    runtimeSnapshot?.currentSectionDeadlineAt,
  ]);

  useEffect(() => {
    if (!runtimeBacked || runtimeState.phase !== 'exam') {
      return;
    }

    const recalculateFromDeadline = () => {
      setDerivedClockNowMs(Date.now());
    };

    document.addEventListener('visibilitychange', recalculateFromDeadline);
    window.addEventListener('pageshow', recalculateFromDeadline);
    window.addEventListener('focus', recalculateFromDeadline);
    return () => {
      document.removeEventListener('visibilitychange', recalculateFromDeadline);
      window.removeEventListener('pageshow', recalculateFromDeadline);
      window.removeEventListener('focus', recalculateFromDeadline);
    };
  }, [runtimeBacked, runtimeState.phase]);

  useEffect(() => {
    // Record tick observations so the stall detector can compare the visible
    // remaining-time countdown (monotonic) against real wall-clock elapsed
    // time. Runs on derived clock changes only (value-based, so it does not
    // churn on snapshot identity), and reads everything else via refs.
    // lastTickMonotonicMsRef = expected remaining countdown in ms (monotonic);
    // lastTickWallMsRef = Date.now() at that observation (wall clock).
    if (!runtimeBacked || runtimeState.phase !== 'exam') {
      lastTickMonotonicMsRef.current = null;
      lastTickWallMsRef.current = null;
      stallEmittedRef.current = false;
      return;
    }

    const runtime = runtimeSnapshotRef.current;
    if (!runtime || runtime.status !== 'live') {
      lastTickMonotonicMsRef.current = null;
      lastTickWallMsRef.current = null;
      stallEmittedRef.current = false;
      return;
    }

    const deadlineMs = runtimeTimerAnchorRef.current?.deadlineMs ?? null;
    if (deadlineMs === null) {
      lastTickMonotonicMsRef.current = null;
      lastTickWallMsRef.current = null;
      stallEmittedRef.current = false;
      return;
    }

    const nowWallMs = Date.now();
    const adjustedNowMs = nowWallMs + clockOffsetMsRef.current;
    const expectedRemainingMs = Math.max(0, deadlineMs - adjustedNowMs);

    lastTickMonotonicMsRef.current = expectedRemainingMs;
    lastTickWallMsRef.current = nowWallMs;
    stallEmittedRef.current = false;

    const displayRemaining = displayTimeRemainingRef.current;
    const expectedRemainingSeconds = Math.max(0, Math.ceil(expectedRemainingMs / 1_000));
    if (typeof displayRemaining === 'number') {
      const dimensions = withStudentObservabilityDimensions({
        scheduleId: runtime.scheduleId,
        attemptId: attemptSnapshotRef.current?.id ?? null,
        endpoint: `/v1/student/sessions/${runtime.scheduleId}/live`,
        statusCode: 200,
        reason: 'deadline_tick',
        syncState: runtimeStateRef.current.attemptSyncState,
        runtimeRevision: runtime.revision ?? null,
        attemptRevision: attemptSnapshotRef.current?.revision ?? null,
        runtimeStatus: runtime.status,
        currentSectionKey: runtime.currentSectionKey ?? null,
        sectionStatus: getActiveRuntimeSection(runtime)?.status ?? null,
        displayTimeRemaining: displayRemaining,
        expectedRemainingSeconds,
        snapshotRemainingSeconds: runtime.currentSectionRemainingSeconds,
        deadlineAt: runtime.currentSectionDeadlineAt ?? null,
        serverNow: runtime.serverNow ?? null,
        clockOffsetMs: clockOffsetMsRef.current,
        documentVisibilityState:
          typeof document === 'undefined' || typeof document.visibilityState !== 'string'
            ? null
            : document.visibilityState,
        navigatorOnline: typeof navigator === 'undefined' ? null : navigator.onLine,
      });
      emitStudentObservabilityMetric('student_timer_tick_total', dimensions);
      if (displayRemaining === expectedRemainingSeconds) {
        emitStudentObservabilityMetric('student_timer_tick_expected_total', dimensions);
      }
    }
  }, [derivedClockNowMs, runtimeBacked, runtimeState.phase]);

  useEffect(() => {
    if (!runtimeBacked || runtimeState.phase !== 'exam') {
      return;
    }

    const intervalId = window.setInterval(() => {
      const runtime = runtimeSnapshotRef.current;
      if (!runtime || runtime.status !== 'live') {
        return;
      }
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
        return;
      }
      if (typeof navigator === 'undefined' || navigator.onLine === false) {
        return;
      }

      const sectionKey = runtime.currentSectionKey;
      const activeSection = sectionKey
        ? runtime.sections.find((section) => section.sectionKey === sectionKey)
        : null;
      if (!activeSection || activeSection.status !== 'live' || activeSection.pausedAt) {
        return;
      }

      const deadlineMs = runtimeTimerAnchorRef.current?.deadlineMs ?? null;
      if (deadlineMs === null) {
        return;
      }

      const nowWallMs = Date.now();
      const adjustedNowMs = nowWallMs + clockOffsetMsRef.current;
      const expectedRemainingMs = Math.max(0, deadlineMs - adjustedNowMs);
      const lastTick = lastTickMonotonicMsRef.current;
      const lastTickWall = lastTickWallMsRef.current;

      if (lastTick === null || lastTickWall === null) {
        // No observation yet: establish baselines and wait for a real tick.
        lastTickMonotonicMsRef.current = expectedRemainingMs;
        lastTickWallMsRef.current = nowWallMs;
        stallEmittedRef.current = false;
        return;
      }

      const expectedRemainingChanged = expectedRemainingMs !== lastTick;
      const wallElapsedMs = nowWallMs - lastTickWall;
      const tickStalled = expectedRemainingChanged && wallElapsedMs > 1_500;

      if (!tickStalled) {
        return;
      }

      if (stallEmittedRef.current) {
        return;
      }
      stallEmittedRef.current = true;

      const runtimeStateNow = runtimeStateRef.current;
      emitStudentObservabilityMetric(
        'student_timer_stall_total',
        withStudentObservabilityDimensions({
          scheduleId: runtime.scheduleId,
          attemptId: attemptSnapshotRef.current?.id ?? null,
          endpoint: `/v1/student/sessions/${runtime.scheduleId}/live`,
          statusCode: 200,
          reason: 'visible_tick_stall',
          syncState: runtimeStateNow.attemptSyncState,
          runtimeRevision: runtime.revision ?? null,
          attemptRevision: attemptSnapshotRef.current?.revision ?? null,
          runtimeStatus: runtime.status,
          currentSectionKey: runtime.currentSectionKey ?? null,
          sectionStatus: activeSection.status,
          displayTimeRemaining: displayTimeRemainingRef.current ?? null,
          snapshotRemainingSeconds: runtime.currentSectionRemainingSeconds,
          deadlineAt: runtime.currentSectionDeadlineAt ?? null,
          serverNow: runtime.serverNow ?? null,
          documentVisibilityState: 'visible',
          navigatorOnline: navigator.onLine,
          clockOffsetMs: clockOffsetMsRef.current,
        }),
      );
    }, 500);

    return () => {
      window.clearInterval(intervalId);
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
        runtimeContractIssue,
        runtimeState.timeRemaining,
      ),
    [
      runtimeBacked,
      runtimeContractIssue,
      runtimeState.proctorStatus,
      runtimeSnapshot,
      runtimeState.blockingReasonOverride,
      runtimeState.timeRemaining,
      runtimeState.waitingForCohortAdvance,
    ],
  );
  const runtimeStatus = runtimeBacked ? runtimeSnapshot?.status ?? 'not_started' : null;
  const resolvedDisplayTimeRemaining = runtimeState.phase === 'exam'
    ? runtimeBacked
      ? resolveRuntimeDisplayRemainingSeconds({
          runtimeBacked,
          runtimeSnapshot,
          phase: runtimeState.phase,
          fallbackSeconds: runtimeState.timeRemaining,
          clockOffsetMs,
          nowMs: derivedClockNowMs,
          authoritativeDeadlineMs: runtimeTimerDeadlineMs,
        }) ?? runtimeState.timeRemaining
      : runtimeState.timeRemaining
    : undefined;

  let displayTimeRemaining = resolvedDisplayTimeRemaining;
  if (runtimeTimerIdentity !== null && typeof resolvedDisplayTimeRemaining === 'number') {
    const previousDisplayedTimer = lastDisplayedTimerRef.current;
    if (
      previousDisplayedTimer?.identity === runtimeTimerIdentity &&
      typeof previousDisplayedTimer.value === 'number'
    ) {
      displayTimeRemaining = Math.min(resolvedDisplayTimeRemaining, previousDisplayedTimer.value);
    }
  }

  const submitRequiresConfirmation = false;
  const answerControlsLocked =
    runtimeBacked &&
    runtimeState.phase === 'exam' &&
    (blocking.active ||
      runtimeContractIssue !== null ||
      displayTimeRemaining === 0 ||
      localZeroTimerIdentityRef.current === runtimeTimerIdentity);

  useEffect(() => {
    // Commit the displayed remaining time only after this render commits so
    // observability consumers never observe a value from an abandoned render.
    displayTimeRemainingRef.current = displayTimeRemaining;
    lastDisplayedTimerRef.current = {
      identity: runtimeTimerIdentity,
      value: displayTimeRemaining,
    };

    if (runtimeTimerIdentity === null || typeof displayTimeRemaining !== 'number') {
      localZeroTimerIdentityRef.current = null;
    } else if (displayTimeRemaining === 0) {
      localZeroTimerIdentityRef.current = runtimeTimerIdentity;
    } else if (localZeroTimerIdentityRef.current !== runtimeTimerIdentity) {
      localZeroTimerIdentityRef.current = null;
    }
  }, [displayTimeRemaining, runtimeTimerIdentity]);

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

  const refreshRuntime = useCallback(async () => {
    if (onRefreshRuntimeRef.current) {
      await onRefreshRuntimeRef.current();
    }
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
      runtimeContractIssue,
      answerControlsLocked,
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
      refreshRuntime,
    },
    examState: state,
    onExit,
  }), [
    addViolation,
    allQuestions,
    blocking,
    answerControlsLocked,
    clearViolations,
    pauseExam,
    displayTimeRemaining,
    onExit,
    resetElapsedTime,
    runtimeBacked,
    runtimeContractIssue,
    runtimeSnapshot,
    runtimeState,
    runtimeStatus,
    setAttemptSyncState,
    refreshRuntime,
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
