import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearLogoutIntent,
  readLogoutIntent,
  readLogoutAllUnconfirmed,
  withAuthMutationLock,
  writeLogoutIntent,
} from '../infrastructure/authBrowserCoordination';

afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); });

describe('logout intent', () => {
  it('persists a versioned intent and only its own operation can clear it', () => {
    const first = writeLogoutIntent('current');
    expect(first.persisted).toBe(true);
    const second = writeLogoutIntent('all');
    expect(readLogoutIntent()).toMatchObject({ id: second.intent.id, scope: 'all', v: 1 });
    // An old completion must not clear a newer intent.
    expect(clearLogoutIntent(first.intent.id)).toBe(false);
    expect(readLogoutIntent()?.id).toBe(second.intent.id);
    expect(clearLogoutIntent(second.intent.id)).toBe(true);
    expect(readLogoutIntent()).toBeNull();
  });

  it('treats a corrupt record as absent', () => {
    window.localStorage.setItem('ielts-auth:logout-intent:v1', '{"v":2}');
    expect(readLogoutIntent()).toBeNull();
  });

  it('survives browsers that expose storage but reject reads', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('storage denied'); });
    expect(readLogoutIntent()).toBeNull();
    expect(readLogoutAllUnconfirmed()).toBe(false);
    expect(writeLogoutIntent('current').persisted).toBe(false);
    expect(clearLogoutIntent('old')).toBe(false);
  });
});

describe('withAuthMutationLock', () => {
  it('serializes credential operations in order', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const first = withAuthMutationLock(async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      events.push('first:end');
    });
    const second = withAuthMutationLock(async () => {
      events.push('second');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });
});
