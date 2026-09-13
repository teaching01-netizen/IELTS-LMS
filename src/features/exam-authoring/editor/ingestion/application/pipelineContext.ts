/**
 * Phase 01 — pipeline context.
 *
 * Capabilities mirror the composer capability shape so later conversion can
 * filter per field without the pipeline destroying data early. The pipeline
 * only records intent for choice fields; filtering happens in conversion.
 */
export interface IngestionCapabilities {
  blockStyles: boolean;
  lists: boolean;
  underline: boolean;
  equation: boolean;
  image: boolean;
  table: boolean;
  code: boolean;
  history: boolean;
}

export interface PipelineContext {
  field: "prompt" | "stimulus" | "rationale" | "choice";
  sectionKey: "reading-writing" | "math";
  capabilities: IngestionCapabilities;
  flags: Record<string, boolean>;
}

export const DEFAULT_PIPELINE_FLAGS: Readonly<Record<string, boolean>> =
  Object.freeze({});

export function createPipelineContext(
  init: Partial<PipelineContext> & { field: PipelineContext["field"] },
): PipelineContext {
  return {
    sectionKey: init.sectionKey ?? "reading-writing",
    capabilities: init.capabilities ?? {
      blockStyles: true,
      lists: true,
      underline: true,
      equation: true,
      image: true,
      table: true,
      code: true,
      history: true,
    },
    flags: init.flags ?? {},
    field: init.field,
  };
}
