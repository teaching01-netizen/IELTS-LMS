import type { ExamConfig } from '../../../types';

const MISSING = Symbol('missing config property');

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => equal(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

function property(object: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : MISSING;
}

function merge(base: unknown, local: unknown, remote: unknown): { value: unknown; conflict: boolean } {
  if (equal(local, base)) return { value: remote, conflict: false };
  if (equal(remote, base) || equal(local, remote)) return { value: local, conflict: false };
  if (!isRecord(base) || !isRecord(local) || !isRecord(remote)) return { value: local, conflict: true };

  const result: Record<string, unknown> = {};
  let conflict = false;
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const next = merge(property(base, key), property(local, key), property(remote, key));
    conflict ||= next.conflict;
    if (next.value !== MISSING) {
      Object.defineProperty(result, key, { value: next.value, enumerable: true, writable: true, configurable: true });
    }
  }
  return { value: result, conflict };
}

/** Three-way rebase of JSON config values; concurrent changes to an array are atomic. */
export function rebaseConfigDraft(base: ExamConfig, local: ExamConfig, remote: ExamConfig): {
  config: ExamConfig;
  conflict: boolean;
} {
  const result = merge(base, local, remote);
  return { config: result.value as ExamConfig, conflict: result.conflict };
}

function preservesRemote(base: unknown, remote: unknown, result: unknown): boolean {
  if (equal(base, remote)) return true;
  if (isRecord(base) && isRecord(remote) && isRecord(result)) {
    return [...new Set([...Object.keys(base), ...Object.keys(remote)])].every((key) =>
      preservesRemote(property(base, key), property(remote, key), property(result, key)),
    );
  }
  return equal(remote, result);
}

/** Normalization must not silently undo another editor's independent changes. */
export function preservesRemoteConfigChanges(base: ExamConfig, remote: ExamConfig, result: ExamConfig): boolean {
  return preservesRemote(base, remote, result);
}

export function configSnapshotsEqual(left: ExamConfig, right: ExamConfig): boolean {
  return equal(left, right);
}
