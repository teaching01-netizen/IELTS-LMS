import { useMemo } from "react";
import {
  resolveCoeditEnabled,
  usePromptCoediting,
  type CoeditClientCapability,
  type SatAuthoringCollaborationValue,
  type UsePromptCoeditingResult,
} from "../realtime/coedit";

/**
 * The co-edit SESSION: whether a prompt room may open at all, and the room hook
 * itself.
 *
 * WHY THIS EXISTS
 * ---------------
 * The gate order is a policy — server optimistic, every other gate checked
 * before we ask — and it used to be four declarations in the middle of the
 * workspace's render body, where two of them (the room flags) fed the
 * persistence owner several hundred lines later. It is one owner now, and the
 * workspace reads named values out.
 *
 * The exam-level room wins: when the route mounted `SatAuthoringCollaboration`,
 * `activeEditableDraft` stays false so a second question-scoped Hocuspocus room
 * cannot open beside it.
 */
export interface AuthoringCoeditSessionInput {
  /** The question whose prompt the room would own. */
  selectedExamQuestionId: string | null;
  /** Only admin/builder may write; everyone else is preview/read-only here. */
  writeCapableRole: boolean;
  /** The exam-level room, when the route mounted one. */
  workspaceCollaboration: SatAuthoringCollaborationValue | null;
}

export interface AuthoringCoeditSession {
  /** The prompt room hook: its session, status and binding. */
  coedit: UsePromptCoeditingResult;
  /** Every gate passed, including the server's. */
  coeditEnabled: boolean;
  /** A room really exists (its provider produced a session). */
  coeditRoomOpen: boolean;
  /** Co-edit chrome is active, including the pre-session preparation window. */
  coeditUiActive: boolean;
  /** The exam-level room is mounted for this session. */
  workspaceUiActive: boolean;
}

export function useAuthoringCoeditSession({
  selectedExamQuestionId,
  writeCapableRole,
  workspaceCollaboration,
}: AuthoringCoeditSessionInput): AuthoringCoeditSession {
  // `server` is optimistic on purpose: we cannot know the server posture until
  // we ask, and a server that cannot offer co-editing answers with a typed
  // unavailable error that the hook degrades into "disabled" without showing
  // the author anything. Every OTHER gate is checked before we ask at all.
  const coeditCapability = useMemo<CoeditClientCapability>(
    () => ({
      server: true,
      // Prompt co-editing is a product default now; no Vite flag is required
      // to expose the collaborative header/editor.
      frontendEnabled: true,
      // A selected question in the shell IS in the current editable draft
      // (the shell only ever exposes the draft); a published/replaced draft
      // de-selects it and the server refuses the token anyway.
      // The route-level exam workspace owns the selected question whenever the
      // SAT workspace provider is mounted. Keeping this false prevents a
      // second question-scoped Hocuspocus room from opening beside it.
      activeEditableDraft: Boolean(selectedExamQuestionId) && workspaceCollaboration === null,
      writeCapableRole,
    }),
    [selectedExamQuestionId, writeCapableRole, workspaceCollaboration]
  );
  const coeditEnabled = resolveCoeditEnabled(coeditCapability);
  const coedit = usePromptCoediting({
    examQuestionId: selectedExamQuestionId,
    capability: coeditCapability,
  });
  const workspaceUiActive = workspaceCollaboration !== null;
  const coeditRoomOpen = workspaceUiActive
    ? Boolean(workspaceCollaboration.workspaceSnapshot.ready)
    : coeditEnabled && coedit.session !== null;
  // This flag owns the co-edit-only chrome, including the short preparation
  // window before the provider has produced a session.
  const coeditUiActive = workspaceUiActive || (coeditEnabled && coedit.status !== "disabled");

  return { coedit, coeditEnabled, coeditRoomOpen, coeditUiActive, workspaceUiActive };
}
