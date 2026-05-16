import type { ModuleType, StudentStatus, Violation } from '../types';
export type { StudentAnswerValue } from './answers';
import type { StudentAnswerValue } from './answers';

export interface StudentAnswerMutationMeta {
  interactionType?: 'typing' | 'discrete' | undefined;
  slotIndex?: number | undefined;
  slotId?: string | undefined;
  slotCount?: number | undefined;
  slotValue?: string | undefined;
}

export type AttemptSyncState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'syncing_reconnect'
  | 'error';

export type StudentAttemptMutationType =
  | 'answer'
  | 'writing_answer'
  | 'flag'
  | 'violation'
  | 'position'
  | 'precheck'
  | 'network'
  | 'heartbeat'
  | 'device_fingerprint'
  | 'sync';

export type HeartbeatEventType = 'heartbeat' | 'disconnect' | 'reconnect' | 'lost';

export interface StudentPreCheckCheckResult {
  id: 'browser' | 'javascript' | 'storage' | 'online' | 'screen-details';
  label: string;
  message: string;
  required: boolean;
  status: 'pass' | 'warn' | 'fail';
}

export interface StudentPreCheckResult {
  completedAt: string;
  browserFamily: 'chrome' | 'edge' | 'safari' | 'firefox' | 'other';
  browserVersion: number | null;
  screenDetailsSupported: boolean;
  heartbeatReady: boolean;
  acknowledgedSafariLimitation: boolean;
  checks: StudentPreCheckCheckResult[];
}

export interface StudentAttempt {
  id: string;
  scheduleId: string;
  studentKey: string;
  examId: string;
  revision?: number | null;
  publishedVersionId?: string | null;
  examTitle: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  phase: 'pre-check' | 'lobby' | 'exam' | 'post-exam' | 'submitted';
  currentModule: ModuleType;
  currentQuestionId: string | null;
  answers: Record<string, StudentAnswerValue>;
  writingAnswers: Record<string, string>;
  flags: Record<string, boolean>;
  violations: Violation[];
  proctorStatus: StudentStatus;
  proctorNote: string | null;
  proctorUpdatedAt: string | null;
  proctorUpdatedBy: string | null;
  lastWarningId: string | null;
  lastAcknowledgedWarningId: string | null;
  submittedAt?: string | null;
  integrity: {
    preCheck: StudentPreCheckResult | null;
    deviceFingerprintHash: string | null;
    clientSessionId: string | null;
    lastDisconnectAt: string | null;
    lastReconnectAt: string | null;
    lastHeartbeatAt: string | null;
    lastHeartbeatStatus: 'idle' | 'ok' | 'lost';
  };
  recovery: {
    lastRecoveredAt: string | null;
    lastLocalMutationAt: string | null;
    lastPersistedAt: string | null;
    lastDroppedMutations: {
      at: string;
      count: number;
      fromModule: ModuleType | 'multiple' | null;
      toModule: ModuleType | null;
      reason: string;
      affectedAnswers?: string[] | undefined;
      affectedAnswerSlots?:
        | Array<{
            questionId: string;
            slotIndex: number;
          }>
        | undefined;
      affectedWritingAnswers?: string[] | undefined;
      affectedFlags?: string[] | undefined;
    } | null;
    pendingMutationCount: number;
    serverAcceptedThroughSeq: number;
    clientSessionId: string | null;
    syncState: AttemptSyncState;
  };
  createdAt: string;
  updatedAt: string;
}

export interface StudentFinalAnswerPatch {
  answers: StudentAttempt['answers'];
  writingAnswers: StudentAttempt['writingAnswers'];
  flags: StudentAttempt['flags'];
}

export interface StudentAttemptSeed {
  scheduleId: string;
  studentKey: string;
  examId: string;
  examTitle: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  currentModule?: ModuleType | undefined;
  currentQuestionId?: string | null | undefined;
  phase?: StudentAttempt['phase'] | undefined;
}

export interface StudentAttemptMutationBase {
  id: string;
  attemptId: string;
  scheduleId: string;
  timestamp: string;
}

export type StudentAttemptMutationPayloadMap = {
  answer: {
    questionId: string;
    value: StudentAnswerValue;
    module?: ModuleType | undefined;
    interactionType?: StudentAnswerMutationMeta['interactionType'] | undefined;
    slotIndex?: number | undefined;
    slotId?: string | undefined;
    slotCount?: number | undefined;
    slotValue?: string | undefined;
  };
  writing_answer: {
    taskId: string;
    value: string;
    module?: ModuleType | undefined;
  };
  flag: {
    questionId: string;
    value: boolean;
    module?: ModuleType | undefined;
  };
  violation: {
    violations?: Violation[] | undefined;
    violationId?: string | undefined;
    violationType?: string | undefined;
    changedAreas?: string[] | undefined;
  } & Record<string, unknown>;
  position: {
    currentModule?: ModuleType | undefined;
    currentQuestionId?: string | null | undefined;
    phase?: StudentAttempt['phase'] | undefined;
    changedAreas?: string[] | undefined;
  } & Record<string, unknown>;
  precheck: Record<string, unknown>;
  network: Record<string, unknown>;
  heartbeat: Record<string, unknown>;
  device_fingerprint: Record<string, unknown>;
  sync: Record<string, unknown>;
};

export type StudentAttemptMutationPayload<TType extends StudentAttemptMutationType> =
  StudentAttemptMutationPayloadMap[TType];

export type StudentAttemptMutation = {
  [K in StudentAttemptMutationType]: StudentAttemptMutationBase & {
    type: K;
    payload: StudentAttemptMutationPayloadMap[K];
  };
}[StudentAttemptMutationType];

export interface StudentHeartbeatEvent {
  id: string;
  attemptId: string;
  scheduleId: string;
  timestamp: string;
  type: HeartbeatEventType;
  payload?: Record<string, unknown> | undefined;
}
