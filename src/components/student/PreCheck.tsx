import React, { useEffect, useState } from 'react';
import {
  Globe,
  Lock,
  Monitor,
  Shield,
} from 'lucide-react';
import type { ExamConfig } from '../../types';
import { getStudentIntegritySecurityPolicy } from '../../services/studentIntegrityService';
import type {
  StudentPreCheckCheckResult,
  StudentPreCheckResult,
} from '../../types/studentAttempt';
import { Button } from '../ui/Button';
import { LoadingMark, SrLoadingText } from '../ui/LoadingMark';
import { isAppleMobileDevice } from './fullscreen';

interface PreCheckProps {
  config?: ExamConfig | undefined;
  onComplete: (result: StudentPreCheckResult) => Promise<void> | void;
  onExit: () => void;
}

interface BrowserInfo {
  family: StudentPreCheckResult['browserFamily'];
  version: number | null;
}

interface CheckItem extends StudentPreCheckCheckResult {
  icon: React.ElementType;
}

function detectBrowser(userAgent: string): BrowserInfo {
  const chromeMatch = userAgent.match(/(?:Chrome|CriOS)\/(\d+)/i);
  if (chromeMatch && !/Edg\//i.test(userAgent)) {
    return {
      family: 'chrome',
      version: Number.parseInt(chromeMatch[1] ?? '', 10) || null,
    };
  }

  const edgeMatch = userAgent.match(/(?:Edg|EdgiOS)\/(\d+)/i);
  if (edgeMatch) {
    return {
      family: 'edge',
      version: Number.parseInt(edgeMatch[1] ?? '', 10) || null,
    };
  }

  const safariMatch = userAgent.match(/Version\/(\d+)/i);
  if (/Safari/i.test(userAgent) && safariMatch && !/Chrome|Chromium|Edg\//i.test(userAgent)) {
    return {
      family: 'safari',
      version: Number.parseInt(safariMatch[1] ?? '', 10) || null,
    };
  }

  const firefoxMatch = userAgent.match(/Firefox\/(\d+)/i);
  if (firefoxMatch) {
    return {
      family: 'firefox',
      version: Number.parseInt(firefoxMatch[1] ?? '', 10) || null,
    };
  }

  return {
    family: 'other',
    version: null,
  };
}

function isMobileDevice(userAgent: string): boolean {
  if (/(iPhone|iPad|iPod)/i.test(userAgent)) {
    return true;
  }

  if (isAppleMobileDevice(userAgent)) {
    return true;
  }

  if (/Android/i.test(userAgent)) {
    return true;
  }

  return false;
}

function canUseStorage() {
  try {
    localStorage.setItem('__student-precheck__', 'ok');
    localStorage.removeItem('__student-precheck__');
    return true;
  } catch {
    return false;
  }
}

function runChecks(config?: ExamConfig): StudentPreCheckResult {
  const userAgent = navigator.userAgent;
  const browser = detectBrowser(userAgent);
  const mobileDevice = isMobileDevice(userAgent);
  const appleMobileDevice = isAppleMobileDevice(userAgent);
  const policy = getStudentIntegritySecurityPolicy(config);
  const fullscreenRequired = config?.security.requireFullscreen ?? false;
  const fullscreenSupported =
    typeof document.documentElement.requestFullscreen === 'function' ||
    'webkitRequestFullscreen' in document.documentElement;
  const storageAvailable = canUseStorage();
  const screenDetailsSupported = 'getScreenDetails' in window;
  const javascriptReady =
    typeof window.setInterval === 'function' &&
    typeof window.clearInterval === 'function';
  const heartbeatReady = javascriptReady && navigator.onLine;

  const secureModeEnabled = Boolean(
    config?.security.requireFullscreen || config?.security.detectSecondaryScreen,
  );
  const mobileAllowed = !secureModeEnabled || appleMobileDevice;
  const mobileCompatibilityOk = !mobileDevice || mobileAllowed;

  const browserSupported =
    mobileCompatibilityOk &&
    (((browser.family === 'chrome' || browser.family === 'edge') &&
      (browser.version ?? 0) >= 111) ||
      browser.family === 'safari' ||
      browser.family === 'firefox');

  const browserCheck: CheckItem = {
    id: 'browser',
    label: 'Browser compatibility',
    message: browserSupported
      ? appleMobileDevice && secureModeEnabled
        ? 'iPad secure mode is best-effort; fullscreen may need to be restored after typing or scrolling.'
        : `${browser.family.toUpperCase()} ${browser.version ?? ''}`.trim()
      : appleMobileDevice && secureModeEnabled
        ? 'iPad secure mode is best-effort; fullscreen may need to be restored after typing or scrolling.'
        : mobileDevice && !mobileAllowed
        ? 'Mobile/iPad is supported only in non-secure mode. Disable fullscreen and secondary screen detection, or use a computer.'
        : 'Use Chrome 111+, Edge, Safari, or Firefox.',
    required: true,
    status: browserSupported ? 'pass' : 'fail',
    icon: Globe,
  };

  const javascriptCheck: CheckItem = {
    id: 'javascript',
    label: 'JavaScript runtime',
    message: javascriptReady
      ? 'Runtime timers and event loop available.'
      : 'JavaScript timers are unavailable.',
    required: true,
    status: javascriptReady ? 'pass' : 'fail',
    icon: Shield,
  };

  const fullscreenCheck: CheckItem = {
    id: 'fullscreen',
    label: 'Fullscreen API',
    message: !fullscreenRequired
      ? 'Fullscreen is optional for this exam.'
      : fullscreenSupported
        ? 'Fullscreen is available.'
        : 'This browser cannot enforce fullscreen mode.',
    required: fullscreenRequired,
    status: !fullscreenRequired || fullscreenSupported ? 'pass' : 'fail',
    icon: Monitor,
  };

  const storageCheck: CheckItem = {
    id: 'storage',
    label: 'Secure local storage',
    message: storageAvailable
      ? 'Attempt recovery storage is available.'
      : 'Local storage is unavailable.',
    required: true,
    status: storageAvailable ? 'pass' : 'fail',
    icon: Lock,
  };

  const onlineCheck: CheckItem = {
    id: 'online',
    label: 'Network connectivity',
    message: navigator.onLine
      ? 'Network connection detected.'
      : 'Reconnect to the internet before continuing.',
    required: true,
    status: navigator.onLine ? 'pass' : 'fail',
    icon: Globe,
  };

  const screenCheck: CheckItem = {
    id: 'screen-details',
    label: 'Secondary screen detection',
    message: !config?.security.detectSecondaryScreen
      ? 'Secondary screen detection is disabled for this exam.'
      : screenDetailsSupported
        ? 'Screen details API available.'
        : browser.family === 'safari' && policy.allowSafariWithAcknowledgement
          ? 'Safari cannot verify external displays. Acknowledgment required.'
          : browser.family === 'safari'
            ? 'Safari is blocked for this exam because external display verification is unavailable.'
            : 'This browser cannot verify external displays.',
    required:
      Boolean(config?.security.detectSecondaryScreen) &&
      !(browser.family === 'safari' && policy.allowSafariWithAcknowledgement),
    status: !config?.security.detectSecondaryScreen
      ? 'pass'
      : screenDetailsSupported
        ? 'pass'
        : browser.family === 'safari' && policy.allowSafariWithAcknowledgement
          ? 'warn'
          : 'fail',
    icon: Monitor,
  };

  return {
    completedAt: new Date().toISOString(),
    browserFamily: browser.family,
    browserVersion: browser.version,
    screenDetailsSupported,
    heartbeatReady,
    acknowledgedSafariLimitation: false,
    checks: [
      browserCheck,
      javascriptCheck,
      fullscreenCheck,
      storageCheck,
      onlineCheck,
      screenCheck,
    ],
  };
}

