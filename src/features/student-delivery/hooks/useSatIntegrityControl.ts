import { useEffect, useRef } from 'react';
import { getDeviceFingerprint } from '../../../utils/deviceFingerprinting';
import { emitStudentObservabilityMetric } from '../../../utils/studentObservability';
import { assessmentDeliveryApi } from '../api/assessmentDeliveryApi';
import { shouldSkipHeartbeat } from '../heartbeatCoalesce';

interface SatIntegrityControlOptions {
  scheduleId: string;
  attemptId: string;
  expectedDeviceFingerprintHash: string | null;
  enforceInteractionGuards: boolean;
}

function violationId(type: string) {
  return `${type}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export function useSatIntegrityControl({
  scheduleId,
  attemptId,
  expectedDeviceFingerprintHash,
  enforceInteractionGuards,
}: SatIntegrityControlOptions) {
  const lastViolationAt = useRef(new Map<string, number>());
  // Plan C5: last successful write stamps presence — beats inside the
  // server window are pure load (the ack echoes presence state).
  const lastWriteAtRef = useRef<number | null>(null);
  const nextHeartbeatSecsRef = useRef(30);

  useEffect(() => {
    const send = (eventType: 'heartbeat' | 'disconnect' | 'reconnect') => {
      if (shouldSkipHeartbeat({
        eventType,
        msSinceLastWrite: lastWriteAtRef.current === null ? null : Date.now() - lastWriteAtRef.current,
        nextHeartbeatSecs: nextHeartbeatSecsRef.current,
      })) {
        return;
      }
      void assessmentDeliveryApi
        .heartbeat(scheduleId, attemptId, eventType)
        .then((res) => {
          lastWriteAtRef.current = Date.now();
          const window = (res as { nextHeartbeatSecs?: unknown })?.nextHeartbeatSecs;
          if (typeof window === 'number' && Number.isFinite(window) && window > 0) {
            nextHeartbeatSecsRef.current = Math.floor(window);
          }
        })
        .catch((error: unknown) => {
          // Exam-day P1: heartbeat failures are observable, never silent.
          // Fire-and-forget posture is kept (no UI block), but the failure
          // is logged + metered so session-identity regressions surface.
          emitStudentObservabilityMetric('sat_heartbeat_error', { scheduleId, attemptId, endpoint: 'sat-heartbeat' });
          console.warn('[sat] heartbeat failed', { scheduleId, attemptId, eventType, error });
        });
    };
    send('heartbeat');
    const interval = window.setInterval(() => send('heartbeat'), 15_000);
    const onOffline = () => send('disconnect');
    const onOnline = () => send('reconnect');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [attemptId, scheduleId]);

  useEffect(() => {
    if (!expectedDeviceFingerprintHash) return;
    let cancelled = false;
    void getDeviceFingerprint().then((fingerprint) => {
      if (cancelled || fingerprint.hash === expectedDeviceFingerprintHash) return;
      void assessmentDeliveryApi.recordAudit(scheduleId, attemptId, 'DEVICE_CONTINUITY_FAILED', {
        expectedHash: expectedDeviceFingerprintHash,
        observedHash: fingerprint.hash,
        message: 'Device fingerprint changed during the SAT attempt.',
      }).catch(() => undefined);
    });
    return () => { cancelled = true; };
  }, [attemptId, expectedDeviceFingerprintHash, scheduleId]);

  useEffect(() => {
    if (!enforceInteractionGuards) return;
    const interactionSurface = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return 'exam';
      return target.closest('[data-sat-trusted-tool="desmos"]') ? 'desmos' : 'exam';
    };
    const reportViolation = (
      type: string,
      severity: 'low' | 'medium' | 'high' | 'critical',
      message: string,
      surface = 'exam',
    ) => {
      const now = Date.now();
      const last = lastViolationAt.current.get(type) ?? 0;
      if (now - last < 1_000) return;
      lastViolationAt.current.set(type, now);
      void assessmentDeliveryApi.recordAudit(scheduleId, attemptId, 'VIOLATION_DETECTED', {
        violationId: violationId(type),
        violationType: type,
        severity,
        message,
        interactionSurface: surface,
      }).catch(() => undefined);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        reportViolation('TAB_SWITCH', 'medium', 'Candidate left the SAT exam window.');
      }
    };
    const blockClipboard = (event: ClipboardEvent) => {
      event.preventDefault();
      reportViolation('CLIPBOARD_ATTEMPT', 'medium', 'Clipboard use was blocked during the SAT exam.', interactionSurface(event.target));
    };
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      reportViolation('CONTEXT_MENU', 'low', 'Context menu use was blocked during the SAT exam.', interactionSurface(event.target));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'PrintScreen') {
        reportViolation('SCREENSHOT_ATTEMPT', 'high', 'Screenshot key was detected during the SAT exam.');
      }
      const command = event.metaKey || event.ctrlKey;
      if (command && ['f', 'p', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        reportViolation('RESTRICTED_SHORTCUT', 'low', `Restricted shortcut ${event.key.toUpperCase()} was blocked.`, interactionSurface(event.target));
      }
    };
    const checkExtendedScreen = () => {
      const extended = (window.screen as Screen & { isExtended?: boolean }).isExtended;
      if (extended) reportViolation('SECONDARY_SCREEN', 'high', 'A secondary display was detected during the SAT exam.');
    };

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('copy', blockClipboard);
    document.addEventListener('cut', blockClipboard);
    document.addEventListener('paste', blockClipboard);
    document.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', checkExtendedScreen);
    checkExtendedScreen();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('copy', blockClipboard);
      document.removeEventListener('cut', blockClipboard);
      document.removeEventListener('paste', blockClipboard);
      document.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', checkExtendedScreen);
    };
  }, [attemptId, enforceInteractionGuards, scheduleId]);
}
