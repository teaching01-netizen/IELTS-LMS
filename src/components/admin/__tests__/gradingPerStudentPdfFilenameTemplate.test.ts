import { describe, expect, test } from 'vitest';

import {
  DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE,
  renderPerStudentPdfFilenameTemplate,
  resolvePerStudentPdfFilenameCollisions,
} from '../gradingPerStudentPdfFilenameTemplate';

describe('renderPerStudentPdfFilenameTemplate', () => {
  test('uses the canonical nickname, Wcode, level, and full name fields', () => {
    const result = renderPerStudentPdfFilenameTemplate(
      DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE,
      {
        studentName: 'Somsri Saelim',
        studentId: 'student-1',
        submissionId: 'sub-1',
        nickname: 'Mew',
        wcode: 'W12345',
        level: 'Level 5',
        fullName: 'Somsri Saelim',
        sections: ['reading', 'listening', 'writing'],
        generatedAt: new Date('2026-05-14T10:11:12.000Z'),
      },
    );

    expect(result.unknownPlaceholders).toEqual([]);
    expect(result.filename).toBe('Mew (W12345) - Level 5 - Somsri Saelim.pdf');
  });

  test('renders known placeholders and ensures .pdf extension', () => {
    const result = renderPerStudentPdfFilenameTemplate('{{studentName}}_{{submissionId}}_{{sections}}', {
      studentName: 'Ada Student',
      studentId: 'student-1',
      studentEmail: 'ada@example.com',
      nickname: 'Ada',
      ieltsCourse: 'IELTS Academic',
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

  test('supports nickname and ieltsCourse placeholders', () => {
    const result = renderPerStudentPdfFilenameTemplate(
      '{{studentName}}_{{nickname}}_{{ieltsCourse}}_{{submissionId}}',
      {
        studentName: 'Ada Student',
        studentId: 'student-1',
        nickname: 'Ada',
        ieltsCourse: 'IELTS Academic',
        submissionId: 'sub-1',
        sections: ['writing'],
        generatedAt: new Date('2026-05-14T10:11:12.000Z'),
      },
    );

    expect(result.unknownPlaceholders).toEqual([]);
    expect(result.filename).toBe('Ada Student_Ada_IELTS Academic_sub-1.pdf');
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

  test('supports section placeholder for per-section exports', () => {
    const result = renderPerStudentPdfFilenameTemplate('{{studentName}}_{{section}}_{{submissionId}}', {
      studentName: 'Ada Student',
      studentId: 'student-1',
      submissionId: 'sub-1',
      section: 'listening',
      sections: ['reading', 'listening', 'writing'],
      generatedAt: new Date('2026-05-14T00:00:00.000Z'),
    });

    expect(result.unknownPlaceholders).toEqual([]);
    expect(result.filename).toBe('Ada Student_listening_sub-1.pdf');
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
