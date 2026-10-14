import type { DraftTable } from "./draft";
import { tableCsv, tableTsv } from "./tsv";

export type ExportFormat = "tsv" | "csv" | "json";

export interface ExportedFile {
  filename: string;
  mime: string;
  text: string;
}

const MIME: Record<ExportFormat, string> = {
  tsv: "text/tab-separated-values;charset=utf-8",
  csv: "text/csv;charset=utf-8",
  json: "application/json;charset=utf-8",
};

/** Serializes one table for download. TSV/CSV carry 0..N-1 headers and re-import unchanged. */
export function exportTable(table: DraftTable, format: ExportFormat, baseName: string): ExportedFile {
  const text =
    format === "tsv" ? tableTsv(table) : format === "csv" ? tableCsv(table) : JSON.stringify(table, null, 2);
  return { filename: `${baseName}.${format}`, mime: MIME[format], text: `${text}\n` };
}

/** Triggers a browser download of `file`. */
export function downloadExport(file: ExportedFile): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
