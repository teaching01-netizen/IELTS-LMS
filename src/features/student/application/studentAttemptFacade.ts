export {
  backendPost,
  buildPendingStudentSubmission,
  buildStudentHeartbeatEvent,
  extractFrozenSubmitPayload,
  hasAttemptCredential,
  ensureClientSessionIdForAttempt,
  isAuthoritativelySubmittedAttempt,
  isPendingStudentSubmissionExpired,
  isPendingStudentSubmissionRecord,
  mapBackendStudentAttempt,
  peekPendingSubmissionForAttempt,
  PENDING_SUBMISSION_RETRY_WINDOW_MS,
  refreshAttemptCredentialForAttempt,
  studentAttemptRepository,
  backendConflictReason,
  clearAttemptMutationWatermark,
  buildQueuedMutationUpdate,
  createStudentMutationOutbox,
  PendingMutationDurabilityMirror,
  readAnswerSyncCheckpoint,
  saveStudentAuditEvent,
} from '../infrastructure/studentAttemptGateway';

export type { DurablePersistTriggerSource } from '../infrastructure/studentAttemptGateway';
export type { FrozenSubmitPayload, PendingStudentSubmission } from '../infrastructure/studentAttemptGateway';
