import { describe, expect, test } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { createPerStudentZipPdfExport } from '../gradingPerStudentExport';
import type { CsvColumn } from '../gradingReviewUtils';
import { buildStudentPdfBytes } from '../gradingPerStudentExport/studentPdf';

describe('createPerStudentZipPdfExport', () => {
  test('shows candidate identity at the top of the generated PDF', () => {
    const pdfBytes = buildStudentPdfBytes(
      {
        submissionId: 'sub-1',
        studentName: 'Somsri Saelim',
        studentId: 'student-sub-1',
        nickname: 'Mew',
        wcode: 'W12345',
        ieltsCourse: 'IELTS Advanced',
        level: 'Level 5',
        sectionData: {
          reading: { columns: [], row: null },
        },
      },
      ['reading'],
      new Date('2026-05-13T00:00:00.000Z'),
    );

    const pdfText = new TextDecoder().decode(pdfBytes);

    expect(pdfText).toContain('Mew \\(W12345\\)');
    expect(pdfText).toContain('Course: IELTS Advanced | Level: Level 5');
    expect(pdfText).toContain('Name: Somsri Saelim');
    expect(pdfText).not.toContain('Generated:');
    expect(pdfText).not.toContain('Submission:');
  });

  test('builds a zip containing one PDF per student plus manifest.json', async () => {
    const readingColumns: CsvColumn[] = [
      { key: 'studentName', label: 'Student Name' },
      { key: 'answer:q1', label: 'Q1 Answer' },
    ];

    const writingColumns: CsvColumn[] = [
      { key: 'studentName', label: 'Student Name' },
      { key: 'task1:response', label: 'Task 1 Response' },
    ];

    const exportResult = await createPerStudentZipPdfExport({
      filenameBase: 'grading-export',
      generatedAt: new Date('2026-05-13T00:00:00.000Z'),
      sections: ['reading', 'writing'],
      students: [
        {
          submissionId: 'sub-1',
          studentName: 'Ada Student',
          studentId: 'student-sub-1',
          sectionData: {
            reading: {
              columns: readingColumns,
              row: { studentName: 'Ada Student', 'answer:q1': 'A' },
            },
            writing: {
              columns: writingColumns,
              row: { studentName: 'Ada Student', 'task1:response': 'My essay text' },
            },
          },
        },
        {
          submissionId: 'sub-2',
          studentName: 'Ben Student',
          studentId: 'student-sub-2',
          sectionData: {
            reading: {
              columns: readingColumns,
              row: null,
            },
            writing: {
              columns: writingColumns,
              row: null,
            },
          },
        },
      ],
    });

    expect(exportResult.filename).toMatch(/\.zip$/i);
    expect(exportResult.bytes.byteLength).toBeGreaterThan(100);

    const entries = unzipSync(exportResult.bytes);
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'No nickname (student-sub-1) - No level - Ada Student.pdf',
        'No nickname (student-sub-2) - No level - Ben Student.pdf',
      ]),
    );

    const manifestRaw = entries['manifest.json'];
    expect(manifestRaw).toBeInstanceOf(Uint8Array);
    const manifest = JSON.parse(strFromU8(manifestRaw));
    expect(manifest.mode).toBe('per_student_zip_pdf');
    expect(manifest.sections).toEqual(['reading', 'writing']);
    expect(manifest.pdfMode).toBe('combined');
    expect(manifest.students).toHaveLength(2);
    expect(manifest.students[0]?.outputs).toEqual(['No nickname (student-sub-1) - No level - Ada Student.pdf']);
  });

  test('includes listening in combined mode when selected', async () => {
    const objectiveColumns: CsvColumn[] = [
      { key: 'studentName', label: 'Student Name' },
      { key: 'answer:q1', label: 'Q1 Answer' },
    ];

    const exportResult = await createPerStudentZipPdfExport({
      filenameBase: 'grading-export',
      generatedAt: new Date('2026-05-13T00:00:00.000Z'),
      sections: ['reading', 'listening'],
      students: [
        {
          submissionId: 'sub-1',
          studentName: 'Ada Student',
          studentId: 'student-sub-1',
          sectionData: {
            reading: {
              columns: objectiveColumns,
              row: { studentName: 'Ada Student', 'answer:q1': 'A', 'rightAnswer:q1': 'A', 'score:q1': 1 },
            },
            listening: {
              columns: objectiveColumns,
              row: { studentName: 'Ada Student', 'answer:q1': 'B', 'rightAnswer:q1': 'C', 'score:q1': 0 },
            },
          },
        },
      ],
    });

    const entries = unzipSync(exportResult.bytes);
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining(['manifest.json', 'No nickname (student-sub-1) - No level - Ada Student.pdf']),
    );

    const manifest = JSON.parse(strFromU8(entries['manifest.json'] as Uint8Array));
    expect(manifest.sections).toEqual(['reading', 'listening']);
    expect(manifest.pdfMode).toBe('combined');
    expect(manifest.students[0]?.outputs).toEqual(['No nickname (student-sub-1) - No level - Ada Student.pdf']);
  });

  test('packages the deterministic plan path and records the plan snapshot', async () => {
    const objectiveColumns: CsvColumn[] = [
      { key: 'studentName', label: 'Student Name' },
      { key: 'answer:q1', label: 'Q1 Answer' },
    ];

    const exportResult = await createPerStudentZipPdfExport({
      filenameBase: 'grading-export',
      generatedAt: new Date('2026-08-10T00:00:00.000Z'),
      sections: ['reading'],
      plan: {
        profile: { id: 'warwick-standard', name: 'Warwick standard export', version: 1 },
        grouping: ['course', 'level'],
        filenameTemplate: '{{nickname}} ({{wcode}}) - {{level}} - {{fullName}}.pdf',
        matchedCount: 1,
        selectedCount: 1,
        folderCount: 2,
        pdfCount: 1,
        warnings: [],
        conflicts: [],
      },
      students: [
        {
          submissionId: 'sub-1',
          studentName: 'Somsri Saelim',
          studentId: 'W12345',
          nickname: 'Mew',
          ieltsCourse: 'IELTS Advanced',
          sectionData: {
            reading: {
              columns: objectiveColumns,
              row: { studentName: 'Somsri Saelim', 'answer:q1': 'A' },
            },
          },
          plannedOutputs: [
            {
              folderPath: ['IELTS Advanced', 'Level 5'],
              filename: 'Mew (W12345) - Level 5 - Somsri Saelim.pdf',
              path: 'IELTS Advanced/Level 5/Mew (W12345) - Level 5 - Somsri Saelim.pdf',
            },
          ],
          wcode: 'W12345',
          level: 'Level 5',
        },
      ],
    });

    const entries = unzipSync(exportResult.bytes);
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'IELTS Advanced/Level 5/Mew (W12345) - Level 5 - Somsri Saelim.pdf',
      ]),
    );

    const manifest = JSON.parse(strFromU8(entries['manifest.json'] as Uint8Array));
    expect(manifest.plan.profile.id).toBe('warwick-standard');
    expect(manifest.students[0]?.wcode).toBe('W12345');
    expect(manifest.students[0]?.level).toBe('Level 5');
    expect(manifest.students[0]?.outputs).toEqual([
      'IELTS Advanced/Level 5/Mew (W12345) - Level 5 - Somsri Saelim.pdf',
    ]);
  });

  test('builds per-student folders with one PDF per section in separate mode', async () => {
    const objectiveColumns: CsvColumn[] = [
      { key: 'studentName', label: 'Student Name' },
      { key: 'answer:q1', label: 'Q1 Answer' },
    ];

    const exportResult = await createPerStudentZipPdfExport({
      filenameBase: 'grading-export',
      generatedAt: new Date('2026-05-13T00:00:00.000Z'),
      sections: ['reading', 'listening', 'writing'],
      pdfMode: 'separate',
      students: [
        {
          submissionId: 'sub-1',
          studentName: 'Ada Student',
          studentId: 'student-sub-1',
          sectionData: {
            reading: { columns: objectiveColumns, row: { studentName: 'Ada Student', 'answer:q1': 'A', 'rightAnswer:q1': 'A', 'score:q1': 1 } },
            listening: { columns: objectiveColumns, row: { studentName: 'Ada Student', 'answer:q1': 'B', 'rightAnswer:q1': 'C', 'score:q1': 0 } },
            writing: { columns: [{ key: 'studentName', label: 'Student Name' }], row: { studentName: 'Ada Student' } },
          },
        },
      ],
    });

    const entries = unzipSync(exportResult.bytes);
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'Ada Student_sub-1/No nickname (student-sub-1) - No level - Ada Student.pdf',
        'Ada Student_sub-1/No nickname (student-sub-1) - No level - Ada Student (2).pdf',
        'Ada Student_sub-1/No nickname (student-sub-1) - No level - Ada Student (3).pdf',
      ]),
    );

    const manifest = JSON.parse(strFromU8(entries['manifest.json'] as Uint8Array));
    expect(manifest.pdfMode).toBe('separate');
    expect(manifest.students[0]?.filename).toBe('Ada Student_sub-1');
    expect(manifest.students[0]?.outputs).toHaveLength(3);
  });
});
