import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SatStudentLinkCard } from '../SatStudentLink';

vi.mock('qrcode', () => ({ toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') }));

const url = 'https://example.test/join/link-1';

describe('SatStudentLinkCard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('copies the room entry URL it is given and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<SatStudentLinkCard url={url} cohortName="Morning" joinedCount={0} onOpenShare={vi.fn()} onPresent={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it('shows the copy failure instead of claiming success', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard blocked.')) } });
    render(<SatStudentLinkCard url={url} cohortName="Morning" joinedCount={0} onOpenShare={vi.fn()} onPresent={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Clipboard blocked.');
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
  });
});
