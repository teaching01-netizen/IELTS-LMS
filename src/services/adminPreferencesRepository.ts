import { createDefaultConfig } from '../constants/examDefaults';
import type { ExamConfig } from '../types';
import {
  backendGet,
  backendPut,
  isBackendNotFound,
} from './backendBridge';
import { ApiError } from '../shared/api-client/errors';

let defaultsRevision: number | undefined;
let inFlightLoad: Promise<ExamConfig> | null = null;

function isConflict(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 409;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode?: unknown }).statusCode === 409
  );
}

class AdminPreferencesRepository {
  getDefaults(): ExamConfig {
    return createDefaultConfig('Academic', 'Academic');
  }

  async loadDefaults(): Promise<ExamConfig> {
    // Single-flight: concurrent callers share one GET so N parallel mounts
    // produce one request. The entry clears in `finally` (via assignment to
    // null after settle) so a failure never pins a rejected promise.
    if (!inFlightLoad) {
      inFlightLoad = this.fetchDefaults().finally(() => {
        inFlightLoad = null;
      });
    }
    return inFlightLoad;
  }

  private async fetchDefaults(): Promise<ExamConfig> {
    try {
      const payload = await backendGet<{
        configSnapshot: ExamConfig;
        revision?: number | undefined;
      }>('/v1/settings/exam-defaults');
      // Revision refresh: always adopt the server's latest revision so the
      // next save carries a fresh base instead of a stale cached number.
      defaultsRevision = payload.revision;
      return payload.configSnapshot;
    } catch (error) {
      if (!isBackendNotFound(error)) {
        throw error;
      }

      defaultsRevision = 0;
      return this.getDefaults();
    }
  }

  async saveDefaults(config: ExamConfig) {
    try {
      const payload = await backendPut<{
        configSnapshot: ExamConfig;
        revision?: number | undefined;
      }>('/v1/settings/exam-defaults', {
        configSnapshot: config,
        revision: defaultsRevision ?? 0,
      });
      defaultsRevision = payload.revision;
    } catch (error) {
      // 409 = another writer committed first. Reload (refreshing the cached
      // revision via fetchDefaults) and retry once with the fresh base; a
      // second conflict surfaces to the caller instead of looping.
      if (!isConflict(error)) throw error;
      const latest = await this.loadDefaults();
      void latest;
      const payload = await backendPut<{
        configSnapshot: ExamConfig;
        revision?: number | undefined;
      }>('/v1/settings/exam-defaults', {
        configSnapshot: config,
        revision: defaultsRevision ?? 0,
      });
      defaultsRevision = payload.revision;
    }
  }
}

export const adminPreferencesRepository = new AdminPreferencesRepository();
