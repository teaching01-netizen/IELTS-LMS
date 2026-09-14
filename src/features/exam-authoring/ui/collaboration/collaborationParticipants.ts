import type { CoeditCollaborator, CoeditSelfIdentity } from "../../realtime/coedit/contracts";
import { colorForActor } from "../../realtime/coedit/contracts";
import { displayNameOf } from "../../realtime/presenceChannel";
import type { AuthoringPresence, PresenceState } from "../../realtime/presenceTypes";

export type CollaborationParticipantState = "editing" | "idle" | "viewing";

export interface CollaborationParticipant {
  id: string;
  displayName: string;
  initials: string;
  color: string;
  state: CollaborationParticipantState;
  isSelf: boolean;
  selectedQuestionId?: string;
}

export function participantInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function selectedQuestionId(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizedState(state: PresenceState): CollaborationParticipantState {
  return state;
}

export function participantFromWorkspacePresence(
  entry: AuthoringPresence,
): CollaborationParticipant {
  const displayName = displayNameOf(entry);
  const participant: CollaborationParticipant = {
    id: entry.userId || `presence:${entry.connectionId}`,
    displayName,
    initials: participantInitials(displayName),
    color: colorForActor(entry.userId || entry.connectionId),
    state: normalizedState(entry.state),
    isSelf: false,
  };
  const questionId = selectedQuestionId(entry.selectedQuestionId);
  if (questionId) participant.selectedQuestionId = questionId;
  return participant;
}

export function participantFromCoedit(
  entry: CoeditCollaborator,
  selectedQuestionIdValue?: string | null,
): CollaborationParticipant {
  const displayName = entry.name.trim() || "Collaborator";
  const id = entry.actorId?.trim() || `coedit:${entry.clientId}`;
  const participant: CollaborationParticipant = {
    id,
    displayName,
    initials: participantInitials(displayName),
    color: colorForActor(entry.actorId?.trim() || id),
    state: "editing",
    isSelf: entry.isSelf,
  };
  const questionId = selectedQuestionId(selectedQuestionIdValue ?? entry.selectedQuestionId);
  if (questionId) participant.selectedQuestionId = questionId;
  return participant;
}

export function selfParticipant(
  identity: CoeditSelfIdentity | null,
  fallbackId: string | null,
  selectedQuestionIdValue: string | null,
  state: CollaborationParticipantState = "editing",
): CollaborationParticipant {
  const id = identity?.actorId?.trim() || fallbackId?.trim() || "self";
  const displayName = identity?.displayName?.trim() || "You";
  const participant: CollaborationParticipant = {
    id,
    displayName,
    initials: participantInitials(displayName),
    color: identity?.color || colorForActor(id),
    state,
    isSelf: true,
  };
  const questionId = selectedQuestionId(selectedQuestionIdValue);
  if (questionId) participant.selectedQuestionId = questionId;
  return participant;
}

/**
 * Combines the prompt room with the legacy workspace roster for display only.
 * The first source wins identity data: self, then the active prompt room, then
 * the legacy roster. That keeps actor/user IDs as the dedupe key without ever
 * inventing a participant for a different question.
 */
export function mergeCollaborationParticipants(input: {
  self: CollaborationParticipant | null;
  room: readonly CoeditCollaborator[];
  workspace: readonly AuthoringPresence[];
  selectedQuestionId?: string | null;
}): CollaborationParticipant[] {
  const result = new Map<string, CollaborationParticipant>();
  const add = (participant: CollaborationParticipant): void => {
    const existing = result.get(participant.id);
    if (!existing) {
      result.set(participant.id, participant);
      return;
    }
    if (existing.isSelf) return;
    if (existing.selectedQuestionId || !participant.selectedQuestionId) return;
    result.set(participant.id, { ...existing, selectedQuestionId: participant.selectedQuestionId });
  };

  if (input.self) add(input.self);
  for (const entry of input.room) {
    // The server normally supplies the actor id, but `isSelf` is already the
    // authoritative identity marker for older awareness payloads. Never add a
    // second avatar for the current user merely because that payload omitted
    // its actor id.
    if (entry.isSelf && input.self) continue;
    add(participantFromCoedit(entry, input.selectedQuestionId));
  }
  for (const entry of input.workspace) add(participantFromWorkspacePresence(entry));
  return [...result.values()];
}
