import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminScheduling } from '../AdminScheduling';
import { examRepository } from '../../../services/examRepository';
import { createDefaultConfig } from '../../../constants/examDefaults';
import { SCHEMA_VERSION, type ExamEntity, type ExamVersion } from '../../../types/domain';

describe('AdminScheduling', () => {
  it('blocks schedule creation when the session window is shorter than planned duration', async () => {
    localStorage.clear();
    const config = createDefaultConfig('Academic', 'Academic');
    const exam: ExamEntity = {
      id: 'exam-1',
      slug: 'mock-exam',
      title: 'Mock Exam',
      type: 'Academic',
      status: 'published',
      visibility: 'organization',
      owner: 'Owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      currentDraftVersionId: null,
      currentPublishedVersionId: 'ver-1',
      canEdit: true,
      canPublish: true,
      canDelete: true,
      schemaVersion: SCHEMA_VERSION
    };
    const version: ExamVersion = {
      id: 'ver-1',
      examId: 'exam-1',
      versionNumber: 1,
      parentVersionId: null,
      contentSnapshot: {
        title: 'Mock Exam',
        type: 'Academic',
        activeModule: 'reading',
        activePassageId: 'p1',
        activeListeningPartId: 'l1',
        config,
        reading: { passages: [] },
        listening: { parts: [] },
        writing: { task1Prompt: 'Task 1', task2Prompt: 'Task 2' },
        speaking: { part1Topics: [], cueCard: '', part3Discussion: [] }
      },
      configSnapshot: config,
      createdBy: 'Owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      isDraft: false,
      isPublished: true
    };

    await examRepository.saveVersion(version);

    const onCreateSchedule = vi.fn();

    const { container } = render(
      <AdminScheduling
        schedules={[]}
        exams={[]}
        examEntities={[exam]}
        onCreateSchedule={onCreateSchedule}
        onUpdateSchedule={vi.fn()}
        onDeleteSchedule={vi.fn()}
        onStartScheduledSession={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('New Session'));

    await screen.findByText(/v1 \(ver-1\)/i);

    const [startInput, endInput] = Array.from(
      container.querySelectorAll('input[type="datetime-local"]')
    ) as HTMLInputElement[];

    fireEvent.change(startInput, { target: { value: '2026-01-01T00:00' } });
    fireEvent.change(endInput, { target: { value: '2026-01-01T01:00' } });

    await waitFor(() => {
      expect(screen.getByText('Window validation failed')).toBeTruthy();
    });

    expect(screen.getByText(/Scheduled window must be at least/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Schedule' })).toBeDisabled();
    expect(onCreateSchedule).not.toHaveBeenCalled();
  });
});
