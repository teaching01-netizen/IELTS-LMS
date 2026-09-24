const SAT_RESUME_LOCATOR_KEY = 'sat-resume-locator:v1';
const SAT_RESUME_LOCATOR_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface SatResumeLocatorV1 {
  version: 1;
  providerKey: 'sat';
  scheduleId: string;
  candidateId: string;
  attemptId?: string;
  accessLinkId?: string;
  updatedAt: string;
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isLocator(value: unknown): value is SatResumeLocatorV1 {
  if (typeof value !== 'object' || value === null) return false;
  const locator = value as Partial<SatResumeLocatorV1>;
  const updatedAt = typeof locator.updatedAt === 'string' ? Date.parse(locator.updatedAt) : Number.NaN;
  const ageMs = Date.now() - updatedAt;
  return (
    locator.version === 1 &&
    locator.providerKey === 'sat' &&
    typeof locator.scheduleId === 'string' && locator.scheduleId.trim().length > 0 &&
    typeof locator.candidateId === 'string' && locator.candidateId.trim().length > 0 &&
    (locator.attemptId === undefined || typeof locator.attemptId === 'string') &&
    (locator.accessLinkId === undefined || typeof locator.accessLinkId === 'string') &&
    Number.isFinite(updatedAt) &&
    ageMs >= 0 && ageMs <= SAT_RESUME_LOCATOR_MAX_AGE_MS
  );
}

export function loadSatResumeLocator(): SatResumeLocatorV1 | null {
  try {
    const raw = browserStorage()?.getItem(SAT_RESUME_LOCATOR_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isLocator(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSatResumeLocator(
  locator: Omit<SatResumeLocatorV1, 'version' | 'providerKey' | 'updatedAt'> &
    Partial<Pick<SatResumeLocatorV1, 'updatedAt'>>,
): void {
  try {
    if (!locator.scheduleId.trim() || !locator.candidateId.trim()) return;
    const value: SatResumeLocatorV1 = {
      version: 1,
      providerKey: 'sat',
      scheduleId: locator.scheduleId,
      candidateId: locator.candidateId,
      ...(locator.attemptId ? { attemptId: locator.attemptId } : {}),
      ...(locator.accessLinkId ? { accessLinkId: locator.accessLinkId } : {}),
      updatedAt: locator.updatedAt ?? new Date().toISOString(),
    };
    browserStorage()?.setItem(SAT_RESUME_LOCATOR_KEY, JSON.stringify(value));
  } catch {
    // Resume discovery is convenience-only; storage must never block exam entry.
  }
}

export function clearSatResumeLocator(): void {
  try {
    browserStorage()?.removeItem(SAT_RESUME_LOCATOR_KEY);
  } catch {
    // Storage cleanup is best-effort.
  }
}

export function matchesSatResumeLocator(
  locator: SatResumeLocatorV1 | null,
  scope: { scheduleId?: string; accessLinkId?: string },
): boolean {
  if (!locator) return false;
  if (scope.scheduleId && locator.scheduleId !== scope.scheduleId) return false;
  if (scope.accessLinkId && locator.accessLinkId !== scope.accessLinkId) return false;
  return true;
}
