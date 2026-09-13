/**
 * Phase 01 — normalizer contract plus pure composition.
 *
 * Phase-02+ normalizers (sanitize, de-nest, cap, degrade) plug in here.
 * Composition preserves declaration order; each normalizer sees the output
 * of the previous one.
 */
import type { ImportDocument } from "../domain/importDocument";
import type { PipelineContext } from "../application/pipelineContext";

export interface Normalizer {
  readonly name: string;
  normalize(doc: ImportDocument, ctx: PipelineContext): ImportDocument;
}

export function composeNormalizers(...normalizers: Normalizer[]): Normalizer {
  return {
    name:
      normalizers.length === 0
        ? "identity"
        : normalizers.map((item) => item.name).join("+"),
    normalize(doc: ImportDocument, ctx: PipelineContext): ImportDocument {
      let current = doc;
      for (const normalizer of normalizers) {
        current = normalizer.normalize(current, ctx);
      }
      return current;
    },
  };
}

export class IdentityNormalizer implements Normalizer {
  readonly name = "identity";
  normalize(doc: ImportDocument, _ctx: PipelineContext): ImportDocument {
    return doc;
  }
}
