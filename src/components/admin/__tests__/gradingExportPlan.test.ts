import { describe, expect, test } from 'vitest';

import type { StudentSubmission } from '../../../types/grading';
import {
  buildExportPlan,
  createDefaultExportProfile,
  createExportStudentRecord,
  type ExportProfile,
  type ExportStudentRecord,
} from '../gradingExportBuilder/exportPlan';

const generatedAt = new Date('2026-08-10T10:11:12.000Z');

function makeSubmission(
  id: string,
  studentName: string,
  overrides: Partial<StudentSubmission> = {},
): StudentSubmission {
  return {
    id,
    submissionId: `attempt-${id}`,
    scheduleId: 'schedule-1',
    examId: 'exam-1',
    publishedVersionId: 'version-1',
    studentId: `W${id.slice(-1)}001`,
    studentName,
    studentEmail: `${id}@example.com`,
    nickname: `Nick ${id.slice(-1)}`,
    ieltsCourse: 'IELTS Advanced',
    cohortName: 'C3/26',
    submittedAt: '2026-08-10T09:00:00.000Z',
    timeSpentSeconds: 3600,
    gradingStatus: 'submitted',
    isFlagged: false,
    isOverdue: false,
    sectionStatuses: {
      listening: 'auto_graded',
      reading: 'auto_graded',
      writing: 'needs_review',
      speaking: 'pending',
    },
    createdAt: '2026-08-10T08:00:00.000Z',
    updatedAt: '2026-08-10T09:00:00.000Z',
    ...overrides,
  };
}

function makeRecord(
  id: string,
  studentName: string,
  identity: Partial<ExportStudentRecord['identity']> = {},
  overrides: Partial<StudentSubmission> = {},
): ExportStudentRecord {
  const submission = makeSubmission(id, studentName, overrides);
  const record = createExportStudentRecord(submission, 'IELTS Mock');
  return {
    ...record,
    identity: {
      ...record.identity,
      ...identity,
    },
  };
}

function makeProfile(overrides: Partial<ExportProfile> = {}): ExportProfile {
  return {
    ...createDefaultExportProfile(),
    ...overrides,
  };
}

