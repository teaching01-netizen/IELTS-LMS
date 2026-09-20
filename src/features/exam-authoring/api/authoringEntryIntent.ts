/**
 * Public authoring-entry API for product routes.
 *
 * The implementation stays in the application layer; this module keeps
 * consumers outside the feature from reaching into that internal layer.
 */
export {
  AUTHORING_ENTRY_INTENT_TTL_MS,
  consumeAuthoringDraftOnEntry,
  peekAuthoringDraftOnEntry,
  requestAuthoringDraftOnEntry,
} from "../application/authoringEntryIntent";
