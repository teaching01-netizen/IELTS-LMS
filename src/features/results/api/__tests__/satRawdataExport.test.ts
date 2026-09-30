import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const downloadBlob = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../utils/downloadBlob', () => ({ downloadBlob }));

import { downloadSatRawdataXlsx, satRawdataExportFilename } from '../satRawdataExport';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-28T09:00:00Z'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('downloadSatRawdataXlsx', () => {
  it('fetches the scoped workbook with same-origin credentials and downloads the blob', async () => {
    const blob = new Blob(['xlsx-data']);
    fetchMock.mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) });

    await expect(downloadSatRawdataXlsx('exam-1', 'schedule-1', 'Practice Test 06')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/results/sat/export/rawdata?examId=exam-1&scheduleId=schedule-1&format=xlsx',
      { credentials: 'same-origin' },
    );
    expect(downloadBlob).toHaveBeenCalledWith(
      'sat-rawdata-practice-test-06-2026-09-28.xlsx',
      blob,
    );
  });

  it('encodes ids and falls back to a title-less filename', async () => {
    const blob = new Blob(['xlsx-data']);
    fetchMock.mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) });

    await downloadSatRawdataXlsx('exam 1', 'sched/1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/results/sat/export/rawdata?examId=exam%201&scheduleId=sched%2F1&format=xlsx',
      { credentials: 'same-origin' },
    );
    expect(downloadBlob).toHaveBeenCalledWith('sat-rawdata-2026-09-28.xlsx', blob);
  });

  it('surfaces the backend message when the download request fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({ code: 'RATE_LIMITED', message: 'Export rate limited. Try again shortly.' }),
    });

    await expect(downloadSatRawdataXlsx('exam-1', 'schedule-1')).rejects.toThrow(
      'Export rate limited. Try again shortly.',
    );
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});

describe('satRawdataExportFilename', () => {
  it('slugifies the exam title and stamps the date', () => {
    expect(satRawdataExportFilename('SAT Simulation Test (May - Aug 2026)', new Date('2026-09-28T00:00:00Z')))
      .toBe('sat-rawdata-sat-simulation-test-may-aug-2026-2026-09-28.xlsx');
    expect(satRawdataExportFilename(undefined, new Date('2026-09-28T00:00:00Z'))).toBe('sat-rawdata-2026-09-28.xlsx');
  });
});
