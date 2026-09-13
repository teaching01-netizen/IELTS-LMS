// Public surface of the SAT authoring realtime package. Editors and rails
// import from here (or not at all); transport internals stay private.

export * from "./contracts";
export { resolveAuthoringRealtimeFlags, resolveEffectiveCapabilities } from "./flags";
export {
  MAX_AUTHORING_FRAME_BYTES,
  parseAuthoringFrame,
  parseAuthoringEvent,
  classifyAuthoringEvent,
  shouldProcessCursor,
  dedupeByEventId,
  sortByCursor,
} from "./schemas";
export {
  createAuthoringEventState,
  reduceAuthoringFrame,
  seedAuthoringBaseline,
  advanceAuthoringCursor,
  type AuthoringReduceAction,
  type AuthoringReduceResult,
} from "./authoringEventReducer";
export {
  AuthoringRealtimeClient,
  buildAuthoringSocketUrl,
  computeAuthoringBackoffMs,
} from "./authoringRealtimeClient";
export {
  reconcileAuthoringEvent,
  questionTargetOf,
  affectedQuestionIdsOf,
  type ReconcileOutcome,
} from "./authoringCacheReconciler";
export { recoverAuthoringSnapshot, shellQuestionIds, type SnapshotRecoveryContext } from "./recovery";
export {
  COMPARE_FIELD_KEYS,
  canonicalStringify,
  classifyQuestionFields,
  documentContentEquals,
  fateOf,
  fieldSlice,
  hasLocalChanges,
  hasSameFieldConflict,
  isAutoMergeable,
  type CompareFieldKey,
  type FieldClassification,
  type FieldFate,
} from "./threeWayCompare";
export {
  applyDivergenceEvent,
  createDivergenceState,
  divergenceFor,
  isDiverged as isDivergedEntry,
  isQuestionDirty as isTrackedQuestionDirty,
  locallyEdited,
  statusOf,
  MAX_TRACKED_DIVERGENCES,
  type DivergenceState,
} from "./divergenceStore";
export {
  deriveDivergenceStatus,
  type DivergenceEvent,
  type DivergenceStatus,
  type QuestionDivergence,
  type RemoteChangeAuthor,
} from "./divergenceTypes";
export { decideRemoteUpdate, type RemoteUpdateDecision } from "./remoteUpdatePolicy";
export {
  authorNameOf,
  decideDeletionRace,
  decideMoveRace,
  decidePublishRace,
  decideReconnect,
  sameQuestionEditors,
  type RaceRecoveryAction,
} from "./raceRecovery";
export {
  PRESENCE_BADGE_MAX,
  PRESENCE_IDLE_MS,
  PRESENCE_STACK_MAX,
  PRESENCE_SWEEP_MS,
  PRESENCE_THROTTLE_MS,
  PRESENCE_TTL_MS,
  authorForActor,
  coalescePresence,
  displayNameOf,
  editorsOf,
  excludeSelf,
  expirePresence,
  filterDraft,
  mergePresence,
  occupantsOf,
  shouldSend,
  withSelection,
} from "./presenceChannel";
export {
  PRESENCE_STATES,
  buildPresenceFrame,
  derivePresenceState,
  parsePresenceBroadcast,
  type AuthoringPresence,
  type PresenceFrame,
  type PresenceIntent,
  type PresenceState,
} from "./presenceTypes";
export {
  CONNECTION_COPY,
  FORBIDDEN_COPY_FRAGMENTS,
  connectionCopyFor,
  copyLeaksTransportDetail,
  saveStatusCopy,
} from "./connectionCopy";
export { useAuthoringRealtime } from "./useAuthoringRealtime";
export {
  useQuestionDivergence,
  type UseQuestionDivergenceOptions,
  type UseQuestionDivergenceResult,
} from "./useQuestionDivergence";
export { useAuthoringPresence } from "./useAuthoringPresence";
// Phase 06 intentionally exports no client metric or trace module: this repo has
// no client telemetry ingestion path, so browser counters would be an in-memory
// subsystem nobody reads. Freshness is measured server-side
// (authoring_resync_total{reason}), which is where the resync is decided.
