import {
  backendGet,
  backendPost,
  ensureClientSessionIdForStudentKey,
  restoreClientSessionIdForStudentKey,
  satWriterStudentKey,
  storeAttemptCredential,
  tryBuildAttemptAuthorizationHeader,
  type BackendAttemptCredential,
} from "../infrastructure/assessmentDeliveryBackendGateway";

/**
 * SAT session ownership + device transfer client
 * (docs/superpowers/plans/2026-10-06-sat-session-ownership-and-device-transfer.md).
 *
 * The server owns every decision. This module only carries the browser-owned
 * writer identity, the student cookie session (implicit), and — for the
 * current writer — its attempt bearer. It never adopts another session's id.
 */

export type SatAdmissionOutcome = "authorized" | "blocked" | "closed";
export type SatPolicyStage = "pre_start" | "post_start";

export interface SatAdmission {
  outcome: SatAdmissionOutcome;
  attemptId: string;
  leaseEpoch: number;
  singleWriter: boolean;
  policyStage?: SatPolicyStage;
}

export type SatTransferState =
  | "pending"
  | "approved"
  | "committed"
  | "denied"
  | "cancelled"
  | "expired"
  | "conflicted";

export interface SatDeviceTransfer {
  requestId: string;
  operationId: string;
  attemptId: string;
  scheduleId: string;
  state: SatTransferState;
  policyStage: SatPolicyStage;
  reasonCode: string;
  expectedLeaseEpoch: number;
  requestedAt: string;
  expiresAt: string;
  approvalKind: "current_writer" | "proctor" | null;
  approvedAt: string | null;
  approvalExpiresAt: string | null;
  unconfirmedRiskAcknowledged: boolean;
  decisionReason: string | null;
  decidedAt: string | null;
  resultingLeaseEpoch: number | null;
  committedAt: string | null;
}

interface AdmissionSessionResponse {
  attempt?: { id?: string } | null;
  attemptCredential?: BackendAttemptCredential | null;
  admission?: SatAdmission | null;
}

const base = (scheduleId: string) => `/v1/student/sessions/${encodeURIComponent(scheduleId)}`;

/** This browser's writer identity for the SAT attempt (created on first use). */
export function satBrowserWriterSession(scheduleId: string, candidateId: string): string {
  return ensureClientSessionIdForStudentKey(scheduleId, satWriterStudentKey(scheduleId, candidateId));
}

/**
 * Ask the server whether THIS browser may write. Authorized/closed stores the
 * issued credential; blocked returns the attempt + lease needed to request a
 * device transfer and stores nothing.
 */
export async function checkSatAdmission(
  scheduleId: string,
  candidateId: string,
): Promise<{ admission: SatAdmission | null; attemptId: string | null }> {
  const clientSessionId = satBrowserWriterSession(scheduleId, candidateId);
  const query = new URLSearchParams({ candidateId, refreshAttemptCredential: "true", clientSessionId });
  const session = await backendGet<AdmissionSessionResponse>(`${base(scheduleId)}?${query.toString()}`, {
    retries: 0,
    timeout: 8_000,
  });
  const attemptId = session.admission?.attemptId ?? session.attempt?.id ?? null;
  if (attemptId && session.attemptCredential && session.admission?.outcome !== "blocked") {
    storeAttemptCredential({ id: attemptId, scheduleId }, session.attemptCredential);
  }
  return { admission: session.admission ?? null, attemptId };
}

const operationStorageKey = (scheduleId: string, attemptId: string, clientSessionId: string) =>
  `sat-device-transfer-op:v1:${scheduleId}:${attemptId}:${clientSessionId}`;
const requestStorageKey = (scheduleId: string, candidateId: string) =>
  `sat-device-transfer-request:v1:${scheduleId}:${candidateId}`;

/**
 * Stable operation id per (attempt, target browser): a retried request after a
 * lost response returns the same server request instead of opening another.
 */
