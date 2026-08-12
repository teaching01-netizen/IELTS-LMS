import type { jsPDF } from 'jspdf';

import { writeWrappedText } from './text';

export type PdfHeaderContext = {
  studentName: string;
  studentId: string;
  submissionId: string;
  generatedAt: Date;
  nickname?: string | null | undefined;
  wcode?: string | null | undefined;
  ieltsCourse?: string | null | undefined;
  level?: string | null | undefined;
  sectionLabel?: string | undefined;
};

function displayIdentityValue(value: string | null | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

export function renderPdfHeader(doc: jsPDF, context: PdfHeaderContext): number {
  const left = 14;
  const maxWidth = 180;
  let y = 12;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Grading Export', left, y);

  y += 6;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  y = writeWrappedText(
    doc,
    `${displayIdentityValue(context.nickname, 'No nickname')} (${displayIdentityValue(context.wcode, context.studentId)})`,
    left,
    y,
    maxWidth,
    5.2,
  );

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  y = writeWrappedText(
    doc,
    `Course: ${displayIdentityValue(context.ieltsCourse, 'No course')} | Level: ${displayIdentityValue(context.level, 'No level')}`,
    left,
    y,
    maxWidth,
    4.2,
  );
  y = writeWrappedText(
    doc,
    `Name: ${displayIdentityValue(context.studentName, 'No name')}`,
    left,
    y,
    maxWidth,
    4.2,
  );

  if (context.sectionLabel) {
    y = writeWrappedText(doc, `Section: ${context.sectionLabel}`, left, y, maxWidth, 4.2);
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
