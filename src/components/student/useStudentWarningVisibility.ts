import { useCallback, useMemo, useState } from 'react';
import type { Violation, ViolationSeverity } from '../../types';

interface WarningSecurityConfig {
  tabSwitchRule: 'none' | 'warn' | 'terminate';
  detectSecondaryScreen: boolean;
  antiScreenshotGuardEnabled?: boolean | undefined;
  preventTranslation: boolean;
}

interface UseStudentWarningVisibilityOptions {
  effectivePhase: 'pre-check' | 'lobby' | 'exam' | 'post-exam' | 'submitted';
  violations: Violation[];
  security: WarningSecurityConfig;
}

function findLatestViolation(violations: Violation[], type: string): Violation | null {
  const filtered = violations.filter((violation) => violation.type === type);
  return filtered[filtered.length - 1] ?? null;
}

export function useStudentWarningVisibility({
  effectivePhase,
  violations,
  security,
}: UseStudentWarningVisibilityOptions) {
  const [lastAcknowledgedSecurityViolationId, setLastAcknowledgedSecurityViolationId] =
    useState<string | null>(null);
  const [lastAcknowledgedSecondaryScreenViolationId, setLastAcknowledgedSecondaryScreenViolationId] =
    useState<string | null>(null);
  const [lastAcknowledgedTranslationViolationId, setLastAcknowledgedTranslationViolationId] =
    useState<string | null>(null);
  const [lastAcknowledgedScreenshotViolationId, setLastAcknowledgedScreenshotViolationId] =
    useState<string | null>(null);

  const latestTabSwitchViolation = useMemo(() => {
    if (effectivePhase !== 'exam' || security.tabSwitchRule !== 'warn') {
      return null;
    }

    return findLatestViolation(violations, 'TAB_SWITCH');
  }, [effectivePhase, security.tabSwitchRule, violations]);

  const shouldShowTabSwitchWarning =
    Boolean(latestTabSwitchViolation) &&
    latestTabSwitchViolation?.id !== lastAcknowledgedSecurityViolationId;

  const tabSwitchSeverity: ViolationSeverity | 'medium' =
    latestTabSwitchViolation?.severity === 'high' || latestTabSwitchViolation?.severity === 'critical'
      ? latestTabSwitchViolation.severity
      : 'medium';

  const latestSecondaryScreenViolation = useMemo(() => {
    if (effectivePhase !== 'exam' || !security.detectSecondaryScreen) {
      return null;
    }

    return findLatestViolation(violations, 'SECONDARY_SCREEN');
  }, [effectivePhase, security.detectSecondaryScreen, violations]);

  const shouldShowSecondaryScreenWarning =
    Boolean(latestSecondaryScreenViolation) &&
    latestSecondaryScreenViolation?.id !== lastAcknowledgedSecondaryScreenViolationId;

  const latestScreenshotViolation = useMemo(() => {
    if (effectivePhase !== 'exam' || security.antiScreenshotGuardEnabled === false) {
      return null;
    }

    return findLatestViolation(violations, 'SCREENSHOT_ATTEMPT');
  }, [effectivePhase, security.antiScreenshotGuardEnabled, violations]);

  const shouldShowScreenshotWarning =
    Boolean(latestScreenshotViolation) &&
    latestScreenshotViolation?.id !== lastAcknowledgedScreenshotViolationId;

  const latestTranslationViolation = useMemo(() => {
    if (effectivePhase !== 'exam' || security.preventTranslation === false) {
      return null;
    }

    return findLatestViolation(violations, 'TRANSLATION_DETECTED');
  }, [effectivePhase, security.preventTranslation, violations]);

  const shouldShowTranslationWarning =
    Boolean(latestTranslationViolation) &&
    latestTranslationViolation?.id !== lastAcknowledgedTranslationViolationId;

  const acknowledgeTabSwitch = useCallback(() => {
    if (latestTabSwitchViolation) {
      setLastAcknowledgedSecurityViolationId(latestTabSwitchViolation.id);
    }
  }, [latestTabSwitchViolation]);

  const acknowledgeSecondaryScreen = useCallback(() => {
    if (latestSecondaryScreenViolation) {
      setLastAcknowledgedSecondaryScreenViolationId(latestSecondaryScreenViolation.id);
    }
  }, [latestSecondaryScreenViolation]);

  const acknowledgeScreenshot = useCallback(() => {
    if (latestScreenshotViolation) {
      setLastAcknowledgedScreenshotViolationId(latestScreenshotViolation.id);
    }
  }, [latestScreenshotViolation]);

  const acknowledgeTranslation = useCallback(() => {
    if (latestTranslationViolation) {
      setLastAcknowledgedTranslationViolationId(latestTranslationViolation.id);
    }
  }, [latestTranslationViolation]);

  return {
    latestTabSwitchViolation,
    shouldShowTabSwitchWarning,
    tabSwitchSeverity,
    latestSecondaryScreenViolation,
    shouldShowSecondaryScreenWarning,
    latestScreenshotViolation,
    shouldShowScreenshotWarning,
    latestTranslationViolation,
    shouldShowTranslationWarning,
    acknowledgeTabSwitch,
    acknowledgeSecondaryScreen,
    acknowledgeScreenshot,
    acknowledgeTranslation,
  };
}
