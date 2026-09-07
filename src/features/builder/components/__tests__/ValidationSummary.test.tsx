import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ValidationSummary } from '../ValidationSummary';
import type { PublishReadiness } from '../../../../types/domain';

function readiness(overrides: Partial<PublishReadiness> = {}): PublishReadiness {
  return {
    canPublish: true,
    errors: [],
    warnings: [],
    missingFields: [],
    questionCounts: { reading: 40, listening: 40, total: 80 },
    ...overrides,
  };
}

describe('ValidationSummary (AT-01/AT-02/AT-05)', () => {
  it('renders the IELTS pass state with reading/listening/total counts', () => {
    render(<ValidationSummary publishReadiness={readiness()} />);
    expect(screen.getByText('Technical Validation Passed')).toBeInTheDocument();
    expect(screen.getByText('Reading')).toBeInTheDocument();
    expect(screen.getByText('Listening')).toBeInTheDocument();
    expect(screen.queryByText('Science')).not.toBeInTheDocument();
  });

  it('renders the ACT pass state with the science count and ACT copy', () => {
    render(
      <ValidationSummary
        publishReadiness={readiness({ questionCounts: { reading: 0, listening: 0, science: 7, total: 7 } })}
      />,
    );
    expect(screen.getByText('Science')).toBeInTheDocument();
    expect(screen.getByText('ACT Science question structure is valid')).toBeInTheDocument();
  });

  it('lists blocking errors and jumps to the failing field', () => {
    const onNavigateToBuilder = vi.fn();
    render(
      <ValidationSummary
        publishReadiness={readiness({
          canPublish: false,
          errors: [{ field: 'reading', message: 'Missing answers', severity: 'error' }],
        })}
        onNavigateToBuilder={onNavigateToBuilder}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /go to field reading/i }));
    expect(onNavigateToBuilder).toHaveBeenCalledWith('reading');
  });
});
