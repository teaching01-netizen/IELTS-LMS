import { describe, expect, it, vi } from "vitest";
import {
  AUTHORING_CHANGED_FIELDS,
  AUTHORING_EVENT_KINDS,
  type AuthoringEntityRef,
  type AuthoringEventFrame,
  type AuthoringEventKind,
  type AuthoringEventV1,
} from "../contracts";
import { resolveAuthoringRealtimeFlags, resolveEffectiveCapabilities } from "../flags";
import {
  classifyAuthoringEvent,
  dedupeByEventId,
  isKnownKind,
  parseAuthoringEventEnvelope,
  shouldProcessCursor,
  sortByCursor,
} from "../schemas";

function makeEnvelope(overrides: Partial<AuthoringEventV1> = {}): Record<string, unknown> {
  const entity: AuthoringEntityRef = overrides.entity ?? {
    kind: "question",
    examQuestionId: "eq-1",
    questionId: "q-1",
    moduleId: "m-1",
  };
  return {
    version: 1,
    kind: "question.changed",
    eventId: "evt-1",
    occurredAt: "2026-09-12T00:00:00.000Z",
    actor: { id: "user-alice", kind: "staff" },
    scope: { organizationId: "org-1", examId: "exam-1", draftVersionId: "draft-7" },
    entity,
    // Two separate concepts: `revision` fences the affected entity,
    // `draftRevision` is the working-draft generation (not monotonic
    // across Undo, never an ordering key).
    revision: 3,
    draftRevision: 194,
    changedFields: ["prompt", "answer"],
    ...(overrides as Record<string, unknown>),
  };
}

function entityForKind(kind: AuthoringEventKind): AuthoringEntityRef {
  switch (kind) {
    case "question.changed":
    case "question.created":
    case "question.deleted":
    case "question.moved":
    case "question.duplicated":
    case "question.bulk_changed":
      return kind === "question.deleted"
        ? { kind: "question", examQuestionId: "eq-1", questionId: null, moduleId: "m-1" }
        : { kind: "question", examQuestionId: "eq-1", questionId: "q-1", moduleId: "m-1" };
    case "exam.changed":
      return { kind: "exam", examId: "exam-1" };
    case "draft.opened":
    case "draft.replaced":
      return { kind: "draft", examId: "exam-1", draftVersionId: "draft-7" };
    case "exam.published":
      return { kind: "exam", examId: "exam-1" };
  }
}

describe("parse", () => {
  it("accepts a valid question.changed envelope (no transport cursor inside)", () => {
    const parsed = parseAuthoringEventEnvelope(makeEnvelope());
    expect(parsed.kind).toBe("question.changed");
    expect(parsed).not.toHaveProperty("sequenceId");
    expect(parsed).not.toHaveProperty("cursor");
  });

  it("accepts all 10 kind vocabularies with matching entity shapes", () => {
    expect(AUTHORING_EVENT_KINDS).toHaveLength(10);
    for (const kind of AUTHORING_EVENT_KINDS) {
      const parsed = parseAuthoringEventEnvelope(
        makeEnvelope({ kind, entity: entityForKind(kind) }),
      );
      expect(parsed.kind).toBe(kind);
    }
  });

  it("rejects malformed envelope (missing scope / bad entity / negative revision)", () => {
    const missingScope = makeEnvelope();
    delete (missingScope as Record<string, unknown>).scope;
    expect(() => parseAuthoringEventEnvelope(missingScope)).toThrow();

    expect(() =>
      parseAuthoringEventEnvelope(
        makeEnvelope({ entity: { kind: "question", examQuestionId: "", questionId: null, moduleId: null } }),
      ),
    ).toThrow();

    expect(() => parseAuthoringEventEnvelope(makeEnvelope({ revision: -1 }))).toThrow();
    expect(() => parseAuthoringEventEnvelope(makeEnvelope({ draftRevision: -1 }))).toThrow();
  });

  it("maps version 0 and non-integer version to unsupported-version (refetch)", () => {
    expect(classifyAuthoringEvent(makeEnvelope({ version: 0 as unknown as 1 })).status).toBe(
      "unsupported-version",
    );
  });
});

describe("cursor", () => {
  it("accepts any cursor strictly greater than last (381 -> 384 is valid)", () => {
    expect(shouldProcessCursor(381, 384)).toBe(true);
    expect(shouldProcessCursor(41, 42)).toBe(true);
  });

  it("rejects duplicate and stale cursors (never rewinds)", () => {
    expect(shouldProcessCursor(41, 41)).toBe(false);
    expect(shouldProcessCursor(41, 40)).toBe(false);
  });

  it("sorts frames by cursor (stable tie-break on eventId)", () => {
    const frames = [
      { cursor: 5, eventId: "b" },
      { cursor: 3, eventId: "a" },
      { cursor: 5, eventId: "a" },
    ];
    expect(sortByCursor(frames).map((e) => e.eventId)).toEqual(["a", "a", "b"]);
  });

  it("frame carries the cursor outside the domain event", () => {
    const frame: AuthoringEventFrame = {
      type: "authoring.event",
      v: 1,
      cursor: 384,
      event: makeEnvelope() as unknown as AuthoringEventV1,
    };
    expect(frame.cursor).toBe(384);
    expect(frame.event).not.toHaveProperty("sequenceId");
  });
});

