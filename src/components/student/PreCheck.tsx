import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Loader2,
  Lock,
  Monitor,
  Shield,
  XCircle,
} from 'lucide-react';
import type { ExamConfig } from '../../types';
import { getStudentIntegritySecurityPolicy } from '../../services/studentIntegrityService';
import type {
  StudentPreCheckCheckResult,
  StudentPreCheckResult,
} from '../../types/studentAttempt';
import { Button } from '../ui/Button';

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

const iconByCheckId: Record<StudentPreCheckCheckResult['id'], React.ElementType> = {
  browser: Globe,
  javascript: Shield,
  fullscreen: Monitor,
  storage: Lock,
  online: Globe,
  'screen-details': Monitor,
};

function detectBrowser(userAgent: string): BrowserInfo {
  const chromeMatch = userAgent.match(/Chrome\/(\d+)/i);
  if (chromeMatch && !/Edg\//i.test(userAgent)) {
    return {
      family: 'chrome',
      version: Number.parseInt(chromeMatch[1] ?? '', 10) || null,
    };
  }

  const edgeMatch = userAgent.match(/Edg\/(\d+)/i);
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

  // iPadOS 13+ can identify as "Macintosh" but includes "Mobile"
  if (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent)) {
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

function getFullscreenElement() {
  return (
    document.fullscreenElement ??
    (
      document as Document & {
        webkitFullscreenElement?: Element | null;
      }
    ).webkitFullscreenElement ??
    null
  );
}

async function requestFullscreenMode(): Promise<boolean> {
  if (getFullscreenElement()) {
    return true;
  }

  try {
    if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
      return true;
    }

    const webkitDocumentElement = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };

    if (typeof webkitDocumentElement.webkitRequestFullscreen === 'function') {
      await webkitDocumentElement.webkitRequestFullscreen();
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function runChecks(config?: ExamConfig): StudentPreCheckResult {
  const userAgent = navigator.userAgent;
  const browser = detectBrowser(userAgent);
  const mobileDevice = isMobileDevice(userAgent);
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
  const mobileAllowed = !secureModeEnabled;
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
      ? `${browser.family.toUpperCase()} ${browser.version ?? ''}`.trim()
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
  const [acknowledgedSafariLimitation, setAcknowledgedSafariLimitation] = useState(false);
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

  const checks = useMemo(() => result?.checks ?? [], [result]);
  const hasRequiredFailure = checks.some((check) => check.required && check.status === 'fail');
  const requiresSafariAcknowledgement = checks.some(
    (check) => check.id === 'screen-details' && check.status === 'warn',
  );
  const canContinue =
    !isRunning &&
    !isSubmitting &&
    !hasRequiredFailure &&
    (!requiresSafariAcknowledgement || acknowledgedSafariLimitation);

  const handleContinue = async () => {
    if (!result) {
      return;
    }

    setSubmitError(null);
    if (config?.security.requireFullscreen) {
      const enteredFullscreen = await requestFullscreenMode();
      if (!enteredFullscreen) {
        setResult({
          ...result,
          checks: result.checks.map((check) =>
            check.id === 'fullscreen'
              ? {
                  ...check,
                  required: true,
                  status: 'fail',
                  message: 'Fullscreen entry was blocked. Allow fullscreen and try again.',
                }
              : check,
          ),
        });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await onComplete({
        ...result,
        acknowledgedSafariLimitation,
      });
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
        <div className="px-3 sm:px-4 md:px-6 lg:px-10 py-3 sm:py-4 md:py-6 lg:py-8 border-b border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3 bg-white flex-shrink-0">
          <div className="flex-1">
            <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 tracking-tight leading-tight">
              System Compatibility Check
            </h2>
            <p className="text-xs sm:text-sm text-gray-600 font-semibold mt-0.5 sm:mt-1">
              Step 1 of 2: Integrity Verification
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <span
              className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider px-2 sm:px-3 py-1 rounded-full ${
                isRunning ? 'bg-blue-200 text-blue-800' : hasRequiredFailure ? 'bg-red-100 text-red-900' : 'bg-green-100 text-green-900'
              }`}
            >
              {isRunning ? 'Checking' : hasRequiredFailure ? 'Blocked' : 'Ready'}
            </span>
          </div>
        </div>

        <div className="p-3 sm:p-4 md:p-6 lg:p-10 overflow-y-auto flex-1">
          <p className="text-gray-700 mb-3 sm:mb-4 md:mb-6 leading-relaxed text-xs sm:text-sm md:text-base">
            Secure delivery requires capability checks before the session can continue.
          </p>

          <div className="space-y-2 sm:space-y-3 md:space-y-4">
            {checks.map((check) => {
              const Icon = iconByCheckId[check.id];

              return (
                <div
                  key={check.id}
                  className={`p-2.5 sm:p-3 md:p-4 rounded-sm border transition-all flex items-center gap-2 sm:gap-3 md:gap-4 ${
                    check.status === 'pass'
                      ? 'bg-green-100/30 border-green-300'
                      : check.status === 'warn'
                        ? 'bg-amber-100 border-amber-400'
                        : check.status === 'fail'
                          ? 'bg-red-100 border-red-300'
                          : 'bg-white border-gray-100'
                  }`}
                >
                  <div
                    className={`w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 rounded-sm flex items-center justify-center flex-shrink-0 ${
                      check.status === 'pass'
                        ? 'bg-white text-green-900 shadow-sm border border-green-300'
                        : check.status === 'warn'
                          ? 'bg-white text-amber-700 shadow-sm border border-amber-400'
                          : check.status === 'fail'
                            ? 'bg-white text-red-900 shadow-sm border border-red-300'
                            : 'bg-gray-50 text-gray-500 border border-gray-100'
                    }`}
                  >
                    {isRunning ? <Loader2 className="animate-spin" size={14} /> : <Icon size={14} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h4 className="text-[11px] sm:text-xs md:text-sm font-bold text-gray-900 truncate">
                      {check.label}
                    </h4>
                    <p className="text-[9px] sm:text-[10px] md:text-xs text-gray-600 mt-0.5">
                      {check.message}
                    </p>
                  </div>

                  <div className="flex-shrink-0">
                    {check.status === 'pass' && (
                      <CheckCircle2 className="text-green-600" size={14} strokeWidth={2.5} />
                    )}
                    {check.status === 'warn' && (
                      <AlertTriangle className="text-amber-700" size={14} strokeWidth={2.5} />
                    )}
                    {check.status === 'fail' && (
                      <XCircle className="text-red-700" size={14} strokeWidth={2.5} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {requiresSafariAcknowledgement ? (
            <label className="mt-4 flex items-start gap-3 rounded-sm border border-amber-300 bg-amber-50 p-3 text-xs sm:text-sm text-amber-900">
              <input
                type="checkbox"
                checked={acknowledgedSafariLimitation}
                onChange={(event) => setAcknowledgedSafariLimitation(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                I understand Safari cannot verify secondary displays, and I confirm no extra
                monitors are connected.
              </span>
            </label>
          ) : null}

          {submitError ? (
            <div className="mt-4 rounded-sm border border-red-200 bg-red-50 p-3 text-xs sm:text-sm text-red-900">
              {submitError}
            </div>
          ) : null}
        </div>

        <div className="p-3 sm:p-4 md:p-6 lg:px-10 border-t border-gray-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 sm:gap-3 md:gap-4 flex-shrink-0 bg-white">
          <div className="text-[10px] sm:text-xs text-gray-500">
            {hasRequiredFailure
              ? 'Resolve failed checks before continuing.'
              : requiresSafariAcknowledgement && !acknowledgedSafariLimitation
                ? 'Safari acknowledgment required.'
                : 'All required checks passed.'}
          </div>

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
