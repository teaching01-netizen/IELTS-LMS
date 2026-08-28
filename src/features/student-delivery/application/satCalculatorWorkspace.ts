import type {
  DesmosCalculatorMode,
  DesmosCalculatorState,
} from '../infrastructure/desmos/desmosTypes';

const STORAGE_PREFIX = 'sat-desmos-workspace:v1';
const MAX_SERIALIZED_BYTES = 1_500_000;

export interface SatCalculatorWorkspace {
  activeMode: DesmosCalculatorMode;
  graphingState?: DesmosCalculatorState;
  scientificState?: DesmosCalculatorState;
}

export function calculatorWorkspaceKey(
  scheduleId: string,
  attemptId: string,
  moduleAttemptId: string,
) {
  return `${STORAGE_PREFIX}:${scheduleId}:${attemptId}:${moduleAttemptId}`;
}

export function createCalculatorWorkspace(): SatCalculatorWorkspace {
  return { activeMode: 'scientific' };
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
    return {
      activeMode: parsed.activeMode === 'graphing' ? 'graphing' : 'scientific',
      ...(parsed.graphingState === undefined ? {} : { graphingState: parsed.graphingState }),
      ...(parsed.scientificState === undefined ? {} : { scientificState: parsed.scientificState }),
    };
  } catch {
    return createCalculatorWorkspace();
  }
}

export function saveCalculatorWorkspace(key: string, workspace: SatCalculatorWorkspace) {
  if (!canUseSessionStorage()) return false;
  try {
    const serialized = JSON.stringify(workspace);
    if (new Blob([serialized]).size > MAX_SERIALIZED_BYTES) return false;
    window.sessionStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
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
