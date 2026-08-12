import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { StudentSubmission } from '../../../types/grading';
import { createDefaultExportProfile, createExportStudentRecord } from '../gradingExportBuilder/exportPlan';
import { ExportBuilderFilters } from '../gradingExportBuilder/ExportBuilderFilters';

const submission: StudentSubmission = {
  id: 'submission-1',
  submissionId: 'submission-1',
  scheduleId: 'schedule-1',
  examId: 'exam-1',
  publishedVersionId: 'version-1',
  studentId: 'W260047',
  studentName: 'Avalinya Malakorn',
  nickname: 'Naja',
  ieltsCourse: 'Advanced',
  level: 'Advanced',
  cohortName: 'Elite 2025-A',
  submittedAt: '2026-08-12T10:00:00.000Z',
  timeSpentSeconds: 3600,
  gradingStatus: 'submitted',
  assignedTeacherId: 'teacher-1',
  assignedTeacherName: 'Teacher One',
  isFlagged: false,
  isOverdue: false,
  sectionStatuses: {
    listening: 'finalized',
    reading: 'finalized',
    writing: 'needs_review',
    speaking: 'pending',
  },
  createdAt: '2026-08-12T10:00:00.000Z',
  updatedAt: '2026-08-12T10:00:00.000Z',
};

describe('ExportBuilderFilters', () => {
  test('keeps multi-value filters compact and updates the selected values', () => {
    const onChange = vi.fn();
    const profile = createDefaultExportProfile();
    const { container } = render(
      <ExportBuilderFilters
        records={[createExportStudentRecord(submission, 'IELTS mock test')]}
        filters={profile.filters}
        disabled={false}
        onChange={onChange}
      />,
    );

    expect(container.querySelectorAll('select[multiple]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-filter-control]')).toHaveLength(6);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Course filter' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Advanced' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ courses: ['Advanced'] }));
  });

  test('closes the multi-value menu with Escape', () => {
    const profile = createDefaultExportProfile();

    render(
      <ExportBuilderFilters
        records={[createExportStudentRecord(submission, 'IELTS mock test')]}
        filters={profile.filters}
        disabled={false}
        onChange={() => {}}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Course filter' }), { key: 'Enter' });
    expect(screen.getByRole('menuitemcheckbox', { name: 'Advanced' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Advanced' })).not.toBeInTheDocument();
  });
});
