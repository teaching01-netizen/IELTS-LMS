import type { jsPDF } from 'jspdf';

export function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function normalizeAnswer(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ');
}

export function toOptionalFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function writeWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  onNewPage?: (() => void) | undefined,
): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = 12;
  const topMargin = 14;

  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  let cursorY = y;

  for (const line of lines) {
    if (cursorY > pageHeight - bottomMargin) {
      doc.addPage();
      cursorY = topMargin;
      onNewPage?.();
    }
    doc.text(line, x, cursorY);
    cursorY += lineHeight;
  }

  return cursorY;
}
