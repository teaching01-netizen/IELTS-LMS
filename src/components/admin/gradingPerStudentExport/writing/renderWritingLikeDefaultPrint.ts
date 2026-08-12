import type { jsPDF } from 'jspdf';

import type { WritingTaskSubmission } from '../../../../types/grading';
import { htmlToPlainTextPreserveLineBreaks } from '../../../../utils/htmlText';

import { renderPdfHeader } from '../pdf/header';
import { writeWrappedText } from '../pdf/text';

function formatSubmittedAt(value?: string): string {
  if (!value) return 'No submission';
  try {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

function getWritingTaskSlot(task: Pick<WritingTaskSubmission, 'taskId' | 'taskLabel'>): 'task1' | 'task2' | null {
  const normalizedId = task.taskId.trim().toLowerCase();
  const normalizedLabel = task.taskLabel.trim().toLowerCase();

  if (normalizedId === 'task1' || normalizedId === 'task-1' || normalizedLabel === 'task 1') return 'task1';
  if (normalizedId === 'task2' || normalizedId === 'task-2' || normalizedLabel === 'task 2') return 'task2';
  return null;
}

function getTaskLabelForSlot(slot: 'task1' | 'task2') {
  return slot === 'task1' ? 'Task 1' : 'Task 2';
}

function getAssessmentRows(task: WritingTaskSubmission | null) {
  return [
    {
      criterion: 'Task Response / Achievement',
      band: task?.rubricAssessment?.taskResponseBand,
      notes: task?.rubricAssessment?.taskResponseNotes,
    },
    {
      criterion: 'Coherence and Cohesion',
      band: task?.rubricAssessment?.coherenceBand,
      notes: task?.rubricAssessment?.coherenceNotes,
    },
    {
      criterion: 'Lexical Resource',
      band: task?.rubricAssessment?.lexicalBand,
      notes: task?.rubricAssessment?.lexicalNotes,
    },
    {
      criterion: 'Grammatical Range and Accuracy',
      band: task?.rubricAssessment?.grammarBand,
      notes: task?.rubricAssessment?.grammarNotes,
    },
    {
      criterion: 'Overall Band',
      band: task?.rubricAssessment?.overallBand,
      notes: task?.overallFeedback || task?.studentVisibleNotes || task?.rubricAssessment?.internalNotes,
    },
  ];
}

export function renderWritingLikeDefaultPrint(
  doc: jsPDF,
  student: {
    studentName: string;
    studentId: string;
    submissionId: string;
    nickname?: string | null | undefined;
    wcode?: string | null | undefined;
    ieltsCourse?: string | null | undefined;
    level?: string | null | undefined;
    generatedAt?: Date | undefined;
  },
  writingTasks: WritingTaskSubmission[],
  startY: number,
): number {
  const left = 14;
  const maxWidth = 180;
  const lineHeight = 4.6;
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = 12;
  const topMargin = 14;
  const headerContext = {
    studentName: student.studentName,
    studentId: student.studentId,
    submissionId: student.submissionId,
    generatedAt: student.generatedAt ?? new Date(),
    nickname: student.nickname,
    wcode: student.wcode,
    ieltsCourse: student.ieltsCourse,
    level: student.level,
  };

  const tasksBySlot = new Map<'task1' | 'task2', WritingTaskSubmission>();
  for (const task of writingTasks) {
    const slot = getWritingTaskSlot(task);
    if (slot && !tasksBySlot.has(slot)) tasksBySlot.set(slot, task);
  }

  let y = startY;

  const slots = ['task1', 'task2'] as const;
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    if (!slot) continue;
    const task = tasksBySlot.get(slot) ?? null;

    // Start each task on a fresh page if we are too low.
    if (y > pageHeight - 60) {
      doc.addPage();
      y = topMargin;
    }

    const sectionLabel = `WRITING - ${getTaskLabelForSlot(slot)}`;
    y = renderPdfHeader(doc, {
      ...headerContext,
      sectionLabel,
    });
    y = writeWrappedText(doc, `Submitted: ${formatSubmittedAt(task?.submittedAt)}`, left, y, maxWidth, 4.8, () => {
      y = renderPdfHeader(doc, {
        ...headerContext,
        sectionLabel,
      });
    });
    y += 3;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(getTaskLabelForSlot(slot), left, y);
    y += 6;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    y = writeWrappedText(doc, `Word count: ${task?.wordCount ?? 0}`, left, y, maxWidth, 5);
    y += 3;

    // Prompt
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Prompt', left, y);
    y += 5;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const promptText = task ? htmlToPlainTextPreserveLineBreaks(task.prompt) : 'Prompt unavailable.';
    y = writeWrappedText(doc, promptText || 'Prompt unavailable.', left, y, maxWidth, lineHeight);
    y += 3;

    // Response
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Student Response', left, y);
    y += 5;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const responseText = task ? htmlToPlainTextPreserveLineBreaks(task.studentText) : '';
    y = writeWrappedText(doc, responseText || 'No submission', left, y, maxWidth, lineHeight);
    y += 4;

    // Assessment table
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Assessment Form', left, y);
    y += 5;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    const colCriterion = 60;
    const colBand = 18;
    const colComments = maxWidth - colCriterion - colBand;
    const colX = {
      criterion: left,
      band: left + colCriterion,
      comments: left + colCriterion + colBand,
    } as const;

    const paddingX = 1.4;
    const paddingY = 1.8;
    const headerHeight = 7.5;

    const drawTableHeader = () => {
      doc.setDrawColor(156, 163, 175);
      doc.setFillColor(243, 244, 246);
      doc.rect(left, y, maxWidth, headerHeight, 'FD');
      doc.rect(colX.criterion, y, colCriterion, headerHeight, 'S');
      doc.rect(colX.band, y, colBand, headerHeight, 'S');
      doc.rect(colX.comments, y, colComments, headerHeight, 'S');

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('Criterion', colX.criterion + paddingX, y + 5.1);
      doc.text('Band', colX.band + paddingX, y + 5.1);
      doc.text('Comments', colX.comments + paddingX, y + 5.1);
      doc.setFont('helvetica', 'normal');
      y += headerHeight;
    };

    drawTableHeader();

    for (const row of getAssessmentRows(task)) {
      const criterion = row.criterion;
      const band = row.band === null || row.band === undefined ? '' : String(row.band);
      const comments = row.notes || '';

      const criterionLines = doc.splitTextToSize(criterion, colCriterion - paddingX * 2) as string[];
      const commentsLines = doc.splitTextToSize(comments, colComments - paddingX * 2) as string[];
      const bandLines = doc.splitTextToSize(band, colBand - paddingX * 2) as string[];
      const rowLines = Math.max(criterionLines.length, commentsLines.length, bandLines.length, 1);
      const rowHeight = rowLines * lineHeight + paddingY * 2;

      if (y + rowHeight > pageHeight - bottomMargin) {
        doc.addPage();
        y = topMargin;
        y = renderPdfHeader(doc, {
          ...headerContext,
          sectionLabel,
        });
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Assessment Form (cont.)', left, y);
        y += 5;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        drawTableHeader();
      }

      doc.setDrawColor(156, 163, 175);
      doc.rect(colX.criterion, y, colCriterion, rowHeight, 'S');
      doc.rect(colX.band, y, colBand, rowHeight, 'S');
      doc.rect(colX.comments, y, colComments, rowHeight, 'S');

      const cellTop = y + paddingY + 2.4;
      const drawLines = (lines: string[], x: number) => {
        for (let li = 0; li < lines.length; li += 1) {
          const text = lines[li];
          if (!text) continue;
          doc.text(String(text), x + paddingX, cellTop + li * lineHeight);
        }
      };

      doc.setFont('helvetica', 'bold');
      drawLines(criterionLines, colX.criterion);
      drawLines(bandLines, colX.band);
      doc.setFont('helvetica', 'normal');
      drawLines(commentsLines, colX.comments);

      y += rowHeight;
    }

    // Next task starts on a new page, to match the print-per-task feel.
    if (slotIndex < slots.length - 1) {
      doc.addPage();
      y = topMargin;
    }
  }

  return y;
}
