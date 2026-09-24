export {
  backendPost,
  buildStudentHeartbeatEvent,
  createStudentClientSessionId,
  hasAttemptCredential,
  ensureClientSessionIdForStudentKey,
  ensureClientSessionIdForAttempt,
  rotateClientSessionIdForAttempt,
  restoreClientSessionIdForStudentKey,
  restoreClientSessionIdForAttempt,
  satWriterStudentKey,
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
} from "../infrastructure/studentAttemptGateway";

export type { DurablePersistTriggerSource } from "../infrastructure/studentAttemptGateway";
