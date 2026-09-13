/**
 * Phase 01 — text adapter stub (real parsing lands in phase 02).
 */
import type { PipelineContext } from "../application/pipelineContext";
import type { RawSource } from "../application/pipeline";
import type { ImportResult } from "../domain/importResult";
import { ImportNotImplemented } from "../application/pipeline";
import type { SourceAdapter } from "./adapter";

export class TextAdapterStub implements SourceAdapter {
  readonly sourceKind = "text" as const;
  canHandle(source: RawSource): boolean {
    return source.kinds.includes("text") && typeof source.text === "string";
  }
  adapt(_source: RawSource, _ctx: PipelineContext): ImportResult {
    throw new ImportNotImplemented("text");
  }
}
