export {
  backendPost,
  buildPendingStudentSubmission,
  buildStudentHeartbeatEvent,
  hasAttemptCredential,
  ensureClientSessionIdForAttempt,
  isPendingStudentSubmissionExpired,
  isPendingStudentSubmissionRecord,
  mapBackendStudentAttempt,
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
export type { PendingStudentSubmission } from '../infrastructure/studentAttemptGateway';
