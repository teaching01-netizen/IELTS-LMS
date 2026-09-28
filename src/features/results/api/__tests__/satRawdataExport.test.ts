import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportSatRawdataVerbal } from '../satRawdataExport';

const resultsGetMock = vi.hoisted(() => vi.fn());
const downloadCsvRowsMock = vi.hoisted(() => vi.fn());

vi.mock('../../infrastructure/resultsGateway', () => ({
  resultsGateway: { get: resultsGetMock },
}));
vi.mock('../../../../utils/csvExport', () => ({
  downloadCsvRows: downloadCsvRowsMock,
}));

const headers = [Array.from({ length: 50 }, (_, index) => `H${index + 1}`), Array.from({ length: 50 }, (_, index) => `C${index + 1}`)];

describe('exportSatRawdataVerbal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests only the selected exam and schedule, then downloads all rows', async () => {
    const studentRows = Array.from({ length: 101 }, (_, index) => Array.from({ length: 50 }, () => String(index)));
    resultsGetMock.mockResolvedValueOnce({ schemaVersion: 1, headerRows: headers, rows: studentRows });

    await exportSatRawdataVerbal('sat exam', 'schedule/1');

    expect(resultsGetMock).toHaveBeenCalledWith('/v1/results/sat/export/rawdata-verbal?examId=sat+exam&scheduleId=schedule%2F1');
    expect(downloadCsvRowsMock).toHaveBeenCalledOnce();
    const [, downloadedRows] = downloadCsvRowsMock.mock.calls[0] as [string, string[][]];
    expect(downloadedRows).toHaveLength(103);
    expect(downloadedRows.slice(0, 2)).toEqual(headers);
    expect(downloadedRows.slice(2)).toEqual(studentRows);
  });

  it('rejects malformed rows before starting a download', async () => {
    resultsGetMock.mockResolvedValueOnce({ schemaVersion: 1, headerRows: headers, rows: [['too short']] });

    await expect(exportSatRawdataVerbal('sat-1', 'schedule-1')).rejects.toThrow('rows are invalid');
    expect(downloadCsvRowsMock).not.toHaveBeenCalled();
  });

  it('rejects unknown schema versions before starting a download', async () => {
    resultsGetMock.mockResolvedValueOnce({ schemaVersion: 2, headerRows: headers, rows: [] });

    await expect(exportSatRawdataVerbal('sat-1', 'schedule-1')).rejects.toThrow('version is not supported');
    expect(downloadCsvRowsMock).not.toHaveBeenCalled();
  });
});
