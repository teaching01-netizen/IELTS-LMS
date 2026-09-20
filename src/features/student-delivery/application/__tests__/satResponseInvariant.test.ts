import { describe, expect, it } from "vitest";
import {
  applySatResponseDraftChange,
  emptySatAnnotations,
  emptySatQuestionResponse,
  normalizeSatResponseDraft,
  type SatQuestionResponseDraft,
  type SatResponseDraftChange,
} from "../../domain/satResponses";
import {
  durablePayloadToSatDraft,
  satDraftToDurablePayload,
} from "../../hooks/useSatResponsePersistence";
import { createSatRunnerState, satRunnerReducer } from "../satRunnerReducer";
import type { SatRunnerAction } from "../satRunnerReducer";

/**
 * Audit finding 3, the cross-layer invariant the original reducer test missed:
 *
 *   answer !== ""  ⇒  eliminatedOptionIds does not contain answer
 *
 * must hold for local state, for the visible durability payload, and after the
 * durable payload is reloaded. One domain mutation produces the draft; these
 * tests check every consumer of it rather than only the reducer.
 */

function startedRunner() {
  const directions = satRunnerReducer(createSatRunnerState("schedule-1", "candidate-1"), {
    type: "bootstrapLoaded",
    assessmentId: "assessment-1",
  });
  return satRunnerReducer(directions, {
    type: "moduleStarted",
    sectionKey: "reading-writing",
    moduleKey: "rw-m1",
    questionIds: ["q1"],
    startedAt: "2026-08-28T01:00:00Z",
    endsAt: "2026-08-28T01:35:00Z",
  });
}

function assertInvariant(draft: SatQuestionResponseDraft, where: string) {
  if (draft.answer !== "" && draft.eliminatedOptionIds.includes(draft.answer)) {
    throw new Error(
      `${where}: answer ${draft.answer} is also eliminated (${draft.eliminatedOptionIds.join(",")})`,
    );
  }
}

// A user-visible action sequence, including the exact two-tap sequence the
// audit used to expose the divergence: eliminate A, then select A.
const SEQUENCES: ReadonlyArray<{ label: string; changes: SatResponseDraftChange[] }> = [
  {
    label: "eliminate A then select A",
    changes: [
      { kind: "toggleEliminatedOption", optionId: "A" },
      { kind: "setAnswer", answer: "A" },
    ],
  },
  {
    label: "select A then try to eliminate A",
    changes: [
      { kind: "setAnswer", answer: "A" },
      { kind: "toggleEliminatedOption", optionId: "A" },
    ],
  },
  {
    label: "eliminate A, select A, flag, then eliminate A again",
    changes: [
      { kind: "toggleEliminatedOption", optionId: "A" },
      { kind: "setAnswer", answer: "A" },
      { kind: "setReviewFlag", markedForReview: true },
      { kind: "toggleEliminatedOption", optionId: "A" },
    ],
  },
  {
    label: "select then clear then eliminate",
    changes: [
      { kind: "setAnswer", answer: "B" },
      { kind: "setAnswer", answer: "" },
      { kind: "toggleEliminatedOption", optionId: "B" },
    ],
  },
  {
    label: "select A then switch to eliminated B",
    changes: [
      { kind: "setAnswer", answer: "A" },
      { kind: "toggleEliminatedOption", optionId: "B" },
    ],
  },
];

describe("SAT response invariant (audit finding 3)", () => {
  it.each(SEQUENCES)("holds through the domain mutation: $label", ({ changes }) => {
    let draft = emptySatQuestionResponse("q1");
    for (const change of changes) {
      draft = applySatResponseDraftChange(draft, change);
      assertInvariant(draft, "domain mutation");
    }
  });

  it.each(SEQUENCES)("holds in the reducer state: $label", ({ changes }) => {
    let state = startedRunner();
    for (const change of changes) {
      // Mirror the controller: one mutation, one replaceResponse dispatch.
      const current =
        state.phase === "module" || state.phase === "review"
          ? (state.responses.q1 ?? emptySatQuestionResponse("q1"))
          : emptySatQuestionResponse("q1");
      const next = applySatResponseDraftChange(current, change);
      state = satRunnerReducer(state, { type: "replaceResponse", response: next });
      const draft =
        state.phase === "module" || state.phase === "review" ? state.responses.q1 : undefined;
      expect(draft).toBeDefined();
      assertInvariant(draft as SatQuestionResponseDraft, "reducer state");
    }
  });

  it.each(SEQUENCES)("holds on the durability payload: $label", ({ changes }) => {
    let draft = emptySatQuestionResponse("q1");
    for (const change of changes) {
      draft = applySatResponseDraftChange(draft, change);
      const payload = satDraftToDurablePayload(draft);
      const answer = typeof payload.answer === "string" ? payload.answer : "";
      if (answer !== "") {
        expect(payload.eliminatedOptions).not.toContain(answer);
      }
    }
  });

  it.each(SEQUENCES)("holds after a durability round-trip (reload): $label", ({ changes }) => {
    let draft = emptySatQuestionResponse("q1");
    for (const change of changes) {
      draft = applySatResponseDraftChange(draft, change);
    }
    // Through the wire and back, exactly as reload/recovery does.
    const wire = JSON.parse(JSON.stringify(satDraftToDurablePayload(draft)));
    assertInvariant(durablePayloadToSatDraft("q1", wire), "after reload");
  });

  it("refuses to cross out the currently selected choice", () => {
    const selected = applySatResponseDraftChange(emptySatQuestionResponse("q1"), {
      kind: "setAnswer",
      answer: "A",
    });
    const toggled = applySatResponseDraftChange(selected, {
      kind: "toggleEliminatedOption",
      optionId: "A",
    });
    expect(toggled).toEqual(selected);
  });

  it("heals a contradictory draft written by an older build", () => {
    // The exact impossible record the old persistence path produced, and the
    // shape a reload of pre-fix data would surface.
    const contradictory = {
      ...emptySatQuestionResponse("q1"),
      answer: "A",
      eliminatedOptionIds: ["A"],
      annotations: emptySatAnnotations(),
    };
    assertInvariant(normalizeSatResponseDraft(contradictory), "normalized in memory");

    const healed = durablePayloadToSatDraft("q1", {
      answer: "A",
      markedForReview: false,
      eliminatedOptions: ["A"],
      annotations: [],
    });
    expect(healed.eliminatedOptionIds).toEqual([]);
    assertInvariant(healed, "healed on read");

    // And it cannot be re-persisted in the contradictory form.
    const payload = satDraftToDurablePayload(healed);
    expect(payload.eliminatedOptions).toEqual([]);
  });

  it("keeps hydrating a server snapshot inside the invariant", () => {
    const hydrated = satRunnerReducer(startedRunner(), {
      type: "hydrateResponse",
      revision: 4,
      response: { ...emptySatQuestionResponse("q1"), answer: "B", eliminatedOptionIds: ["B"] },
    } as SatRunnerAction);
    const draft =
      hydrated.phase === "module" ? hydrated.responses.q1 : (undefined as unknown as undefined);
    expect(draft?.eliminatedOptionIds).toEqual([]);
    assertInvariant(draft as SatQuestionResponseDraft, "hydrated snapshot");
  });
});
