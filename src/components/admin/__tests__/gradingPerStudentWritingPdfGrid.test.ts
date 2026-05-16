import { describe, expect, test, vi } from 'vitest';

import type { jsPDF } from 'jspdf';

import { renderWritingLikeDefaultPrint } from '../gradingPerStudentExport/writing/renderWritingLikeDefaultPrint';
import type { WritingTaskSubmission } from '../../../types/grading';

function createRecordingPdfDoc() {
  const rectCalls: Array<unknown[]> = [];

  const doc = {
    internal: {
      pageSize: {
        getHeight: () => 297,
      },
    },
    setFontSize: vi.fn(),
    setFont: vi.fn(),
    setDrawColor: vi.fn(),
    setFillColor: vi.fn(),
    setTextColor: vi.fn(),
    setLineWidth: vi.fn(),
    text: vi.fn(),
    line: vi.fn(),
    rect: vi.fn((...args: unknown[]) => {
      rectCalls.push(args);
    }),
    addPage: vi.fn(),
    splitTextToSize: vi.fn((value: unknown) => [String(value)]),
  } as unknown as jsPDF;

  return { doc, rectCalls };
}

describe('per-student ZIP writing PDF', () => {
  test('draws grid borders for the assessment table', () => {
    const { doc, rectCalls } = createRecordingPdfDoc();

    const writingTask: WritingTaskSubmission = {
      taskId: 'task1',
      taskLabel: 'Task 1',
      submittedAt: '2026-05-16T05:16:00.000Z',
      wordCount: 152,
      prompt: '<p>Prompt</p>',
      studentText: '<p>Response</p>',
      rubricAssessment: {
        taskResponseBand: 5,
        taskResponseNotes: 'notes',
        coherenceBand: 5,
        coherenceNotes: 'notes',
        lexicalBand: 5,
        lexicalNotes: 'notes',
        grammarBand: 5,
        grammarNotes: 'notes',
        overallBand: 5,
        internalNotes: null,
      },
      overallFeedback: 'overall',
      studentVisibleNotes: null,
    } as unknown as WritingTaskSubmission;

    renderWritingLikeDefaultPrint(
      doc,
      { studentName: 'Ada Student', studentId: 'W250026', submissionId: 'sub-1' },
      [writingTask],
      20,
    );

    const tableRectCalls = rectCalls.filter((args) => args[2] === 60 && args[4] === 'S');
    expect(tableRectCalls.length).toBeGreaterThan(0);
  });
});
