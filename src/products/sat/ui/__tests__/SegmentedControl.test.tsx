import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SatSegmentedControl } from '../SegmentedControl';

const options = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'live', label: 'Live' },
  { value: 'finished', label: 'Finished' },
] as const;

type Bucket = (typeof options)[number]['value'];

describe('SatSegmentedControl', () => {
  it('announces a radio group and marks the selection', () => {
    render(<SatSegmentedControl<Bucket> label="Session status" value="upcoming" options={options} onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Session status' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Upcoming' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Live' })).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps the roving tabindex on the selected segment', () => {
    render(<SatSegmentedControl<Bucket> label="Session status" value="live" options={options} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Live' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Upcoming' })).toHaveAttribute('tabindex', '-1');
  });

  it('selects with a pointer', () => {
    const onChange = vi.fn();
    render(<SatSegmentedControl<Bucket> label="Session status" value="upcoming" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Live' }));
    expect(onChange).toHaveBeenCalledWith('live');
  });

  it('selects with the arrow keys', () => {
    const onChange = vi.fn();
    render(<SatSegmentedControl<Bucket> label="Session status" value="upcoming" options={options} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Upcoming' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('live');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Upcoming' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('finished');
  });

  it('renders exactly one sliding thumb on the selected segment', () => {
    const { container } = render(<SatSegmentedControl<Bucket> label="Session status" value="live" options={options} onChange={vi.fn()} />);
    expect(container.querySelectorAll('.sat-segmented-thumb')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Live' }).querySelector('.sat-segmented-thumb')).not.toBeNull();
    expect(screen.getByRole('radio', { name: 'Upcoming' }).querySelector('.sat-segmented-thumb')).toBeNull();
  });

  it('wraps around: ArrowLeft on the first segment selects the last value', () => {
    const onChange = vi.fn();
    render(<SatSegmentedControl<Bucket> label="Session status" value="upcoming" options={options} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Session status' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('finished');
  });

  it('passes className through to the radiogroup (e.g. max-w-360px)', () => {
    const { container } = render(
      <SatSegmentedControl<Bucket> label="Session status" value="upcoming" options={options} onChange={vi.fn()} className="max-w-360px" />,
    );
    expect(container.querySelector('[role="radiogroup"]')?.className).toContain('max-w-360px');
  });
});