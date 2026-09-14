import { describe, expect, it } from "vitest";
import type { CoeditCollaborator } from "../../../realtime/coedit";
import { colorForActor } from "../../../realtime/coedit";
import type { AuthoringPresence } from "../../../realtime/presenceTypes";
import {
  mergeCollaborationParticipants,
  participantFromWorkspacePresence,
  selfParticipant,
} from "../collaborationParticipants";

function workspacePresence(overrides: Partial<AuthoringPresence> = {}): AuthoringPresence {
  return {
    connectionId: "presence-1",
    userId: "actor-alice",
    displayName: "Alice Workspace",
    examId: "exam-1",
    draftVersionId: "draft-1",
    selectedQuestionId: "eq-2",
    state: "viewing",
    lastSeenAt: "2026-09-13T12:00:00.000Z",
    ...overrides,
  };
}

function roomCollaborator(overrides: Partial<CoeditCollaborator> = {}): CoeditCollaborator {
  return {
    clientId: 2,
    actorId: "actor-alice",
    name: "Alice Room",
    color: colorForActor("actor-alice"),
    isSelf: false,
    ...overrides,
  };
}

describe("normalized collaboration participants", () => {
  it("includes self first and keeps the active room as the only source when workspace presence is unavailable", () => {
    const self = selfParticipant(
      { actorId: "actor-self", displayName: "Ada", color: colorForActor("actor-self") },
      "fallback-self",
      "eq-1",
    );
    const participants = mergeCollaborationParticipants({
      self,
      room: [roomCollaborator()],
      workspace: [],
      selectedQuestionId: "eq-1",
    });

    expect(participants.map((participant) => participant.id)).toEqual(["actor-self", "actor-alice"]);
    expect(participants[0]).toMatchObject({ isSelf: true, displayName: "Ada", selectedQuestionId: "eq-1" });
  });

  it("deduplicates by actor/user id and prefers the room identity", () => {
    const participants = mergeCollaborationParticipants({
      self: selfParticipant(
        { actorId: "actor-self", displayName: "Ada", color: colorForActor("actor-self") },
        null,
        "eq-1",
      ),
      room: [
        roomCollaborator(),
        roomCollaborator({ clientId: 3, actorId: "actor-self", isSelf: true, name: "Ada Room" }),
      ],
      workspace: [workspacePresence()],
      selectedQuestionId: "eq-1",
    });

    expect(participants).toHaveLength(2);
    expect(participants.find((participant) => participant.id === "actor-alice")).toMatchObject({
      displayName: "Alice Room",
      color: colorForActor("actor-alice"),
    });
    expect(participants.find((participant) => participant.id === "actor-self")).toMatchObject({
      isSelf: true,
      displayName: "Ada",
    });
  });

  it("uses one deterministic palette for workspace participants too", () => {
    const first = participantFromWorkspacePresence(workspacePresence());
    const second = participantFromWorkspacePresence(workspacePresence({ connectionId: "presence-2" }));
    expect(first.color).toBe(colorForActor("actor-alice"));
    expect(second.color).toBe(first.color);
    expect(first.initials).toBe("AW");
  });
});
