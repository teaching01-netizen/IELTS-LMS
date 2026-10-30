import { backendGet, backendPost, hasBackendStatusCode } from '@services/backendBridge';
import {
  storeAttemptCredential,
  isAttemptCredentialExpiringWithin,
  tryBuildAttemptAuthorizationHeader,
} from '@services/attemptCredentialAdapter';
import { refreshAttemptCredentialForAttempt } from '@services/studentAttemptRepository';
import type { StudentAttempt } from '../../../types/studentAttempt';
import type {
  DraftEvidenceAckV2,
  ResponseBatchRequestV2,
  ResponseBatchResponseV2,
  ResponseAcknowledgementV2,
  ResponseSnapshotV2,
  SubmitAttemptV2Request,
  SubmitAttemptV2Response,
} from '@shared/durability/types';
import type { TransportClient } from '@shared/durability/DurableResponseEngine';

const V2_ATTEMPT_PATH = '/v2/student/attempts';
// Leave room for the 60-second submission request and clock/network skew.
const ATTEMPT_REFRESH_WINDOW_MS = 120_000;

function attemptPath(attemptId: string): string {
  return `${V2_ATTEMPT_PATH}/${encodeURIComponent(attemptId)}`;
}

/** HTTP adapter shared by SAT and IELTS. It deliberately contains no UI state. */
async function withAttemptCredentialRefresh<T>(
  attempt: StudentAttempt | undefined,
  request: () => Promise<T>,
  clientSessionId?: string,
): Promise<T> {
  if (attempt && isAttemptCredentialExpiringWithin(
    attempt.scheduleId, attempt.id, ATTEMPT_REFRESH_WINDOW_MS,
  )) {
    // A temporary renewal failure must not prevent trying a still-valid bearer.
    await refreshAttemptCredentialForAttempt(attempt, clientSessionId).catch(() => false);
  }
  try {
    return await request();
  } catch (error) {
    if (!attempt || !hasBackendStatusCode(error, 401)) {
      throw error;
    }
    const refreshed = await refreshAttemptCredentialForAttempt(attempt, clientSessionId).catch(() => false);
    if (!refreshed) {
      throw error;
    }
    return request();
  }
}

export function createResponseDurabilityV2Transport(
  scheduleId: string,
  credentialAttempt?: StudentAttempt,
  clientSessionId?: string,
): TransportClient {
  const attemptHeaders = (attemptId: string): Record<string, string> =>
    tryBuildAttemptAuthorizationHeader(scheduleId, attemptId) ?? {};
  const requestConfig = (attemptId: string, extra: Record<string, unknown> = {}) => {
    const headers = attemptHeaders(attemptId);
    return {
      ...extra, headers,
      ...(headers["Authorization"] ? { credentialScope: "attempt" as const } : {}),
      retries: 0, skipUnauthorizedHandler: true,
    };
  };

  return {
    sendBatch: (attemptId, request: ResponseBatchRequestV2) =>
      withAttemptCredentialRefresh(credentialAttempt, () =>
        backendPost<ResponseBatchResponseV2>(
          `${attemptPath(attemptId)}/responses:batch`,
          request,
          requestConfig(attemptId, { timeout: 15_000 }),
        ),
        clientSessionId,
      ),
    submit: (attemptId, request: SubmitAttemptV2Request) =>
      withAttemptCredentialRefresh(credentialAttempt, () =>
        backendPost<SubmitAttemptV2Response>(
          `${attemptPath(attemptId)}/submit`,
          request,
          requestConfig(attemptId, { timeout: 60_000 }),
        ),
        clientSessionId,
      ),
    fetchSubmissionReceipt: async (attemptId, submissionId) => {
      try {
        return await withAttemptCredentialRefresh(credentialAttempt, () =>
          backendGet<SubmitAttemptV2Response>(
            `${attemptPath(attemptId)}/submission-receipt?submissionId=${encodeURIComponent(submissionId)}`,
            requestConfig(attemptId),
          ), clientSessionId,
        );
      } catch (error) {
        // Old servers have no receipt endpoint; exact submit replay remains
        // safe there. A real outage/auth failure must retain the intent.
        if (hasBackendStatusCode(error, 404)) return null;
        throw error;
      }
    },
    submitDraftEvidence: (attemptId, items) =>
      withAttemptCredentialRefresh(credentialAttempt, () =>
        backendPost<DraftEvidenceAckV2>(
          `${attemptPath(attemptId)}/draft-evidence`,
          { items },
          requestConfig(attemptId),
        ), clientSessionId,
      ),
    fetchSnapshot: (attemptId) =>
      withAttemptCredentialRefresh(credentialAttempt, () =>
        backendGet<ResponseSnapshotV2 | ResponseAcknowledgementV2[]>(
          `${attemptPath(attemptId)}/responses`,
          requestConfig(attemptId),
        ),
        clientSessionId,
      ),
  };
}

export interface TakeoverLeaseV2Request {
  clientSessionId: string;
  reason: string;
}

export interface TakeoverLeaseV2Response {
  attemptId: string;
  clientSessionId: string;
  leaseEpoch: number;
  expiresAt: string;
  token: string;
  credentialPolicy?: "legacy_v1" | "sitting_v1";
}

export async function takeOverResponseDurabilityLease(
  scheduleId: string,
  attemptId: string,
  request: TakeoverLeaseV2Request,
  credentialAttempt?: StudentAttempt,
): Promise<TakeoverLeaseV2Response> {
  const response = await withAttemptCredentialRefresh(credentialAttempt, () =>
    backendPost<TakeoverLeaseV2Response>(
      `${attemptPath(attemptId)}/takeover`,
      request,
      {
        headers: tryBuildAttemptAuthorizationHeader(scheduleId, attemptId) ?? {},
        ...(tryBuildAttemptAuthorizationHeader(scheduleId, attemptId) ? { credentialScope: "attempt" as const } : {}),
        retries: 0,
        skipUnauthorizedHandler: true,
      },
    )
  );
  storeAttemptCredential(
    { id: attemptId, scheduleId },
    { attemptToken: response.token, expiresAt: response.expiresAt, credentialPolicy: response.credentialPolicy },
  );
  return response;
}
