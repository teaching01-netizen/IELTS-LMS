/**
 * Spine rollout flag (plan Phase 1, removed in Phase 10 with the legacy branch).
 *
 * Explicit `?spine=` param wins; otherwise the stored staff preference wins;
 * otherwise the rollout default applies (off through Phase 8, on in Phase 9).
 * Storage access is guarded: private browsing / locked-down embeds deny it.
 */
export const SPINE_STORAGE_KEY = "sat-authoring:spine";

export function readStoredSpinePreference(): "1" | "0" | null {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return null;
    }
    const stored = window.localStorage.getItem(SPINE_STORAGE_KEY);
    return stored === "1" || stored === "0" ? stored : null;
  } catch {
    return null;
  }
}

export function isSpineEnabled(searchParams: URLSearchParams, defaultOn = false): boolean {
  const param = searchParams.get("spine");
  if (param === "1") return true;
  if (param === "0") return false;
  const stored = readStoredSpinePreference();
  if (stored !== null) return stored === "1";
  return defaultOn;
}
