import { downloadBlob } from './downloadBlob';

/**
 * CSV export helpers. `escapeCsvCell` always quotes (RFC 4180) so commas,
 * quotes, and newlines round-trip; embedded quotes double. A leading
 * `=`, `+`, `-`, or `@` is neutralized with a leading single quote so
 * spreadsheet formula injection (`=HYPERLINK(...)`) cannot execute on open.
 */
const FORMULA_PREFIX_PATTERN = /^[=+\-@]/;

export function escapeCsvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : String(value);

  // Normalize newlines so one logical cell never emits a raw record break on
  // parsers that split strictly on \n (CRLF preserved as \n for round-trip).
  const normalized = text.replace(/\r\n?/g, '\n');
  const guarded = FORMULA_PREFIX_PATTERN.test(normalized) ? `'${normalized}` : normalized;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function emitCsv(filename: string, rows: Array<Array<unknown>>): void {
  // \uFEFF BOM makes Excel detect UTF-8; \r\n line endings match RFC 4180 and
  // Excel's expectations on Windows.
  const csvContent = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(filename, blob);
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<unknown>>,
): void {
  emitCsv(filename, [headers, ...rows]);
}

/**
 * Downloads a CSV that carries more than one header row (for example the SAT
 * RAWDATA template's column-letter row plus its named column row). Reuses the
 * same escaping, BOM, and formula-injection guards as `downloadCsv` so there is
 * a single CSV implementation.
 */
export function downloadCsvRows(
  filename: string,
  headerRows: Array<Array<unknown>>,
  rows: Array<Array<unknown>>,
): void {
  emitCsv(filename, [...headerRows, ...rows]);
}
