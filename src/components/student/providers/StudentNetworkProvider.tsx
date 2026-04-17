import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { saveStudentAuditEvent } from '@services/studentAuditService';
import {
  getHeartbeatIntervalMs,
  getHeartbeatLossTimeoutMs,
  getStudentIntegritySecurityPolicy,
  hasDeviceContinuityMismatch,
} from '@services/studentIntegrityService';
import type { ExamConfig } from '../../../types';
import { getDeviceFingerprint } from '../../../utils/deviceFingerprinting';
import { useStudentAttempt } from './StudentAttemptProvider';
import { useStudentRuntime } from './StudentRuntimeProvider';

interface StudentNetworkState {
  isOnline: boolean;
  isRecovering: boolean;
  lastDisconnectAt: string | null;
  lastReconnectAt: string | null;
}

interface StudentNetworkContextValue {
  state: StudentNetworkState;
}

interface StudentNetworkProviderProps {
  children: ReactNode;
  config?: ExamConfig | undefined;
  scheduleId?: string | undefined;
  onRefreshRuntime?: (() => Promise<void>) | undefined;
}

const StudentNetworkContext = createContext<StudentNetworkContextValue | null>(null);

export function StudentNetworkProvider({
  children,
  config,
  scheduleId,
  onRefreshRuntime,
}: StudentNetworkProviderProps) {
  const { state: runtimeState, actions: runtimeActions } = useStudentRuntime();
  const { state: attemptState, actions: attemptActions } = useStudentAttempt();
  const policy = useMemo(() => getStudentIntegritySecurityPolicy(config), [config]);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [isRecovering, setIsRecovering] = useState(false);
  const [lastDisconnectAt, setLastDisconnectAt] = useState<string | null>(
    attemptState.attempt?.integrity.lastDisconnectAt ?? null,
  );
  const [lastReconnectAt, setLastReconnectAt] = useState<string | null>(
    attemptState.attempt?.integrity.lastReconnectAt ?? null,
  );
  const heartbeatLostRef = useRef(false);

  useEffect(() => {
    setLastDisconnectAt(attemptState.attempt?.integrity.lastDisconnectAt ?? null);
    setLastReconnectAt(attemptState.attempt?.integrity.lastReconnectAt ?? null);
  }, [
    attemptState.attempt?.integrity.lastDisconnectAt,
    attemptState.attempt?.integrity.lastReconnectAt,
  ]);

  const handleOffline = useCallback(async () => {
    const timestamp = new Date().toISOString();
    setIsOnline(false);
    setLastDisconnectAt(timestamp);
    if (policy.pauseOnOffline) {
      runtimeActions.setBlockingReason('offline');
    }
    runtimeActions.setAttemptSyncState('offline');
    await attemptActions.recordNetworkStatus('offline', timestamp);
    await attemptActions.recordHeartbeat('disconnect', {
      reason: 'browser_offline',
    });
    await saveStudentAuditEvent(scheduleId, 'NETWORK_DISCONNECTED', {
      timestamp,
    }, attemptState.attemptId ?? undefined);
  }, [attemptActions, attemptState.attemptId, policy.pauseOnOffline, runtimeActions, scheduleId]);

  const verifyDeviceContinuity = useCallback(async () => {
    const attempt = attemptState.attempt;
    if (!attempt) {
      return true;
    }

    const fingerprint = await getDeviceFingerprint();
    const previousHash = attempt.integrity.deviceFingerprintHash;

    if (!previousHash) {
      await attemptActions.setDeviceFingerprintHash(fingerprint.hash);
      return true;
    }

    if (hasDeviceContinuityMismatch(previousHash, fingerprint.hash)) {
      runtimeActions.addViolation(
        'DEVICE_MISMATCH',
        'critical',
        'Device continuity check failed after reconnect.',
      );
      runtimeActions.setBlockingReason('device_mismatch');
      await saveStudentAuditEvent(scheduleId, 'DEVICE_CONTINUITY_FAILED', {
        previousHash,
        nextHash: fingerprint.hash,
      }, attemptState.attemptId ?? undefined);
      return false;
    }

    return true;
  }, [attemptActions, attemptState.attempt, attemptState.attemptId, runtimeActions, scheduleId]);

  const handleOnline = useCallback(async () => {
    const timestamp = new Date().toISOString();
    setIsOnline(true);
    setIsRecovering(true);
    setLastReconnectAt(timestamp);
    runtimeActions.setBlockingReason('syncing_reconnect');
    runtimeActions.setAttemptSyncState('syncing_reconnect');
    await attemptActions.recordNetworkStatus('online', timestamp);
    await attemptActions.recordHeartbeat('reconnect', {
      reason: 'browser_online',
    });
    await saveStudentAuditEvent(scheduleId, 'NETWORK_RECONNECTED', {
      timestamp,
    }, attemptState.attemptId ?? undefined);

    try {
      if (onRefreshRuntime) {
        await onRefreshRuntime();
      }

      const isSameDevice = policy.requireDeviceContinuityOnReconnect
        ? await verifyDeviceContinuity()
        : true;
      if (!isSameDevice) {
        return;
      }

      const flushed = await attemptActions.flushPending();
      if (!flushed) {
        runtimeActions.setBlockingReason('syncing_reconnect');
        return;
      }

      runtimeActions.setBlockingReason(null);
      runtimeActions.setAttemptSyncState('saved');
    } finally {
      setIsRecovering(false);
    }
  }, [
    attemptActions,
    attemptState.attemptId,
    onRefreshRuntime,
    policy.requireDeviceContinuityOnReconnect,
    runtimeActions,
    scheduleId,
    verifyDeviceContinuity,
  ]);

  useEffect(() => {
    const onlineListener = () => {
      void handleOnline();
    };
    const offlineListener = () => {
      void handleOffline();
    };

    window.addEventListener('online', onlineListener);
    window.addEventListener('offline', offlineListener);

    return () => {
      window.removeEventListener('online', onlineListener);
      window.removeEventListener('offline', offlineListener);
    };
  }, [handleOffline, handleOnline]);

  useEffect(() => {
    let cancelled = false;

    if (!attemptState.attempt) {
      return;
    }

    void (async () => {
      const fingerprint = await getDeviceFingerprint();
      if (cancelled) {
        return;
      }

      const previousHash = attemptState.attempt?.integrity.deviceFingerprintHash;
      if (!previousHash) {
        await attemptActions.setDeviceFingerprintHash(fingerprint.hash);
        return;
      }

      if (!policy.requireDeviceContinuityOnReconnect) {
        return;
      }

      if (hasDeviceContinuityMismatch(previousHash, fingerprint.hash)) {
        runtimeActions.addViolation(
          'DEVICE_MISMATCH',
          'critical',
          'Device continuity check failed.',
        );
        runtimeActions.setBlockingReason('device_mismatch');
        await saveStudentAuditEvent(scheduleId, 'DEVICE_CONTINUITY_FAILED', {
          previousHash,
          nextHash: fingerprint.hash,
          phase: 'initial_load',
        }, attemptState.attemptId ?? undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    attemptActions,
    attemptState.attempt?.id,
    attemptState.attempt?.integrity.deviceFingerprintHash,
    policy.requireDeviceContinuityOnReconnect,
    runtimeActions,
    scheduleId,
  ]);

  useEffect(() => {
    if (runtimeState.phase !== 'exam' || !attemptState.attempt) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void attemptActions.recordHeartbeat('heartbeat');
    }, getHeartbeatIntervalMs(policy));

    return () => {
      window.clearInterval(intervalId);
    };
  }, [attemptActions, attemptState.attempt, policy, runtimeState.phase]);

  useEffect(() => {
    if (runtimeState.phase !== 'exam') {
      heartbeatLostRef.current = false;
      return;
    }

    let heartbeatLossTimer: number | null = null;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        heartbeatLossTimer = window.setTimeout(() => {
          if (heartbeatLostRef.current) {
            return;
          }

          heartbeatLostRef.current = true;
          runtimeActions.addViolation(
            'HEARTBEAT_LOST',
            'high',
            'Session heartbeat was lost while the exam was in the background.',
          );
          runtimeActions.setBlockingReason('heartbeat_lost');
          void attemptActions.recordHeartbeat('lost', {
            reason: 'visibility_timeout',
          });
          void saveStudentAuditEvent(scheduleId, 'HEARTBEAT_LOST', {
            reason: 'visibility_timeout',
          }, attemptState.attemptId ?? undefined);
        }, getHeartbeatLossTimeoutMs(policy));
        return;
      }

      if (heartbeatLossTimer) {
        window.clearTimeout(heartbeatLossTimer);
      }

      if (heartbeatLostRef.current && isOnline) {
        heartbeatLostRef.current = false;
        runtimeActions.setBlockingReason(null);
        void attemptActions.recordHeartbeat('heartbeat', {
          reason: 'visibility_restored',
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (heartbeatLossTimer) {
        window.clearTimeout(heartbeatLossTimer);
      }
    };
  }, [attemptActions, attemptState.attemptId, isOnline, policy, runtimeActions, runtimeState.phase, scheduleId]);

  const value = useMemo<StudentNetworkContextValue>(() => ({
    state: {
      isOnline,
      isRecovering,
      lastDisconnectAt,
      lastReconnectAt,
    },
  }), [isOnline, isRecovering, lastDisconnectAt, lastReconnectAt]);

  return (
    <StudentNetworkContext.Provider value={value}>
      {children}
    </StudentNetworkContext.Provider>
  );
}

export function useStudentNetwork() {
  const context = useContext(StudentNetworkContext);
  if (!context) {
    throw new Error('useStudentNetwork must be used within StudentNetworkProvider');
  }
  return context;
}
