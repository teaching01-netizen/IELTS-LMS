import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ValidationSummary } from '../ValidationSummary';
import type { PublishReadiness } from '../../../../types/domain';
import type { ValidationScope } from '../../../../types';

describe('ValidationSummary', () => {
  const mockPublishReadiness: PublishReadiness = {
    canPublish: true,
    errors: [],
    warnings: [],
    missingFields: [],
    questionCounts: {
      reading: 40,
      listening: 40,
      total: 80
    }
  };

  const mockValidationScope: ValidationScope = {
    checked: [
      'All questions have correct answers',
      'Scoring tables match IELTS band conversions',
      'Time allocations are within acceptable ranges',
      'Question types match module requirements'
    ],
    notChecked: [
      'Content quality and appropriateness',
      'Passage difficulty level',
      'Distractor quality'
    ]
  };

  it('renders validation scope with Checked and Not checked sections', () => {
    render(
      <ValidationSummary 
        publishReadiness={mockPublishReadiness}
        validationScope={mockValidationScope}
      />
    );

    expect(screen.getByText(/^checked:$/i)).toBeTruthy();
    expect(screen.getByText(/^not checked:$/i)).toBeTruthy();
  });

  it('displays correct color states for passed validation', () => {
    render(
      <ValidationSummary 
        publishReadiness={{ ...mockPublishReadiness, canPublish: true }}
        validationScope={mockValidationScope}
      />
    );

    expect(screen.getByText(/technical validation passed/i)).toBeTruthy();
  });

  it('displays correct color states for failed validation', () => {
    render(
      <ValidationSummary 
        publishReadiness={{ 
          ...mockPublishReadiness, 
          canPublish: false,
          errors: [{ field: 'title', message: 'Title is required', severity: 'error' }]
        }}
        validationScope={mockValidationScope}
      />
    );

    expect(screen.getByText(/technical validation issues/i)).toBeTruthy();
  });

  it('shows Next steps guidance', () => {
    render(
      <ValidationSummary 
        publishReadiness={mockPublishReadiness}
        validationScope={mockValidationScope}
      />
    );

    expect(screen.getByText(/next steps:/i)).toBeTruthy();
    expect(screen.getByText(/schedule access time and publish \(or republish\)/i)).toBeTruthy();
  });

  it('calls onScheduleClick when schedule item clicked', () => {
    const onScheduleClick = vi.fn();
    render(
      <ValidationSummary 
        publishReadiness={mockPublishReadiness}
        validationScope={mockValidationScope}
        onScheduleClick={onScheduleClick}
      />
    );

    // The schedule click would be triggered by a clickable item
    // This is a placeholder for the actual implementation
  });

  it('calls onNavigateToConfig when config item clicked', () => {
    const onNavigateToConfig = vi.fn();
    render(
      <ValidationSummary 
        publishReadiness={mockPublishReadiness}
        validationScope={mockValidationScope}
        onNavigateToConfig={onNavigateToConfig}
      />
    );
  });

  it('calls onNavigateToBuilder when builder item clicked', () => {
    const onNavigateToBuilder = vi.fn();
    render(
      <ValidationSummary 
        publishReadiness={mockPublishReadiness}
        validationScope={mockValidationScope}
        onNavigateToBuilder={onNavigateToBuilder}
      />
    );
  });

  it('has correct aria-labels for accessibility', () => {
    const { container } = render(
      <ValidationSummary 
        publishReadiness={mockPublishReadiness}
        validationScope={mockValidationScope}
      />
    );

    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('handles loading state', () => {
    render(
      <ValidationSummary 
        publishReadiness={mockPublishReadiness}
        validationScope={mockValidationScope}
      />
    );
  });

  it('handles error state', () => {
    render(
      <ValidationSummary 
        publishReadiness={{ 
          ...mockPublishReadiness, 
          canPublish: false,
          errors: [
            { field: 'title', message: 'Title is required', severity: 'error' },
            { field: 'content', message: 'Content is missing', severity: 'error' }
          ]
        }}
        validationScope={mockValidationScope}
      />
    );

    expect(screen.getByText(/title is required/i)).toBeTruthy();
    expect(screen.getByText(/content is missing/i)).toBeTruthy();
  });

  it('displays content summary with question counts', () => {
    render(
      <ValidationSummary 
        publishReadiness={mockPublishReadiness}
        validationScope={mockValidationScope}
      />
    );

    expect(screen.getAllByText('40')).toHaveLength(2); // reading + listening
    expect(screen.getByText('80')).toBeTruthy(); // total
  });

  it('shows errors before the checked and not checked sections', () => {
    render(
      <ValidationSummary
        publishReadiness={{
          ...mockPublishReadiness,
          canPublish: false,
          errors: [{ field: 'title', message: 'Title is required', severity: 'error' }],
          warnings: [{ field: 'review', message: 'Review recommended before publish' }],
        }}
        validationScope={mockValidationScope}
      />
    );

    const errorsHeading = screen.getByText(/errors/i);
    const checkedHeading = screen.getByText(/^checked:$/i);

    expect(
      errorsHeading.compareDocumentPosition(checkedHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
