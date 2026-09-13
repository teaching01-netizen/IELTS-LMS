/**
 * Phase 01 — conversion stub.
 *
 * ImportDocument to StructuredContent v2 JSON builders land in phase 07.
 * The stub keeps the boundary explicit: the pipeline never converts, the
 * applicator calls conversion separately. JSON here means plain data; no
 * editor instance is constructed.
 */
import type { ImportDocument } from "../domain/importDocument";
import { ImportNotImplemented } from "../application/pipeline";

export interface StructuredContentJson {
  version: 2;
  doc: unknown;
}

export function importDocumentToStructuredContent(
  _doc: ImportDocument,
): StructuredContentJson {
  throw new ImportNotImplemented("conversion/toStructuredContent");
}
