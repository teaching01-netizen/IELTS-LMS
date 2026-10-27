import { createDefaultConfig } from '../constants/examDefaults';
import type { ExamConfig } from '../types';
import {
  backendGet,
  backendPut,
  isBackendNotFound,
} from './backendBridge';
import { ApiError } from '../shared/api-client/errors';

let defaultsRevision: number | undefined;
/** The content `defaultsRevision` represents; a 409 is only safe to retry when the server still holds it. */
let defaultsBase: ExamConfig | undefined;
let inFlightLoad: Promise<ExamConfig> | null = null;

type DefaultsPayload = {
  configSnapshot: ExamConfig;
  revision?: number | undefined;
};

/** Another writer changed the saved defaults since this client's base. */
export class ExamDefaultsConflictError extends Error {
  readonly code = 'EXAM_DEFAULTS_CONFLICT';
  readonly latest: ExamConfig;
  constructor(latest: ExamConfig) {
    super('Another admin changed the saved exam defaults.');
    this.name = 'ExamDefaultsConflictError';
    this.latest = latest;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sameContent(a: ExamConfig | undefined, b: ExamConfig | undefined): boolean {
  return a !== undefined && b !== undefined && stableStringify(a) === stableStringify(b);
}

const DEFAULTS_LOAD_TIMEOUT_MS = 10_000;

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
      const payload = await backendGet<DefaultsPayload>('/v1/settings/exam-defaults', {
        timeout: DEFAULTS_LOAD_TIMEOUT_MS,
        retries: 0,
      });
      // A load adopts the server's revision together with the content it
      // describes, so a later conflict can tell a real remote edit apart.
      defaultsRevision = payload.revision;
      defaultsBase = payload.configSnapshot;
      return payload.configSnapshot;
    } catch (error) {
      if (!isBackendNotFound(error)) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Loading saved exam defaults timed out. Check the backend connection and retry.');
        }
        throw error;
      }

      defaultsRevision = 0;
      defaultsBase = undefined;
      return this.getDefaults();
    }
  }

  private async putDefaults(config: ExamConfig, revision: number): Promise<void> {
    const payload = await backendPut<DefaultsPayload>('/v1/settings/exam-defaults', {
      configSnapshot: config,
      revision,
    });
    defaultsRevision = payload.revision;
    defaultsBase = payload.configSnapshot ?? config;
  }

  /**
   * Save the full defaults document against the loaded base revision.
   *
   * A 409 means another writer committed first. The save is retried once on
   * the fresh revision only when that cannot discard their work: the server
   * still holds our base content (a revision-only bump) or already holds
   * exactly what we are saving. Otherwise the caller gets a conflict and
   * decides; `overwrite` is that explicit decision.
   */
  async saveDefaults(config: ExamConfig, options: { overwrite?: boolean } = {}): Promise<void> {
    try {
      await this.putDefaults(config, defaultsRevision ?? 0);
    } catch (error) {
      if (!isConflict(error)) throw error;
      let latest: DefaultsPayload | null;
      try {
        latest = await backendGet<DefaultsPayload>('/v1/settings/exam-defaults', {
          timeout: DEFAULTS_LOAD_TIMEOUT_MS,
          retries: 0,
        });
      } catch (readError) {
        if (!isBackendNotFound(readError)) throw readError;
        latest = null;
      }
      const remote = latest?.configSnapshot;
      const safeToRetry = options.overwrite === true || sameContent(remote, defaultsBase) || sameContent(remote, config);
      if (!safeToRetry) throw new ExamDefaultsConflictError(remote ?? this.getDefaults());
      await this.putDefaults(config, latest?.revision ?? 0);
    }
  }
}

export const adminPreferencesRepository = new AdminPreferencesRepository();
