import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateRoomReads, proctorKeys } from '../proctorQueries';

function seeded() {
  const client = new QueryClient();
  for (const key of [proctorKeys.sessions(), proctorKeys.sessions('sat'), proctorKeys.sessions('ielts'), proctorKeys.detail('room-1'), proctorKeys.detail('room-2')]) {
    client.setQueryData(key, []);
  }
  return client;
}

const stale = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;

describe('room read invalidation', () => {
  it('marks every provider summary family and the changed room stale', async () => {
    const client = seeded();
    await invalidateRoomReads(client, { scheduleId: 'room-1' });
    expect(stale(client, proctorKeys.sessions())).toBe(true);
    expect(stale(client, proctorKeys.sessions('sat'))).toBe(true);
    expect(stale(client, proctorKeys.sessions('ielts'))).toBe(true);
    expect(stale(client, proctorKeys.detail('room-1'))).toBe(true);
    expect(stale(client, proctorKeys.detail('room-2'))).toBe(false);
  });

  it('skips the family and detail a caller refetches itself', async () => {
    const client = seeded();
    await invalidateRoomReads(client, { exceptSummaries: proctorKeys.sessions('sat') });
    expect(stale(client, proctorKeys.sessions('sat'))).toBe(false);
    expect(stale(client, proctorKeys.sessions())).toBe(true);
    expect(stale(client, proctorKeys.detail('room-1'))).toBe(false);
  });
});
