/**
 * Phase 01 — application barrel.
 */
export type { PipelineContext, IngestionCapabilities } from "./pipelineContext";
export {
  createPipelineContext,
  DEFAULT_PIPELINE_FLAGS,
} from "./pipelineContext";
export type { PipelineDeps, RawFileRef, RawSource } from "./pipeline";
export { ImportNotImplemented, runIngestionPipeline } from "./pipeline";
