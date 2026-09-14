// Prompt co-editing: the only frontend package that imports Yjs, Hocuspocus,
// or y-indexeddb. Everything else consumes the domain types below.
export type {
  CoeditClientCapability,
  CoeditCollaborator,
  CoeditConnectionPhase,
  CoeditLifecycleMessage,
  CoeditLifecycleIssue,
  CoeditLifecyclePhase,
  CoeditRecovery,
  CoeditSaveFailureMessage,
  CoeditSaveState,
  CoeditSaveStateName,
  CoeditSelfIdentity,
  CoeditTokenResponse,
  PromptCoeditingSession,
} from "./contracts";
export {
  INITIAL_SAVE_STATE,
  colorForActor,
  parseCoeditSaveFailureMessage,
  parseCoeditLifecycleMessage,
  resolveCoeditEnabled,
} from "./contracts";
export {
  COEDIT_DOCUMENT_PREFIX,
  isSameDocument,
  parseCoeditDocumentName,
  type ParsedDocumentName,
} from "./documentIdentity";
export {
  VITE_AUTHORING_REALTIME_COEDITING,
  coeditFrontendEnabled,
  resolveCoeditFrontendFlag,
} from "./flags";
export { renderCaretLabel, promptCollaborationExtensions, collaborationExtensions } from "./editorBinding";
export {
  PromptCoeditProvider,
  COEDIT_TOKEN_REFRESH_INTERVAL_MS,
  type PromptCoeditProviderOptions,
  type PromptCoeditSnapshot,
} from "./provider";
export { stateVectorHash } from "./saveState";
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
export { requestCoeditToken, requestWorkspaceCoeditToken, scheduleTokenRefresh } from "./tokenApi";
export {
  SAT_WORKSPACE_COMMANDS,
  createSatWorkspaceCommand,
  isSatWorkspaceCommandName,
  parseSatWorkspaceCommand,
  type SatWorkspaceCommand,
  type SatWorkspaceCommandName,
} from "./workspaceCommands";
export {
  SatAuthoringWorkspaceProvider,
  type WorkspaceCoeditSnapshot,
  type WorkspaceCoeditingStatus,
  type WorkspaceFieldBinding,
  type WorkspaceRecovery,
} from "./workspaceProvider";
export {
  SatAuthoringCollaborationProvider,
  useRequiredSatAuthoringCollaboration,
  useSatAuthoringCollaboration,
  type SatAuthoringCollaborationValue,
} from "./useSatAuthoringCollaboration";
export {
  SatAuthoringCollaborationBoundary,
  invalidateForWorkspaceAcknowledgement,
  invalidateForWorkspaceCommand,
} from "./SatAuthoringCollaborationBoundary";
export {
  usePromptCoediting,
  type CoeditingComposerBinding,
  type PromptCoeditingStatus,
  type UsePromptCoeditingOptions,
  type UsePromptCoeditingResult,
} from "./usePromptCoediting";
