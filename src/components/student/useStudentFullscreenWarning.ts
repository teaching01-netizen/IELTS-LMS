import { useEffect, useMemo, useRef, useState } from 'react';
import type { Violation } from '../../types';
import { getFullscreenElement } from './fullscreen';

interface UseStudentFullscreenWarningOptions {
  effectivePhase: 'pre-check' | 'lobby' | 'exam' | 'post-exam' | 'submitted';
  showWarnings: boolean;
  requireFullscreen: boolean;
  violations: Violation[];
  getFullscreenElementFn?: (() => Element | null) | undefined;
}

const DEFAULT_FULLSCREEN_WARNING_MESSAGE =
  'Fullscreen mode is required. Please return to fullscreen to continue.';

function mapFullscreenWarningSeverity(severity: Violation['severity']): 'medium' | 'high' | 'critical' {
  if (severity === 'critical') {
    return 'critical';
  }

  if (severity === 'high') {
    return 'high';
  }

  return 'medium';
}

export function useStudentFullscreenWarning({
  effectivePhase,
  showWarnings,
  requireFullscreen,
  violations,
  getFullscreenElementFn,
}: UseStudentFullscreenWarningOptions) {
  const resolveFullscreenElement = getFullscreenElementFn ?? getFullscreenElement;
  const [fullscreenWarningOpen, setFullscreenWarningOpen] = useState(false);
  const [fullscreenWarningMessage, setFullscreenWarningMessage] = useState(
    DEFAULT_FULLSCREEN_WARNING_MESSAGE,
  );
  const [fullscreenWarningSeverity, setFullscreenWarningSeverity] = useState<
    'medium' | 'high' | 'critical'
  >('high');
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(resolveFullscreenElement()));
  const fullscreenGraceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleFullscreenUpdate = () => {
      setIsFullscreen(Boolean(resolveFullscreenElement()));
    };

    handleFullscreenUpdate();
    document.addEventListener('fullscreenchange', handleFullscreenUpdate);
    document.addEventListener(
      'webkitfullscreenchange' as unknown as 'fullscreenchange',
      handleFullscreenUpdate,
    );

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenUpdate);
      document.removeEventListener(
        'webkitfullscreenchange' as unknown as 'fullscreenchange',
        handleFullscreenUpdate,
      );
    };
  }, [resolveFullscreenElement]);

  const latestFullscreenExitViolation = useMemo(() => {
    if (effectivePhase !== 'exam' || !requireFullscreen) {
      return null;
    }

    const fullscreenViolations = violations.filter(
      (violation) => violation.type === 'FULLSCREEN_EXIT',
    );
    return fullscreenViolations[fullscreenViolations.length - 1] ?? null;
  }, [effectivePhase, requireFullscreen, violations]);

  useEffect(() => {
    if (fullscreenGraceTimerRef.current) {
      window.clearTimeout(fullscreenGraceTimerRef.current);
      fullscreenGraceTimerRef.current = null;
    }

    if (effectivePhase !== 'exam' || !showWarnings || !requireFullscreen) {
      setFullscreenWarningOpen(false);
      return;
    }

    if (!latestFullscreenExitViolation) {
      setFullscreenWarningOpen(false);
      return;
    }

    if (isFullscreen) {
      setFullscreenWarningOpen(false);
      return;
    }

    fullscreenGraceTimerRef.current = window.setTimeout(() => {
      if (resolveFullscreenElement()) {
        setFullscreenWarningOpen(false);
        return;
      }

      setFullscreenWarningMessage(
        latestFullscreenExitViolation.description ?? DEFAULT_FULLSCREEN_WARNING_MESSAGE,
      );
      setFullscreenWarningSeverity(
        mapFullscreenWarningSeverity(latestFullscreenExitViolation.severity),
      );
      setFullscreenWarningOpen(true);
    }, 200);

    return () => {
      if (fullscreenGraceTimerRef.current) {
        window.clearTimeout(fullscreenGraceTimerRef.current);
        fullscreenGraceTimerRef.current = null;
      }
    };
  }, [
    effectivePhase,
    showWarnings,
    requireFullscreen,
    isFullscreen,
    latestFullscreenExitViolation,
    resolveFullscreenElement,
  ]);

  useEffect(() => {
    if (isFullscreen) {
      setFullscreenWarningOpen(false);
    }
  }, [isFullscreen]);

  return {
    fullscreenWarningOpen,
    fullscreenWarningMessage,
    fullscreenWarningSeverity,
  };
}
