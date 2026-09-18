// Prompt co-editing: the only frontend package that imports Yjs, Hocuspocus,
// or y-indexeddb. Everything else consumes the domain types below.
export type {
  CoeditClientCapability,
  CoeditCollaborator,
  CoeditConnectionPhase,
  CoeditDecimalString,
  CoeditDurabilityMetadata,
  CoeditFlushOutcome,
  CoeditFlushResult,
  CoeditLifecycleOperation,
  CoeditLifecycleMessage,
  CoeditLifecycleIssue,
  CoeditLifecyclePhase,
  CoeditPhase1Reason,
  CoeditRecovery,
  CoeditSaveFailureMessage,
  CoeditSaveState,
  CoeditSaveStateName,
  CoeditSelfIdentity,
  CoeditStaleCacheExport,
  CoeditTokenResponse,
  PromptCoeditingSession,
} from "./contracts";
export {
  COEDIT_EPOCH_MISMATCH_REASON,
  COEDIT_FINAL_STORE_REQUIRED_REASON,
  COEDIT_FREEZE_CONFLICT_REASON,
  COEDIT_OVERSIZED_REASON,
  COEDIT_PHASE1_REASONS,
  COEDIT_STALE_CACHE_MESSAGE,
  COEDIT_SEED_CONFLICT_REASON,
  COEDIT_STALE_CACHE_REASON,
  COEDIT_WRITE_REFUSED_REASON,
  INITIAL_SAVE_STATE,
  coeditRecoveryFromSaveFailure,
  colorForActor,
  parseCoeditSaveFailureMessage,
  parseCoeditLifecycleMessage,
  resolveCoeditEnabled,
  isCoeditDecimalString,
  isCoeditLifecycleOperation,
  isCoeditPhase1Reason,
  parseCoeditDurabilityMetadata,
} from "./contracts";
export {
  COEDIT_DOCUMENT_PREFIX,
  parseCoeditDocumentName,
  type ParsedDocumentName,
} from "./documentIdentity";
export {
  COEDIT_STALE_CACHE_EPOCH_WINDOW,
  attachIndexedDbPersistence,
  auditEpochCaches,
  clearEpochCache,
  coeditCacheName,
  coeditContentFingerprint,
  coeditStaleCacheNames,
  type CoeditLocalPersistence,
  type CoeditStaleCacheAudit,
  type CoeditStaleCacheReport,
} from "./indexedDbPersistence";
export { compareCoeditDecimalStrings } from "./protocol";
export {
  renderCaretLabel,
  collaborationExtensions,
  isCollaborativeTransaction,
  type CollaborativeTransactionLike,
} from "./editorBinding";
export {
  PromptCoeditProvider,
  COEDIT_LOCAL_REPLAY_GRACE_MS,
  COEDIT_TOKEN_REFRESH_INTERVAL_MS,
  type CoeditChangeReason,
  type PromptCoeditProviderOptions,
  type PromptCoeditSnapshot,
} from "./provider";
export { resolveFieldWriter, type FieldWriter, type FieldWriterInput } from "./fieldWriter";
export { encodeStateVectorBase64, toBase64 } from "./stateVector";
export { deriveSaveState } from "./saveState";
export {
  COEDIT_FIELD_PATCH_KEYS,
  isPromptOnlyChange,
  promptFreeFieldPatch,
  promptFreeFieldsChangedSince,
  remotelyBlockedFields,
  savePromptFreeFields,
  type CoeditFieldPatchKey,
  type PromptFreeSaveDeps,
  type PromptFreeSaveInput,
} from "./fieldPatch";
export {
  CoeditNoEditableDraftError,
  CoeditUnavailableError,
  requestCoeditToken,
  requestWorkspaceCoeditToken,
} from "./tokenApi";
export {
  SAT_WORKSPACE_COMMANDS,
  createSatWorkspaceCommand,
  isSatWorkspaceCommandName,
  parseSatWorkspaceCommand,
  type SatWorkspaceCommand,
  type SatWorkspaceCommandName,
} from "./workspaceCommands";
export {
  MAX_WORKSPACE_SEED_FRAME_BYTES,
  MAX_WORKSPACE_SEED_ID_LENGTH,
  MAX_WORKSPACE_SEED_PATH_LENGTH,
  MAX_WORKSPACE_SEED_VALUE_BYTES,
  WORKSPACE_SEED_RESULT_TYPE,
  WorkspaceSeedValidationError,
  createWorkspaceSeedFrame,
  createWorkspaceSeedResultFrame,
  isWorkspaceSeedFrame,
  parseWorkspaceSeedFrame,
  parseWorkspaceSeedResultFrame,
  workspaceSeedId,
  workspaceSeedPathRoot,
  type ParseWorkspaceSeedOptions,
  type WorkspaceSeedFrame,
  type WorkspaceSeedInput,
  type WorkspaceSeedOutcome,
  type WorkspaceSeedResultFrame,
  type WorkspaceSeedRoot,
} from "./workspaceSeed";
export {
  SatAuthoringWorkspaceProvider,
  type WorkspaceCoeditSnapshot,
  type WorkspaceCoeditingStatus,
  type WorkspaceFieldBinding,
  type WorkspaceProviderDeps,
  type WorkspaceRecovery,
} from "./workspaceProvider";
export {
  SatAuthoringCollaborationProvider,
  useRequiredSatAuthoringCollaboration,
  useSatAuthoringCollaboration,
  type SatAuthoringCollaborationValue,
} from "./useSatAuthoringCollaboration";
// The command/acknowledgement invalidation helpers that used to live beside
// this boundary are now authoringEffects.applyWorkspaceCommand /
// applyWorkspaceAcknowledgement: the boundary owns transport, the effects layer
// owns which projections an event invalidates.
export { SatAuthoringCollaborationBoundary } from "./SatAuthoringCollaborationBoundary";
export {
  usePromptCoediting,
  type CoeditingComposerBinding,
  type PromptCoeditingStatus,
  type UsePromptCoeditingOptions,
  type UsePromptCoeditingResult,
} from "./usePromptCoediting";
