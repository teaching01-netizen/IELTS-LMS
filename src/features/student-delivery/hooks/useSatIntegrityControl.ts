import { useCallback, useEffect, useRef, useState } from 'react';
import { getDeviceFingerprint } from '../../../utils/deviceFingerprinting';
import { emitStudentObservabilityMetric } from '../../../utils/studentObservability';
import { useExamVisibilityIntegrity } from '@student/api/useExamVisibilityIntegrity';
import {
  EXAM_VISIBILITY_WARNING_MESSAGE,
  examVisibilityAuditDetail,
  type ExamVisibilityExcursion,
} from '@student/api/examVisibilityIntegrity';
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

/**
 * SAT adapter for exam integrity.
 *
 * Detection itself is provider-neutral (`useExamVisibilityIntegrity`): one
 * `visible -> hidden -> visible` excursion is one `TAB_SWITCH`. This hook owns
 * only the SAT-specific reaction — a delivery audit plus the pending warning
 * the route renders — so IELTS/ACT and SAT cannot drift on what counts as a
 * tab switch. The old SAT handler reported on `hidden` alone, which double-
 * counted lifecycle noise and never reached the student.
 *
 * Policy note: the client records the violation and shows the warning; whether
 * the sitting continues or is terminated stays with the existing proctor
 * auto-response rules on the server (which already understand `TAB_SWITCH`).
 */
export function useSatIntegrityControl({
  scheduleId,
  attemptId,
  expectedDeviceFingerprintHash,
  enforceInteractionGuards,
}: SatIntegrityControlOptions) {
  const lastViolationAt = useRef(new Map<string, number>());
  const enforceRef = useRef(enforceInteractionGuards);
  useEffect(() => {
    enforceRef.current = enforceInteractionGuards;
  }, [enforceInteractionGuards]);
  // A pending warning survives a phase change (the excursion happened during
  // the exam), and only student acknowledgement clears it.
  const [pendingTabSwitchWarning, setPendingTabSwitchWarning] =
    useState<ExamVisibilityExcursion | null>(null);
  const acknowledgeTabSwitchWarning = useCallback(() => {
    setPendingTabSwitchWarning(null);
  }, []);
  // A rotated attempt must not inherit the previous student's warning.
  useEffect(() => {
    setPendingTabSwitchWarning(null);
  }, [attemptId, scheduleId]);

  /** True while the student may actually answer. The route's phase gate. */
  const integrityActive = enforceInteractionGuards;

  const reportViolation = useCallback(
    (
      type: string,
      severity: 'low' | 'medium' | 'high' | 'critical',
      message: string,
      detail: Record<string, unknown>,
    ) => {
      if (!enforceRef.current) return;
      const now = Date.now();
      // Interaction noise repeats; a visibility excursion cannot. Charging each
      // excursion means TAB_SWITCH carries no cooldown (one leave = one event),
      // while keyboard/clipboard/menu bursts stay coalesced.
      const cooldownMs = type === 'TAB_SWITCH' ? 0 : 1_000;
      const last = lastViolationAt.current.get(type) ?? 0;
      if (cooldownMs > 0 && now - last < cooldownMs) return;
      lastViolationAt.current.set(type, now);
      void assessmentDeliveryApi.recordAudit(scheduleId, attemptId, 'VIOLATION_DETECTED', {
        violationId: violationId(type),
        violationType: type,
        severity,
        message,
        ...detail,
      }).catch(() => undefined);
    },
    [attemptId, scheduleId],
  );

  const onVisibilityExcursion = useCallback(
    (excursion: ExamVisibilityExcursion) => {
      reportViolation('TAB_SWITCH', 'medium', EXAM_VISIBILITY_WARNING_MESSAGE, {
        interactionSurface: 'exam',
        ...examVisibilityAuditDetail(excursion),
      });
      setPendingTabSwitchWarning(excursion);
    },
    [reportViolation],
  );

  useExamVisibilityIntegrity({
    active: integrityActive,
    enabled: integrityActive,
    onViolation: onVisibilityExcursion,
  });

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
    const blockClipboard = (event: ClipboardEvent) => {
      event.preventDefault();
      reportViolation('CLIPBOARD_ATTEMPT', 'medium', 'Clipboard use was blocked during the SAT exam.', {
        interactionSurface: interactionSurface(event.target),
      });
    };
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      reportViolation('CONTEXT_MENU', 'low', 'Context menu use was blocked during the SAT exam.', {
        interactionSurface: interactionSurface(event.target),
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'PrintScreen') {
        reportViolation('SCREENSHOT_ATTEMPT', 'high', 'Screenshot key was detected during the SAT exam.', {
          interactionSurface: 'exam',
        });
      }
      const command = event.metaKey || event.ctrlKey;
      if (command && ['f', 'p', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        reportViolation('RESTRICTED_SHORTCUT', 'low', `Restricted shortcut ${event.key.toUpperCase()} was blocked.`, {
          interactionSurface: interactionSurface(event.target),
        });
      }
    };
    const checkExtendedScreen = () => {
      const extended = (window.screen as Screen & { isExtended?: boolean }).isExtended;
      if (extended) {
        reportViolation('SECONDARY_SCREEN', 'high', 'A secondary display was detected during the SAT exam.', {
          interactionSurface: 'exam',
        });
      }
    };

    // No `visibilitychange` listener here: the shared integrity rule owns it.
    document.addEventListener('copy', blockClipboard);
    document.addEventListener('cut', blockClipboard);
    document.addEventListener('paste', blockClipboard);
    document.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', checkExtendedScreen);
    checkExtendedScreen();
    return () => {
      document.removeEventListener('copy', blockClipboard);
      document.removeEventListener('cut', blockClipboard);
      document.removeEventListener('paste', blockClipboard);
      document.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', checkExtendedScreen);
    };
  }, [enforceInteractionGuards, reportViolation]);

  return { pendingTabSwitchWarning, acknowledgeTabSwitchWarning } as const;
}
