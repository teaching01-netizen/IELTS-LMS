/**
 * Phase 01 — typed ingestion telemetry (shape-only, no content fields).
 *
 * Events carry counts, codes, latencies, and routing — never pasted text,
 * markup, file bytes, filenames, or URLs. The sink is a no-op; real backend
 * wiring lands in phase 10.
 */
import type { DiagnosticCode } from "../domain/importResult";

export type IngestionEventName =
  | "ingestion.started"
  | "ingestion.parsed"
  | "ingestion.inserted"
  | "ingestion.undone"
  | "ingestion.warning";

export interface IngestionEventBase {
  name: IngestionEventName;
  field: "prompt" | "stimulus" | "rationale" | "choice";
  sectionKey: "reading-writing" | "math";
}

export interface IngestionStartedEvent extends IngestionEventBase {
  name: "ingestion.started";
  sourceKind: string;
}

export interface IngestionParsedEvent extends IngestionEventBase {
  name: "ingestion.parsed";
  nodeCount: number;
  tableCells: number;
  images: number;
  equations: number;
  parseMs: number;
  codes: DiagnosticCode[];
}

export interface IngestionInsertedEvent extends IngestionEventBase {
  name: "ingestion.inserted";
  nodeCount: number;
  parseMs: number;
}

export interface IngestionUndoneEvent extends IngestionEventBase {
  name: "ingestion.undone";
  parseMs: number;
}

export interface IngestionWarningEvent extends IngestionEventBase {
  name: "ingestion.warning";
  codes: DiagnosticCode[];
}

export type IngestionEvent =
  | IngestionStartedEvent
  | IngestionParsedEvent
  | IngestionInsertedEvent
  | IngestionUndoneEvent
  | IngestionWarningEvent;

export type IngestionEventSink = (event: IngestionEvent) => void;

const noopSink: IngestionEventSink = () => undefined;

let sink: IngestionEventSink = noopSink;

export function setIngestionEventSink(next: IngestionEventSink): void {
  sink = next;
}

export function resetIngestionEventSink(): void {
  sink = noopSink;
}

export function emitIngestionEvent(event: IngestionEvent): void {
  sink(event);
}
