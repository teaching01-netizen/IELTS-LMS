/**
 * The shared workspace-command validator.
 *
 * Both halves of the relay use this module, so the rules are asserted once,
 * from both directions: a raw wire string (what the Hocuspocus service sees)
 * and an already-parsed value (what the browser provider sees after its
 * transport decoded it).
 */
import { describe, expect, it } from "vitest";
import {
  SAT_WORKSPACE_COMMANDS,
  createSatWorkspaceCommand,
  isSatWorkspaceCommandName,
  parseSatWorkspaceCommand,
} from "../workspaceCommands";

const DOCUMENT_NAME = "coedit:v2:9c2f5a44-1f6e-4c31-8b0d-77e0c2b41a53";

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "coedit.command",
    documentName: DOCUMENT_NAME,
    actorId: "actor-alice",
    commandId: "command-1",
    idempotencyKey: "command-1",
    command: "question.deleted",
    payload: { questionId: "q-1" },
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("workspace command envelopes", () => {
  it("parses the same command from a wire string and from a parsed value", () => {
    const raw = JSON.stringify(envelope());
    const fromWire = parseSatWorkspaceCommand(raw, { documentName: DOCUMENT_NAME });
    const fromValue = parseSatWorkspaceCommand(envelope(), { documentName: DOCUMENT_NAME });
    expect(fromWire).toEqual(fromValue);
    expect(fromWire?.command).toBe("question.deleted");
    expect(fromWire?.payload).toEqual({ questionId: "q-1" });
  });

  it("keeps an optional expected revision and drops an absent one", () => {
    const withRevision = parseSatWorkspaceCommand(
      envelope({ expectedWorkspaceRevision: "rev-9" }),
      {},
    );
    expect(withRevision?.expectedWorkspaceRevision).toBe("rev-9");
    expect("expectedWorkspaceRevision" in (parseSatWorkspaceCommand(envelope(), {}) ?? {})).toBe(
      false,
    );
  });

  it("binds the actor only when the caller has one to bind", () => {
    // The browser knows its own name but cannot vouch for it; the service binds
    // the signed identity, so a relayed notification cannot be somebody else's.
    expect(parseSatWorkspaceCommand(envelope(), { actorId: "actor-alice" })).not.toBeNull();
    expect(parseSatWorkspaceCommand(envelope(), { actorId: "actor-mallory" })).toBeNull();
    expect(parseSatWorkspaceCommand(envelope(), { actorId: "" })).not.toBeNull();
    expect(parseSatWorkspaceCommand(envelope(), {})).not.toBeNull();
  });

  it("refuses a command aimed at another room", () => {
    expect(
      parseSatWorkspaceCommand(envelope(), { documentName: "coedit:v2:another-room" }),
    ).toBeNull();
    expect(parseSatWorkspaceCommand(envelope(), {})).not.toBeNull();
  });

  it("refuses malformed, unknown, and unbounded envelopes", () => {
    const rejected: unknown[] = [
      "not json",
      JSON.stringify([1, 2, 3]),
      null,
      envelope({ type: "coedit.other" }),
      envelope({ command: "question.invented" }),
      envelope({ commandId: "" }),
      envelope({ commandId: " ".repeat(3) }),
      envelope({ actorId: "a".repeat(257) }),
      envelope({ idempotencyKey: "" }),
      envelope({ documentName: "" }),
      envelope({ payload: "not-a-record" }),
      envelope({ payload: [1] }),
      envelope({ createdAt: 1.5 }),
      envelope({ createdAt: "1700000000000" }),
      envelope({ expectedWorkspaceRevision: "" }),
    ];
    for (const raw of rejected) {
      expect(parseSatWorkspaceCommand(raw, { documentName: DOCUMENT_NAME })).toBeNull();
    }
  });

  it("refuses an envelope or payload past the byte cap", () => {
    const huge = envelope({ payload: { body: "x".repeat(70_000) } });
    expect(parseSatWorkspaceCommand(huge, {})).toBeNull();
    expect(parseSatWorkspaceCommand(JSON.stringify(huge), {})).toBeNull();
    // The same command with room to spare still parses, so the cap — not the
    // payload shape — is what rejected it.
    expect(parseSatWorkspaceCommand(envelope({ payload: { body: "x".repeat(1_000) } }), {})).not.toBeNull();
  });

  it("builds an envelope the validator accepts, on both paths", () => {
    const built = createSatWorkspaceCommand({
      documentName: DOCUMENT_NAME,
      actorId: "actor-alice",
      command: "question.reordered",
      payload: { questionIds: ["q-1", "q-2"] },
      expectedWorkspaceRevision: "  rev-3  ",
    });
    expect(built.expectedWorkspaceRevision).toBe("rev-3");
    expect(built.idempotencyKey).toBe(built.commandId);
    expect(parseSatWorkspaceCommand(built, { documentName: DOCUMENT_NAME, actorId: "actor-alice" })).toEqual(built);
    expect(parseSatWorkspaceCommand(JSON.stringify(built), {})).toEqual(built);
  });

  it("exposes the frozen command vocabulary", () => {
    for (const command of SAT_WORKSPACE_COMMANDS) {
      expect(isSatWorkspaceCommandName(command)).toBe(true);
    }
    expect(isSatWorkspaceCommandName("question.invented")).toBe(false);
    expect(isSatWorkspaceCommandName(42)).toBe(false);
  });
});
