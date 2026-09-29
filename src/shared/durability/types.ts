/**
 * Exam Response Durability V2 — Domain & Contract Types
 */

export interface ResponsePayload {
  answer: string | string[] | null;
  markedForReview: boolean;
  eliminatedOptions: string[];
  annotations: Array<{ id: string; [key: string]: unknown }>;
}

export type DurabilityTier = 'memory' | 'checkpoint' | 'indexeddb';

export interface ConfirmedResponseState {
  payload: ResponsePayload;
  serverRevision: number;
  contentHash: string;
}

export interface BlockedResponseInfo {
  reason: string;
  blockedAt: string;
}

export interface PendingResponseState {
  payload: ResponsePayload;
  writeId: string;
  leaseEpoch: number;
  controlEpoch: number;
  clientVersion: number;
  durability: DurabilityTier;
  /** Wall-clock accept time (ISO). Present on records written after the
   *  durability repair; absent on older records, which sort as oldest. */
  receivedAt?: string;
  /** In-session accept order. Tiebreak for equal timestamps only. */
  order?: number;
  /** Present when the draft is visible but must never be sent without an
   *  explicit reconcile or discard decision (control-epoch stall, version
   *  collision, stale hydration). */
  blocked?: BlockedResponseInfo;
}

export interface QuestionResponseState {
  confirmed: ConfirmedResponseState | null;
  pending: PendingResponseState | null;
}

export function getVisibleResponse(state: QuestionResponseState | undefined): ResponsePayload | null {
  if (!state) return null;
  return state.pending?.payload ?? state.confirmed?.payload ?? null;
}

export type ResponseOutcome = 'applied' | 'duplicate' | 'superseded';

export interface ResponseCommandV2 {
  writeId: string;
  questionId: string;
  clientVersion: number;
  response: ResponsePayload;
}

export interface ResponseBatchRequestV2 {
  leaseEpoch: number;
  controlEpoch: number;
  commands: ResponseCommandV2[];
}

export interface ResponseAcknowledgementV2 {
  writeId: string;
  questionId: string;
  clientVersion: number;
  outcome: ResponseOutcome;
  serverRevision: number;
  canonicalResponse: ResponsePayload;
  contentHash: string;
}

export interface ResponseBatchResponseV2 {
  attemptRevision: number;
  serverTime: string;
  acknowledgements: ResponseAcknowledgementV2[];
}

export interface ResponseSnapshotV2 {
  attemptId: string;
  protocolVersion: number;
  deliveryStatus: string;
  leaseEpoch: number;
  controlEpoch: number;
  attemptRevision: number;
  deadlineAt?: string | null;
  closingGraceUntil?: string | null;
  responses: ResponseAcknowledgementV2[];
}

export interface SubmitAttemptV2Request {
  submissionId: string;
  leaseEpoch: number;
  controlEpoch: number;
  finalCommands: ResponseCommandV2[];
  expectedAttemptRevision: number;
}

export interface SubmitAttemptV2Response {
  attemptId: string;
  submissionId: string;
  status: string;
  attemptRevision: number;
  finalResponseDigest: string;
  // SAT's V2 submit is a provisional receipt until the provider completion
  // path scores and seals all modules.
  submittedAt: string | null;
  acknowledgements: ResponseAcknowledgementV2[];
}

export type DurabilitySyncStatus =
  | 'synced'
  | 'saving'
  | 'saved_locally'
  | 'blocked_attention'
  | 'durability_fault'
  | 'conflict_fenced'
  | 'conflict_terminal';

export interface QuarantinedWrite {
  writeId: string;
  questionId: string;
  clientVersion: number;
  payload: ResponsePayload;
  reason: string;
  quarantinedAt: string;
}

/**
 * Why an authoritative control epoch offered by a transition ack was not
 * adopted. One closed vocabulary so the telemetry counter and the tests agree
 * on the same names: `invalid_epoch` (unusable value), `engine_not_writable`
 * (destroyed / terminal / submitting), `recovery_pending` (versions not seeded
 * yet), `not_advanced` (equal or older fence), `not_idle` (work still
 * outstanding), `conflict_fenced` (fenced or terminal conflict posture),
 * `durability_fault` (the engine cannot trust its own storage).
 */
export type ControlEpochAdoptionSkipReason =
  | 'invalid_epoch'
  | 'engine_not_writable'
  | 'recovery_pending'
  | 'not_advanced'
  | 'not_idle'
  | 'conflict_fenced'
  | 'durability_fault';

export type ControlEpochAdoptionResult =
  | { adopted: true; controlEpoch: number }
  | { adopted: false; reason: ControlEpochAdoptionSkipReason };
