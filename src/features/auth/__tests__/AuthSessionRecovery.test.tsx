import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../../shared/api/apiClient';
import { authService } from '../../../services/authService';
import { AuthSessionProvider, useAuthSession } from '../authSession';
import { RequireAuth } from '../RequireAuth';
import { readLogoutIntent, writeLogoutIntent } from '../infrastructure/authBrowserCoordination';

const admin = {
  user: { id: 'admin-1', email: 'admin@example.com', displayName: 'Admin', role: 'admin' as const, state: 'active' as const },
  csrfToken: 'csrf-1',
  expiresAt: '2099-01-01T12:00:00.000Z',
};

const transient = () => Object.assign(new Error('Service unavailable'), { status: 503, code: 'SERVICE_UNAVAILABLE' });

let auth: ReturnType<typeof useAuthSession> | null = null;
function Capture() {
  auth = useAuthSession();
  return null;
}

function renderAt(path = '/admin', extra?: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthSessionProvider>
        <Capture />
        {extra}
        <Routes>
          <Route path="/admin" element={<RequireAuth allowedRoles={['admin']}><div>admin content</div></RequireAuth>} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </AuthSessionProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  auth = null;
});

describe('AuthSessionProvider restoration', () => {
  it('keeps a new login unavailable until the browser cookie is confirmed', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValueOnce(null).mockRejectedValue(transient());
    vi.spyOn(authService, 'login').mockResolvedValue(admin);
    renderAt('/login');
    await waitFor(() => expect(auth?.status).toBe('unauthenticated'));
    await act(async () => { await expect(auth!.login('admin@example.com', 'pw')).rejects.toThrow('Service unavailable'); });
    expect(auth?.session).toBeNull();
    expect(auth?.status).toBe('unavailable');
  });

  it('shows a retry surface, not a login redirect, when the cold check fails transiently', async () => {
    vi.spyOn(authService, 'getSession').mockRejectedValueOnce(transient()).mockResolvedValue(admin);
    renderAt();

    expect(await screen.findByText('Can’t reach the server')).toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
    expect(auth?.status).toBe('unavailable');

    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(await screen.findByText('admin content')).toBeInTheDocument();
  });

  it('retries automatically on the recovery timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const getSession = vi.spyOn(authService, 'getSession').mockRejectedValueOnce(transient()).mockResolvedValue(admin);
      renderAt();
      await screen.findByText('Can’t reach the server');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_300);
      });
      expect(await screen.findByText('admin content')).toBeInTheDocument();
      expect(getSession).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('redirects to login only for a definitive no-session answer', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);
    renderAt();
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });

  it('pauses recovery offline and preserves Retry-After across reconnect', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      const getSession = vi.spyOn(authService, 'getSession')
        .mockRejectedValueOnce(Object.assign(transient(), { details: { retryAfterSeconds: 60 } }))
        .mockResolvedValue(admin);
      renderAt();
      await screen.findByText('Can’t reach the server');
      act(() => { online.mockReturnValue(false); window.dispatchEvent(new Event('offline')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      act(() => { online.mockReturnValue(true); window.dispatchEvent(new Event('online')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(48_000); });
      expect(getSession).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
      expect(await screen.findByText('admin content')).toBeInTheDocument();
      expect(getSession).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});

describe('AuthSessionProvider logout intent', () => {
  it('does not restore a pending logout when storage reads start failing', async () => {
    const getSession = vi.spyOn(authService, 'getSession').mockResolvedValue(admin);
    vi.spyOn(authService, 'logout').mockRejectedValue(transient());
    renderAt();
    await screen.findByText('admin content');
    await act(() => auth!.logout());
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('storage denied'); });
    await act(() => auth!.refresh());
    expect(auth?.status).toBe('logoutPending');
    expect(auth?.session).toBeNull();
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('a login response arriving after logout cannot restore private UI or erase the new intent', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);
    let resolveLogin!: (session: typeof admin) => void;
    vi.spyOn(authService, 'login').mockImplementation(() => new Promise((resolve) => { resolveLogin = resolve; }));
    vi.spyOn(authService, 'logout').mockRejectedValue(transient());
    renderAt('/login');
    await waitFor(() => expect(auth?.status).toBe('unauthenticated'));
    let login!: Promise<unknown>;
    act(() => { login = auth!.login('admin@example.com', 'pw').catch((error: unknown) => error); });
    await waitFor(() => expect(resolveLogin).toBeDefined());
    let logout!: Promise<void>;
    act(() => { logout = auth!.logout(); });
    const intent = readLogoutIntent();
    await act(async () => { resolveLogin(admin); await login; await logout; });
    expect(auth?.status).toBe('logoutPending');
    expect(auth?.session).toBeNull();
    expect(readLogoutIntent()?.id).toBe(intent?.id);
  });

  it('reports when offline sign-out cannot be saved across a browser restart', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(admin);
    vi.spyOn(authService, 'logout').mockRejectedValue(transient());
    renderAt();
    await screen.findByText('admin content');
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('storage denied'); });
    await act(() => auth!.logout());
    expect(auth?.pendingLogout?.durable).toBe(false);
    expect(screen.getByText(/closing it may restore your sign-in/)).toBeInTheDocument();
  });

  it('hides identity at once and keeps the intent until the server confirms', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(admin);
    const logout = vi.spyOn(authService, 'logout').mockRejectedValueOnce(transient()).mockResolvedValue(undefined);
    renderAt();
    await screen.findByText('admin content');

    await act(() => auth!.logout());

    expect(auth?.status).toBe('logoutPending');
    expect(auth?.session).toBeNull();
    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
    expect(readLogoutIntent()?.scope).toBe('current');

    await act(async () => {
      await auth!.refresh();
    });
    expect(logout).toHaveBeenCalledTimes(2);
    expect(auth?.status).toBe('unauthenticated');
    expect(readLogoutIntent()).toBeNull();
  });

  it('finishes a pending logout before restoring a session on startup', async () => {
    writeLogoutIntent('current');
    const getSession = vi.spyOn(authService, 'getSession').mockResolvedValue(admin);
    const logout = vi.spyOn(authService, 'logout').mockResolvedValue(undefined);
    renderAt();

    await waitFor(() => expect(auth?.status).toBe('unauthenticated'));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(getSession).not.toHaveBeenCalled();
    expect(readLogoutIntent()).toBeNull();
  });

  it('reports an unconfirmed all-device logout when the session is already gone', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(admin);
    vi.spyOn(authService, 'logoutAll').mockRejectedValue(Object.assign(new Error('gone'), { status: 401 }));
    const logout = vi.spyOn(authService, 'logout').mockResolvedValue(undefined);
    renderAt();
    await screen.findByText('admin content');

    await act(() => auth!.logoutAll());

    expect(logout).toHaveBeenCalledTimes(1);
    expect(auth?.status).toBe('unauthenticated');
    expect(auth?.logoutAllUnconfirmed).toBe(true);
  });

  it('a deliberate new login supersedes a pending logout intent', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValueOnce(null).mockResolvedValue(admin);
    const logout = vi.spyOn(authService, 'logout').mockRejectedValue(transient());
    vi.spyOn(authService, 'login').mockResolvedValue(admin);
    renderAt('/login');
    await waitFor(() => expect(auth?.status).toBe('unauthenticated'));
    await act(() => auth!.logout());
    expect(readLogoutIntent()).not.toBeNull();

    await act(async () => {
      await auth!.login('admin@example.com', 'pw', true);
    });

    expect(readLogoutIntent()).toBeNull();
    expect(auth?.session?.user.id).toBe('admin-1');
    const calls = logout.mock.calls.length;
    await act(async () => {
      await auth!.refresh();
    });
    expect(logout.mock.calls.length).toBe(calls);
  });

  it('hides identity when another tab starts a logout', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(admin);
    renderAt();
    await screen.findByText('admin content');

    const { intent } = writeLogoutIntent('all');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'ielts-auth:logout-intent:v1', newValue: JSON.stringify(intent) }));
    });

    expect(auth?.status).toBe('logoutPending');
    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
  });
});

