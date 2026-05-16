import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminScheduling } from '../AdminScheduling';
import { examRepository } from '../../../services/examRepository';
import { examDeliveryService } from '../../../services/examDeliveryService';
import { createDefaultConfig } from '../../../constants/examDefaults';
import { SCHEMA_VERSION, type ExamEntity, type ExamVersion } from '../../../types/domain';

describe('AdminScheduling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a cohort without manual schedule window fields and derives the internal window from the exam plan', async () => {
    localStorage.clear();
    const config = createDefaultConfig('Academic', 'Academic');
    const plan = examDeliveryService.buildSectionPlan(config);
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

    vi.spyOn(examRepository, 'getVersionById').mockResolvedValue(version);

    const onCreateSchedule = vi.fn();

    render(
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

    expect(screen.queryByLabelText(/start time/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/end time/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/window length/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

    await waitFor(() => expect(onCreateSchedule).toHaveBeenCalledTimes(1));
    const createdSchedule = onCreateSchedule.mock.calls[0][0];
    expect(createdSchedule).toEqual(
      expect.objectContaining({
        plannedDurationMinutes: plan.plannedDurationMinutes,
        deliveryMode: 'proctor_start',
        autoStart: false,
      }),
    );
    expect(Date.parse(createdSchedule.endTime) - Date.parse(createdSchedule.startTime)).toBe(
      plan.plannedDurationMinutes * 60_000,
    );
  });

  it('opens create schedule modal with the routed exam preselected', async () => {
    localStorage.clear();
    const config = createDefaultConfig('Academic', 'Academic');
    const examOne: ExamEntity = {
      id: 'exam-1',
      slug: 'mock-exam-1',
      title: 'Mock Exam 1',
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
    const examTwo: ExamEntity = {
      ...examOne,
      id: 'exam-2',
      slug: 'mock-exam-2',
      title: 'Mock Exam 2',
      currentPublishedVersionId: 'ver-2',
    };

    const versionOne: ExamVersion = {
      id: 'ver-1',
      examId: 'exam-1',
      versionNumber: 1,
      parentVersionId: null,
      contentSnapshot: {
        title: 'Mock Exam 1',
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
    const versionTwo: ExamVersion = {
      ...versionOne,
      id: 'ver-2',
      examId: 'exam-2',
      contentSnapshot: {
        ...versionOne.contentSnapshot,
        title: 'Mock Exam 2',
      },
    };

    vi.spyOn(examRepository, 'getVersionById').mockImplementation(async (id: string) => {
      if (id === 'ver-1') return versionOne;
      if (id === 'ver-2') return versionTwo;
      return null;
    });

    render(
      <AdminScheduling
        schedules={[]}
        exams={[]}
        examEntities={[examOne, examTwo]}
        onCreateSchedule={vi.fn()}
        onUpdateSchedule={vi.fn()}
        onDeleteSchedule={vi.fn()}
        onStartScheduledSession={vi.fn()}
        initialExamId="exam-2"
        autoOpenCreate
      />
    );

    await screen.findByText('Schedule New Session');

    const examSelect = screen.getByLabelText('Exam') as HTMLSelectElement;
    expect(examSelect.value).toBe('exam-2');
  });
});
