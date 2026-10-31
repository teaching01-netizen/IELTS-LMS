import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SatRoomNotices } from '../SatRoomNotices';

function notices(overrides: Partial<Parameters<typeof SatRoomNotices>[0]> = {}) {
  return (
    <SatRoomNotices
      createdRoom={false}
      isStale={false}
      message={null}
      onRetry={vi.fn()}
      onDismissCreation={vi.fn()}
      {...overrides}
    />
  );
}

describe('SatRoomNotices', () => {
  it('dismisses the stale banner until a new controller error arrives', () => {
    const { rerender } = render(notices({ isStale: true, staleKey: 'Network unavailable' }));
    expect(screen.getByText(/Data may be out of date/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(screen.queryByText(/Data may be out of date/)).not.toBeInTheDocument();

    rerender(notices({ isStale: true, staleKey: 'Server timeout' }));
    expect(screen.getByText(/Data may be out of date/)).toBeInTheDocument();
  });

  it('dismisses an action result and reopens for a new result', () => {
    const { rerender } = render(notices({ message: { kind: 'error', text: 'Could not add 5 minutes.' } }));
    expect(screen.getByText('Could not add 5 minutes.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(screen.queryByText('Could not add 5 minutes.')).not.toBeInTheDocument();

    rerender(notices({ message: { kind: 'success', text: 'Added 5 minutes.' } }));
    expect(screen.getByText('Added 5 minutes.')).toBeInTheDocument();
  });

  it('keeps the creation confirmation closable', () => {
    const onDismissCreation = vi.fn();
    render(notices({ createdRoom: true, onDismissCreation }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss room creation confirmation' }));
    expect(onDismissCreation).toHaveBeenCalledOnce();
  });

  it('renders nothing when there is no notice to show', () => {
    const { container } = render(notices());
    expect(container).toBeEmptyDOMElement();
  });
});
