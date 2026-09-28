import { downloadCsvRows } from '../../../utils/csvExport';
import { resultsGateway } from '../infrastructure/resultsGateway';

const SAT_RAWDATA_SCHEMA_VERSION = 1;
const SAT_RAWDATA_COLUMN_COUNT = 50;

type SatRawdataVerbalPayload = {
  schemaVersion: number;
  headerRows: string[][];
  rows: string[][];
};

function isStringRow(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length === SAT_RAWDATA_COLUMN_COUNT
    && value.every((cell) => typeof cell === 'string');
}

function parsePayload(value: unknown): SatRawdataVerbalPayload {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The SAT RAWDATA export response is invalid.');
  }
  const payload = value as { schemaVersion?: unknown; headerRows?: unknown; rows?: unknown };
  if (payload.schemaVersion !== SAT_RAWDATA_SCHEMA_VERSION) {
    throw new Error('This SAT RAWDATA export version is not supported.');
  }
  if (!Array.isArray(payload.headerRows) || payload.headerRows.length !== 2 || !payload.headerRows.every(isStringRow)) {
    throw new Error('The SAT RAWDATA export headers are invalid.');
  }
  if (!Array.isArray(payload.rows) || !payload.rows.every(isStringRow)) {
    throw new Error('The SAT RAWDATA export rows are invalid.');
  }
  return {
    schemaVersion: SAT_RAWDATA_SCHEMA_VERSION,
    headerRows: payload.headerRows,
    rows: payload.rows,
  };
}

export async function exportSatRawdataVerbal(examId: string, scheduleId: string): Promise<void> {
  const params = new URLSearchParams({ examId, scheduleId });
  const response = await resultsGateway.get<unknown>(`/v1/results/sat/export/rawdata-verbal?${params.toString()}`);
  const payload = parsePayload(response);
  const filename = `sat-rawdata-verbal-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadCsvRows(filename, [...payload.headerRows, ...payload.rows]);
}
