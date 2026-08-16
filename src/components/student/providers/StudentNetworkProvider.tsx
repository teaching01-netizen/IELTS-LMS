import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { saveStudentAuditEvent } from '@student/application/studentAttemptFacade';
import { classifyStudentPlatformEvent } from '@student/application/exam-session/studentPlatformEventPolicy';
import {
  getHeartbeatEnforcementThresholds,
  getHeartbeatIntervalMs,
  getStudentIntegritySecurityPolicy,
  hasDeviceContinuityMismatch,
} from '@student/application/studentIntegrityFacade';
import type { ExamConfig } from '../../../types';
import { createBrowserNetworkMonitor } from '@student/infrastructure/exam-session/platform/BrowserNetworkMonitor';
import { readBrowserDeviceFingerprint } from '@student/infrastructure/exam-session/platform/BrowserDeviceFingerprint';
import { useStudentAttempt } from './StudentAttemptProvider';
import { useStudentRuntime, useStudentRuntimeSession } from './StudentRuntimeProvider';

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
  const { state: runtimeState, actions: runtimeActions } = useStudentRuntimeSession();
  const { state: attemptState, actions: attemptActions } = useStudentAttempt();
  const policy = useMemo(() => getStudentIntegritySecurityPolicy(config), [config]);
  const heartbeatThresholds = useMemo(() => getHeartbeatEnforcementThresholds(config), [config]);
  const heartbeatIntervalMs = getHeartbeatIntervalMs(policy);
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
  const missedHeartbeatsRef = useRef(0);
  const heartbeatInFlightRef = useRef(false);
  const recoveryEpochRef = useRef(0);
  const onlineInFlightRef = useRef<Promise<void> | null>(null);
  const runtimeStateRef = useRef(runtimeState);
  const runtimeActionsRef = useRef(runtimeActions);
  const attemptStateRef = useRef(attemptState);
  const attemptActionsRef = useRef(attemptActions);
  const policyRef = useRef(policy);
  const heartbeatThresholdsRef = useRef(heartbeatThresholds);
  const scheduleIdRef = useRef(scheduleId);
  const onRefreshRuntimeRef = useRef(onRefreshRuntime);

  useLayoutEffect(() => {
    runtimeStateRef.current = runtimeState;
    runtimeActionsRef.current = runtimeActions;
    attemptStateRef.current = attemptState;
    attemptActionsRef.current = attemptActions;
    policyRef.current = policy;
    heartbeatThresholdsRef.current = heartbeatThresholds;
    scheduleIdRef.current = scheduleId;
    onRefreshRuntimeRef.current = onRefreshRuntime;
  }, [
    attemptActions,
    attemptState,
    heartbeatThresholds,
    onRefreshRuntime,
    policy,
    runtimeActions,
    runtimeState,
    scheduleId,
  ]);

  useEffect(() => {
    setLastDisconnectAt(attemptState.attempt?.integrity.lastDisconnectAt ?? null);
    setLastReconnectAt(attemptState.attempt?.integrity.lastReconnectAt ?? null);
  }, [
    attemptState.attempt?.integrity.lastDisconnectAt,
    attemptState.attempt?.integrity.lastReconnectAt,
  ]);

  const handleOffline = useCallback(async () => {
    recoveryEpochRef.current += 1;
    const timestamp = new Date().toISOString();
    setIsOnline(false);
    setIsRecovering(false);
    setLastDisconnectAt(timestamp);
    runtimeActionsRef.current.setAttemptSyncState('offline');
    await attemptActionsRef.current.recordNetworkStatus('offline', timestamp);
    await attemptActionsRef.current
      .recordHeartbeat('disconnect', {
        reason: 'browser_offline',
      })
      .catch(() => {});
    await saveStudentAuditEvent(scheduleIdRef.current, 'NETWORK_DISCONNECTED', {
      timestamp,
    }, attemptStateRef.current.attemptId ?? undefined);
  }, []);

  const verifyDeviceContinuity = useCallback(async () => {
    const attempt = attemptStateRef.current.attempt;
    if (!attempt) {
      return true;
    }

    const fingerprint = await readBrowserDeviceFingerprint();
    const previousHash = attempt.integrity.deviceFingerprintHash;

    if (!previousHash) {
      await attemptActionsRef.current.setDeviceFingerprintHash(fingerprint.hash);
      return true;
    }

    if (hasDeviceContinuityMismatch(previousHash, fingerprint.hash)) {
      runtimeActionsRef.current.addViolation(
        'DEVICE_MISMATCH',
        'critical',
        'Device continuity check failed after reconnect.',
      );
      await saveStudentAuditEvent(scheduleIdRef.current, 'DEVICE_CONTINUITY_FAILED', {
        previousHash,
        nextHash: fingerprint.hash,
      }, attemptStateRef.current.attemptId ?? undefined);
      return false;
    }

    return true;
  }, []);

  const runReconnectRecovery = useCallback((epoch: number) => {
    if (onlineInFlightRef.current) {
      return;
    }

    const promise = (async () => {
      let retryAttempt = 0;
      try {
        while (epoch === recoveryEpochRef.current && navigator.onLine) {
          try {
            const isSameDevice = policyRef.current.requireDeviceContinuityOnReconnect
              ? await verifyDeviceContinuity()
              : true;
            if (epoch !== recoveryEpochRef.current) {
              return;
            }
            if (!isSameDevice) {
              return;
            }

            const flushed = await attemptActionsRef.current.flushPending();
            if (epoch !== recoveryEpochRef.current) {
              return;
            }
            if (!flushed) {
              throw new Error('pending_flush_failed');
            }

            await attemptActionsRef.current.flushHeartbeatEvents().catch(() => {});
            if (epoch !== recoveryEpochRef.current) {
              return;
            }

            if (onRefreshRuntimeRef.current) {
              await onRefreshRuntimeRef.current();
              if (epoch !== recoveryEpochRef.current) {
                return;
              }
            }

            runtimeActionsRef.current.setAttemptSyncState('saved');
            return;
          } catch {
            if (epoch !== recoveryEpochRef.current || !navigator.onLine) {
              return;
            }
            runtimeActionsRef.current.setAttemptSyncState('syncing_reconnect');
            const retryDelayMs = Math.min(10_000, 500 * 2 ** retryAttempt);
            retryAttempt = Math.min(retryAttempt + 1, 20);
            await new Promise<void>((resolve) => {
              window.setTimeout(() => resolve(), retryDelayMs);
            });
          }
        }
      } finally {
        if (epoch === recoveryEpochRef.current) {
          setIsRecovering(false);
        }
      }
    })();

    onlineInFlightRef.current = promise;
    void promise.finally(() => {
      if (onlineInFlightRef.current === promise) {
        onlineInFlightRef.current = null;
      }
    });
  }, [verifyDeviceContinuity]);

  const handleOnline = useCallback(() => {
    if (onlineInFlightRef.current) {
      return;
    }

    recoveryEpochRef.current += 1;
    const epoch = recoveryEpochRef.current;

    const promise = (async () => {
      const timestamp = new Date().toISOString();
      setIsOnline(true);
      setIsRecovering(true);
      setLastReconnectAt(timestamp);
      runtimeActionsRef.current.setAttemptSyncState('syncing_reconnect');
      await attemptActionsRef.current.recordNetworkStatus('online', timestamp).catch(() => {});
      if (epoch !== recoveryEpochRef.current) {
        return;
      }
      await attemptActionsRef.current
        .recordHeartbeat('reconnect', {
          reason: 'browser_online',
        })
        .catch(() => {});
      if (epoch !== recoveryEpochRef.current) {
        return;
      }
      await saveStudentAuditEvent(
        scheduleIdRef.current,
        'NETWORK_RECONNECTED',
        { timestamp },
        attemptStateRef.current.attemptId ?? undefined,
      ).catch(() => {});
    })();

    onlineInFlightRef.current = promise;
    void promise.finally(() => {
      if (onlineInFlightRef.current === promise) {
        onlineInFlightRef.current = null;
      }
      if (epoch === recoveryEpochRef.current && navigator.onLine) {
        setIsRecovering(true);
        runReconnectRecovery(epoch);
      }
    });
  }, [runReconnectRecovery]);

  const handleForegroundResume = useCallback(() => {
    if (!navigator.onLine || onlineInFlightRef.current) {
      return;
    }

    const blockedForRecovery =
      runtimeStateRef.current.attemptSyncState === 'offline' ||
      runtimeStateRef.current.attemptSyncState === 'syncing_reconnect';
    if (!blockedForRecovery) {
      return;
    }

    runtimeActionsRef.current.setAttemptSyncState('syncing_reconnect');

    const epoch = recoveryEpochRef.current;
    setIsOnline(true);
    setIsRecovering(true);
    runReconnectRecovery(epoch);
  }, [runReconnectRecovery]);

  useEffect(() => {
    const networkMonitor = createBrowserNetworkMonitor();
    const unsubscribeNetwork = networkMonitor.subscribe((event) => {
      const action = classifyStudentPlatformEvent(event);
      if (action.kind === 'network' && action.status === 'online') {
        handleOnline();
      }
      if (action.kind === 'network' && action.status === 'offline') {
        void handleOffline();
      }
    });
    const pageShowListener = () => {
      handleForegroundResume();
    };
    const visibilityListener = () => {
      if (document.visibilityState === 'visible') {
        handleForegroundResume();
      }
    };
    window.addEventListener('pageshow', pageShowListener);
    document.addEventListener('visibilitychange', visibilityListener);

    return () => {
      unsubscribeNetwork();
      window.removeEventListener('pageshow', pageShowListener);
      document.removeEventListener('visibilitychange', visibilityListener);
    };
  }, [handleForegroundResume, handleOffline, handleOnline]);

  useEffect(() => {
    let cancelled = false;

    if (!attemptStateRef.current.attempt) {
      return;
    }

    void (async () => {
      const fingerprint = await readBrowserDeviceFingerprint();
      if (cancelled) {
        return;
      }

      const previousHash = attemptStateRef.current.attempt?.integrity.deviceFingerprintHash;
      if (!previousHash) {
        await attemptActionsRef.current.setDeviceFingerprintHash(fingerprint.hash);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attemptState.attempt?.id, scheduleId]);

  useEffect(() => {
    if (runtimeState.phase !== 'exam' || !attemptStateRef.current.attempt) {
      missedHeartbeatsRef.current = 0;
      return;
    }

    if (!isOnline) {
      return;
    }

    let cancelled = false;
    const intervalMs = heartbeatIntervalMs;

    const intervalId = window.setInterval(() => {
      void (async () => {
        if (heartbeatInFlightRef.current) {
          return;
        }

        heartbeatInFlightRef.current = true;

        try {
          await attemptActionsRef.current.recordHeartbeat('heartbeat');
          if (cancelled) {
            return;
          }

          missedHeartbeatsRef.current = 0;
        } catch {
          if (cancelled) {
            return;
          }

          missedHeartbeatsRef.current += 1;

          const { warningThreshold, hardBlockThreshold } = heartbeatThresholdsRef.current;

          if (missedHeartbeatsRef.current === warningThreshold) {
            void saveStudentAuditEvent(
              scheduleIdRef.current,
              'HEARTBEAT_MISSED',
              {
                missedCount: missedHeartbeatsRef.current,
                threshold: warningThreshold,
                intervalSeconds: Math.round(intervalMs / 1_000),
              },
              attemptStateRef.current.attemptId ?? undefined,
            );
          }

          if (missedHeartbeatsRef.current === hardBlockThreshold) {
            runtimeActionsRef.current.addViolation(
              'HEARTBEAT_LOST',
              'high',
              `Heartbeat delivery failed after ${missedHeartbeatsRef.current} attempts.`,
            );
            void attemptActionsRef.current
              .recordHeartbeat('lost', {
                reason: 'delivery_failed',
                missedCount: missedHeartbeatsRef.current,
              })
              .catch(() => {});
            void saveStudentAuditEvent(
              scheduleIdRef.current,
              'HEARTBEAT_LOST',
              {
                missedCount: missedHeartbeatsRef.current,
                threshold: hardBlockThreshold,
                intervalSeconds: Math.round(intervalMs / 1_000),
              },
              attemptStateRef.current.attemptId ?? undefined,
            );
          }
        } finally {
          heartbeatInFlightRef.current = false;
        }
      })();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    heartbeatIntervalMs,
    isOnline,
    runtimeState.phase,
  ]);

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
