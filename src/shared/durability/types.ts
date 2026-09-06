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

export interface PendingResponseState {
  payload: ResponsePayload;
  writeId: string;
  leaseEpoch: number;
  controlEpoch: number;
  clientVersion: number;
  durability: DurabilityTier;
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