describe('grading export plan', () => {
  test('filters independently from selection and resolves nested course/level paths', () => {
    const students = [
      makeRecord('sub-1', 'Somsri Saelim', {
        nickname: 'Mew',
        wcode: 'W12345',
        level: 'Level 5',
        courseName: 'IELTS Advanced',
      }),
      makeRecord('sub-2', 'Somchai Dee', {
        nickname: 'Beam',
        wcode: 'W12346',
        level: 'Level 5',
        courseName: 'IELTS Advanced',
      }),
      makeRecord('sub-3', 'Nattapong Jai', {
        nickname: 'Pond',
        wcode: 'W12347',
        level: 'Level 6',
        courseName: 'IELTS Foundation',
      }),
    ];

    const plan = buildExportPlan({
      session: { sessionId: 'session-1', examTitle: 'IELTS Mock' },
      students,
      selectedSubmissionIds: ['sub-1'],
      profile: makeProfile({
        filters: { ...createDefaultExportProfile().filters, courses: ['IELTS Advanced'] },
        grouping: [{ field: 'course' }, { field: 'level' }],
      }),
      generatedAt,
    });

    expect(plan.matchedCount).toBe(2);
    expect(plan.selectedCount).toBe(1);
    expect(plan.students[0]?.outputs[0]?.path).toBe(
      'IELTS Advanced/Level 5/Mew (W12345) - Level 5 - Somsri Saelim.pdf',
    );
  });

  test('combines selected courses into a custom group folder', () => {
    const profile = makeProfile({
      grouping: [{ field: 'customGroup' }],
      customGroups: [
        {
          id: 'advanced',
          name: 'IELTS Advanced',
          conditions: [
            {
              field: 'course',
              operator: 'in',
              values: ['IELTS 6.5', 'IELTS 7.0', 'IELTS Advanced'],
            },
          ],
        },
      ],
    });
    const student = makeRecord('sub-1', 'Somsri Saelim', {
      courseName: 'IELTS 7.0',
      level: 'Level 6',
    });

    const plan = buildExportPlan({
      session: { sessionId: 'session-1', examTitle: 'IELTS Mock' },
      students: [student],
      selectedSubmissionIds: ['sub-1'],
      profile,
      generatedAt,
    });

    expect(plan.students[0]?.outputs[0]?.path).toMatch(/^IELTS Advanced\//);
  });

  test('applies release status and submitted date filters before selection', () => {
    const students = [
      makeRecord('sub-1', 'Ready Student', {}, {
        gradingStatus: 'ready_to_release',
        submittedAt: '2026-08-10T09:00:00.000Z',
      }),
      makeRecord('sub-2', 'Released Student', {}, {
        gradingStatus: 'released',
        submittedAt: '2026-08-12T09:00:00.000Z',
      }),
    ];

    const plan = buildExportPlan({
      session: { sessionId: 'session-1', examTitle: 'IELTS Mock' },
      students,
      selectedSubmissionIds: ['sub-1', 'sub-2'],
      profile: makeProfile({
        filters: {
          ...createDefaultExportProfile().filters,
          releaseStatuses: ['ready_to_release'],
          submittedFrom: '2026-08-10',
          submittedTo: '2026-08-11',
        },
      }),
      generatedAt,
    });

    expect(plan.matchedCount).toBe(1);
    expect(plan.students[0]?.submissionId).toBe('sub-1');
  });

  test('does not treat a submission id as a Wcode when registration data is missing', () => {
    const record = createExportStudentRecord(
      makeSubmission('sub-1', 'Missing Wcode', { studentId: '' }),
      'IELTS Mock',
    );

    expect(record.identity.studentId).toBe('attempt-sub-1');
    expect(record.identity.wcode).toBeNull();
    expect(record.identity.fullName).toBe('Missing Wcode');
  });

  test('reports missing identity data and resolves filename conflicts within a folder', () => {
    const first = makeRecord('sub-1', 'Same Student', {
      nickname: null,
      wcode: null,
      level: 'Level 5',
      courseName: 'IELTS Advanced',
      cohortName: 'C3/26',
    });
    const second = makeRecord('sub-2', 'Same Student', {
      nickname: null,
      wcode: 'W12346',
      level: 'Level 5',
      courseName: 'IELTS Advanced',
      cohortName: 'C3/26',
    });

    const plan = buildExportPlan({
      session: { sessionId: 'session-1', examTitle: 'IELTS Mock' },
      students: [first, second],
      selectedSubmissionIds: ['sub-1', 'sub-2'],
      profile: makeProfile({
        grouping: [{ field: 'course' }, { field: 'level' }],
        filenameTemplate: '{{fullName}}.pdf',
      }),
      generatedAt,
    });

    expect(plan.selectedCount).toBe(2);
    expect(plan.warnings.map((warning) => warning.code)).toContain('missing_required_field');
    expect(plan.warnings.map((warning) => warning.code)).toContain('missing_optional_field');
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.students[1]?.outputs[0]?.filename).toContain('(2).pdf');
  });

  test('reports zero-result filters without planning files', () => {
    const plan = buildExportPlan({
      session: { sessionId: 'session-1', examTitle: 'IELTS Mock' },
      students: [makeRecord('sub-1', 'Same Student')],
      selectedSubmissionIds: ['sub-1'],
      profile: makeProfile({
        filters: { ...createDefaultExportProfile().filters, courses: ['No such course'] },
      }),
      generatedAt,
    });

    expect(plan.selectedCount).toBe(0);
    expect(plan.warnings.map((warning) => warning.code)).toContain('no_matches');
    expect(plan.pdfCount).toBe(0);
  });
});
