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
});