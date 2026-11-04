import type { DesmosCalculatorMode, DesmosLocale } from '../infrastructure/desmos/desmosTypes';
import { SAT_EXAM_LOCALE } from '../infrastructure/desmos/desmosTypes';
import { emitStudentObservabilityMetric } from '../../../utils/studentObservability';

const STORAGE_PREFIX = 'sat-desmos-embed:v1';
const LOCALE_PREFIX = 'sat-desmos-locale:v1';

export interface SatCalculatorWorkspace {
  activeMode: DesmosCalculatorMode;
}

export function calculatorWorkspaceKey(
  scheduleId: string,
  attemptId: string,
  moduleAttemptId: string,
) {
  return `${STORAGE_PREFIX}:${scheduleId}:${attemptId}:${moduleAttemptId}`;
}

export function createCalculatorWorkspace(): SatCalculatorWorkspace {
  return { activeMode: 'graphing' };
}

function canUseSessionStorage() {
  if (typeof window === 'undefined') return false;
  try { return Boolean(window.sessionStorage); } catch { return false; }
}
export function loadCalculatorWorkspace(key: string): SatCalculatorWorkspace {
  if (!canUseSessionStorage()) return createCalculatorWorkspace();
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return createCalculatorWorkspace();
    const parsed = JSON.parse(raw) as Partial<SatCalculatorWorkspace>;
    return { activeMode: parsed.activeMode === 'scientific' ? 'scientific' : 'graphing' };
  } catch {
    return createCalculatorWorkspace();
  }
}

export function saveCalculatorWorkspace(key: string, workspace: SatCalculatorWorkspace) {
  if (!canUseSessionStorage()) return false;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ activeMode: workspace.activeMode }));
    return true;
  } catch {
    return false;
  }
}
export function calculatorLocaleKey(
  scheduleId: string,
  attemptId: string,
  moduleAttemptId: string,
) {
  return `${LOCALE_PREFIX}:${scheduleId}:${attemptId}:${moduleAttemptId}`;
}

let localeFreezeBeaconed = false;

export function loadCalculatorLocale(key: string): DesmosLocale {
  // Burst-plan freeze (FR-06): the embed URL always carries
  // SAT_EXAM_LOCALE (`lang=en`). Seeded storage is ignored — a stale
  // `en-US` seed previously flipped the embed to `lang=en-US`. The seeded
  // value is never read back; a one-time beacon records the freeze hit.
  if (!canUseSessionStorage()) return SAT_EXAM_LOCALE;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw != null) {
      const parsed = JSON.parse(raw) as Partial<{ locale: unknown }>;
      if (parsed.locale !== undefined && parsed.locale !== SAT_EXAM_LOCALE && !localeFreezeBeaconed) {
        localeFreezeBeaconed = true;
        emitStudentObservabilityMetric('sat_desmos_locale_frozen', {
          seededLocale: typeof parsed.locale === 'string' ? parsed.locale : 'unknown',
        });
      }
    }
  } catch {
    // Corrupt storage never breaks the embed; the frozen default holds.
  }
  return SAT_EXAM_LOCALE;
}

/**
 * Prewarm read-only rule (FR-07): storage keys minted for a synthetic
 * `prewarm:<moduleId>` module attempt must never be written. Callers gate
 * saves through this predicate; a write under a prewarm key would fork the
 * prewarmed frame away from the real module attempt (INV-012).
 */
export function isPrewarmKey(key: string): boolean {
  if (key.startsWith('prewarm:')) return true;
  const segments = key.split(':');
  return segments.length >= 2 && segments[segments.length - 2] === 'prewarm';
}

export function saveCalculatorLocale(key: string, locale: DesmosLocale) {
  if (!canUseSessionStorage()) return false;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ locale }));
    return true;
  } catch {
    return false;
  }
}

export function clearCalculatorLocale(key: string) {
  if (!canUseSessionStorage()) return;
  try { window.sessionStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
}

export function clearCalculatorLocaleForAttempt(scheduleId: string, attemptId: string) {
  if (!canUseSessionStorage()) return;
  const prefix = `${LOCALE_PREFIX}:${scheduleId}:${attemptId}:`;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Cleanup is best-effort and must never interfere with exam completion.
  }
}

export function clearCalculatorWorkspace(key: string) {
  if (!canUseSessionStorage()) return;
  try { window.sessionStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
}

export function clearCalculatorWorkspacesForAttempt(scheduleId: string, attemptId: string) {
  if (!canUseSessionStorage()) return;
  const prefix = `${STORAGE_PREFIX}:${scheduleId}:${attemptId}:`;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Cleanup is best-effort and must never interfere with exam completion.
  }
}
