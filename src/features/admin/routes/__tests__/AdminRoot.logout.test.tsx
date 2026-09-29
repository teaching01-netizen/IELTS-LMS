import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRoot } from '../AdminRoot';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
}));

vi.mock('@admin/hooks/useAdminRootController', () => ({
  useAdminRootController: () => ({
    contextValue: {
      onNavigate: vi.fn(),
      defaults: {},
      setDefaults: vi.fn(),
      isInitialized: true,
      initError: null,
    },
    currentView: 'exams',
    initError: null,
    isInitialized: true,
    navItems: [],
    notificationCount: 0,
    reload: vi.fn(),
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
  }),
}));

vi.mock('../../../auth/api/authSession', () => ({
  useAuthSession: () => ({ logout: mocks.logout }),
}));

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderAdminRoot() {
  return render(
    <MemoryRouter initialEntries={['/admin/exams']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <AdminRoot />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRoot exit', () => {
  beforeEach(() => {
    mocks.logout.mockReset();
    mocks.logout.mockResolvedValue(undefined);
  });

  it('logs out the session when exiting Admin', async () => {
    renderAdminRoot();

    fireEvent.click(screen.getByRole('button', { name: 'Exit Admin' }));

    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('still leaves Admin when the server logout request fails', async () => {
    mocks.logout.mockRejectedValueOnce(new Error('network unavailable'));
    renderAdminRoot();

    fireEvent.click(screen.getByRole('button', { name: 'Exit Admin' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/'));
  });
});
