import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { RichComposerCollaboration } from "../editor/RichQuestionComposer";
import {
  resolveAuthoringRealtimeFlags,
  resolveEffectiveCapabilities,
  type AuthoringCapabilities,
} from "../realtime";
import type {
  SatAuthoringCollaborationValue,
  UsePromptCoeditingResult,
  WorkspaceFieldBinding,
} from "../realtime/coedit";

/**
 * Placeholder binding used while a room is being opened: it renders the
 * composer's non-editable loading surface and claims nothing (no extensions,
 * not ready, not writable). The legacy editable editor must never mount for a
 * prompt that is about to move into a room.
 *
 * Module-private on purpose: it is a decision of the binding lookup below, not
 * a value any call site may pass around.
 */
const PENDING_PROMPT_COLLABORATION: RichComposerCollaboration = Object.freeze({
  extensions: [],
  ready: false,
  readOnly: true,
});

/**
 * The collaboration BRIDGE: what the workspace and its panels are told about
 * collaboration once session and transport exist.
 *
 * This owns exactly the decisions that were previously computed inline and
 * threaded through the render body as loose values:
 *
 *   - which capabilities are live (server grant narrowed by the local kill
 *     switch, and delivery narrowed further by an active exam room);
 *   - whether the open question counts as dirty for the realtime transport;
 *   - WHICH writer owns a field right now: the binding the composer receives,
 *     including the loading placeholder that keeps a soon-to-be-roomed prompt
 *     out of the legacy editor;
 *   - the per-field binding lookup the spine calls for the open question.
 *
 * Not a place for transport, and not a place for the session or the presence
 * roster either: the sockets, the reconciler and the query effects stay in
 * their own modules, the gates and the prompt room live in
 * `useAuthoringCoeditSession`, and "who else is here" lives in
 * `useAuthoringCollaborationPresence`. This hook answers one question: which
 * writer owns a field.
 */
export interface AuthoringCollaborationBridgeInput {
  workspaceUiActive: boolean;
  coeditEnabled: boolean;
  coedit: UsePromptCoeditingResult;
  workspaceCollaboration: SatAuthoringCollaborationValue | null;
  selectedExamQuestionId: string | null;
  /** `question/<examQuestionId>` for the open question, when one is selected. */
  workspaceQuestionPath: string | null;
  /** The persistence owner's answer: does the open question have unsaved work? */
  hasPendingChanges: boolean;
}

export interface AuthoringCollaborationBridge {
  /** The handshake widens the granted capability; nothing else writes this. */
  setServerCapabilities: Dispatch<SetStateAction<AuthoringCapabilities>>;
  effectiveCapabilities: AuthoringCapabilities;
  /** The LEGACY event socket may run: no room owns the exam, and it is granted. */
  realtimeDeliveryEnabled: boolean;
  isQuestionDirtyForRealtime: (examQuestionId: string) => boolean;
  /** The binding the prompt composer renders, or undefined for the legacy path. */
  promptCollaboration: RichComposerCollaboration | undefined;
  /** The open question's binding for one field path, when a room owns it. */
  workspaceFieldCollaboration: (fieldPath: string) => WorkspaceFieldBinding | null;
}

export function useAuthoringCollaborationBridge({
  workspaceUiActive,
  coeditEnabled,
  coedit,
  workspaceCollaboration,
  selectedExamQuestionId,
  workspaceQuestionPath,
  hasPendingChanges,
}: AuthoringCollaborationBridgeInput): AuthoringCollaborationBridge {
  const realtimeFlags = useMemo(
    () => resolveAuthoringRealtimeFlags(import.meta.env as Record<string, unknown>),
    []
  );
  // The server posture starts pessimistic-until-asked: a socket that cannot
  // deliver must not be rendered as if it could, and the handshake widens this.
  const [serverCapabilities, setServerCapabilities] = useState<AuthoringCapabilities>({
    delivery: true,
    presence: false,
    conflictCompare: false,
  });
  // Server OFF always wins; the local kill switch can only narrow further.
  const effectiveCapabilities = useMemo(
    () => resolveEffectiveCapabilities(serverCapabilities, realtimeFlags),
    [serverCapabilities, realtimeFlags]
  );
  // The exam-level room is the single realtime transport for SAT authoring.
  // Starting the legacy event socket beside it creates a second connection
  // that is intentionally refused by the default server posture and adds
  // noisy console failures. Non-workspace authoring keeps the old path.
  const realtimeDeliveryEnabled = !workspaceUiActive && effectiveCapabilities.delivery;
  const isQuestionDirtyForRealtime = useCallback(
    (examQuestionId: string) => examQuestionId === selectedExamQuestionId && hasPendingChanges,
    [selectedExamQuestionId, hasPendingChanges]
  );
  // While the token round-trip and initial sync are in flight the prompt must
  // NOT be an editable legacy editor: the room is about to own it, and text
  // typed into an editor that is destroyed a moment later never reaches the
  // Y.Doc (the room seeds from the stored projection). A placeholder binding
  // keeps the composer on its non-editable loading surface until the real one
  // arrives; it carries no save truth and claims no ownership.
  const workspacePromptBinding = useMemo(() => {
    if (!workspaceCollaboration || !selectedExamQuestionId) return null;
    const binding = workspaceCollaboration.fieldBinding(
      `question/${selectedExamQuestionId}/prompt`
    );
    return (
      binding ??
      (workspaceCollaboration.status === "preparing" || workspaceCollaboration.status === "error"
        ? PENDING_PROMPT_COLLABORATION
        : null)
    );
  }, [selectedExamQuestionId, workspaceCollaboration]);
  const coeditBinding = workspaceUiActive
    ? null
    : (coedit.collaboration ??
      (coeditEnabled && (coedit.status === "preparing" || coedit.status === "error")
        ? PENDING_PROMPT_COLLABORATION
        : null));
  // Effective binding for the composer: only when co-editing actually took
  // over. A server-disabled posture renders the legacy editor; a connection
  // error stays on the read-only recovery surface so it cannot create a second
  // prompt writer beside an active room.
  const promptCollaboration = workspaceUiActive
    ? (workspacePromptBinding ?? undefined)
    : coeditEnabled && coedit.status !== "disabled"
      ? (coeditBinding ?? undefined)
      : undefined;
  const workspaceFieldCollaboration = useCallback(
    (fieldPath: string) => {
      if (!workspaceCollaboration || !workspaceQuestionPath) return null;
      return workspaceCollaboration.fieldBinding(`${workspaceQuestionPath}/${fieldPath}`);
    },
    [workspaceCollaboration, workspaceQuestionPath]
  );

  return {
    setServerCapabilities,
    effectiveCapabilities,
    realtimeDeliveryEnabled,
    isQuestionDirtyForRealtime,
    promptCollaboration,
    workspaceFieldCollaboration,
  };
}
