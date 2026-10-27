import { createDefaultConfig } from '../constants/examDefaults';
import type { ExamConfig } from '../types';
import {
  backendGet,
  backendPut,
  isBackendNotFound,
} from './backendBridge';
import { ApiError } from '../shared/api-client/errors';

/**
 * The saved defaults document together with the revision that describes it.
 * `stored` is false when the server has none yet and the built-in defaults
 * stand in; that content is not a base another writer could have changed.
 */
export interface ExamDefaultsSnapshot {
  config: ExamConfig;
  revision: number;
  stored: boolean;
}

type DefaultsPayload = {
  configSnapshot: ExamConfig;
  revision?: number | undefined;
};

/** Another writer changed the saved defaults since this client's base. */
export class ExamDefaultsConflictError extends Error {
  readonly code = 'EXAM_DEFAULTS_CONFLICT';
  readonly latest: ExamDefaultsSnapshot;
  constructor(latest: ExamDefaultsSnapshot) {
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

  async loadDefaults(signal?: AbortSignal): Promise<ExamDefaultsSnapshot> {
    try {
      return await this.readDefaults(signal);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError' && !signal?.aborted) {
        throw new Error('Loading saved exam defaults timed out. Check the backend connection and retry.');
      }
      throw error;
    }
  }

  private async readDefaults(signal?: AbortSignal): Promise<ExamDefaultsSnapshot> {
    try {
      const payload = await backendGet<DefaultsPayload>('/v1/settings/exam-defaults', {
        timeout: DEFAULTS_LOAD_TIMEOUT_MS,
        retries: 0,
        ...(signal ? { signal } : {}),
      });
      return { config: payload.configSnapshot, revision: payload.revision ?? 0, stored: true };
    } catch (error) {
      if (!isBackendNotFound(error)) throw error;
      return { config: this.getDefaults(), revision: 0, stored: false };
    }
  }

  private async putDefaults(config: ExamConfig, revision: number): Promise<ExamDefaultsSnapshot> {
    const payload = await backendPut<DefaultsPayload>('/v1/settings/exam-defaults', {
      configSnapshot: config,
      revision,
    });
    return { config: payload.configSnapshot ?? config, revision: payload.revision ?? revision + 1, stored: true };
  }

  /**
   * Save the full defaults document against `base`, the snapshot this edit
   * started from, and return the acknowledged snapshot.
   *
   * A 409 means another writer committed first. The save is retried once on
   * the fresh revision only when that cannot discard their work: the server
   * still holds the base content (a revision-only bump) or already holds
   * exactly what we are saving. Otherwise the caller gets a conflict carrying
   * the latest snapshot and decides; `overwrite` is that explicit decision.
   */
  async saveDefaults(
    config: ExamConfig,
    base: ExamDefaultsSnapshot,
    options: { overwrite?: boolean } = {},
  ): Promise<ExamDefaultsSnapshot> {
    try {
      return await this.putDefaults(config, base.revision);
    } catch (error) {
      if (!isConflict(error)) throw error;
      const latest = await this.readDefaults();
      const safeToRetry =
        options.overwrite === true ||
        (base.stored && latest.stored && sameContent(latest.config, base.config)) ||
        (latest.stored && sameContent(latest.config, config));
      if (!safeToRetry) throw new ExamDefaultsConflictError(latest);
      return this.putDefaults(config, latest.revision);
    }
  }
}

export const adminPreferencesRepository = new AdminPreferencesRepository();
