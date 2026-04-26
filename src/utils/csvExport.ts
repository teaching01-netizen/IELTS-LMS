export function escapeCsvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : String(value);

  return `"${text.replace(/"/g, '""')}"`;
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<unknown>>,
): void {
  const csvContent = [headers.map(escapeCsvCell).join(','), ...rows.map((row) => row.map(escapeCsvCell).join(','))].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}
