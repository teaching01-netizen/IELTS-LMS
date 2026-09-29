import { downloadCsvRows } from '../../../utils/csvExport';
import { resultsGateway } from '../infrastructure/resultsGateway';

/**
 * Wire payload for GET /v1/results/sat/export/rawdata. The backend owns the
 * schema, ordering, row generation, and 50-column validation; this client only
 * serializes the rows through the shared CSV utility.
 */
export interface SatRawdataExportPayload {
  schemaVersion: number;
  examId: string;
  scheduleId: string;
  columnCount: number;
  rowCount: number;
  headerRows: string[][];
  rows: string[][];
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function satRawdataExportFilename(examTitle: string | undefined, date: Date): string {
  const stamp = date.toISOString().slice(0, 10);
  const slug = slugify(examTitle ?? '');
  return slug ? `sat-rawdata-${slug}-${stamp}.csv` : `sat-rawdata-${stamp}.csv`;
}

/**
 * Fetches the RAWDATA projection for one Student Access group and triggers the
 * download. Returns the exported row count so the caller can surface feedback.
 */
export async function downloadSatRawdataCsv(
  examId: string,
  scheduleId: string,
  examTitle?: string,
): Promise<number> {
  const payload = await resultsGateway.get<SatRawdataExportPayload>(
    `/v1/results/sat/export/rawdata?examId=${encodeURIComponent(examId)}&scheduleId=${encodeURIComponent(scheduleId)}`,
  );
  downloadCsvRows(satRawdataExportFilename(examTitle, new Date()), payload.headerRows, payload.rows);
  return payload.rowCount ?? payload.rows.length;
}
