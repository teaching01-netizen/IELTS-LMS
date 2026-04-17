import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExamSettingsDrawer } from '../ExamSettingsDrawer';
import { DEFAULT_LISTENING_BAND_TABLE, createDefaultConfig } from '../../../constants/examDefaults';
import { ExamEntity, PublishReadiness } from '../../../types/domain';

describe('ExamSettingsDrawer timing validation', () => {
  it('shows section flow validation errors for invalid timing config', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.sections.listening.order = 0;
    config.sections.reading.order = 0;
    config.sections.listening.duration = 0;
    config.sections.reading.gapAfterMinutes = -1;

    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Timing'));

    expect(screen.getByText('Section Flow')).toBeTruthy();
    expect(screen.getByText('Listening duration must be greater than 0.')).toBeTruthy();
    expect(screen.getByText('Reading gap cannot be negative.')).toBeTruthy();
    expect(screen.getByText('Duplicate section order 0 detected.')).toBeTruthy();
    expect(screen.getByText('Actual clock times are derived from session start.')).toBeTruthy();
  });
});

describe('ExamSettingsDrawer standards tab', () => {
  it('updates standards and keeps writing section tasks synced', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();

    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText('Standards'));
    fireEvent.change(screen.getByLabelText('Task 1 minimum words'), {
      target: { value: '180' },
    });

    const nextConfig = onChange.mock.calls.at(-1)?.[0];
    expect(nextConfig.standards.writingTasks.task1.minWords).toBe(180);
    expect(nextConfig.sections.writing.tasks[0].minWords).toBe(180);
  });

  it('resets custom band tables to official IELTS defaults', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.standards.bandScoreTables.listening = { 39: 8 };
    config.sections.listening.bandScoreTable = { 39: 8 };
    const onChange = vi.fn();

    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText('Standards'));
    fireEvent.click(screen.getByText('Reset to Official IELTS Standards'));

    const nextConfig = onChange.mock.calls.at(-1)?.[0];
    expect(nextConfig.standards.bandScoreTables.listening).toEqual(DEFAULT_LISTENING_BAND_TABLE);
    expect(nextConfig.sections.listening.bandScoreTable).toEqual(DEFAULT_LISTENING_BAND_TABLE);
  });

  it('adds an extra writing task from the sections tab', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();

    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText('Sections'));
    fireEvent.click(screen.getByText('Add Task'));

    const nextConfig = onChange.mock.calls.at(-1)?.[0];
    expect(nextConfig.sections.writing.tasks).toHaveLength(3);
    expect(nextConfig.sections.writing.tasks[2]).toMatchObject({
      id: 'task3',
      label: 'Task 3',
      minWords: config.standards.writingTasks.task2.minWords,
      recommendedTime: config.standards.writingTasks.task2.recommendedTime,
    });
  });
});

describe('ExamSettingsDrawer publish tab', () => {
  it('merges readiness and actions into one release status section', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const exam: ExamEntity = {
      id: 'exam-1',
      slug: 'academic-exam-1',
      title: 'Academic Exam 1',
      type: 'Academic',
      status: 'draft',
      visibility: 'private',
      owner: 'Admin User',
      createdAt: '2026-04-15T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
      currentDraftVersionId: 'draft-1',
      currentPublishedVersionId: null,
      canEdit: true,
      canPublish: true,
      canDelete: true,
      schemaVersion: 1,
    };
    const publishReadiness: PublishReadiness = {
      canPublish: false,
      errors: [
        { field: 'sections.reading', message: 'Reading section needs 3 more questions.', severity: 'error' },
      ],
      warnings: [
        { field: 'timing', message: 'Listening timing is shorter than the recommended duration.' },
      ],
      missingFields: ['sections.reading'],
      questionCounts: {
        reading: 37,
        listening: 40,
        total: 77,
      },
    };

    render(
      <ExamSettingsDrawer
        isOpen
        onClose={() => {}}
        config={config}
        onChange={vi.fn()}
        exam={exam}
        publishReadiness={publishReadiness}
        onPublish={vi.fn()}
        onSchedulePublish={vi.fn()}
        onSaveDraft={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Publish'));

    const blockersHeading = screen.getByText('What needs attention');
    const statusHeading = screen.getByText('Needs fixes before publish');

    expect(screen.getByText('Release Status')).toBeTruthy();
    expect(screen.getByText('Resolve publish blockers')).toBeTruthy();
    expect(screen.getByText('Fix 1 blocking issue before publishing.')).toBeTruthy();
    expect(
      blockersHeading.compareDocumentPosition(statusHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByText('Publish Readiness')).toBeNull();
    expect(screen.getByText('Schedule & Notes')).toBeTruthy();
    expect(screen.getByText('Reference Details')).toBeTruthy();
  });
});
