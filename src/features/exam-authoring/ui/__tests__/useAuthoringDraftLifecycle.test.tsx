import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import type { QuestionRevision } from "../../contracts/assessment";
import {
  useAuthoringDraftLifecycle,
  type AuthoringDraftLifecycleConditions,
} from "../useAuthoringDraftLifecycle";

/**
 * The projection: state in, seam refs out.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `authoringDraftLifecycle.test.ts` locks the precedence. This locks the other
 * half of the claim — that the refs the imperative seams read are a PROJECTION
 * of that state, so a seam can never observe a combination the state says is
 * impossible, and that a pending flag arriving before the editor has a document
 * cannot block the seed.
 */

function revision(revisionNumber: number): QuestionRevision {
  return {
    id: `rev-${revisionNumber}`,
    questionId: "q-1",
    semanticRevision: revisionNumber,
    revision: revisionNumber,
    state: "draft",
    questionType: "single_choice",
    stimulus: { version: 2, nodes: [], document: { type: "doc" } },
    prompt: { version: 2, nodes: [], document: { type: "doc" } },
    answer: { kind: "student_response", accepted: [], canonical: "" },
    rationale: { version: 2, nodes: [], document: { type: "doc" } },
    metadata: { sectionKey: "math", domain: null, skill: null, difficulty: "medium", tags: [] },
    accessibility: undefined,
  } as unknown as QuestionRevision;
}

const baseConditions: AuthoringDraftLifecycleConditions = {
  draft: revision(3),
  saveStatus: "idle",
  hasPendingChanges: false,
  divergedFromBase: false,
  publishedReadOnly: false,
  deletedRemotely: false,
};

function renderLifecycle(overrides: Partial<AuthoringDraftLifecycleConditions> = {}) {
  const conditions: AuthoringDraftLifecycleConditions = { ...baseConditions, ...overrides };
  return renderHook(() => {
    const mutationFrozenRef = useRef(false);
    const deletedRemotelyRef = useRef(false);
    const draftProtectedRef = useRef(false);
    const networkSavePausedRef = useRef(false);
    const lifecycle = useAuthoringDraftLifecycle({
      conditions,
      seams: { mutationFrozenRef, deletedRemotelyRef, draftProtectedRef, networkSavePausedRef },
    });
    // The refs themselves, read AFTER the projection effect has run: their
    // values are the seam's view of the committed render, not of the render
    // that declared them.
    return {
      lifecycle,
      mutationFrozenRef,
      deletedRemotelyRef,
      draftProtectedRef,
      networkSavePausedRef,
    };
  });
}

describe("the draft lifecycle projection", () => {
  it("projects a published draft into a frozen write target", () => {
    const { result } = renderLifecycle({ publishedReadOnly: true });

    expect(result.current.lifecycle.state).toBe("published-readonly");
    expect(result.current.mutationFrozenRef.current).toBe(true);
    // Freezing the target is not the same as pausing the network: the pause
    // exists for a divergence, and this is not one.
    expect(result.current.networkSavePausedRef.current).toBe(false);
  });

  it("keeps every condition readable independently of the resolved state", () => {
    const { result } = renderLifecycle({ publishedReadOnly: true, deletedRemotely: true });

    expect(result.current.lifecycle.state).toBe("published-readonly");
    expect(result.current.lifecycle.deletedRemotely).toBe(true);
    expect(result.current.deletedRemotelyRef.current).toBe(true);
  });

  it("protects the local copy only once there is a document to protect", () => {
    const clean = renderLifecycle();
    expect(clean.result.current.draftProtectedRef.current).toBe(false);

    const dirty = renderLifecycle({ hasPendingChanges: true });
    expect(dirty.result.current.lifecycle.state).toBe("editing");
    expect(dirty.result.current.draftProtectedRef.current).toBe(true);
  });

  it("does not let a recovered draft's pending flag block the seed", () => {
    // A recovered device copy arrives BEFORE the editor has a document. Held
    // work must not stop the seed, or the question would never open at all.
    const recovered = renderLifecycle({ draft: null, hasPendingChanges: true });

    expect(recovered.result.current.lifecycle.state).toBe("loading");
    expect(recovered.result.current.draftProtectedRef.current).toBe(false);
  });

  it("holds HTTP writes back while the draft is conflicted", () => {
    const { result } = renderLifecycle({ divergedFromBase: true, saveStatus: "conflict" });

    expect(result.current.lifecycle.state).toBe("conflicted");
    expect(result.current.lifecycle.dirty).toBe(true);
    expect(result.current.networkSavePausedRef.current).toBe(true);
  });
});
