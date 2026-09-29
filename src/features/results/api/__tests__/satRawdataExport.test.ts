import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
const downloadCsvRows = vi.hoisted(() => vi.fn());

vi.mock('../../infrastructure/resultsGateway', () => ({ resultsGateway: { get } }));
vi.mock('../../../../utils/csvExport', () => ({ downloadCsvRows }));

import { downloadSatRawdataCsv, satRawdataExportFilename } from '../satRawdataExport';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-28T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('downloadSatRawdataCsv', () => {
  it('requests the scoped export and downloads a multi-header CSV', async () => {
    get.mockResolvedValue({
      schemaVersion: 1,
      examId: 'exam-1',
      scheduleId: 'schedule-1',
      columnCount: 50,
      rowCount: 2,
      headerRows: [['A', 'B'], ['email', 'Percentage']],
      rows: [['a@example.com', '50%'], ['', '']],
    });

    await expect(downloadSatRawdataCsv('exam-1', 'schedule-1', 'Practice Test 06')).resolves.toBe(2);

    expect(get).toHaveBeenCalledWith(
      '/v1/results/sat/export/rawdata?examId=exam-1&scheduleId=schedule-1',
    );
    expect(downloadCsvRows).toHaveBeenCalledWith(
      'sat-rawdata-practice-test-06-2026-09-28.csv',
      [['A', 'B'], ['email', 'Percentage']],
      [['a@example.com', '50%'], ['', '']],
    );
  });

  it('encodes ids and falls back to a title-less filename', async () => {
    get.mockResolvedValue({
      schemaVersion: 1,
      examId: 'exam 1',
      scheduleId: 'sched/1',
      columnCount: 50,
      rowCount: 0,
      headerRows: [[], []],
      rows: [],
    });

    await expect(downloadSatRawdataCsv('exam 1', 'sched/1')).resolves.toBe(0);

    expect(get).toHaveBeenCalledWith(
      '/v1/results/sat/export/rawdata?examId=exam%201&scheduleId=sched%2F1',
    );
    expect(downloadCsvRows).toHaveBeenCalledWith('sat-rawdata-2026-09-28.csv', [[], []], []);
  });

  it('falls back to the row array length when rowCount is absent', async () => {
    get.mockResolvedValue({ schemaVersion: 1, headerRows: [[], []], rows: [['x'], ['y'], ['z']] });
    await expect(downloadSatRawdataCsv('exam-1', 'schedule-1')).resolves.toBe(3);
  });
});

describe('satRawdataExportFilename', () => {
  it('slugifies the exam title and stamps the date', () => {
    expect(satRawdataExportFilename('SAT Simulation Test (May - Aug 2026)', new Date('2026-09-28T00:00:00Z')))
      .toBe('sat-rawdata-sat-simulation-test-may-aug-2026-2026-09-28.csv');
    expect(satRawdataExportFilename(undefined, new Date('2026-09-28T00:00:00Z'))).toBe('sat-rawdata-2026-09-28.csv');
  });
});
