import { useCallback, useEffect, useMemo, type RefObject } from "react";
import type { AssessmentAuthoringShell } from "../contracts/assessment";
import {
  useAuthoringPresence,
  type AuthoringConnectionState,
  type AuthoringPresence,
} from "../realtime";
import {
  colorForActor,
  type SatAuthoringCollaborationValue,
  type UsePromptCoeditingResult,
} from "../realtime/coedit";
import {
  mergeCollaborationParticipants,
  selfParticipant,
} from "./collaboration/collaborationParticipants";
import { questionLabel } from "./collaboration/collaborationCopy";

/**
 * Who else is here, and what the spine is told about them.
 *
 * The presence CHANNEL is `realtime/useAuthoringPresence`; this hook is the
 * workspace-facing half of it: it mounts the channel with the connection facts,
 * merges the three rosters that can name a collaborator (the exam room, the
 * prompt room, the presence channel), keeps the late-bound seams current (the
 * realtime client is created before this hook exists, so the frame handler and
 * the roster reach it through refs), and derives the labels the header shows.
 *
 * Live region, roster merge and label derivation were three unrelated bits of
 * the render body before this hook existed; they are one question — "who is
 * here, and what do we call them?"
 */
export interface AuthoringCollaborationPresenceInput {
  shell: AssessmentAuthoringShell | undefined;
  selectedExamQuestionId: string | null;
  /** The autosave-defined dirty flag; presence derives from a save, not a keystroke. */
  isQuestionDirty: boolean;
  /** Effective presence capability: server grant ANDed with the local kill switch. */
  enabled: boolean;
  connectionState: AuthoringConnectionState;
  sendFrame: (frame: unknown) => boolean;
  selfConnectionId: string | null;
  workspaceCollaboration: SatAuthoringCollaborationValue | null;
  coeditUiActive: boolean;
  coeditSession: UsePromptCoeditingResult["session"];
  /** A publish close freezes the author into viewing, not editing. */
  publishedFrozen: boolean;
  /** This tab's own identity, resolved from the auth session. */
  self: { actorId: string | null; displayName: string };
  /** Seam the realtime mount feeds raw presence frames into. */
  presenceFrameRef: RefObject<(raw: unknown) => void>;
  /** Seam the realtime seams read collaborator names from at call time. */
  presenceRosterRef: RefObject<readonly AuthoringPresence[]>;
}

export interface AuthoringCollaborationPresence {
  presence: ReturnType<typeof useAuthoringPresence>;
  /** Who the collaborator stack renders, from all three rosters. */
  collaborationParticipants: ReturnType<typeof mergeCollaborationParticipants>;
  /** "Question 3" for an exam-question id, or null when it is not in the shell. */
  labelForQuestion: (examQuestionId: string) => string | null;
  selectedQuestionLabel: string | null;
  /** The first other author editing the open question, if any. */
  editorHere: AuthoringPresence | null;
}

export function useAuthoringCollaborationPresence({
  shell,
  selectedExamQuestionId,
  isQuestionDirty,
  enabled,
  connectionState,
  sendFrame,
  selfConnectionId,
  workspaceCollaboration,
  coeditUiActive,
  coeditSession,
  publishedFrozen,
  self,
  presenceFrameRef,
  presenceRosterRef,
}: AuthoringCollaborationPresenceInput): AuthoringCollaborationPresence {
  const staffActorId = self.actorId;
  const presence = useAuthoringPresence({
    draftVersionId: shell?.versionId ?? null,
    selectedExamQuestionId,
    isDirty: isQuestionDirty,
    enabled,
    connectionState,
    sendFrame,
    selfConnectionId,
  });
  const collaborationParticipants = useMemo(
    () =>
      workspaceCollaboration
        ? workspaceCollaboration.participants
        : mergeCollaborationParticipants({
            self: coeditUiActive
              ? selfParticipant(
                  coeditSession?.self ?? {
                    actorId: staffActorId ?? "self",
                    displayName: self.displayName,
                    color: colorForActor(staffActorId ?? "self"),
                  },
                  staffActorId,
                  selectedExamQuestionId,
                  coeditSession?.readOnly || publishedFrozen ? "viewing" : "editing"
                )
              : null,
            room: coeditSession?.collaborators ?? [],
            workspace: enabled ? presence.occupants : [],
            selectedQuestionId: selectedExamQuestionId,
          }),
    [
      coeditSession?.collaborators,
      coeditSession?.readOnly,
      coeditSession?.self,
      coeditUiActive,
      enabled,
      presence.occupants,
      publishedFrozen,
      selectedExamQuestionId,
      staffActorId,
      self.displayName,
      workspaceCollaboration,
    ]
  );
  useEffect(() => {
    presenceFrameRef.current = presence.handlePresenceFrame;
  }, [presence.handlePresenceFrame, presenceFrameRef]);
  useEffect(() => {
    presenceRosterRef.current = presence.occupants;
  }, [presence.occupants, presenceRosterRef]);

  const labelForQuestion = useCallback(
    (examQuestionId: string): string | null => {
      for (const section of shell?.sections ?? []) {
        for (const module of section.modules) {
          const index = module.questions.findIndex((q) => q.examQuestionId === examQuestionId);
          if (index >= 0) return questionLabel(index);
        }
      }
      return null;
    },
    [shell]
  );
  const selectedQuestionLabel = selectedExamQuestionId
    ? labelForQuestion(selectedExamQuestionId)
    : null;
  const editorHere = presence.editorsHere[0] ?? null;

  return {
    presence,
    collaborationParticipants,
    labelForQuestion,
    selectedQuestionLabel,
    editorHere,
  };
}
