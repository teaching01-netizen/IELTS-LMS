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

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<unknown>>,
): void {
  // \uFEFF BOM makes Excel detect UTF-8; \r\n line endings match RFC 4180 and
  // Excel's expectations on Windows.
  const csvContent = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ].join('\r\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  // `click()` on a detached anchor is ignored by some browsers (notably
  // Firefox); the node must be in the document for the download to start.
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
  }

  // Revoke asynchronously (0ms): revoking synchronously can abort the download
  // in Chrome before the navigation captures the blob URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
