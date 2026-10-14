import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatStaffRoutePanel } from '../SatStaffRoutePanel';

const gateway = vi.hoisted(() => ({ backendGet: vi.fn(), backendPost: vi.fn() }));
vi.mock('../../../../features/proctor/infrastructure/proctorGateway', () => ({ proctorGateway: gateway }));

const waiting = {
  enabled: true,
  items: [{ attemptId: 'a1', studentName: 'Ada Lovelace', sectionKey: 'reading-writing', rawCorrect: 12, total: 27 }],
};

describe('SatStaffRoutePanel', () => {
  beforeEach(() => {
    gateway.backendGet.mockReset();
    gateway.backendPost.mockReset();
  });

  it('stays hidden when the queue is disabled', async () => {
    gateway.backendGet.mockResolvedValue({ enabled: false, items: [] });
    const { container } = render(<SatStaffRoutePanel scheduleId="s1" blocked={false} />);
    await waitFor(() => expect(gateway.backendGet).toHaveBeenCalled());
    expect(gateway.backendGet).toHaveBeenCalledWith('/v1/proctor/sessions/s1/route-queue', { retries: 0 });
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden when enabled with nobody waiting and no load error', async () => {
    gateway.backendGet.mockResolvedValue({ enabled: true, items: [] });
    const { container } = render(<SatStaffRoutePanel scheduleId="s1" blocked={false} />);
    await waitFor(() => expect(gateway.backendGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a waiting student and sends the chosen Module 2 route', async () => {
    gateway.backendGet.mockResolvedValue(waiting);
    gateway.backendPost.mockResolvedValue(undefined);
    render(<SatStaffRoutePanel scheduleId="s1" blocked={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Harder Module 2' }));
    await waitFor(() => expect(gateway.backendPost).toHaveBeenCalledWith(
      '/v1/proctor/sessions/s1/attempts/a1/route',
      { sectionKey: 'reading-writing', route: 'higher' },
      { retries: 0 },
    ));
  });

  it('exposes a failed queue load with Retry, then recovers', async () => {
    gateway.backendGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(waiting);
    render(<SatStaffRoutePanel scheduleId="s1" blocked={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Module 2 assignments could not load.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Easier Module 2' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