export function PreCheck({ config, onComplete, onExit }: PreCheckProps) {
  const [isRunning, setIsRunning] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<StudentPreCheckResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setResult(runChecks(config));
      setIsRunning(false);
    }, 150);

    return () => {
      window.clearTimeout(timer);
    };
  }, [config]);

  const canContinue = !isRunning && !isSubmitting;

  const handleContinue = async () => {
    if (!result) {
      return;
    }

    setSubmitError(null);

    setIsSubmitting(true);
    try {
      await onComplete(result);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to continue. Please try again.');
      return;
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-full bg-gray-50 p-3 sm:p-4 md:p-6 lg:p-8">
      <div className="bg-white rounded-sm shadow-[0_8px_24px_rgba(9,30,66,0.08)] max-w-2xl w-full overflow-hidden border border-gray-100 flex flex-col max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] md:max-h-[calc(100vh-4rem)] lg:max-h-[calc(100vh-5rem)]">
        <div className="px-3 sm:px-4 md:px-6 lg:px-10 py-3 sm:py-4 md:py-6 lg:py-8 border-b border-gray-200 bg-white flex-shrink-0">
          <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 tracking-tight leading-tight">
            System checking
          </h2>
        </div>

        <div className="p-3 sm:p-4 md:p-6 lg:p-10 overflow-y-auto flex-1">
          <div className="flex flex-col items-center justify-center py-10 sm:py-14 md:py-20">
            {isRunning ? (
              <>
                <LoadingMark size="md" className="bg-gray-300" />
                <SrLoadingText>System checking…</SrLoadingText>
              </>
            ) : null}
            <div className="mt-3 text-sm sm:text-base font-semibold text-gray-900">
              System checking
            </div>
          </div>

          {submitError ? (
            <div className="mt-4 rounded-sm border border-red-200 bg-red-50 p-3 text-xs sm:text-sm text-red-900">
              {submitError}
            </div>
          ) : null}
        </div>

        <div className="p-3 sm:p-4 md:p-6 lg:px-10 border-t border-gray-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 sm:gap-3 md:gap-4 flex-shrink-0 bg-white">
          <div className="flex gap-2 sm:gap-3 md:gap-4 w-full md:w-auto">
            <Button
              variant="secondary"
              onClick={onExit}
              size="sm"
              disabled={isSubmitting}
              className="flex-1 md:flex-none text-[10px] sm:text-xs"
            >
              Exit
            </Button>
            <Button
              variant="primary"
              disabled={!canContinue || !result}
              onClick={() => {
                void handleContinue();
              }}
              size="sm"
              className="flex-1 md:flex-none min-w-[80px] sm:min-w-[100px] md:min-w-[120px] text-[10px] sm:text-xs"
            >
              {isSubmitting ? 'Saving…' : 'Continue'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