function TriggerSensitive() {
  useEffect(() => {
    void apiClient.post('/v1/results/export', {}).catch(() => undefined);
  }, []);
  return null;
}

describe('AuthSessionProvider password confirmation', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('opens one dialog for REAUTH_REQUIRED and keeps the session on a wrong password', async () => {
    const getSession = vi.spyOn(authService, 'getSession').mockResolvedValue(admin);
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ code: 'REAUTH_REQUIRED', message: 'confirm' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const reauth = vi
      .spyOn(authService, 'reauthenticate')
      .mockRejectedValueOnce(Object.assign(new Error('Invalid credentials.'), { status: 401, code: 'UNAUTHORIZED' }))
      .mockResolvedValue({ ...admin, csrfToken: 'csrf-2' });

    renderAt('/admin', <><TriggerSensitive /><TriggerSensitive /></>);

    const dialogs = await screen.findAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');

    fireEvent.change(password, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('That password is incorrect.')).toBeInTheDocument();
    expect(auth?.session?.user.id).toBe('admin-1');
    expect(screen.getByText('admin content')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'right' } });
    getSession.mockResolvedValue({ ...admin, csrfToken: 'csrf-2' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/Repeat the action you were doing/)).toBeInTheDocument();
    expect(reauth).toHaveBeenLastCalledWith('right');
    expect(auth?.session?.csrfToken).toBe('csrf-2');
  });
});
