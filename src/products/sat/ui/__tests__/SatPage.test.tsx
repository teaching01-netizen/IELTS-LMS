import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  SatEmptyState,
  SatListRow,
  SatSearchField,
  SatStatStrip,
  SatStatusPill,
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
    expect(container.querySelector('span[aria-hidden="true"]')?.className).toContain('animate-pulse');
    rerender(<SatStatusPill tone="finished">Finished</SatStatusPill>);
    expect(container.querySelector('span[aria-hidden="true"]')?.className).not.toContain('animate-pulse');
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
});

describe('SatListRow', () => {
  it('fires onOpen on click', () => {
    const onOpen = vi.fn();
    render(<SatListRow onOpen={onOpen}><span>Row title</span></SatListRow>);
    fireEvent.click(screen.getByRole('button', { name: 'Row title' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
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
});
