import type { AuditActionType, SessionAuditLog } from '../types';
import { examRepository } from './examRepository';

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

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
  if (!sessionId) {
    return;
  }

  const log: SessionAuditLog = {
    id: generateId('audit'),
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

  await examRepository.saveAuditLog(log);
}
