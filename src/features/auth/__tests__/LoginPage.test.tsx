import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../LoginPage';
import { AuthSessionProvider } from '../authSession';

const navigateMock = vi.fn();
const originalFetch = global.fetch;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('LoginPage', () => {
  afterEach(() => {
    navigateMock.mockReset();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('submits credentials to the auth API and routes admin users to the admin workspace', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/auth/login') {
        return jsonResponse({
          user: {
            id: 'user-1',
            email: 'admin@example.com',
            displayName: 'Admin User',
            role: 'admin',
            state: 'active',
          },
          csrfToken: 'csrf-1',
          expiresAt: '2026-01-01T12:00:00.000Z',
        });
      }

      return new Response(JSON.stringify({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' },
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    });
    global.fetch = fetchMock as typeof fetch;

    render(
      <MemoryRouter>
        <AuthSessionProvider>
          <LoginPage />
        </AuthSessionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();
    });

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'Password123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/v1/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            email: 'admin@example.com',
            password: 'Password123!',
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/admin/exams', { replace: true });
    });
  });

  it('shows student check-in guidance instead of navigating back to /login', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/auth/login') {
        return jsonResponse({
          user: {
            id: 'student-1',
            email: 'student@example.com',
            displayName: 'Student One',
            role: 'student',
            state: 'active',
          },
          csrfToken: 'csrf-2',
          expiresAt: '2026-01-01T12:00:00.000Z',
        });
      }

      return new Response(JSON.stringify({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' },
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    });
    global.fetch = fetchMock as typeof fetch;

    render(
      <MemoryRouter>
        <AuthSessionProvider>
          <LoginPage />
        </AuthSessionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();
    });

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'student@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'Password123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /student check-in/i })).toBeInTheDocument();
    });
    expect(navigateMock).not.toHaveBeenCalledWith('/login', expect.anything());
  });
});
