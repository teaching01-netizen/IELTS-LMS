/**
 * Phase 01 — source adapter contract.
 *
 * Later phases (02-06) implement this for text, markup, sheets, bytes, and
 * viewer selections. Selection among adapters is deterministic: adapters are
 * sorted by source rank and the first whose canHandle passes wins.
 */
import type { ImportMetadata } from "../domain/importDocument";
import type { ImportResult } from "../domain/importResult";
import type { PipelineContext } from "../application/pipelineContext";
import type { RawSource } from "../application/pipeline";

export interface SourceAdapter {
  readonly sourceKind: ImportMetadata["source"];
  canHandle(source: RawSource): boolean;
  adapt(source: RawSource, ctx: PipelineContext): ImportResult;
}
