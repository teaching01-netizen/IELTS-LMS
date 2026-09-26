import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  SatEmptyState,
  SatInlineError,
  SatListRow,
  SatListSkeleton,
  SatPrimaryButton,
  SatReleaseTag,
  SatResultCount,
  SatSearchField,
  SatStatStrip,
  SatStatusPill,
  satOutcomeTone,
} from '../SatPage';

describe('SatStatusPill', () => {
  it('renders a dot plus label text so color never carries state alone', () => {
    const { container } = render(<SatStatusPill tone="live">Live</SatStatusPill>);
    expect(screen.getByText('Live')).toBeInTheDocument();
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain('rounded-full');
  });

  it('pulses the dot for live sessions only', () => {
    const { container, rerender } = render(
      <SatStatusPill tone="live" pulse>Live</SatStatusPill>,
    );
    expect(container.querySelector('span[aria-hidden="true"]')?.className).toContain('sat-live-dot');
    rerender(<SatStatusPill tone="finished">Finished</SatStatusPill>);
    expect(container.querySelector('span[aria-hidden="true"]')?.className).not.toContain('sat-live-dot');
  });
});

describe('SatSearchField', () => {
  it('clears through onChange when the clear button is pressed', () => {
    const onChange = vi.fn();
    render(
      <SatSearchField
        id="sat-test-search"
        label="Search tests"
        value="mock"
        onChange={onChange}
        placeholder="Search"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear Search tests' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('hides the clear button when the field is empty', () => {
    render(
      <SatSearchField
        id="sat-test-search"
        label="Search tests"
        value=""
        onChange={vi.fn()}
        placeholder="Search"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Clear Search tests' })).not.toBeInTheDocument();
  });

  it('clears on Escape without remounting the input', () => {
    const onChange = vi.fn();
    render(
      <SatSearchField
        id="sat-test-search"
        label="Search tests"
        value="mock"
        onChange={onChange}
        placeholder="Search"
      />,
    );
    fireEvent.keyDown(screen.getByLabelText('Search tests'), { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('SatListRow', () => {
  it('fires onOpen on click', () => {
    const onOpen = vi.fn();
    render(<SatListRow onOpen={onOpen}><span>Row title</span></SatListRow>);
    fireEvent.click(screen.getByRole('button', { name: 'Row title' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('staggers only when an index is given, otherwise no entrance', () => {
    const { container, rerender } = render(<SatListRow onOpen={vi.fn()}><span>Plain</span></SatListRow>);
    expect(container.querySelector('button.sat-list-row')).not.toHaveClass('sat-row-enter');
    rerender(<SatListRow onOpen={vi.fn()} index={2}><span>Staggered</span></SatListRow>);
    const row = container.querySelector('button.sat-list-row');
    expect(row).toHaveClass('sat-row-enter');
    expect(row?.getAttribute('style')).toContain('--sat-row-index');
  });

  it('never lifts on hover — hover is border and shadow only', () => {
    const { container } = render(<SatListRow onOpen={vi.fn()}><span>Row title</span></SatListRow>);
    expect(container.querySelector('button.sat-list-row')?.className).not.toContain('-translate-y');
  });
});

describe('SatPrimaryButton', () => {
  it('disables and announces busy while pending, keeping width stable', () => {
    render(<SatPrimaryButton onClick={vi.fn()} pending>New SAT</SatPrimaryButton>);
    const button = screen.getByRole('button', { name: 'New SAT' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('stays enabled by default', () => {
    render(<SatPrimaryButton onClick={vi.fn()}>New SAT</SatPrimaryButton>);
    expect(screen.getByRole('button', { name: 'New SAT' })).toBeEnabled();
  });
});

describe('SatListSkeleton', () => {
  it('keeps the status contract and uses shimmer, not pulse', () => {
    const { container } = render(<SatListSkeleton rows={2} label="Loading exams" />);
    expect(screen.getByRole('status', { name: 'Loading exams' })).toBeInTheDocument();
    expect(container.querySelector('.sat-skeleton-shimmer')).not.toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });
});

describe('SatEmptyState', () => {
  it('renders title, hint, and action', () => {
    render(
      <SatEmptyState
        icon={<span aria-hidden="true">icon</span>}
        title="Nothing here yet"
        hint="Create the first item to get started."
        action={<button type="button">Get started</button>}
      />,
    );
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByText('Create the first item to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument();
  });
});

describe('SatStatStrip', () => {
  it('renders every stat value', () => {
    render(
      <SatStatStrip
        label="Summary"
        stats={[
          { id: 'a', label: 'Upcoming', value: 4 },
          { id: 'b', label: 'Live', value: 1 },
          { id: 'c', label: 'Finished', value: 12 },
        ]}
      />,
    );
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders a stat as a button only when onSelect is present', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SatStatStrip
        label="Summary"
        stats={[
          { id: 'a', label: 'Upcoming', value: 4, onSelect },
          { id: 'b', label: 'Live', value: 1 },
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Upcoming: 4' });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('section[aria-label="Summary"] > div')).toHaveLength(1);
  });
});

describe('satOutcomeTone', () => {
  it('maps the outcomeStatus table exactly', () => {
    expect(satOutcomeTone('scored')).toBe('ready');
    expect(satOutcomeTone('pending')).toBe('ready');
    expect(satOutcomeTone('invalidated_proctor')).toBe('invalidated');
    expect(satOutcomeTone('invalidated_timeout')).toBe('invalidated');
    expect(satOutcomeTone('anything-else')).toBe('neutral');
  });
});

describe('SatResultCount', () => {
  it('keeps the itemLabel path when scopeLabel is absent', () => {
    render(<SatResultCount total={3} visible={2} itemLabel="sessions" />);
    expect(screen.getByRole('status')).toHaveTextContent('2 of 3 sessions');
  });

  it('uses scopeLabel as the unit word when provided', () => {
    render(<SatResultCount total={3} visible={3} itemLabel="sessions" scopeLabel="filtered sessions" />);
    expect(screen.getByRole('status')).toHaveTextContent('3 filtered sessions');
  });

  it('stays null when total is zero (skeleton-XOR: empty-state owns the announce)', () => {
    const { container } = render(<SatResultCount total={0} visible={0} itemLabel="sessions" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SatInlineError', () => {
  it('announces via role=alert with a 40px primary retry button', () => {
    const onRetry = vi.fn();
    render(<SatInlineError title="Results failed" description="Try again." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Results failed');
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.className).toContain('min-h-10');
    // Phase 03: retry uses the accent token (var(--sat-staff-accent) with #0071e3 fallback).
    expect(retry.className).toContain('sat-staff-accent');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button when onRetry is absent', () => {
    render(<SatInlineError title="Offline" description="Check connection." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('SatReleaseTag', () => {
  it('renders the trivial practice tag', () => {
    render(<SatReleaseTag releaseStatus="ready_to_release" />);
    expect(screen.getByText('Practice · ready_to_release')).toBeInTheDocument();
  });
});

describe('Phase 03 token hygiene + contracts (additive)', () => {
  it('consumes staff tokens (var(--sat-staff-*)) across pill, row, and error surfaces', () => {
    const { container } = render(
      <>
        <SatStatusPill tone="published">Published</SatStatusPill>
        <SatListRow onOpen={vi.fn()} index={0}><span>Row</span></SatListRow>
        <SatInlineError title="Boom" description="Try again." onRetry={vi.fn()} />
      </>,
    );
    const html = container.innerHTML;
    expect(html).toContain('sat-staff-success-tint');
    expect(html).toContain('sat-staff-surface');
    expect(html).toContain('sat-staff-accent');
    expect(html).not.toContain('bg-[#0071e3]');
    expect(html).not.toContain('animate-pulse');
  });

  it('keeps focus-visible rings on search, primary, row, and stat button', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <>
        <SatSearchField id="sat-focus-search" label="Search exams" value="q" onChange={vi.fn()} placeholder="Search" />
        <SatPrimaryButton onClick={vi.fn()}>New SAT</SatPrimaryButton>
        <SatListRow onOpen={vi.fn()} index={0}><span>Row</span></SatListRow>
        <SatStatStrip label="Summary" stats={[{ id: 'a', label: 'Upcoming', value: 4, onSelect }]} />
      </>,
    );
    expect(container.querySelector('input')?.className).toContain('focus:ring');
    expect(screen.getByRole('button', { name: 'New SAT' }).className).toContain('focus-visible:ring');
    expect(container.querySelector('button.sat-list-row')?.className).toContain('focus-visible:ring');
    expect(screen.getByRole('button', { name: 'Upcoming: 4' }).className).toContain('focus-visible:ring');
  });

  it('keeps the sat-search-clear hook with a Clear-prefixed accessible name', () => {
    render(
      <SatSearchField id="sat-clear-hook" label="Search exams" value="q" onChange={vi.fn()} placeholder="Search" />,
    );
    const clear = screen.getByRole('button', { name: 'Clear Search exams' });
    expect(clear.className).toContain('sat-search-clear');
    expect(clear.getAttribute('aria-label')).toMatch(/^Clear/);
  });

  it('documents the stagger cap: index 9 still renders sat-row-enter (CSS caps at min-5)', () => {
    const { container } = render(<SatListRow onOpen={vi.fn()} index={9}><span>Capped</span></SatListRow>);
    const row = container.querySelector('button.sat-list-row');
    expect(row).toHaveClass('sat-row-enter');
    expect(row?.getAttribute('style')).toContain('--sat-row-index');
  });
});
