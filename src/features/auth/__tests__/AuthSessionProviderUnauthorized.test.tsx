import React, { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../../../app/api/apiClient';
import { AuthSessionProvider } from '../authSession';
import { RequireAuth } from '../RequireAuth';
import { authService } from '../../../services/authService';

const originalFetch = global.fetch;

function jsonError(status: number, message: string) {
  return new Response(
    JSON.stringify({
      success: false,
      error: { code: 'UNAUTHORIZED', message },
    }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

function TriggerUnauthorized() {
  useEffect(() => {
    void apiClient
      .get('/v1/admin/exams', { retries: 0 })
      .catch(() => undefined);
  }, []);

  return <div>admin content</div>;
}

const admin = {
  user: {
    id: 'admin-1',
    email: 'admin@example.com',
    displayName: 'Admin User',
    role: 'admin' as const,
    state: 'active' as const,
  },
  csrfToken: 'csrf-1',
  expiresAt: '2026-01-01T12:00:00.000Z',
};

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin/exams']}>
      <AuthSessionProvider>
        <Routes>
          <Route
            path="/admin/exams"
            element={(
              <RequireAuth allowedRoles={['admin']}>
                <TriggerUnauthorized />
              </RequireAuth>
            )}
          />
          <Route path="/login" element={<div>login</div>} />
        </Routes>
      </AuthSessionProvider>
    </MemoryRouter>,
  );
}

describe('AuthSessionProvider unauthorized handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('signs out when a 401 is confirmed by the session check', async () => {
    const getSession = vi
      .spyOn(authService, 'getSession')
      .mockResolvedValueOnce(admin)
      .mockResolvedValue(null);
    const fetchMock = vi.fn(async () => jsonError(401, 'Unauthorized'));
    global.fetch = fetchMock as unknown as typeof fetch;

    renderAdmin();

    expect(await screen.findByText('login')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('keeps the session when the session check says it is still valid', async () => {
    const getSession = vi.spyOn(authService, 'getSession').mockResolvedValue(admin);
    global.fetch = vi.fn(async () => jsonError(401, 'Unauthorized')) as unknown as typeof fetch;

    renderAdmin();

    expect(await screen.findByText('admin content')).toBeInTheDocument();
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('login')).not.toBeInTheDocument();
  });

  it('keeps the warm identity when the session check fails transiently', async () => {
    vi.spyOn(authService, 'getSession')
      .mockResolvedValueOnce(admin)
      .mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    global.fetch = vi.fn(async () => jsonError(401, 'Unauthorized')) as unknown as typeof fetch;

    renderAdmin();

    expect(await screen.findByText('admin content')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('admin content')).toBeInTheDocument();
    expect(screen.queryByText('login')).not.toBeInTheDocument();
  });
});
