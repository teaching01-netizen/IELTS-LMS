import { describe, expect, it, vi } from "vitest";
import type { AuthoringEventKind, ReconcilerContext } from "../contracts";
import { questionTargetOf, reconcileAuthoringEvent } from "../authoringCacheReconciler";
import { entityForKind, makeEvent } from "./fixtures";

function makeContext(overrides: Partial<ReconcilerContext> = {}): ReconcilerContext {
  return {
    examId: "exam-1",
    draftVersionId: "draft-7",
    isQuestionDirty: vi.fn(() => false),
    selectedExamQuestionId: null,
    invalidateShell: vi.fn(),
    invalidateQuestion: vi.fn(),
    removeQuestionCache: vi.fn(),
    invalidateReadinessAndRelease: vi.fn(),
    noteRemoteRevision: vi.fn(),
    noteRemoteStructuralChange: vi.fn(),
    ...overrides,
  };
}

function eventOfKind(kind: AuthoringEventKind, overrides: Record<string, unknown> = {}) {
  return makeEvent({
    kind,
    entity: entityForKind(kind),
    ...overrides,
  } as never);
}

describe("questionTargetOf", () => {
  it("returns the exam-question id only for question entities", () => {
    expect(questionTargetOf(makeEvent())).toBe("eq-1");
    expect(questionTargetOf(eventOfKind("draft.replaced"))).toBeNull();
  });
});

