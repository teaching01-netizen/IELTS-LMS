/**
 * Phase 01 — markup adapter stub (real parsing lands in phase 02).
 */
import type { PipelineContext } from "../application/pipelineContext";
import type { RawSource } from "../application/pipeline";
import type { ImportResult } from "../domain/importResult";
import { ImportNotImplemented } from "../application/pipeline";
import type { SourceAdapter } from "./adapter";

export class HtmlAdapterStub implements SourceAdapter {
  readonly sourceKind = "html" as const;
  canHandle(source: RawSource): boolean {
    return source.kinds.includes("html") && typeof source.html === "string";
  }
  adapt(_source: RawSource, _ctx: PipelineContext): ImportResult {
    throw new ImportNotImplemented("html");
  }
}
