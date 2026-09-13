import { describe, expect, it } from "vitest";
import { AUTHORING_REALTIME_FLAGS_OFF } from "../contracts";
import { resolveEffectiveCapabilities } from "../flags";
import {
  applyDivergenceEvent,
  createDivergenceState,
  divergenceFor,
  isQuestionDirty,
} from "../divergenceStore";
import { makeRevision } from "./divergenceFixtures";
import type { DivergenceEvent } from "../divergenceTypes";

/**
 * The capability dependency graph, as an executable contract:
 *
 *   EVENTS -> DELIVERY -> PRESENCE
 *                     \-> CONFLICT_COMPARE  (presentation only)
 *
 * The load-bearing part is the second half. `CONFLICT_COMPARE=off` removes the
 * richer Review UI and NOTHING else. It must never disable dirty-state
 * preservation, the pause on automatic network autosave after a known
 * divergence, GET-before-POST recovery, or revision fencing — which is why the
 * safety path below takes no capability input at all.
 */

describe("capability dependencies", () => {
  it("conflict compare is presentation-only: off never narrows delivery or presence", () => {
    const effective = resolveEffectiveCapabilities(
      { delivery: true, presence: true, conflictCompare: true },
      {
        // The transports are permitted locally; ONLY the compare UI is off.
        ...AUTHORING_REALTIME_FLAGS_OFF,
        authoring_realtime_events: true,
        authoring_realtime_delivery: true,
        authoring_presence: true,
        authoring_conflict_compare: false,
      },
    );
    expect(effective.conflictCompare).toBe(false);
    // The transports are untouched by a presentation flag.
    expect(effective.delivery).toBe(true);
    expect(effective.presence).toBe(true);
  });

  it("the local kill switch can only narrow, never widen", () => {
    const withheld = resolveEffectiveCapabilities(
      { delivery: false, presence: false, conflictCompare: false },
      {
        authoring_realtime_events: true,
        authoring_realtime_delivery: true,
        authoring_presence: true,
        authoring_conflict_compare: true,
      },
    );
    expect(withheld).toEqual({ delivery: false, presence: false, conflictCompare: false });
  });

  it("every capability off still preserves a dirty divergence", () => {
    // No capability is passed in anywhere below: divergence safety is a property
    // of the document state, not of a feature flag. A remote save landing on a
    // dirty editor must keep the draft, keep the dirty flag, and record the
    // newer revision so the network autosave pause has something to react to.
    const base = makeRevision({ revision: 3 });
    const mine = {
      ...base,
      prompt: { type: "doc", content: [{ text: "my unsaved work" }] },
    } as ReturnType<typeof makeRevision>;

    const events: DivergenceEvent[] = [
      { type: "INIT_BASELINE", examQuestionId: "eq-1", base },
      { type: "LOCAL_EDIT", examQuestionId: "eq-1", local: mine },
      {
        type: "REMOTE_REVISION",
        examQuestionId: "eq-1",
        remoteRevision: 4,
        hasPendingChanges: true,
      },
    ];
    const state = events.reduce(
      (acc, event) => applyDivergenceEvent(acc, event, "2026-09-13T12:00:00.000Z"),
      createDivergenceState(),
    );

    const entry = divergenceFor(state, "eq-1");
    expect(entry?.status).toBe("diverged");
    expect(isQuestionDirty(entry, true)).toBe(true);
    // The author's content is byte-identical: a remote event never rewrites it.
    expect(entry?.localDocument).toEqual(mine);
    // The newer revision is recorded, which is what arms the autosave pause.
    expect(entry?.remoteRevision).toBe(4);
  });

  it("the three-way compare is what the flag actually gates", () => {
    // classifyQuestionFields is only ever reached through the workspace's
    // `effectiveCapabilities.conflictCompare` guard, so withholding the flag
    // removes the comparison and the Review sheet while the safety path above
    // keeps working unchanged.
    const effective = resolveEffectiveCapabilities(
      { delivery: true, presence: false, conflictCompare: true },
      { ...AUTHORING_REALTIME_FLAGS_OFF, authoring_realtime_delivery: true },
    );
    expect(effective.conflictCompare).toBe(false);
    expect(effective.delivery).toBe(true);
  });
});
