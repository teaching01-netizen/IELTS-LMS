import { describe, expect, it } from "vitest";
import {
  advanceAuthoringCursor,
  createAuthoringEventState,
  reduceAuthoringFrame,
  seedAuthoringBaseline,
} from "../authoringEventReducer";
import { makeEvent, makeEventFrame } from "./fixtures";

const BOUND = "draft-7";

describe("authoringEventReducer cursor table", () => {
  it("processes the first event when no baseline was seeded", () => {
    const state = createAuthoringEventState();
    const { state: next, action } = reduceAuthoringFrame(state, makeEventFrame(41), BOUND);
    expect(action.action).toBe("process");
    expect(next.lastProcessedCursor).toBe(41);
  });

  it("processes any cursor strictly greater than last (non-contiguous cursors are valid)", () => {
    const state = createAuthoringEventState(41);
    // 381 -> 384 is valid: skipped values belong to other exams/kinds/origins.
    const { state: next, action } = reduceAuthoringFrame(state, makeEventFrame(384), BOUND);
    expect(action.action).toBe("process");
    expect(next.lastProcessedCursor).toBe(384);
  });

  it("ignores a duplicate cursor and never rewinds", () => {
    const state = createAuthoringEventState(41);
    const { state: next, action } = reduceAuthoringFrame(state, makeEventFrame(41), BOUND);
    expect(action.action).toBe("ignore-duplicate");
    expect(next.lastProcessedCursor).toBe(41);
  });

  it("ignores an out-of-order cursor and never rewinds", () => {
    const state = createAuthoringEventState(41);
    const { state: next, action } = reduceAuthoringFrame(state, makeEventFrame(40), BOUND);
    expect(action.action).toBe("ignore-out-of-order");
    expect(next.lastProcessedCursor).toBe(41);
  });

  it("is PURE: never mutates the input state", () => {
    const state = createAuthoringEventState(41);
    const frozen = Object.freeze({ ...state });
    const { state: next } = reduceAuthoringFrame(frozen, makeEventFrame(99), BOUND);
    expect(frozen.lastProcessedCursor).toBe(41);
    expect(next).not.toBe(frozen);
    expect(next.lastProcessedCursor).toBe(99);
  });

  it("maps snapshot_required to a snapshot action with its truthful reason", () => {
    const state = createAuthoringEventState(41);
    const { state: next, action } = reduceAuthoringFrame(
      state,
      {
        type: "authoring.snapshot_required",
        v: 1,
        examId: "exam-1",
        draftVersionId: "draft-7",
        reason: "delivery_gap",
      },
      BOUND,
    );
    expect(action.action).toBe("snapshot-required");
    if (action.action === "snapshot-required") {
      expect(action.reason).toBe("delivery_gap");
    }
    // A snapshot signal never advances the cursor on its own.
    expect(next.lastProcessedCursor).toBe(41);
  });

  it("filters a content event from another draft but passes lifecycle kinds", () => {
    let state = createAuthoringEventState(10);
    const staleContent = reduceAuthoringFrame(
      state,
      makeEventFrame(11, {
        scope: { organizationId: "org-1", examId: "exam-1", draftVersionId: "draft-8" },
        kind: "question.changed",
      }),
      BOUND,
    );
    expect(staleContent.action.action).toBe("ignore-stale-draft");
    expect(staleContent.state.lastProcessedCursor).toBe(10);

    state = staleContent.state;
    const lifecycle = reduceAuthoringFrame(
      state,
      makeEventFrame(12, {
        scope: { organizationId: "org-1", examId: "exam-1", draftVersionId: "draft-8" },
        kind: "draft.replaced",
        entity: { kind: "draft", examId: "exam-1", draftVersionId: "draft-8" },
      }),
      BOUND,
    );
    expect(lifecycle.action.action).toBe("process");
    expect(lifecycle.state.lastProcessedCursor).toBe(12);
  });

  it("does not stale-filter when no draft is bound", () => {
    const state = createAuthoringEventState(1);
    const { action } = reduceAuthoringFrame(
      state,
      makeEventFrame(2, {
        scope: { organizationId: "org-1", examId: "exam-1", draftVersionId: "draft-99" },
      }),
      null,
    );
    expect(action.action).toBe("process");
  });

  it("ignores connection-level frames without moving the cursor", () => {
    const state = createAuthoringEventState(1);
    const { state: next, action } = reduceAuthoringFrame(
      state,
      {
        type: "authoring.capabilities",
        v: 1,
        delivery: true,
        presence: false,
        conflictCompare: false,
      },
      BOUND,
    );
    expect(action.action).toBe("ignore-unknown");
    expect(next.lastProcessedCursor).toBe(1);
  });

  it("keeps the cursor monotonic over a randomized run", () => {
    let state = createAuthoringEventState();
    let previous = -1;
    const cursors = [3, 3, 9, 4, 9, 12, 12, 40, 39, 41];
    for (const cursor of cursors) {
      const { state: next, action } = reduceAuthoringFrame(
        state,
        makeEventFrame(cursor, { eventId: `evt-${cursor}` }),
        BOUND,
      );
      state = next;
      if (action.action === "process") {
        expect(cursor).toBeGreaterThan(previous);
        previous = cursor;
      }
      expect(state.lastProcessedCursor).not.toBeNull();
      expect(state.lastProcessedCursor as number).toBeGreaterThanOrEqual(previous);
    }
    expect(state.lastProcessedCursor).toBe(41);
  });
});

describe("authoringEventReducer target shape", () => {
  it("carries the validated event through unchanged", () => {
    const state = createAuthoringEventState();
    const event = makeEvent({ kind: "question.deleted", eventId: "evt-del" });
    const { action } = reduceAuthoringFrame(
      state,
      { type: "authoring.event", v: 1, cursor: 5, event },
      BOUND,
    );
    expect(action.action).toBe("process");
    if (action.action === "process") {
      expect(action.event.eventId).toBe("evt-del");
      expect(action.cursor).toBe(5);
    }
  });
});

describe("seedAuthoringBaseline", () => {
  it("adopts the handshake barrier as the baseline when nothing was processed", () => {
    const state = createAuthoringEventState();
    const seeded = seedAuthoringBaseline(state, 512);
    expect(seeded.lastProcessedCursor).toBe(512);
    // The input is untouched.
    expect(state.lastProcessedCursor).toBeNull();
  });

  it("never rewinds an established cursor (a stale or duplicate ack is a no-op)", () => {
    const state = createAuthoringEventState(900);
    expect(seedAuthoringBaseline(state, 512)).toBe(state);
    expect(seedAuthoringBaseline(state, 900)).toBe(state);
    expect(seedAuthoringBaseline(state, 901).lastProcessedCursor).toBe(901);
  });
});

describe("advanceAuthoringCursor", () => {
  it("consumes an unknown-kind cursor so resume never lags", () => {
    const state = createAuthoringEventState(50);
    expect(advanceAuthoringCursor(state, 51).lastProcessedCursor).toBe(51);
    expect(state.lastProcessedCursor).toBe(50);
  });

  it("is monotonic and never rewinds", () => {
    const state = createAuthoringEventState(60);
    expect(advanceAuthoringCursor(state, 51)).toBe(state);
    expect(advanceAuthoringCursor(state, 60)).toBe(state);
    expect(advanceAuthoringCursor(state, 61).lastProcessedCursor).toBe(61);
  });

  it("establishes the first position when the baseline is empty", () => {
    expect(advanceAuthoringCursor(createAuthoringEventState(), 7).lastProcessedCursor).toBe(7);
  });
});
