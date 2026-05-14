import { describe, expect, test } from 'vitest';

import {
  renderPerStudentPdfFilenameTemplate,
  resolvePerStudentPdfFilenameCollisions,
} from '../gradingPerStudentPdfFilenameTemplate';

describe('renderPerStudentPdfFilenameTemplate', () => {
  test('renders known placeholders and ensures .pdf extension', () => {
    const result = renderPerStudentPdfFilenameTemplate('{{studentName}}_{{submissionId}}_{{sections}}', {
      studentName: 'Ada Student',
      studentId: 'student-1',
      studentEmail: 'ada@example.com',
      submissionId: 'sub-1',
      examTitle: 'IELTS Mock',
      cohortName: 'Cohort A',
      sessionId: 'sess-1',
      sections: ['reading', 'writing'],
      generatedAt: new Date('2026-05-14T10:11:12.000Z'),
    });

    expect(result.unknownPlaceholders).toEqual([]);
    expect(result.filename).toBe('Ada Student_sub-1_reading-writing.pdf');
  });

  test('keeps unknown placeholders and reports them', () => {
    const result = renderPerStudentPdfFilenameTemplate('X_{{unknown}}_{{studentName}}.pdf', {
      studentName: 'Ada',
      studentId: 'id',
      submissionId: 'sub',
      sections: ['reading'],
      generatedAt: new Date('2026-05-14T00:00:00.000Z'),
    });

    expect(result.unknownPlaceholders).toEqual(['unknown']);
    expect(result.filename).toBe('X_{{unknown}}_Ada.pdf');
  });

  test('sanitizes invalid filename characters', () => {
    const result = renderPerStudentPdfFilenameTemplate('{{studentName}}_{{submissionId}}.pdf', {
      studentName: 'Ada/Student',
      studentId: 'id',
      submissionId: 'sub:1?',
      sections: ['writing'],
      generatedAt: new Date('2026-05-14T00:00:00.000Z'),
    });

    expect(result.filename).toBe('Ada-Student_sub-1-.pdf');
  });
});

describe('resolvePerStudentPdfFilenameCollisions', () => {
  test('suffixes duplicates with (n) before .pdf', () => {
    const { filenames, collisionsResolved } = resolvePerStudentPdfFilenameCollisions([
      'Ada.pdf',
      'Ada.pdf',
      'Ada.pdf',
    ]);

    expect(collisionsResolved).toBe(2);
    expect(filenames).toEqual(['Ada.pdf', 'Ada (2).pdf', 'Ada (3).pdf']);
  });
});

