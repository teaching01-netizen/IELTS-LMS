import { downloadBlob } from '../../../utils/downloadBlob';

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
  return slug ? `sat-rawdata-${slug}-${stamp}.xlsx` : `sat-rawdata-${stamp}.xlsx`;
}

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (
      payload !== null &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof payload.message === 'string' &&
      payload.message.trim()
    ) {
      return payload.message;
    }
  } catch {
    // Fall through to a status-based error for non-JSON responses.
  }
  return `SAT RAWDATA export could not be downloaded (${response.status}).`;
}

/** Fetches and downloads the section-specific SAT RAWDATA workbook. */
export async function downloadSatRawdataXlsx(
  examId: string,
  scheduleId: string,
  examTitle?: string,
): Promise<void> {
  const response = await fetch(
    `/api/v1/results/sat/export/rawdata?examId=${encodeURIComponent(examId)}&scheduleId=${encodeURIComponent(scheduleId)}&format=xlsx`,
    { credentials: 'same-origin' },
  );
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  downloadBlob(satRawdataExportFilename(examTitle, new Date()), await response.blob());
}
