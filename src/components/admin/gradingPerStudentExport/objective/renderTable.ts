import type { jsPDF } from 'jspdf';

import type { CsvColumn } from '../../gradingReviewUtils';
import type { PdfHeaderContext } from '../pdf/header';
import { renderPdfHeader } from '../pdf/header';
import { toDisplayValue, writeWrappedText } from '../pdf/text';
import { buildObjectiveQuestionTableRows } from './tableRows';

export function renderObjectiveQuestionTable(
  doc: jsPDF,
  headerContext: PdfHeaderContext,
  sectionLabel: string,
  columns: CsvColumn[],
  row: Record<string, unknown>,
  startY: number,
): number {
  const left = 14;
  const maxWidth = 180;
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = 12;
  const paddingX = 1.4;
  const paddingY = 1.8;

  const colQ = 14;
  const colStudent = 70;
  const colRight = 70;
  const colCorrect = 16;
  const colScore = maxWidth - colQ - colStudent - colRight - colCorrect;
  const colX = {
    q: left,
    student: left + colQ,
    right: left + colQ + colStudent,
    correct: left + colQ + colStudent + colRight,
    score: left + colQ + colStudent + colRight + colCorrect,
  } as const;

  const renderSectionHeader = () => {
    startY = renderPdfHeader(doc, { ...headerContext, sectionLabel });
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(sectionLabel, left, startY);
    startY += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
  };

  const ensureSpace = (neededHeight: number) => {
    if (startY + neededHeight <= pageHeight - bottomMargin) return;
    doc.addPage();
    renderSectionHeader();
  };

  const summaryPairs: Array<{ label: string; value: string }> = [
    { label: 'Submitted', value: toDisplayValue(row['submittedAt']) },
    { label: 'Total', value: `${toDisplayValue(row['totalScore'])}/${toDisplayValue(row['maxScore'])}`.replace(/^\/|\/$/g, '') },
    { label: 'Correct', value: toDisplayValue(row['correctCount']) },
    { label: 'Band', value: toDisplayValue(row['ieltsBandScore']) },
  ].filter((pair) => pair.value.trim() !== '');

  if (summaryPairs.length > 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Summary', left, startY);
    startY += 5;

    doc.setFontSize(9);
    for (const pair of summaryPairs) {
      doc.setFont('helvetica', 'bold');
      doc.text(`${pair.label}:`, left, startY);
      doc.setFont('helvetica', 'normal');
      startY = writeWrappedText(doc, pair.value, left + 24, startY, maxWidth - 24, 4.4, () => {
        renderSectionHeader();
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Summary (cont.)', left, startY);
        startY += 5;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
      });
      startY += 1.2;
    }
    startY += 2;
  }

  const tableRows = buildObjectiveQuestionTableRows(columns, row);
  if (tableRows.length === 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    return writeWrappedText(doc, 'No question answers found.', left, startY, maxWidth, 4.6);
  }

  const headerHeight = 7.5;
  ensureSpace(headerHeight + 2);

  const drawTableHeader = () => {
    doc.setDrawColor(210);
    doc.setFillColor(245, 247, 250);
    doc.rect(left, startY, maxWidth, headerHeight, 'FD');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Q', colX.q + paddingX, startY + 5.1);
    doc.text('Student Answer', colX.student + paddingX, startY + 5.1);
    doc.text('Right Answer', colX.right + paddingX, startY + 5.1);
    doc.text('Correct', colX.correct + paddingX, startY + 5.1);
    doc.text('Score', colX.score + paddingX, startY + 5.1);
    startY += headerHeight;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
  };

  drawTableHeader();

  const lineHeight = 4.2;
  for (let i = 0; i < tableRows.length; i += 1) {
    const item = tableRows[i]!;
    const qLines = doc.splitTextToSize(item.question, colQ - paddingX * 2) as string[];
    const studentLines = doc.splitTextToSize(item.studentAnswer || '', colStudent - paddingX * 2) as string[];
    const rightLines = doc.splitTextToSize(item.rightAnswer || '', colRight - paddingX * 2) as string[];
    const correctLines = doc.splitTextToSize(item.correct || '', colCorrect - paddingX * 2) as string[];
    const scoreLines = doc.splitTextToSize(item.score || '', colScore - paddingX * 2) as string[];
    const maxLines = Math.max(qLines.length, studentLines.length, rightLines.length, correctLines.length, scoreLines.length, 1);
    const rowHeight = maxLines * lineHeight + paddingY * 2;

    if (startY + rowHeight > pageHeight - bottomMargin) {
      doc.addPage();
      renderSectionHeader();
      drawTableHeader();
    }

    doc.setDrawColor(225);
    if (i % 2 === 1) {
      doc.setFillColor(252, 252, 253);
      doc.rect(left, startY, maxWidth, rowHeight, 'F');
    }

    doc.rect(colX.q, startY, colQ, rowHeight, 'S');
    doc.rect(colX.student, startY, colStudent, rowHeight, 'S');
    doc.rect(colX.right, startY, colRight, rowHeight, 'S');
    doc.rect(colX.correct, startY, colCorrect, rowHeight, 'S');
    doc.rect(colX.score, startY, colScore, rowHeight, 'S');

    const cellTop = startY + paddingY + 2.4;
    const drawLines = (lines: string[], x: number) => {
      for (let li = 0; li < lines.length; li += 1) {
        const text = lines[li];
        if (!text) continue;
        doc.text(String(text), x + paddingX, cellTop + li * lineHeight);
      }
    };

    drawLines(qLines, colX.q);
    drawLines(studentLines, colX.student);
    drawLines(rightLines, colX.right);

    doc.setFont('helvetica', 'bold');
    if (item.correct === 'Yes') doc.setTextColor(20, 110, 60);
    if (item.correct === 'No') doc.setTextColor(160, 40, 40);
    drawLines(correctLines, colX.correct);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');

    drawLines(scoreLines, colX.score);

    startY += rowHeight;
  }

  return startY;
}

