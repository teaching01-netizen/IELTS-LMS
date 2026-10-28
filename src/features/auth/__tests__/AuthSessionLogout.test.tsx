import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../../shared/api/queryClient';
import { authService } from '../../../services/authService';
import { AuthSessionProvider, useAuthSession } from '../authSession';

const admin = {
  user: { id: 'admin-1', email: 'admin@example.com', displayName: 'Admin User', role: 'admin' as const, state: 'active' as const },
  csrfToken: 'csrf-1',
  expiresAt: '2099-01-01T12:00:00.000Z',
};

let auth: ReturnType<typeof useAuthSession> | null = null;
function Capture() {
  auth = useAuthSession();
  return null;
}

function renderProvider() {
  return render(
    <MemoryRouter>
      <AuthSessionProvider>
        <Capture />
      </AuthSessionProvider>
    </MemoryRouter>,
  );
}

describe('AuthSessionProvider logout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
    auth = null;
  });

  it.each(['logout', 'logoutAll'] as const)('%s drops the previous actor\'s cached server data', async (method) => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(admin);
    vi.spyOn(authService, method).mockResolvedValue(undefined);
    renderProvider();
    await waitFor(() => expect(auth?.session?.user.id).toBe('admin-1'));
    queryClient.setQueryData(['grading', 'sessions'], [{ id: 'grading-session-1' }]);

    await act(() => auth![method]());

    expect(queryClient.getQueryData(['grading', 'sessions'])).toBeUndefined();
    expect(auth?.session).toBeNull();
  });

  it('still drops cached data when the server logout request fails', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(admin);
    vi.spyOn(authService, 'logout').mockRejectedValue(new Error('offline'));
    renderProvider();
    await waitFor(() => expect(auth?.session?.user.id).toBe('admin-1'));
    queryClient.setQueryData(['grading', 'sessions'], [{ id: 'grading-session-1' }]);

    await act(() => auth!.logout().catch(() => undefined));

    expect(queryClient.getQueryData(['grading', 'sessions'])).toBeUndefined();
  });
});
