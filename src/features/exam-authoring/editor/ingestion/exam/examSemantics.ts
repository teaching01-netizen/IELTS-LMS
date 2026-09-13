/**
 * Phase 01 — exam-semantic hook (no-op stub).
 *
 * Phase 08 consumes this interface for choice detection, SPR proposal, and
 * stimulus/prompt splitting. The phase-01 pipeline intentionally leaves the
 * document untouched so downstream opt-in stays additive.
 */
import type { ImportDocument } from "../domain/importDocument";
import type { PipelineContext } from "../application/pipelineContext";

export interface ExamSemanticSlice {
  readonly name: string;
  apply(doc: ImportDocument, ctx: PipelineContext): ImportDocument;
}

export class NoopExamSemantics implements ExamSemanticSlice {
  readonly name = "noop-exam-semantics";
  apply(doc: ImportDocument, _ctx: PipelineContext): ImportDocument {
    return doc;
  }
}
