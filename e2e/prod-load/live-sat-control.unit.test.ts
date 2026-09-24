import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLiveSatControlConfig } from './live-sat-control';

const root = path.resolve('/tmp/runner-workspace');
const valid = {
  joinUrl: 'https://example.com/join/link-123',
  usersFile: 'e2e/prod-load/live-users.500.csv',
  userCount: 100,
  userOffset: 0,
  maxConcurrentUsers: 15,
  screenshotIntervalMs: 5000,
  jpegQuality: 30,
  startTimeoutMs: 1_200_000,
  examTimeoutMs: 9_000_000,
};

describe('parseLiveSatControlConfig', () => {
  it('validates settings and resolves the roster from the workspace', () => {
    expect(parseLiveSatControlConfig(valid, root)).toEqual({
      ...valid,
      usersFile: path.join(root, valid.usersFile),
      accessLinkId: 'link-123',
    });
  });

  it('rejects concurrency above 100', () => {
    expect(() => parseLiveSatControlConfig({ ...valid, maxConcurrentUsers: 101 }, root)).toThrow(
      /MAX_CONCURRENT_USERS must be between 1 and 100/,
    );
  });

  it('rejects roster paths outside the workspace', () => {
    expect(() => parseLiveSatControlConfig({ ...valid, usersFile: '../../outside.csv' }, root)).toThrow(
      /USERS_FILE must be inside the workspace/,
    );
  });

  it('rejects non Student-Link URLs', () => {
    expect(() => parseLiveSatControlConfig({ ...valid, joinUrl: 'https://example.com/student/s/register' }, root)).toThrow(
      /SAT_JOIN_URL must match/,
    );
  });
});
