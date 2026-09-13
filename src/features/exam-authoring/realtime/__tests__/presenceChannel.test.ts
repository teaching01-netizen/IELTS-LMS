import { describe, expect, it } from "vitest";
import {
  PRESENCE_TTL_MS,
  PRESENCE_THROTTLE_MS,
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
} from "../presenceChannel";
import {
  buildPresenceFrame,
  derivePresenceState,
  parsePresenceBroadcast,
  type AuthoringPresence,
} from "../presenceTypes";

function presence(overrides: Partial<AuthoringPresence> = {}): AuthoringPresence {
  return {
    connectionId: "ap-1",
    userId: "user-alice",
    displayName: "Alice",
    examId: "exam-1",
    draftVersionId: "draft-7",
    selectedQuestionId: "eq-1",
    state: "viewing",
    lastSeenAt: "2026-09-13T12:00:00.000Z",
    ...overrides,
  };
}

const T0 = Date.parse("2026-09-13T12:00:00.000Z");

describe("shouldSend (throttle)", () => {
  it("allows the first send", () => {
    expect(shouldSend(T0, null)).toBe(true);
  });

  it("sheds everything inside the window", () => {
    expect(shouldSend(T0 + 1, T0)).toBe(false);
    expect(shouldSend(T0 + PRESENCE_THROTTLE_MS - 1, T0)).toBe(false);
  });

  it("allows the next send once the window has elapsed", () => {
    expect(shouldSend(T0 + PRESENCE_THROTTLE_MS, T0)).toBe(true);
  });

  it("collapses 50 rapid transitions into at most one send per window", () => {
    let lastSent: number | null = null;
    let sends = 0;
    for (let index = 0; index < 50; index += 1) {
      const now = T0 + index * 10;
      if (shouldSend(now, lastSent)) {
        sends += 1;
        lastSent = now;
      }
    }
    // 500ms of transitions with a 2s window: exactly one send.
    expect(sends).toBe(1);
  });
});

describe("coalescePresence", () => {
  it("keeps only the latest intent, so a shed frame is never a lost delta", () => {
    const first = { selectedQuestionId: "eq-1", state: "viewing" as const };
    const second = { selectedQuestionId: "eq-2", state: "editing" as const };
    expect(coalescePresence(first, second)).toEqual(second);
    expect(coalescePresence(null, second)).toEqual(second);
  });
});

describe("expirePresence", () => {
  it("keeps fresh entries and sweeps stale ones", () => {
    const fresh = presence({ connectionId: "ap-fresh", lastSeenAt: new Date(T0).toISOString() });
    const stale = presence({
      connectionId: "ap-stale",
      lastSeenAt: new Date(T0 - PRESENCE_TTL_MS - 1).toISOString(),
    });
    const kept = expirePresence([fresh, stale], T0);
    expect(kept.map((entry) => entry.connectionId)).toEqual(["ap-fresh"]);
  });

  it("treats exactly-at-TTL as still live", () => {
    const edge = presence({ lastSeenAt: new Date(T0 - PRESENCE_TTL_MS).toISOString() });
    expect(expirePresence([edge], T0)).toHaveLength(1);
  });

  it("expires an unclean disconnect without any close frame", () => {
    // Nothing but the lastSeenAt anchor distinguishes a crashed tab from a
    // closed one, which is exactly why TTL is the only removal path.
    const crashed = presence({ lastSeenAt: new Date(T0 - 60_000).toISOString() });
    expect(expirePresence([crashed], T0)).toHaveLength(0);
  });
});

describe("scope filters", () => {
  it("drops frames from a retired working draft", () => {
    const current = presence({ connectionId: "ap-a", draftVersionId: "draft-7" });
    const retired = presence({ connectionId: "ap-b", draftVersionId: "draft-4" });
    expect(filterDraft([current, retired], "draft-7").map((e) => e.connectionId)).toEqual(["ap-a"]);
    // No bound draft means no presence at all, never everyone.
    expect(filterDraft([current], null)).toEqual([]);
  });

  it("excludes only this connection, so the same user's other tabs remain visible", () => {
    const self = presence({ connectionId: "ap-self" });
    const otherTab = presence({ connectionId: "ap-other-tab", userId: "user-alice" });
    const kept = excludeSelf([self, otherTab], "ap-self");
    expect(kept.map((entry) => entry.connectionId)).toEqual(["ap-other-tab"]);
  });

  it("excludes nothing before the socket knows its own identity", () => {
    const entries = [presence({ connectionId: "ap-a" }), presence({ connectionId: "ap-b" })];
    expect(excludeSelf(entries, null)).toHaveLength(2);
  });

  it("upserts by connectionId so a peer never appears twice", () => {
    const first = presence({ state: "viewing" });
    const updated = presence({ state: "editing" });
    const merged = mergePresence([first], updated);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.state).toBe("editing");
  });

  it("finds occupants, editors, and entries with a selection", () => {
    const entries = [
      presence({ connectionId: "ap-a", selectedQuestionId: "eq-1", state: "editing" }),
      presence({ connectionId: "ap-b", selectedQuestionId: "eq-2", state: "viewing" }),
      presence({ connectionId: "ap-c", selectedQuestionId: null, state: "idle" }),
    ];
    expect(occupantsOf(entries, "eq-1").map((e) => e.connectionId)).toEqual(["ap-a"]);
    expect(editorsOf(entries, "eq-1").map((e) => e.connectionId)).toEqual(["ap-a"]);
    expect(editorsOf(entries, "eq-2")).toEqual([]);
    expect(withSelection(entries).map((e) => e.connectionId)).toEqual(["ap-a", "ap-b"]);
  });
});

