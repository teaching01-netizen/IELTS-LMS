export {
  backendPost,
  buildStudentHeartbeatEvent,
  hasAttemptCredential,
  ensureClientSessionIdForAttempt,
  rotateClientSessionIdForAttempt,
  restoreClientSessionIdForAttempt,
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
