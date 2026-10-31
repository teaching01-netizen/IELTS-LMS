import { backendGet, backendPost } from '@services/backendBridge';

/**
 * Proctor read/review of SAT late-answer evidence
 * (`GET/POST /v1/proctor/sessions/:schedule/attempts/:attempt/late-evidence`).
 *
 * Evidence is immutable and never changes the score or the adaptive route.
 * This client only reads it and records a disposition.
 */
export interface SatLateEvidenceRow {
  id: string;
  sequence: string;
  moduleId: string;
  questionId: string;
  writeId: string;
  response: unknown;
  clientMetadata: unknown;
  serverReceivedAt: string;
  wouldChangeRoute: boolean;
  provenanceConflict: boolean;
  /** The same write is already canonical in attempt_responses_v2. */
  alreadyScored: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewOutcome: 'acknowledged' | 'investigated' | null;
  reviewNote: string | null;
}

export interface SatLateEvidencePage {
  rows: SatLateEvidenceRow[];
  nextCursor: string;
  hasMore: boolean;
}

const base = (scheduleId: string, attemptId: string): string =>
  `/v1/proctor/sessions/${encodeURIComponent(scheduleId)}/attempts/${encodeURIComponent(attemptId)}/late-evidence`;

export function listSatLateEvidence(
  scheduleId: string,
  attemptId: string,
  cursor = '',
): Promise<SatLateEvidencePage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return backendGet<SatLateEvidencePage>(`${base(scheduleId, attemptId)}${query}`, { retries: 0 });
}

export function reviewSatLateEvidence(
  scheduleId: string,
  attemptId: string,
  request: {
    operationId: string;
    evidenceIds: string[];
    outcome: 'acknowledged' | 'investigated';
    note: string;
  },
): Promise<void> {
  return backendPost<void>(`${base(scheduleId, attemptId)}/review`, request, { retries: 0 });
}
