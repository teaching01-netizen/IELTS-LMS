export { backendPost } from '@services/backendBridge';
export { buildStudentHeartbeatEvent } from '@services/studentIntegrityService';
export {
  buildPendingStudentSubmission,
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
} from '@services/studentAttemptRepository';
export type { FrozenSubmitPayload, PendingStudentSubmission } from '@services/studentAttemptRepository';
export {
  buildQueuedMutationUpdate,
  createStudentMutationOutbox,
  PendingMutationDurabilityMirror,
  readAnswerSyncCheckpoint,
} from '@services/studentMutationOutbox';
export type { DurablePersistTriggerSource } from '@services/studentMutationOutbox';
export { saveStudentAuditEvent } from '@services/studentAuditService';
