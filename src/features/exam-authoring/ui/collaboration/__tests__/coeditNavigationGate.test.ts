import { describe, expect, it } from "vitest";
import {
  COEDIT_ROOM_BLOCK_COPY,
  coeditRoomBlockMessage,
  coeditRoomHoldsUnconfirmedWork,
  coeditRoomShouldWarnBeforeUnload,
  type CoeditRoomFacts,
} from "../coeditNavigationGate";

/**
 * The gate is the last thing between an author's uncommitted work and a screen
 * that reads MySQL, so these cases are the whole decision in miniature: which
 * outcomes block, who is allowed through, and which browser closes are worth
 * interrupting.
 */
function room(overrides: Partial<CoeditRoomFacts> = {}): CoeditRoomFacts {
  return {
    ready: true,
    writeCapable: true,
    issue: "none",
    issueMessage: null,
    saveState: { name: "saved", localStateVector: "v1", acknowledgedStateVector: "v1" },
    ...overrides,
    ...(overrides.saveState
      ? { saveState: { name: "saved", localStateVector: "v1", acknowledgedStateVector: "v1", ...overrides.saveState } }
      : {}),
  };
}

describe("coeditRoomBlockMessage", () => {
  it("lets a durable acknowledgement through", () => {
    expect(coeditRoomBlockMessage(room(), "saved")).toBeNull();
  });

  it("blocks every outcome that is not durability, with its own copy", () => {
    for (const outcome of ["pending", "offline", "refused", "stale_cache", "read_only", "ended"] as const) {
      const message = coeditRoomBlockMessage(room(), outcome);
      expect(message).toBe(COEDIT_ROOM_BLOCK_COPY[outcome]);
      expect(message).toBeTruthy();
    }
  });

  it("never blocks a session whose token cannot write", () => {
    // An observer's room may never commit while they read. Blocking on its
    // unacknowledged state would trap them on the page with nothing to save.
    for (const outcome of ["pending", "offline", "read_only", "ended"] as const) {
      expect(coeditRoomBlockMessage(room({ writeCapable: false }), outcome)).toBeNull();
    }
  });

  it("blocks a frozen room whose author still has work in it", () => {
    // A room frozen by a publish reports `read_only`, but a WRITE-capable
    // session's local edits can never be committed from here: leaving silently
    // is the one thing that loses them.
    const message = coeditRoomBlockMessage(
      room({
        issue: "frozen",
        saveState: { name: "error", localStateVector: "v2", acknowledgedStateVector: "v1" },
      }),
      "read_only",
    );
    expect(message).toContain("could not be saved here");
  });
});

describe("coeditRoomHoldsUnconfirmedWork", () => {
  it("is false for a room that matches its acknowledgement", () => {
    expect(coeditRoomHoldsUnconfirmedWork(room())).toBe(false);
  });

  it("is true when the local document has moved past the acknowledgement", () => {
    expect(
      coeditRoomHoldsUnconfirmedWork(
        room({ saveState: { localStateVector: "v2", acknowledgedStateVector: "v1" } }),
      ),
    ).toBe(true);
  });

  it("is true when nothing has been acknowledged at all", () => {
    expect(
      coeditRoomHoldsUnconfirmedWork(
        room({ saveState: { localStateVector: "v1", acknowledgedStateVector: null } }),
      ),
    ).toBe(true);
  });

  it("is false for a document that has never materialized", () => {
    expect(
      coeditRoomHoldsUnconfirmedWork(
        room({ saveState: { localStateVector: null, acknowledgedStateVector: null } }),
      ),
    ).toBe(false);
  });
});

describe("coeditRoomShouldWarnBeforeUnload", () => {
  it("warns while the transport is down with unacknowledged work", () => {
    expect(
      coeditRoomShouldWarnBeforeUnload(
        room({ saveState: { name: "unsaved", localStateVector: "v2", acknowledgedStateVector: "v1" } }),
      ),
    ).toBe(true);
  });

  it("warns on a refusal or an ended room that still holds local work", () => {
    expect(
      coeditRoomShouldWarnBeforeUnload(
        room({ saveState: { name: "error", localStateVector: "v2", acknowledgedStateVector: "v1" } }),
      ),
    ).toBe(true);
  });

  it("does not warn about an in-flight commit", () => {
    // The service already holds the update and IndexedDB holds the local copy,
    // so an unload mid-commit cannot lose it. Only the states where the next
    // keystroke would be saved nowhere are worth interrupting.
    expect(
      coeditRoomShouldWarnBeforeUnload(
        room({ saveState: { name: "syncing", localStateVector: "v2", acknowledgedStateVector: "v1" } }),
      ),
    ).toBe(false);
  });

  it("does not warn about a reported problem whose work is durable", () => {
    expect(
      coeditRoomShouldWarnBeforeUnload(
        room({ issue: "closed", saveState: { name: "error", localStateVector: "v1", acknowledgedStateVector: "v1" } }),
      ),
    ).toBe(false);
  });

  it("does not warn for an observer or a room that never opened", () => {
    expect(
      coeditRoomShouldWarnBeforeUnload(
        room({
          writeCapable: false,
          saveState: { name: "unsaved", localStateVector: "v2", acknowledgedStateVector: "v1" },
        }),
      ),
    ).toBe(false);
    expect(
      coeditRoomShouldWarnBeforeUnload(
        room({ ready: false, saveState: { name: "unsaved", localStateVector: "v2", acknowledgedStateVector: "v1" } }),
      ),
    ).toBe(false);
  });
});