describe("reconcileAuthoringEvent", () => {
  it("question.changed (clean): invalidates the detail and passively touches the shell", () => {
    const ctx = makeContext();
    const outcome = reconcileAuthoringEvent(ctx, eventOfKind("question.changed"));
    expect(outcome.outcome).toBe("invalidated");
    expect(ctx.invalidateQuestion).toHaveBeenCalledWith("eq-1", "active");
    expect(ctx.invalidateShell).toHaveBeenCalledWith("none");
    expect(ctx.noteRemoteRevision).not.toHaveBeenCalled();
  });

  it("question.changed (dirty): writes nothing and records the remote revision", () => {
    const ctx = makeContext({ isQuestionDirty: vi.fn(() => true) });
    const outcome = reconcileAuthoringEvent(ctx, eventOfKind("question.changed", { revision: 9 }));
    expect(outcome.outcome).toBe("deferred-dirty");
    // The actor ID is threaded through (and only the ID — the envelope is
    // contractually name-free, so callers resolve names via presence).
    expect(ctx.noteRemoteRevision).toHaveBeenCalledWith("eq-1", 9, "user-alice");
    expect(ctx.invalidateQuestion).not.toHaveBeenCalled();
    expect(ctx.invalidateShell).not.toHaveBeenCalled();
    expect(ctx.removeQuestionCache).not.toHaveBeenCalled();
  });

  it("question.created and question.duplicated refetch the authoritative shell (no synthesized rows)", () => {
    for (const kind of ["question.created", "question.duplicated"] as const) {
      const ctx = makeContext();
      const outcome = reconcileAuthoringEvent(ctx, eventOfKind(kind));
      expect(outcome.outcome).toBe("invalidated");
      expect(ctx.invalidateShell).toHaveBeenCalledWith("active");
      expect(ctx.invalidateReadinessAndRelease).toHaveBeenCalled();
      expect(ctx.invalidateQuestion).not.toHaveBeenCalled();
    }
  });

  it("question.deleted removes the detail cache and refetches the shell when clean", () => {
    const ctx = makeContext();
    const outcome = reconcileAuthoringEvent(ctx, eventOfKind("question.deleted"));
    expect(outcome.outcome).toBe("invalidated");
    expect(ctx.removeQuestionCache).toHaveBeenCalledWith("eq-1");
    expect(ctx.invalidateShell).toHaveBeenCalledWith("active");
    expect(ctx.invalidateReadinessAndRelease).toHaveBeenCalled();
    // Still recorded: a clean author must learn WHO removed the question they
    // were reading. A dropped cache alone would only ever surface as an error.
    expect(ctx.noteRemoteStructuralChange).toHaveBeenCalledWith(
      "eq-1",
      "deleted",
      "user-alice",
    );
  });

  it("question.deleted on a DIRTY question preserves the draft and records divergence", () => {
    const ctx = makeContext({ isQuestionDirty: vi.fn(() => true) });
    const outcome = reconcileAuthoringEvent(ctx, eventOfKind("question.deleted"));
    expect(outcome).toEqual({
      outcome: "deferred-dirty-structural",
      examQuestionId: "eq-1",
      kind: "deleted",
    });
    // The unsaved draft is never destroyed, and the clean baseline it is
    // diffed against is never dropped.
    expect(ctx.removeQuestionCache).not.toHaveBeenCalled();
    expect(ctx.noteRemoteStructuralChange).toHaveBeenCalledWith(
      "eq-1",
      "deleted",
      "user-alice",
    );
    // Structural truth still moves, because membership/order is server-owned.
    expect(ctx.invalidateShell).toHaveBeenCalledWith("active");
    expect(ctx.invalidateReadinessAndRelease).toHaveBeenCalled();
  });

  it("question.moved refetches the shell for authoritative order (no client reorder math)", () => {
    const ctx = makeContext();
    reconcileAuthoringEvent(ctx, eventOfKind("question.moved"));
    expect(ctx.invalidateShell).toHaveBeenCalledWith("active");
    expect(ctx.invalidateQuestion).not.toHaveBeenCalled();
  });

  it("question.moved on a DIRTY question notes divergence without touching its draft", () => {
    const ctx = makeContext({ isQuestionDirty: vi.fn(() => true) });
    const outcome = reconcileAuthoringEvent(ctx, eventOfKind("question.moved"));
    expect(outcome).toEqual({
      outcome: "deferred-dirty-structural",
      examQuestionId: "eq-1",
      kind: "moved",
    });
    expect(ctx.invalidateShell).toHaveBeenCalledWith("active");
    expect(ctx.invalidateQuestion).not.toHaveBeenCalled();
    expect(ctx.removeQuestionCache).not.toHaveBeenCalled();
  });

  it("question.bulk_changed always invalidates once, never per-id patches", () => {
    const ctx = makeContext();
    reconcileAuthoringEvent(
      ctx,
      eventOfKind("question.bulk_changed", {
        affectedExamQuestionIds: Array.from({ length: 100 }, (_, i) => `eq-${i}`),
      }),
    );
    expect(ctx.invalidateShell).toHaveBeenCalledTimes(1);
    expect(ctx.invalidateReadinessAndRelease).toHaveBeenCalledTimes(1);
    expect(ctx.invalidateQuestion).not.toHaveBeenCalled();
    expect(ctx.removeQuestionCache).not.toHaveBeenCalled();
  });

  it("question.bulk_changed notes divergence for dirty affected ids and no others", () => {
    const dirty = new Set(["eq-3", "eq-7"]);
    const ctx = makeContext({ isQuestionDirty: vi.fn((id: string) => dirty.has(id)) });
    reconcileAuthoringEvent(
      ctx,
      eventOfKind("question.bulk_changed", {
        entity: { kind: "exam", examId: "exam-1" },
        affectedExamQuestionIds: ["eq-1", "eq-3", "eq-7", "eq-9"],
      }),
    );
    expect(ctx.noteRemoteStructuralChange).toHaveBeenCalledTimes(2);
    expect(ctx.noteRemoteStructuralChange).toHaveBeenCalledWith(
      "eq-3",
      "bulk_changed",
      "user-alice",
    );
    expect(ctx.noteRemoteStructuralChange).toHaveBeenCalledWith(
      "eq-7",
      "bulk_changed",
      "user-alice",
    );
    // Still bounded work: one structural refetch, never a per-id fan-out.
    expect(ctx.invalidateShell).toHaveBeenCalledTimes(1);
    expect(ctx.invalidateQuestion).not.toHaveBeenCalled();
    expect(ctx.removeQuestionCache).not.toHaveBeenCalled();
  });

  it("exam.changed is lifecycle-adjacent and never writes content caches", () => {
    const ctx = makeContext();
    const outcome = reconcileAuthoringEvent(ctx, eventOfKind("exam.changed"));
    expect(outcome).toEqual({ outcome: "lifecycle", signal: "exam-changed" });
    expect(ctx.invalidateShell).toHaveBeenCalledWith("none");
    expect(ctx.invalidateReadinessAndRelease).toHaveBeenCalled();
  });

  it("draft.replaced and exam.published signal lifecycle so the workspace can re-resolve", () => {
    const replaced = reconcileAuthoringEvent(makeContext(), eventOfKind("draft.replaced"));
    expect(replaced).toEqual({ outcome: "lifecycle", signal: "draft-replaced" });
    const published = reconcileAuthoringEvent(makeContext(), eventOfKind("exam.published"));
    expect(published).toEqual({ outcome: "lifecycle", signal: "published" });
  });

  it("draft.opened is informational and writes nothing", () => {
    const ctx = makeContext();
    const outcome = reconcileAuthoringEvent(ctx, eventOfKind("draft.opened"));
    expect(outcome).toEqual({ outcome: "ignored", reason: "informational" });
    expect(ctx.invalidateShell).not.toHaveBeenCalled();
  });

  it("an unknown future kind is ignored, never thrown", () => {
    const ctx = makeContext();
    const outcome = reconcileAuthoringEvent(ctx, makeEvent({ kind: "question.pinned" as never }));
    expect(outcome).toEqual({ outcome: "ignored", reason: "unknown-kind" });
    expect(ctx.invalidateShell).not.toHaveBeenCalled();
  });
});
