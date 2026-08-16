import {
  createDefaultExportProfile,
  type ExportProfile,
} from './exportPlan';
import { backendGet, backendPost, isBackendNotFound } from '../../../features/grading/infrastructure/gradingGateway';
import { isAppError } from '../../../app/error/errorTypes';

const PROFILE_STORAGE_KEY = 'grading:exportProfiles:v1';

interface BackendGradingExportProfile {
  id: string;
  profileName: string;
  configSnapshot: unknown;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStoredExportProfile(value: unknown): value is ExportProfile {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    (value['outputType'] === 'pdf_zip' || value['outputType'] === 'csv' || value['outputType'] === 'xlsx') &&
    Array.isArray(value['sections']) &&
    isRecord(value['filters']) &&
    Array.isArray(value['grouping']) &&
    Array.isArray(value['customGroups']) &&
    typeof value['filenameTemplate'] === 'string' &&
    (value['pdfMode'] === 'combined' || value['pdfMode'] === 'separate' || value['pdfMode'] === 'bySection') &&
    value['collisionStrategy'] === 'suffix' &&
    typeof value['version'] === 'number' &&
    typeof value['createdBy'] === 'string' &&
    typeof value['createdAt'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  );
}

function normalizeStoredExportProfile(profile: ExportProfile): ExportProfile {
  const defaults = createDefaultExportProfile();
  return {
    ...defaults,
    ...profile,
    filters: {
      ...defaults.filters,
      ...profile.filters,
    },
  };
}

function hydrateBackendProfile(record: BackendGradingExportProfile): ExportProfile {
  const defaults = createDefaultExportProfile();
  const snapshot = isRecord(record.configSnapshot) ? record.configSnapshot : {};
  const snapshotFilters = isRecord(snapshot['filters']) ? snapshot['filters'] : {};
  return normalizeStoredExportProfile({
    ...defaults,
    ...(snapshot as Partial<ExportProfile>),
    id: record.id,
    name: record.profileName,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: typeof snapshot['version'] === 'number' ? snapshot['version'] : Math.max(1, record.revision),
    filters: {
      ...defaults.filters,
      ...(snapshotFilters as Partial<ExportProfile['filters']>),
    },
  });
}

function shouldUseLocalFallback(error: unknown): boolean {
  if (isBackendNotFound(error)) return true;
  return isAppError(error) && (error.code === 'NETWORK_ERROR' || error.code === 'SERVICE_UNAVAILABLE');
}

export function upsertExportProfile(
  profiles: readonly ExportProfile[],
  profile: ExportProfile,
): readonly ExportProfile[] {
  const existingIndex = profiles.findIndex((candidate) => candidate.id === profile.id);
  if (existingIndex < 0) return [...profiles, profile];
  return profiles.map((candidate, index) => (index === existingIndex ? profile : candidate));
}

export function loadStoredExportProfiles(): readonly ExportProfile[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(isStoredExportProfile).map(normalizeStoredExportProfile)
      : [];
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

export function saveStoredExportProfile(profile: ExportProfile): void {
  if (typeof window === 'undefined') return;
  const profiles = upsertExportProfile(loadStoredExportProfiles(), profile);
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
  } catch (error) {
    if (error instanceof DOMException) return;
    throw error;
  }
}

export function getAvailableExportProfiles(): readonly ExportProfile[] {
  const systemProfile = createDefaultExportProfile();
  return [
    systemProfile,
    ...loadStoredExportProfiles().filter((profile) => profile.id !== systemProfile.id),
  ];
}

/**
 * Load shared profiles first. Browser storage is only an offline/dev fallback;
 * successful backend reads never merge in stale browser-only profiles.
 */
export async function loadAvailableExportProfiles(): Promise<readonly ExportProfile[]> {
  try {
    const records = await backendGet<BackendGradingExportProfile[]>('/v1/settings/export-profiles');
    const systemProfile = createDefaultExportProfile();
    return [
      systemProfile,
      ...records
        .map(hydrateBackendProfile)
        .filter((profile) => profile.id !== systemProfile.id),
    ];
  } catch (error) {
    if (!shouldUseLocalFallback(error)) throw error;
    return getAvailableExportProfiles();
  }
}

export async function persistExportProfile(profile: ExportProfile): Promise<ExportProfile> {
  try {
    const record = await backendPost<BackendGradingExportProfile>('/v1/settings/export-profiles', {
      profileName: profile.name,
      configSnapshot: profile,
    });
    return hydrateBackendProfile(record);
  } catch (error) {
    if (!shouldUseLocalFallback(error)) throw error;
    saveStoredExportProfile(profile);
    return profile;
  }
}

export function createSavedExportProfile(
  name: string,
  profile: ExportProfile,
): ExportProfile {
  const normalizedName = name.trim() || 'Untitled export';
  const slug = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const now = new Date().toISOString();
  return {
    ...profile,
    id: `local-${slug || 'export'}-${Date.now()}`,
    name: normalizedName,
    createdBy: 'local-user',
    createdAt: now,
    updatedAt: now,
  };
}
