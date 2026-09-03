import { backendGet, backendPost, hasBackendStatusCode } from '@services/backendBridge';
import {
  storeAttemptCredential,
  tryBuildAttemptAuthorizationHeader,
} from '@services/attemptCredentialAdapter';
import { refreshAttemptCredentialForAttempt } from '@services/studentAttemptRepository';
import type { StudentAttempt } from '../../../types/studentAttempt';
import type {
  ResponseBatchRequestV2,
  ResponseBatchResponseV2,
  ResponseAcknowledgementV2,
  ResponseSnapshotV2,
  SubmitAttemptV2Request,
  SubmitAttemptV2Response,
} from '@shared/durability/types';
import type { TransportClient } from '@shared/durability/DurableResponseEngine';

const V2_ATTEMPT_PATH = '/v2/student/attempts';

function attemptPath(attemptId: string): string {
  return `${V2_ATTEMPT_PATH}/${encodeURIComponent(attemptId)}`;
}

/** HTTP adapter shared by SAT and IELTS. It deliberately contains no UI state. */
async function withAttemptCredentialRefresh<T>(
  attempt: StudentAttempt | undefined,
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!attempt || !hasBackendStatusCode(error, 401)) {
      throw error;
    }
    const refreshed = await refreshAttemptCredentialForAttempt(attempt).catch(() => false);
    if (!refreshed) {
      throw error;
    }
    return request();
  }
}

export function createResponseDurabilityV2Transport(
  scheduleId: string,
  credentialAttempt?: StudentAttempt,
): TransportClient {
  const attemptHeaders = (attemptId: string): Record<string, string> =>
    tryBuildAttemptAuthorizationHeader(scheduleId, attemptId) ?? {};
  const requestConfig = (attemptId: string, extra: Record<string, unknown> = {}) => ({
    ...extra,
    headers: attemptHeaders(attemptId),
    retries: 0,
    skipUnauthorizedHandler: true,
  });

  return {
    sendBatch: (attemptId, request: ResponseBatchRequestV2) =>
      withAttemptCredentialRefresh(credentialAttempt, () =>
        backendPost<ResponseBatchResponseV2>(
          `${attemptPath(attemptId)}/responses:batch`,
          request,
          requestConfig(attemptId),
        )
      ),
    submit: (attemptId, request: SubmitAttemptV2Request) =>
      withAttemptCredentialRefresh(credentialAttempt, () =>
        backendPost<SubmitAttemptV2Response>(
          `${attemptPath(attemptId)}/submit`,
          request,
          requestConfig(attemptId, { timeout: 60_000 }),
        )
      ),
    fetchSnapshot: (attemptId) =>
      withAttemptCredentialRefresh(credentialAttempt, () =>
        backendGet<ResponseSnapshotV2 | ResponseAcknowledgementV2[]>(
          `${attemptPath(attemptId)}/responses`,
          requestConfig(attemptId),
        )
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
        retries: 0,
        skipUnauthorizedHandler: true,
      },
    )
  );
  storeAttemptCredential(
    { id: attemptId, scheduleId },
    { attemptToken: response.token, expiresAt: response.expiresAt },
  );
  return response;
}
