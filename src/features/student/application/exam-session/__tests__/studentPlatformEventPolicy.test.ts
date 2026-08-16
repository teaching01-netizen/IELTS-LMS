import { describe, expect, it } from 'vitest';
import { classifyStudentPlatformEvent } from '../studentPlatformEventPolicy';

describe('student platform event policy', () => {
  it('keeps connectivity signals non-blocking and explicit', () => {
    expect(
      classifyStudentPlatformEvent({
        type: 'NETWORK_OFFLINE',
        timestamp: '2026-08-16T00:00:00.000Z',
      }),
    ).toEqual({ kind: 'network', status: 'offline' });
  });

  it('makes storage failure the only hard-stop action in this policy', () => {
    expect(
      classifyStudentPlatformEvent({
        type: 'STORAGE_UNAVAILABLE',
        timestamp: '2026-08-16T00:00:00.000Z',
        detail: 'quota',
      }),
    ).toEqual({ kind: 'storage', blocked: true, detail: 'quota' });
  });
});
