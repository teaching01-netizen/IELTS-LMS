import type { AuditActionType, SessionAuditLog } from '../types';
import { backendPost } from './backendBridge';
import { tryBuildAttemptAuthorizationHeader } from './studentAttemptRepository';

const auditActions = new Set<AuditActionType>([
  'PRECHECK_COMPLETED',
  'PRECHECK_WARNING_ACKNOWLEDGED',
  'NETWORK_DISCONNECTED',
  'NETWORK_RECONNECTED',
  'HEARTBEAT_MISSED',
  'HEARTBEAT_LOST',
  'DEVICE_CONTINUITY_FAILED',
  'CLIPBOARD_BLOCKED',
  'CONTEXT_MENU_BLOCKED',
  'AUTOFILL_SUSPECTED',
  'PASTE_BLOCKED',
  'REPLACEMENT_SUSPECTED',
  'SCREEN_CHECK_UNSUPPORTED',
  'SCREEN_CHECK_PERMISSION_DENIED',
  'VIOLATION_DETECTED',
  'ALERT_ACKNOWLEDGED',
]);

function resolveActionType(event: string): AuditActionType {
  if (auditActions.has(event as AuditActionType)) {
    return event as AuditActionType;
  }

  return 'AUTO_ACTION';
}

export async function saveStudentAuditEvent(
  sessionId: string | undefined,
  event: string,
  payload?: Record<string, unknown>,
  targetStudentId?: string,
): Promise<void> {
  if (!sessionId || !targetStudentId) {
    return;
  }

  const headers = tryBuildAttemptAuthorizationHeader(sessionId, targetStudentId);
  if (!headers) {
    return;
  }

  const log: SessionAuditLog = {
    id: '',
    timestamp: new Date().toISOString(),
    actor: 'student-system',
    actionType: resolveActionType(event),
    targetStudentId,
    sessionId,
    payload: {
      event,
      ...(payload ?? {}),
    },
  };

  void backendPost(
    `/v1/student/sessions/${sessionId}/audit`,
    {
      actionType: log.actionType,
      clientTimestamp: log.timestamp,
      payload: log.payload,
    },
    { headers, retries: 0, timeout: 5_000 },
  ).catch(() => {
    // Best-effort only: never block the student experience.
  });
}