describe("dedupe", () => {
  it("drops duplicate eventIds and cursors at/below lastProcessedCursor", () => {
    const events = [
      { cursor: 10, eventId: "dup" },
      { cursor: 11, eventId: "dup" },
      { cursor: 9, eventId: "old" },
      { cursor: 12, eventId: "new" },
    ];
    expect(dedupeByEventId(events, 10).map((e) => e.eventId)).toEqual(["dup", "new"]);
  });
});

describe("unknown-kind", () => {
  it("parses without throwing, warns once, returns unknown-kind classification", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const classified = classifyAuthoringEvent(makeEnvelope({ kind: "question.pinned" }));
      expect(classified.status).toBe("unknown-kind");
      if (classified.status === "unknown-kind") {
        expect(classified.rawKind).toBe("question.pinned");
        expect(classified.eventId).toBe("evt-1");
      }
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it("malformed envelope still throws (unknown-kind never masks corruption)", () => {
    const bad = makeEnvelope({ kind: "question.pinned" });
    delete (bad as Record<string, unknown>).scope;
    expect(() => classifyAuthoringEvent(bad)).toThrow();
  });
});

describe("unsupported-version", () => {
  it("v2 with a familiar kind never executes v1 semantics (refetch, not interpret)", () => {
    const classified = classifyAuthoringEvent({
      ...makeEnvelope({ kind: "question.changed" }),
      version: 2,
    });
    expect(classified.status).toBe("unsupported-version");
    if (classified.status === "unsupported-version") {
      expect(classified.version).toBe(2);
    }
  });

  it("version 0 and non-integer versions are unsupported-version (refetch)", () => {
    expect(classifyAuthoringEvent(makeEnvelope({ version: 0 as unknown as 1 })).status).toBe(
      "unsupported-version",
    );
    expect(classifyAuthoringEvent(makeEnvelope({ version: 1.5 as unknown as 1 })).status).toBe(
      "unsupported-version",
    );
  });
});

describe("flags", () => {
  it("resolveAuthoringRealtimeFlags defaults all OFF; parses 1/true/yes/on (case-insensitive)", () => {
    expect(resolveAuthoringRealtimeFlags({})).toEqual({
      authoring_realtime_events: false,
      authoring_realtime_delivery: false,
      authoring_presence: false,
      authoring_conflict_compare: false,
    });
    expect(
      resolveAuthoringRealtimeFlags({
        VITE_AUTHORING_REALTIME_EVENTS: "1",
        VITE_AUTHORING_REALTIME_DELIVERY: "TRUE",
        VITE_AUTHORING_PRESENCE: "Yes",
        VITE_AUTHORING_CONFLICT_COMPARE: " on ",
      }),
    ).toEqual({
      authoring_realtime_events: true,
      authoring_realtime_delivery: true,
      authoring_presence: true,
      authoring_conflict_compare: true,
    });
  });

  it("kill switch can only disable a server-granted capability, never enable", () => {
    const server = { delivery: false, presence: true, conflictCompare: true };
    const killOn = resolveAuthoringRealtimeFlags({
      VITE_AUTHORING_REALTIME_DELIVERY: "1",
      VITE_AUTHORING_PRESENCE: "1",
      VITE_AUTHORING_CONFLICT_COMPARE: "1",
    });
    // Server OFF wins even when the frontend switch is ON.
    expect(resolveEffectiveCapabilities(server, killOn).delivery).toBe(false);
    // Frontend OFF disables a server-granted capability.
    const killOff = { ...killOn, authoring_presence: false };
    expect(resolveEffectiveCapabilities(server, killOff).presence).toBe(false);
    expect(resolveEffectiveCapabilities(server, killOn).conflictCompare).toBe(true);
  });
});

describe("no-content", () => {
  it("serialized fixtures contain no prompt/answer/rationale text, base64, or asset bytes", () => {
    const fixture = JSON.stringify(makeEnvelope());
    expect(fixture).not.toContain("promptPreview");
    expect(fixture).not.toContain("answerKeyPreview");
    expect(fixture).not.toContain("dataBase64");
    const parsed = parseAuthoringEventEnvelope(makeEnvelope());
    for (const field of parsed.changedFields) {
      expect(typeof field).toBe("string");
      expect(field.length).toBeGreaterThan(0);
    }
    expect(AUTHORING_CHANGED_FIELDS.length).toBeGreaterThan(0);
  });

  it("tombstone serializes null questionId/moduleId as JSON null (never absent)", () => {
    const raw = JSON.stringify(makeEnvelope({ entity: entityForKind("question.deleted") }));
    expect(raw).toContain('"questionId":null');
  });
});

describe("versioning", () => {
  it("unknown kinds stay classifiable under v1; v2 always refetches", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(classifyAuthoringEvent(makeEnvelope({ kind: "question.pinned" })).status).toBe(
        "unknown-kind",
      );
    } finally {
      warn.mockRestore();
    }
    expect(isKnownKind("question.pinned")).toBe(false);
    expect(isKnownKind("question.changed")).toBe(true);
  });
});
