import type { ModuleType, StudentStatus, Violation } from '../types';

export type StudentAnswerValue = 
  | string // For text answers, single MCQ selection, matching
  | string[] // For multi-select MCQ
  | 'T' | 'F' | 'NG' | 'Y' | 'N' // For TFNG/YNNG questions
  | null // For cleared answers
  | undefined; // For unassigned answers

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
  id: 'browser' | 'javascript' | 'fullscreen' | 'storage' | 'online' | 'screen-details';
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
  examTitle: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  phase: 'pre-check' | 'lobby' | 'exam' | 'post-exam';
  currentModule: ModuleType;
  currentQuestionId: string | null;
  answers: Record<string, StudentAnswerValue | undefined>;
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
    } | null;
    pendingMutationCount: number;
    serverAcceptedThroughSeq: number;
    clientSessionId: string | null;
    syncState: AttemptSyncState;
  };
  createdAt: string;
  updatedAt: string;
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

export interface StudentAttemptMutation {
  id: string;
  attemptId: string;
  scheduleId: string;
  timestamp: string;
  type: StudentAttemptMutationType;
  payload: Record<string, unknown>;
}

export interface StudentHeartbeatEvent {
  id: string;
  attemptId: string;
  scheduleId: string;
  timestamp: string;
  type: HeartbeatEventType;
  payload?: Record<string, unknown> | undefined;
}
