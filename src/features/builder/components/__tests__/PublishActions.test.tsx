import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PublishActions } from '../PublishActions';
import type { PublishReadiness } from '../../../../types/domain';

describe('PublishActions', () => {
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

  const defaultProps = {
    canPublish: true,
    publishReadiness: mockPublishReadiness,
    onPublish: vi.fn(),
    onRepublishLatestDraft: vi.fn(),
    onSchedulePublish: vi.fn(),
    onUnpublish: vi.fn(),
    exam: { title: 'Test Exam' }
  };

  it('not published + not scheduled: Schedule enabled and Publish disabled', () => {
    render(
      <PublishActions 
        {...defaultProps}
        publishReadiness={mockPublishReadiness}
      />
    );

    expect(screen.getByRole('button', { name: /^schedule$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeDisabled();
  });

  it('not published + scheduled: Publish enabled and Reschedule shown', () => {
    const onOpenSchedulingWorkflow = vi.fn();
    render(
      <PublishActions 
        {...defaultProps}
        publishReadiness={mockPublishReadiness}
        scheduledTime="2026-04-20"
        onOpenSchedulingWorkflow={onOpenSchedulingWorkflow}
      />
    );

    expect(screen.getByRole('button', { name: /^publish$/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /reschedule/i })).toBeTruthy();
  });

  it('shows success state after publish', () => {
    render(
      <PublishActions 
        {...defaultProps}
        publishReadiness={mockPublishReadiness}
        publishSuccess={{
          draftVersion: 3,
          publishedVersion: 4,
          scheduledDate: '2026-04-20'
        }}
      />
    );

    expect(screen.getByText(/exam published successfully/i)).toBeTruthy();
    expect(screen.getByText(/published v4 \(from draft 3\)/i)).toBeTruthy();
  });

  it('shows view published version button after success', () => {
    const onViewPublished = vi.fn();
    render(
      <PublishActions 
        {...defaultProps}
        publishReadiness={mockPublishReadiness}
        publishSuccess={{
          draftVersion: 3,
          publishedVersion: 4
        }}
        onViewPublished={onViewPublished}
      />
    );

    const viewButton = screen.getByRole('button', { name: /view published/i });
    expect(viewButton).toBeTruthy();
  });

  it('shows continue editing draft button after success', () => {
    render(
      <PublishActions 
        {...defaultProps}
        publishReadiness={mockPublishReadiness}
        publishSuccess={{
          draftVersion: 3,
          publishedVersion: 4
        }}
      />
    );

    const continueButton = screen.getByRole('button', { name: /continue editing draft/i });
    expect(continueButton).toBeTruthy();
  });

  it('shows republish action when there are unpublished draft changes', () => {
    render(
      <PublishActions
        {...defaultProps}
        publishReadiness={mockPublishReadiness}
        publishSuccess={{
          draftVersion: 3,
          publishedVersion: 4,
        }}
        hasUnpublishedDraftChanges={true}
        draftVersionNumber={5}
        publishedVersionNumber={4}
      />
    );

    expect(screen.getByRole('button', { name: /republish/i })).toBeTruthy();
    expect(screen.getByText(/draft v5 has changes not in published v4/i)).toBeTruthy();
  });

  it('republishes when requested', async () => {
    const onRepublishLatestDraft = vi.fn().mockResolvedValue({ success: true });

    render(
      <PublishActions
        {...defaultProps}
        onRepublishLatestDraft={onRepublishLatestDraft}
        publishSuccess={{
          draftVersion: 3,
          publishedVersion: 4,
        }}
        hasUnpublishedDraftChanges={true}
        draftVersionNumber={5}
        publishedVersionNumber={4}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /republish/i }));

    await waitFor(() => {
      expect(onRepublishLatestDraft).toHaveBeenCalledTimes(1);
    });
  });

  it('shows safe-state error when republish fails', async () => {
    const onRepublishLatestDraft = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'Could not republish. Existing schedules are unchanged.' });

    render(
      <PublishActions
        {...defaultProps}
        onRepublishLatestDraft={onRepublishLatestDraft}
        publishSuccess={{
          draftVersion: 3,
          publishedVersion: 4,
        }}
        hasUnpublishedDraftChanges={true}
        draftVersionNumber={5}
        publishedVersionNumber={4}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /republish/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/could not republish\. existing schedules are unchanged\./i),
      ).toBeTruthy();
    });
  });

  it('copies the published student link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(
      <PublishActions
        {...defaultProps}
        publishReadiness={mockPublishReadiness}
        publishSuccess={{
          draftVersion: 3,
          publishedVersion: 4,
          scheduledDate: '2026-04-20',
          publishedLink: 'https://example.com/student/sched-1/register',
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /copy student link/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://example.com/student/sched-1/register');
    });
  });

  it('opens the real scheduling workflow when provided', () => {
    const onOpenSchedulingWorkflow = vi.fn();

    render(
      <PublishActions
        {...defaultProps}
        onOpenSchedulingWorkflow={onOpenSchedulingWorkflow}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^schedule$/i }));

    expect(onOpenSchedulingWorkflow).toHaveBeenCalledTimes(1);
  });
});
