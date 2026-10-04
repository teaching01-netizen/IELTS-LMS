import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SatStudentLinkDialog, satSessionStudentUrl } from '../SatStudentLink';

vi.mock('qrcode', () => ({ toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') }));

describe('SatStudentLinkDialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds the scheduled-session entry URL', () => {
    expect(satSessionStudentUrl('sched 1')).toBe(window.location.origin + '/student/sched%201');
  });

  it('copies the student link and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<SatStudentLinkDialog open scheduleId="sched-1" cohortName="Morning" onClose={vi.fn()} onPresent={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(window.location.origin + '/student/sched-1');
  });

  it('shows the copy failure instead of claiming success', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard blocked.')) } });
    render(<SatStudentLinkDialog open scheduleId="sched-1" cohortName="Morning" onClose={vi.fn()} onPresent={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Clipboard blocked.');
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
  });
});
