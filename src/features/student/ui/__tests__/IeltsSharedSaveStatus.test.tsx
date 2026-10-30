import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IeltsSharedSaveStatus } from '../IeltsSharedSaveStatus';

describe('IeltsSharedSaveStatus', () => {
  it('never presents a local copy as a submission', () => {
    const { rerender } = render(<IeltsSharedSaveStatus status="saved_locally" />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved on this device');
    expect(screen.getByRole('status')).not.toHaveTextContent(/submit/i);

    rerender(<IeltsSharedSaveStatus status="saved" />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved to server');
  });

  it('names review, sync and retry states distinctly', () => {
    const { rerender } = render(<IeltsSharedSaveStatus status="needs_recovery" />);
    expect(screen.getByRole('status')).toHaveTextContent('Needs review');

    rerender(<IeltsSharedSaveStatus status="syncing" />);
    expect(screen.getByRole('status')).toHaveTextContent('Syncing');

    rerender(<IeltsSharedSaveStatus status="error" />);
    expect(screen.getByRole('status')).toHaveTextContent('Not saved');
  });

  it('overrides a server-saved label while retained work needs review', () => {
    render(<IeltsSharedSaveStatus status="saved" needsReview />);
    expect(screen.getByRole('status')).toHaveTextContent('Needs review');
    expect(screen.getByRole('status')).not.toHaveTextContent('Saved to server');
  });

  it('renders nothing without a status or review work', () => {
    render(<IeltsSharedSaveStatus status={null} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
