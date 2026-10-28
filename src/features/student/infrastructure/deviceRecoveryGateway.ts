import { backendGet, backendPost } from "@services/backendBridge";
import {
  buildAttemptAuthorizationHeader,
  storeAttemptCredential,
} from "@services/attemptCredentialAdapter";
import {
  prepareRecoveredStudentWriter,
  restoreClientSessionIdForStudentKey,
  satWriterStudentKey,
} from "@services/studentAttemptRepository";
import type {
  RecoveryBegin,
  RecoveryIssued,
  RecoveryOptions,
  RecoveryReady,
  RecoveryTarget,
} from "../application/deviceRecovery";

const staffPath = (schedule: string, attempt: string) =>
  `/v1/proctor/sessions/${encodeURIComponent(schedule)}/attempts/${encodeURIComponent(attempt)}/device-recovery`;
const studentPath = (grant: string) => `/v1/student/device-recovery/${encodeURIComponent(grant)}`;
export const recoveryGateway = {
  installIdentity: async (result: RecoveryBegin) => {
    await prepareRecoveredStudentWriter(result.recovery.attemptId, result.clientSessionId);
    storeAttemptCredential(
      { id: result.recovery.attemptId, scheduleId: result.recovery.scheduleId },
      result.attemptCredential
    );
    restoreClientSessionIdForStudentKey(
      result.recovery.scheduleId,
      satWriterStudentKey(result.recovery.scheduleId, result.recovery.candidateId),
      result.clientSessionId
    );
  },
  original: (scheduleId: string, attemptId: string, operationId: string, browserProof: string) => {
    const header = buildAttemptAuthorizationHeader({ scheduleId, id: attemptId });
    return backendPost<RecoveryReady>(
      `/v1/student/sessions/${encodeURIComponent(scheduleId)}/attempts/${encodeURIComponent(attemptId)}/device-recovery/original-ready`,
      { operationId, browserProof, originalAttemptToken: header["Authorization"]?.slice(7) },
      { retries: 0 }
    );
  },
  options: (schedule: string, attempt: string) =>
    backendGet<RecoveryOptions>(staffPath(schedule, attempt), { retries: 0 }),
  issue: (
    schedule: string,
    attempt: string,
    body: {
      operationId: string;
      expectedLeaseEpoch: number;
      expectedControlEpoch: number;
      target: RecoveryTarget;
      remainingSeconds?: number;
    }
  ) => backendPost<RecoveryIssued>(staffPath(schedule, attempt), body, { retries: 0 }),
  restore: (
    schedule: string,
    attempt: string,
    body: { operationId: string; expectedLeaseEpoch: number; expectedControlEpoch: number }
  ) =>
    backendPost<RecoveryOptions>(`${staffPath(schedule, attempt)}/restore-original`, body, {
      retries: 0,
    }),
  claim: (
    grant: string,
    body: { operationId: string; browserProof: string; linkSecret: string; code: string }
  ) => backendPost<RecoveryReady>(`${studentPath(grant)}/claim`, body, { retries: 0 }),
  ready: (grant: string, browserProof: string) =>
    backendPost<RecoveryReady>(`${studentPath(grant)}/ready`, { browserProof }, { retries: 0 }),
  begin: (
    grant: string,
    operationId: string,
    browserProof: string,
    expectedGrantRevision: number
  ) =>
    backendPost<RecoveryBegin>(
      `${studentPath(grant)}/begin`,
      { operationId, browserProof, expectedGrantRevision },
      { retries: 0 }
    ),
};
