import { describe, expect, it, vi } from "vitest";
import { parseAuthoringFrame } from "../schemas";
import { makeEvent } from "./fixtures";

function eventFrame(cursor = 7, event = makeEvent()) {
  return { type: "authoring.event", v: 1, cursor, event };
}

describe("parseAuthoringFrame", () => {
  it("accepts every frozen inbound frame type", () => {
    const frames: unknown[] = [
      eventFrame(),
      {
        type: "authoring.subscribed",
        v: 1,
        examId: "exam-1",
        draftVersionId: "draft-7",
        barrierCursor: 512,
      },
      {
        type: "authoring.capabilities",
        v: 1,
        delivery: true,
        presence: false,
        conflictCompare: false,
      },
      {
        type: "authoring.snapshot_required",
        v: 1,
        examId: "exam-1",
        draftVersionId: "draft-7",
        reason: "cursor_too_old",
      },
      { type: "authoring.error", v: 1, code: "subscription_forbidden", message: "no" },
    ];
    for (const frame of frames) {
      const parsed = parseAuthoringFrame(frame);
      expect(parsed.ok).toBe(true);
    }
  });

  it("rejects unknown frame types without throwing", () => {
    for (const bad of [
      { type: "connected", v: 1 },
      { type: "runtime_snapshot", v: 1 },
      { type: "authoring.unknown", v: 1 },
      { v: 1 },
    ]) {
      const parsed = parseAuthoringFrame(bad);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok && parsed.outcome === "rejected") {
        expect(parsed.reason).toBe("unknown-type");
      } else {
        throw new Error("expected a rejected frame");
      }
    }
  });

  it("rejects unsupported versions without interpreting the event", () => {
    const parsed = parseAuthoringFrame(eventFrame(7, { ...makeEvent(), version: 2 as unknown as 1 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok && parsed.outcome === "rejected") {
      expect(parsed.reason).toBe("unsupported-version");
    } else {
      throw new Error("expected a rejected frame");
    }
  });

  it("rejects malformed shapes (negative cursor, missing examId, non-object) without throwing", () => {
    const bad: unknown[] = [
      eventFrame(-1),
      [],
      null,
      "not-an-object",
      {
        type: "authoring.subscribed",
        v: 1,
        examId: "",
        draftVersionId: "draft-7",
        barrierCursor: 1,
      },
      { type: "authoring.snapshot_required", v: 1, examId: "e", draftVersionId: "d", reason: "???" },
    ];
    for (const value of bad) {
      const parsed = parseAuthoringFrame(value);
      expect(parsed.ok).toBe(false);
    }
  });

  it("tolerates an unknown event kind by returning the cursor it must consume", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const parsed = parseAuthoringFrame(
        eventFrame(37, makeEvent({ kind: "question.pinned" as never })),
      );
      expect(parsed.ok).toBe(false);
      if (!parsed.ok && parsed.outcome === "unknown-kind") {
        // Forward tolerance must not create phantom loss: the caller ADVANCES
        // the cursor past a frame it cannot interpret.
        expect(parsed.cursor).toBe(37);
        expect(parsed.rawKind).toBe("question.pinned");
      } else {
        throw new Error("expected an unknown-kind parse result");
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("still rejects an unknown kind that arrives without a usable cursor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const cursor of [undefined, -3, 1.5, "9"]) {
        const parsed = parseAuthoringFrame({
          type: "authoring.event",
          v: 1,
          cursor,
          event: makeEvent({ kind: "question.pinned" as never }),
        });
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) {
          expect(parsed.outcome).toBe("rejected");
        }
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects a frame missing its version", () => {
    const { v: _v, ...noVersion } = eventFrame() as unknown as Record<string, unknown>;
    const parsed = parseAuthoringFrame(noVersion);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok && parsed.outcome === "rejected") {
      expect(parsed.reason).toBe("unsupported-version");
    } else {
      throw new Error("expected a rejected frame");
    }
  });
});