describe("displayNameOf", () => {
  it("falls back to a neutral label, never a blank or a raw user id", () => {
    expect(displayNameOf({ displayName: "Alice" })).toBe("Alice");
    expect(displayNameOf({ displayName: "   " })).toBe("Another author");
    expect(displayNameOf({ displayName: "" })).toBe("Another author");
  });
});

describe("derivePresenceState", () => {
  const base = { selectedQuestionId: "eq-1", lastActivityAt: T0, now: T0, idleAfterMs: 60_000 };

  it("reports editing while the autosave says dirty", () => {
    expect(derivePresenceState({ ...base, isDirty: true })).toBe("editing");
  });

  it("reports viewing while active and clean", () => {
    expect(derivePresenceState({ ...base, isDirty: false })).toBe("viewing");
  });

  it("reports idle only after the quiet window, even when dirty", () => {
    expect(derivePresenceState({ ...base, isDirty: false, now: T0 + 60_001 })).toBe("idle");
    // A dirty editor is editing regardless of the idle timer: walking away with
    // unsaved work must not read as idle.
    expect(derivePresenceState({ ...base, isDirty: true, now: T0 + 600_000 })).toBe("editing");
  });

  it("never reports editing with nothing selected", () => {
    expect(
      derivePresenceState({ ...base, selectedQuestionId: null, isDirty: true }),
    ).toBe("viewing");
  });
});

describe("presence frames carry no content", () => {
  it("builds a frame with ids and state only", () => {
    const raw = JSON.stringify(buildPresenceFrame({ selectedQuestionId: "eq-1", state: "editing" }));
    for (const banned of [
      "stimulus",
      "prompt",
      "answer",
      "rationale",
      "metadata",
      "accessibility",
      "choices",
      "correctOptionId",
      "preview",
      "content",
      "tags",
    ]) {
      expect(raw.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("round-trips a server broadcast and rejects malformed ones without throwing", () => {
    const broadcast = {
      type: "authoring.presence",
      v: 1,
      presence: {
        connectionId: "ap-9",
        userId: "user-bob",
        displayName: "Bob",
        examId: "exam-1",
        draftVersionId: "draft-7",
        selectedQuestionId: "eq-3",
        state: "editing",
        lastSeenAt: "2026-09-13T12:00:00.000Z",
      },
    };
    expect(parsePresenceBroadcast(broadcast)?.connectionId).toBe("ap-9");

    for (const bad of [
      null,
      "nope",
      { type: "authoring.presence", v: 2, presence: broadcast.presence },
      { type: "authoring.event", v: 1, presence: broadcast.presence },
      { type: "authoring.presence", v: 1, presence: { ...broadcast.presence, state: "typing" } },
      { type: "authoring.presence", v: 1, presence: { ...broadcast.presence, connectionId: "" } },
      { type: "authoring.presence", v: 1 },
    ]) {
      expect(parsePresenceBroadcast(bad)).toBeNull();
    }
  });

  it("ignores content a hostile server tried to smuggle into a presence frame", () => {
    const parsed = parsePresenceBroadcast({
      type: "authoring.presence",
      v: 1,
      presence: {
        connectionId: "ap-9",
        userId: "user-bob",
        displayName: "Bob",
        examId: "exam-1",
        draftVersionId: "draft-7",
        selectedQuestionId: "eq-3",
        state: "viewing",
        lastSeenAt: "2026-09-13T12:00:00.000Z",
        stimulus: { secret: true },
        prompt: "leak me",
      },
    });
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed as object)).not.toContain("stimulus");
    expect(Object.keys(parsed as object)).not.toContain("prompt");
  });
});

describe("authorForActor (names come from presence, never from the envelope)", () => {
  it("resolves a staff actor id to the display name on the roster", () => {
    expect(authorForActor([presence()], "user-alice")).toEqual({ displayName: "Alice" });
  });

  it("returns null — never a raw id — when that person has left the room", () => {
    expect(authorForActor([presence({ userId: "user-bob" })], "user-alice")).toBeNull();
  });

  it("returns null when no actor id arrived at all", () => {
    expect(authorForActor([presence()], undefined)).toBeNull();
    expect(authorForActor([presence()], null)).toBeNull();
  });

  it("falls back to neutral rather than surfacing a blank name", () => {
    expect(authorForActor([presence({ displayName: "   " })], "user-alice")).toBeNull();
  });
});

describe("presence tolerances", () => {
  it("expires receivers LATER than the server, so a throttled tab cannot flicker", () => {
    // The server retires a silent peer at 30s; a receiver must stay the calmer
    // of the two rather than blink a colleague out during a suspended timer.
    expect(PRESENCE_TTL_MS).toBeGreaterThan(30_000);
  });
});
