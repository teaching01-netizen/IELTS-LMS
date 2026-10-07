import { backendGet, backendPost } from '@services/backendBridge';

/** Proctor-facing SAT device-transfer request (never carries session ids or answers). */
export interface ProctorDeviceTransfer {
  requestId: string;
  attemptId: string;
  scheduleId: string;
  state: 'pending' | 'approved' | 'committed' | 'denied' | 'cancelled' | 'expired' | 'conflicted';
  policyStage: 'pre_start' | 'post_start';
  reasonCode: string;
  requestedAt: string;
  expiresAt: string;
  approvalKind: 'current_writer' | 'proctor' | null;
  approvalExpiresAt: string | null;
  candidateId: string;
  candidateName: string;
  lastServerSaveAt: string | null;
}

const base = (scheduleId: string) => `/v1/proctor/sessions/${encodeURIComponent(scheduleId)}/device-transfers`;

export async function listDeviceTransfers(scheduleId: string): Promise<ProctorDeviceTransfer[]> {
  const out = await backendGet<{ items: ProctorDeviceTransfer[] }>(base(scheduleId), { retries: 0 });
  return out.items ?? [];
}

export async function decideDeviceTransfer(
  scheduleId: string,
  requestId: string,
  decision: { approve: boolean; reason: string; acknowledgeUnconfirmedRisk: boolean },
): Promise<ProctorDeviceTransfer> {
  const out = await backendPost<{ transfer: ProctorDeviceTransfer }>(
    `${base(scheduleId)}/${encodeURIComponent(requestId)}/decision`,
    {
      decision: decision.approve ? 'approve' : 'deny',
      reason: decision.reason,
      acknowledgeUnconfirmedRisk: decision.acknowledgeUnconfirmedRisk,
    },
    { retries: 0 },
  );
  return out.transfer;
}
