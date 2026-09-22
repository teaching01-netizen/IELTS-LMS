import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from '../useUIStore';

describe('useUIStore persistence', () => {
  beforeEach(() => {
    useUIStore.persist.clearStorage();
    window.localStorage.clear();
    useUIStore.setState({ sidebarCollapsed: false });
  });

  it('drops the legacy persisted theme during migration', async () => {
    window.localStorage.setItem(
      'ui-storage',
      JSON.stringify({
        state: { sidebarCollapsed: true, theme: 'dark' },
        version: 0,
      }),
    );

    await useUIStore.persist.rehydrate();

    const state = useUIStore.getState() as unknown as Record<string, unknown>;
    expect(state.sidebarCollapsed).toBe(true);
    expect('theme' in state).toBe(false);
  });
});
