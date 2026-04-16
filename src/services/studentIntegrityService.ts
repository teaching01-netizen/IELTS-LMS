import type { ExamConfig } from '../types';
import type {
  HeartbeatEventType,
  StudentHeartbeatEvent,
} from '../types/studentAttempt';

export interface StudentIntegritySecurityPolicy {
  heartbeatIntervalSeconds: number;
  heartbeatMissThreshold: number;
  pauseOnOffline: boolean;
  bufferAnswersOffline: boolean;
  requireDeviceContinuityOnReconnect: boolean;
  allowSafariWithAcknowledgement: boolean;
}

export const DEFAULT_STUDENT_INTEGRITY_SECURITY_POLICY: StudentIntegritySecurityPolicy = {
  heartbeatIntervalSeconds: 15,
  heartbeatMissThreshold: 3,
  pauseOnOffline: true,
  bufferAnswersOffline: true,
  requireDeviceContinuityOnReconnect: true,
  allowSafariWithAcknowledgement: true,
};

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isExamConfig(config: unknown): config is ExamConfig {
  return config != null && typeof config === 'object' && 'security' in config;
}

function isStudentIntegrityPolicy(config: unknown): config is StudentIntegritySecurityPolicy {
  return (
    config != null &&
    typeof config === 'object' &&
    'heartbeatIntervalSeconds' in config &&
    !('proctoringFlags' in config)
  );
}

function getSecurityConfig(
  config?: StudentIntegritySecurityPolicy | ExamConfig | ExamConfig['security'] | null,
): StudentIntegritySecurityPolicy | ExamConfig['security'] | undefined {
  if (!config) {
    return undefined;
  }

  if (isStudentIntegrityPolicy(config)) {
    return config;
  }

  return isExamConfig(config) ? config.security : config;
}

export function getStudentIntegritySecurityPolicy(
  config?: StudentIntegritySecurityPolicy | ExamConfig | ExamConfig['security'] | null,
): StudentIntegritySecurityPolicy {
  const security = getSecurityConfig(config);

  return {
    heartbeatIntervalSeconds:
      security?.heartbeatIntervalSeconds ??
      DEFAULT_STUDENT_INTEGRITY_SECURITY_POLICY.heartbeatIntervalSeconds,
    heartbeatMissThreshold:
      security?.heartbeatMissThreshold ??
      DEFAULT_STUDENT_INTEGRITY_SECURITY_POLICY.heartbeatMissThreshold,
    pauseOnOffline:
      security?.pauseOnOffline ??
      DEFAULT_STUDENT_INTEGRITY_SECURITY_POLICY.pauseOnOffline,
    bufferAnswersOffline:
      security?.bufferAnswersOffline ??
      DEFAULT_STUDENT_INTEGRITY_SECURITY_POLICY.bufferAnswersOffline,
    requireDeviceContinuityOnReconnect:
      security?.requireDeviceContinuityOnReconnect ??
      DEFAULT_STUDENT_INTEGRITY_SECURITY_POLICY.requireDeviceContinuityOnReconnect,
    allowSafariWithAcknowledgement:
      security?.allowSafariWithAcknowledgement ??
      DEFAULT_STUDENT_INTEGRITY_SECURITY_POLICY.allowSafariWithAcknowledgement,
  };
}

export function getHeartbeatIntervalMs(
  config?: StudentIntegritySecurityPolicy | ExamConfig | ExamConfig['security'] | null,
): number {
  return getStudentIntegritySecurityPolicy(config).heartbeatIntervalSeconds * 1_000;
}

export function getHeartbeatLossTimeoutMs(
  config?: StudentIntegritySecurityPolicy | ExamConfig | ExamConfig['security'] | null,
): number {
  const policy = getStudentIntegritySecurityPolicy(config);
  return policy.heartbeatIntervalSeconds * policy.heartbeatMissThreshold * 1_000;
}

export function hasDeviceContinuityMismatch(
  previousHash: string | null | undefined,
  nextHash: string | null | undefined,
): boolean {
  return Boolean(previousHash && nextHash && previousHash !== nextHash);
}

export function buildStudentHeartbeatEvent(
  attemptId: string,
  scheduleId: string,
  type: HeartbeatEventType,
  payload?: Record<string, unknown>,
  timestamp = new Date().toISOString(),
): StudentHeartbeatEvent {
  return {
    id: generateId('heartbeat'),
    attemptId,
    scheduleId,
    timestamp,
    type,
    payload,
  };
}
