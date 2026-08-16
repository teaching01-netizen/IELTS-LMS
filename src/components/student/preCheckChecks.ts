import React from 'react';
import { Globe, Lock, Monitor, Shield } from 'lucide-react';
import type { ExamConfig } from '../../types';
import { getStudentIntegritySecurityPolicy } from '@student/application/studentIntegrityFacade';
import type {
  StudentPreCheckCheckResult,
  StudentPreCheckResult,
} from '../../types/studentAttempt';
import { isAppleMobileDevice } from './appleMobileDevice';

interface BrowserInfo {
  family: StudentPreCheckResult['browserFamily'];
  version: number | null;
}

export interface PreCheckCheckItem extends StudentPreCheckCheckResult {
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

export function runPreCheckChecks(config?: ExamConfig): StudentPreCheckResult {
  const userAgent = navigator.userAgent;
  const browser = detectBrowser(userAgent);
  const mobileDevice = isMobileDevice(userAgent);
  const appleMobileDevice = isAppleMobileDevice(userAgent);
  const policy = getStudentIntegritySecurityPolicy(config);
  const storageAvailable = canUseStorage();
  const screenDetailsSupported = 'getScreenDetails' in window;
  const javascriptReady =
    typeof window.setInterval === 'function' &&
    typeof window.clearInterval === 'function';
  const heartbeatReady = javascriptReady && navigator.onLine;

  const secureModeEnabled = Boolean(config?.security.detectSecondaryScreen);
  const mobileAllowed = !secureModeEnabled || appleMobileDevice;
  const mobileCompatibilityOk = !mobileDevice || mobileAllowed;

  const browserSupported =
    mobileCompatibilityOk &&
    (((browser.family === 'chrome' || browser.family === 'edge') &&
      (browser.version ?? 0) >= 111) ||
      browser.family === 'safari' ||
      browser.family === 'firefox');

  const browserCheck: PreCheckCheckItem = {
    id: 'browser',
    label: 'Browser compatibility',
    message: browserSupported
      ? appleMobileDevice && secureModeEnabled
        ? 'iPad secure mode is best-effort; external display verification may be limited.'
        : `${browser.family.toUpperCase()} ${browser.version ?? ''}`.trim()
      : appleMobileDevice && secureModeEnabled
        ? 'iPad secure mode is best-effort; external display verification may be limited.'
        : mobileDevice && !mobileAllowed
        ? 'Mobile/iPad is supported only in non-secure mode. Disable secondary screen detection, or use a computer.'
        : 'Use Chrome 111+, Edge, Safari, or Firefox.',
    required: true,
    status: browserSupported ? 'pass' : 'fail',
    icon: Globe,
  };

  const javascriptCheck: PreCheckCheckItem = {
    id: 'javascript',
    label: 'JavaScript runtime',
    message: javascriptReady
      ? 'Runtime timers and event loop available.'
      : 'JavaScript timers are unavailable.',
    required: true,
    status: javascriptReady ? 'pass' : 'fail',
    icon: Shield,
  };

  const storageCheck: PreCheckCheckItem = {
    id: 'storage',
    label: 'Secure local storage',
    message: storageAvailable
      ? 'Attempt recovery storage is available.'
      : 'Local storage is unavailable.',
    required: true,
    status: storageAvailable ? 'pass' : 'fail',
    icon: Lock,
  };

  const onlineCheck: PreCheckCheckItem = {
    id: 'online',
    label: 'Network connectivity',
    message: navigator.onLine
      ? 'Network connection detected.'
      : 'Reconnect to the internet before continuing.',
    required: true,
    status: navigator.onLine ? 'pass' : 'fail',
    icon: Globe,
  };

  const screenCheck: PreCheckCheckItem = {
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
      storageCheck,
      onlineCheck,
      screenCheck,
    ],
  };
}
