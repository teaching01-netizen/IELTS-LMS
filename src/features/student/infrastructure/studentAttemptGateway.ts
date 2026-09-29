export { backendPost } from "@services/backendBridge";
export { buildStudentHeartbeatEvent } from "@services/studentIntegrityService";
export {
  createStudentClientSessionId,
  hasAttemptCredential,
  ensureClientSessionIdForStudentKey,
  ensureClientSessionIdForAttempt,
  ensureBrowserClientSessionIdForAttempt,
  rotateClientSessionIdForAttempt,
  restoreClientSessionIdForStudentKey,
  restoreClientSessionIdForAttempt,
  satWriterStudentKey,
  mapBackendStudentAttempt,
  refreshAttemptCredentialForAttempt,
  studentAttemptRepository,
  backendConflictReason,
  clearAttemptMutationWatermark,
} from "@services/studentAttemptRepository";
export {
  buildQueuedMutationUpdate,
  createStudentMutationOutbox,
  PendingMutationDurabilityMirror,
  readAnswerSyncCheckpoint,
} from "@services/studentMutationOutbox";
export type { DurablePersistTriggerSource } from "@services/studentMutationOutbox";
export { saveStudentAuditEvent } from "@services/studentAuditService";
