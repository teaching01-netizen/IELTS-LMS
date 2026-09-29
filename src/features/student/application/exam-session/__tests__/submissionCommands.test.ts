import { describe, expect, it, vi } from "vitest";
import { createStudentExamStore } from "../studentExamStoreFactory";
import { createStudentSubmissionCommands } from "../submissionCommands";

function createStore() {
  return createStudentExamStore({
    attemptId: "attempt-1",
    scheduleId: "schedule-1",
    candidateId: "candidate-1",
    phase: "exam",
    currentModule: "reading",
    currentQuestionId: "q1",
    answers: {},
    writingAnswers: {},
    flags: {},
    runtimeSnapshot: null,
    displayTimeRemaining: null,
    syncState: "idle",
    pendingMutationCount: 0,
    acceptedThroughSeq: 0,
  });
}

describe("student submission commands", () => {
  it("commits drafts and flushes durability before submitting", async () => {
    const order: string[] = [];
    const commands = createStudentSubmissionCommands({
      store: createStore(),
      drafts: {
        async commitAll() {
          order.push("commit");
        },
        async flushDurability() {
          order.push("durability");
        },
      },
      transport: {
        async flushPending() {
          order.push("flush");
          return true;
        },
        async submit() {
          order.push("submit");
          return true;
        },
      },
    });

    await expect(commands.requestSubmit()).resolves.toEqual({ kind: "submitted" });
    expect(order).toEqual(["commit", "durability", "flush", "submit"]);
  });

  it("submits after an already-completed barrier without flushing twice", async () => {
    const order: string[] = [];
    const commands = createStudentSubmissionCommands({
      store: createStore(),
      drafts: {
        async commitAll() {
          order.push("commit");
        },
        async flushDurability() {
          order.push("durability");
        },
      },
      transport: {
        async flushPending() {
          order.push("flush");
          return true;
        },
        async submit() {
          order.push("submit");
          return true;
        },
        async submitAfterBarrier() {
          order.push("submit-after-barrier");
          return true;
        },
      },
    });

    await expect(commands.flushBarrier()).resolves.toEqual({ kind: "ready" });
    await expect(commands.submitAfterBarrier()).resolves.toEqual({ kind: "submitted" });
    expect(order).toEqual(["commit", "durability", "flush", "submit-after-barrier"]);
  });

  it("resolves an ambiguous submit by querying the same submission identity", async () => {
    const submit = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce(true);
    const commands = createStudentSubmissionCommands({
      store: createStore(),
      drafts: {
        async commitAll() {},
        async flushDurability() {},
      },
      transport: {
        async flushPending() {
          return true;
        },
        submit,
      },
    });

    // Ambiguous failure (transport threw after the server may have committed):
    // the retry reuses the same coordinator/transport identity rather than
    // minting a new submission, so the server dedups to existingSubmissionId.
    await expect(commands.requestSubmit()).rejects.toThrow("network timeout");
    await expect(commands.requestSubmit()).resolves.toEqual({ kind: "submitted" });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("does not report completion when the durability barrier fails", async () => {
    const submit = vi.fn(async () => true);
    const store = createStore();
    const commands = createStudentSubmissionCommands({
      store,
      drafts: {
        async commitAll() {},
        async flushDurability() {},
      },
      transport: {
        async flushPending() {
          return false;
        },
        submit,
      },
    });

    await expect(commands.requestSubmit()).resolves.toEqual({
      kind: "blocked",
      reason: "durability_failed",
    });
    expect(submit).not.toHaveBeenCalled();
    expect(store.getState().persistence.syncState).toBe("error");
  });
});
