import { apiClient } from '../../../shared/api/apiClient';
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

/** Fetches and downloads the section-specific SAT RAWDATA workbook. */
export async function downloadSatRawdataXlsx(
  examId: string,
  scheduleId: string,
  examTitle?: string,
): Promise<void> {
  const endpoint = `/api/v1/results/sat/export/rawdata?examId=${encodeURIComponent(examId)}&scheduleId=${encodeURIComponent(scheduleId)}&format=xlsx`;
  const generation = apiClient.captureAuthGeneration();
  const response = await fetch(endpoint, { credentials: 'same-origin' });
  if (!response.ok) {
    const error = await apiClient.errorFromResponse(response);
    // Shared auth owners first (sign-in check / password confirmation), so the
    // structured code is not lost to the message-only error below.
    await apiClient.reportAuthFailure(error, {
      endpoint,
      method: 'GET',
      requestId: error.requestId ?? '',
      generation,
      bearer: false,
    });
    if (!error.message || error.message === response.statusText) {
      error.message = `SAT RAWDATA export could not be downloaded (${response.status}).`;
    }
    throw error;
  }
  const blob = await response.blob();
  // Never hand a previous actor's workbook to the next signed-in user.
  apiClient.assertAuthGeneration(generation);
  downloadBlob(satRawdataExportFilename(examTitle, new Date()), blob);
}
