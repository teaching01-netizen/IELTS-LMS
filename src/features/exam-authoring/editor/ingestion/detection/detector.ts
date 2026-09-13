/**
 * Phase 01 — payload classifier stub (phase 02/06 entry point).
 *
 * The pipeline's RawSource.kinds already carry the host classification, so
 * this stub only names the decision for observability; real heuristics land
 * in the adapter phases.
 */
import type { RawSource } from "../application/pipeline";

export type SourceKind = "text" | "html" | "file" | "empty";

export function detectSourceKind(source: RawSource): SourceKind {
  if (source.kinds.includes("html") && typeof source.html === "string") {
    return "html";
  }
  if (source.kinds.includes("text") && typeof source.text === "string") {
    return "text";
  }
  if (source.kinds.includes("file")) return "file";
  return "empty";
}