function transferOperationId(scheduleId: string, attemptId: string, clientSessionId: string): string {
  const key = operationStorageKey(scheduleId, attemptId, clientSessionId);
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

/** Forget the operation id so a fresh request (after denial/expiry) is new. */
export function forgetSatTransferOperation(scheduleId: string, attemptId: string, clientSessionId: string): void {
  try {
    window.sessionStorage.removeItem(operationStorageKey(scheduleId, attemptId, clientSessionId));
  } catch {
    // Storage denied: the next request mints a new id anyway.
  }
}

/** Remember the open request so a reload resumes polling instead of re-asking. */
export function rememberSatTransferRequest(scheduleId: string, candidateId: string, requestId: string | null): void {
  try {
    const key = requestStorageKey(scheduleId, candidateId);
    if (requestId) window.sessionStorage.setItem(key, requestId);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Best effort; the server still holds the one outstanding request.
  }
}

export function recallSatTransferRequest(scheduleId: string, candidateId: string): string | null {
  try {
    return window.sessionStorage.getItem(requestStorageKey(scheduleId, candidateId));
  } catch {
    return null;
  }
}

export async function requestSatDeviceTransfer(input: {
  scheduleId: string;
  candidateId: string;
  attemptId: string;
  expectedLeaseEpoch: number;
}): Promise<SatDeviceTransfer> {
  const clientSessionId = satBrowserWriterSession(input.scheduleId, input.candidateId);
  const out = await backendPost<{ transfer: SatDeviceTransfer }>(
    `${base(input.scheduleId)}/device-transfers`,
    {
      operationId: transferOperationId(input.scheduleId, input.attemptId, clientSessionId),
      attemptId: input.attemptId,
      clientSessionId,
      expectedLeaseEpoch: input.expectedLeaseEpoch,
      reasonCode: "device_change",
    },
    { retries: 0 },
  );
  return out.transfer;
}

export async function getSatDeviceTransfer(
  scheduleId: string,
  candidateId: string,
  requestId: string,
): Promise<SatDeviceTransfer> {
  const clientSessionId = satBrowserWriterSession(scheduleId, candidateId);
  const query = new URLSearchParams({ clientSessionId });
  const out = await backendGet<{ transfer: SatDeviceTransfer }>(
    `${base(scheduleId)}/device-transfers/${encodeURIComponent(requestId)}?${query.toString()}`,
    { retries: 0 },
  );
  return out.transfer;
}

export async function cancelSatDeviceTransfer(
  scheduleId: string,
  candidateId: string,
  requestId: string,
): Promise<SatDeviceTransfer> {
  const clientSessionId = satBrowserWriterSession(scheduleId, candidateId);
  const query = new URLSearchParams({ clientSessionId });
  const out = await backendPost<{ transfer: SatDeviceTransfer }>(
    `${base(scheduleId)}/device-transfers/${encodeURIComponent(requestId)}/cancel?${query.toString()}`,
    undefined,
    { retries: 0 },
  );
  return out.transfer;
}

/**
 * Redeem an approved transfer. Idempotent: a retry after a lost response
 * recovers the same credential while this browser still owns the lease.
 * Stores the writer credential and pins this browser's writer identity.
 */
export async function commitSatDeviceTransfer(
  scheduleId: string,
  candidateId: string,
  requestId: string,
): Promise<SatDeviceTransfer> {
  const clientSessionId = satBrowserWriterSession(scheduleId, candidateId);
  const out = await backendPost<{
    transfer: SatDeviceTransfer;
    attemptId: string;
    attemptToken: string;
    attemptExpiresAt: string;
    clientSessionId: string;
  }>(
    `${base(scheduleId)}/device-transfers/${encodeURIComponent(requestId)}/commit`,
    { clientSessionId },
    { retries: 0, timeout: 8_000 },
  );
  restoreClientSessionIdForStudentKey(scheduleId, satWriterStudentKey(scheduleId, candidateId), out.clientSessionId);
  storeAttemptCredential(
    { id: out.attemptId, scheduleId },
    { attemptToken: out.attemptToken, expiresAt: out.attemptExpiresAt },
  );
  return out.transfer;
}

/** Current writer: the open request (if any) targeting its attempt. */
export async function getPendingTransferForWriter(
  scheduleId: string,
  attemptId: string,
): Promise<SatDeviceTransfer | null> {
  const headers = tryBuildAttemptAuthorizationHeader(scheduleId, attemptId);
  if (!headers) return null;
  const query = new URLSearchParams({ attemptId });
  const out = await backendGet<{ transfer: SatDeviceTransfer | null }>(
    `${base(scheduleId)}/writer/device-transfer?${query.toString()}`,
    { headers, retries: 0 },
  );
  return out.transfer ?? null;
}

/** Current writer, before any timed module starts: allow the other device. */
export async function confirmTransferAsWriter(
  scheduleId: string,
  attemptId: string,
  requestId: string,
): Promise<SatDeviceTransfer> {
  const headers = tryBuildAttemptAuthorizationHeader(scheduleId, attemptId);
  if (!headers) throw new Error("This browser no longer holds the exam credential.");
  const out = await backendPost<{ transfer: SatDeviceTransfer }>(
    `${base(scheduleId)}/writer/device-transfers/${encodeURIComponent(requestId)}/confirm`,
    undefined,
    { headers, retries: 0 },
  );
  return out.transfer;
}
