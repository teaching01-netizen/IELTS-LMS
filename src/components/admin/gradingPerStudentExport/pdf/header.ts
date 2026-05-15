import type { jsPDF } from 'jspdf';

import { writeWrappedText } from './text';

export type PdfHeaderContext = {
  studentName: string;
  studentId: string;
  submissionId: string;
  generatedAt: Date;
  sectionLabel?: string | undefined;
};

export function renderPdfHeader(doc: jsPDF, context: PdfHeaderContext): number {
  const left = 14;
  const maxWidth = 180;
  let y = 12;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Grading Export', left, y);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  y += 5;

  const meta = [
    `Generated: ${context.generatedAt.toISOString()}`,
    `Student: ${context.studentName} (${context.studentId})`,
    `Submission: ${context.submissionId}`,
    context.sectionLabel ? `Section: ${context.sectionLabel}` : null,
  ].filter((line): line is string => Boolean(line));

  for (const line of meta) {
    y = writeWrappedText(doc, line, left, y, maxWidth, 4.2);
  }

  // Divider
  y += 2;
  doc.setDrawColor(200);
  doc.line(left, y, left + maxWidth, y);
  y += 5;
  return y;
}

export function writeKeyValueRow(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  onNewPage?: (() => void) | undefined,
): number {
  const labelText = label.trim();
  const valueText = value.trim();

  doc.setFont('helvetica', 'bold');
  const labelLines = doc.splitTextToSize(labelText, 58) as string[];
  doc.setFont('helvetica', 'normal');
  const valueLines = doc.splitTextToSize(valueText, maxWidth - 62) as string[];

  const rowLines = Math.max(labelLines.length, valueLines.length, 1);
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = 12;
  const topMargin = 14;

  if (y + rowLines * lineHeight > pageHeight - bottomMargin) {
    doc.addPage();
    y = topMargin;
    onNewPage?.();
  }

  for (let i = 0; i < rowLines; i += 1) {
    const rowY = y + i * lineHeight;
    const labelLine = labelLines[i] ?? '';
    const valueLine = valueLines[i] ?? '';
    doc.setFont('helvetica', 'bold');
    doc.text(labelLine, x, rowY);
    doc.setFont('helvetica', 'normal');
    doc.text(valueLine, x + 62, rowY);
  }

  return y + rowLines * lineHeight;
}

