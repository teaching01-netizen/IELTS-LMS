/**
 * DurableResponseEngine core guarantees + frozen E1/E2 contract pins (WP-T1).
 *
 * WP0 mapping: this file is the WP-T1-owned engine-guarantee suite (monotonic
 * versions, coalescing, ack identity, quarantine routing, recovery overlay,
 * submit, storage-fault). Second pass hardens two pins (blocked-accept
 * keeps-blocked + ack-prunes-quarantine) and pins the E2 shapes owned here
 * (per-write tombstone IDs, CONTROL_EPOCH_STALE drain blocking, conflict
 * persistence). quarantine_pruned pins are ACTIVE (E2 landed green — T1
 * SIGNAL 2026-09-10); no prune pins remain deferred.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DurableResponseEngine, type TransportClient } from "../DurableResponseEngine";
import {
  getVisibleResponse,
  type ResponsePayload,
  type ResponseBatchRequestV2,
  type ResponseBatchResponseV2,
  type ResponseCommandV2,
  type ResponseSnapshotV2,
  type SubmitAttemptV2Request,
  type SubmitAttemptV2Response,
} from "../types";

// WP-T1 (L3): quarantine archive/tombstone timing is deterministic only when
// the draft store is a controllable mock (real-store writes resolve on their
// own microtask chain and race the test barrier). The mock keeps localStorage
// checkpoints real — reload/recovery assertions still parse real content.
const storage = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn(), clear: vi.fn() }));
vi.mock("../../../utils/durableDraftStore", () => ({
  saveDurableDraft: storage.save,
  listDurableDrafts: storage.list,
  clearDurableDraft: storage.clear,
}));

describe("DurableResponseEngine", () => {
  let transport: TransportClient;

  beforeEach(() => {
    localStorage.clear();
    storage.save.mockReset().mockResolvedValue(undefined);
    storage.list.mockReset().mockResolvedValue([]);
    storage.clear.mockReset().mockResolvedValue(undefined);
    transport = {
      sendBatch: vi.fn(),
      submit: vi.fn(),
      fetchSnapshot: vi.fn().mockResolvedValue([]),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("guarantee 1 & 2: accepted response has monotonic version and visible answer is never replaced by older", async () => {
    transport.sendBatch = vi.fn().mockImplementation(() => new Promise(() => {}));
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    const payload1: ResponsePayload = {
      answer: "A",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    };

    await engine.acceptResponse("q-1", payload1);
    void engine.flush();
    await vi.waitFor(() => expect(transport.sendBatch).toHaveBeenCalledTimes(1));

    const state1 = engine.getStates().get("q-1");
    expect(state1?.pending?.clientVersion).toBe(1);
    expect(getVisibleResponse(state1)?.answer).toBe("A");

    const payload2: ResponsePayload = {
      answer: "B",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    };

    await engine.acceptResponse("q-1", payload2);

    const state2 = engine.getStates().get("q-1");
    expect(state2?.pending?.clientVersion).toBe(2);
    expect(getVisibleResponse(state2)?.answer).toBe("B");

    // Emulate arrival of the first write's acknowledgement after version 2 exists.
    // Even if server confirms version 1, visible value must remain version 2 ('B').
    engine["handleAcknowledgement"]({
      writeId: state1?.pending?.writeId ?? "missing-write-id",
      questionId: "q-1",
      clientVersion: 1,
      outcome: "applied",
      serverRevision: 10,
      canonicalResponse: payload1,
      contentHash: "sha256:1",
    });

    const stateAfterOlderAck = engine.getStates().get("q-1");
    expect(getVisibleResponse(stateAfterOlderAck)?.answer).toBe("B");
    expect(stateAfterOlderAck?.confirmed?.payload.answer).toBe("A");
    engine.destroy();
  });

  it("guarantee 3: coalesces multiple edits into at most one unsent entry per question", async () => {
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    await engine.acceptResponse("q-1", {
      answer: "1",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });
    await engine.acceptResponse("q-1", {
      answer: "2",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });
    await engine.acceptResponse("q-1", {
      answer: "3",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });

    expect(engine.getPendingCount()).toBe(1);
    const pending = engine.getStates().get("q-1")?.pending;
    expect(pending?.clientVersion).toBe(3);
    expect(pending?.payload.answer).toBe("3");
  });

  it("guarantee 7 & 8: acknowledgement removes pending only when exact writeId matches", async () => {
    let resolveBatch: (res: ResponseBatchResponseV2) => void;
    let callCount = 0;
    transport.sendBatch = vi.fn().mockImplementation((_attemptId, req: ResponseBatchRequestV2) => {
      callCount++;
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveBatch = resolve;
        });
      }
      return Promise.resolve({
        attemptRevision: 2,
        serverTime: new Date().toISOString(),
        acknowledgements: req.commands.map((cmd) => ({
          writeId: cmd.writeId,
          questionId: cmd.questionId,
          clientVersion: cmd.clientVersion,
          outcome: "applied",
          serverRevision: 2,
          canonicalResponse: cmd.response,
          contentHash: "hash-2",
        })),
      });
    });

    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    await engine.acceptResponse("q-1", {
      answer: "first",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });

    const writeId1 = engine.getStates().get("q-1")?.pending?.writeId;
    if (!writeId1) throw new Error("Expected first pending write id");

    // Start flush so writeId1 is in flight
    const flushPromise = engine.flush();
    await Promise.resolve();

    // User types new answer while writeId1 is in flight
    await engine.acceptResponse("q-1", {
      answer: "second",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });
    const writeId2 = engine.getStates().get("q-1")?.pending?.writeId;
    if (!writeId2) throw new Error("Expected second pending write id");
    expect(writeId2).not.toBe(writeId1);

    // Resolve in-flight batch for writeId1
    resolveBatch!({
      attemptRevision: 1,
      serverTime: new Date().toISOString(),
      acknowledgements: [
        {
          writeId: writeId1,
          questionId: "q-1",
          clientVersion: 1,
          outcome: "applied",
          serverRevision: 1,
          canonicalResponse: {
            answer: "first",
            markedForReview: false,
            eliminatedOptions: [],
            annotations: [],
          },
          contentHash: "hash-1",
        },
      ],
    });

    // Yield to microtasks so drainOutbox processes acknowledgement
    await Promise.resolve();

    // writeId2 is still pending and visible answer is still 'second'!
    const current = engine.getStates().get("q-1");
    expect(current?.pending?.writeId).toBe(writeId2);
    expect(getVisibleResponse(current)?.answer).toBe("second");
    expect(current?.confirmed?.payload.answer).toBe("first");

    await flushPromise;
  });

  it("quarantines terminal conflict and stops retrying", async () => {
    transport.sendBatch = vi.fn().mockRejectedValue({
      code: "LEASE_FENCED",
      message: "Fenced by newer session",
    });

    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    await engine.acceptResponse("q-1", {
      answer: "fenced_answer",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });

    await engine.flush();

    expect(engine.getStatus()).toBe("conflict_fenced");
    expect(engine.getQuarantined().length).toBe(1);
    expect(engine.getQuarantined()[0].reason).toBe("LEASE_FENCED");
  });

  it("quarantines ASSESSMENT_CONFLICT/ATTEMPT_TERMINAL as terminal (stop, not retry)", async () => {
    // Exam-day: a save against a submitted/terminated attempt returns
    // code ASSESSMENT_CONFLICT + details.reason ATTEMPT_TERMINAL. The
    // engine must surface conflict_terminal (re-bootstrap) instead of
    // looping the bounded retry forever.
    transport.sendBatch = vi.fn().mockRejectedValue({
      code: "ASSESSMENT_CONFLICT",
      details: { reason: "ATTEMPT_TERMINAL" },
      message: "The SAT attempt is already terminal.",
    });

    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    await engine.acceptResponse("q-1", {
      answer: "late_answer",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });

    await engine.flush();

    expect(engine.getStatus()).toBe("conflict_terminal");
    expect(engine.getQuarantined().length).toBe(1);
  });

  it("retries ASSESSMENT_CONFLICT/SECTION_CLOCK_MISSING (operator state, not terminal)", async () => {
    // A missing cohort section clock is retryable: quarantining would
    // strand answers the next cohort-start bootstrap would accept. The
    // drain loop sleeps between bounded retries, so only the first
    // attempt is awaited — the assertions pin routing (retry, not
    // quarantine), not drain completion.
    let attempts = 0;
    transport.sendBatch = vi.fn().mockImplementation(() => {
      attempts += 1;
      return Promise.reject({
        code: "ASSESSMENT_CONFLICT",
        details: { reason: "SECTION_CLOCK_MISSING" },
        message: "The authoritative SAT section clock is missing.",
      });
    });

    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    await engine.acceptResponse("q-1", {
      answer: "early_answer",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });

    // Fire-and-observe: the first rejection routes to retry (still
    // pending), not to quarantine. Destroy stops the scheduled retry.
    const flushPromise = engine.flush();
    await vi.waitFor(() => expect(attempts).toBeGreaterThanOrEqual(1));
    expect(engine.getQuarantined().length).toBe(0);
    expect(engine.getStatus()).not.toBe("conflict_terminal");
    engine.destroy();
    await flushPromise.catch(() => undefined);
  });

  it("recovers local drafts and overlays onto server snapshot", async () => {
    // Simulate pre-existing checkpoint in localStorage
    localStorage.setItem(
      "response-checkpoint:v2:att-1:q-1",
      JSON.stringify({
        payload: {
          answer: "draft-answer",
          markedForReview: true,
          eliminatedOptions: [],
          annotations: [],
        },
        writeId: "recovered-write-1",
        leaseEpoch: 1,
        controlEpoch: 1,
        clientVersion: 5,
        durability: "checkpoint",
      })
    );

    // Server has an older confirmed answer
    transport.fetchSnapshot = vi.fn().mockResolvedValue([
      {
        writeId: "server-write-0",
        questionId: "q-1",
        clientVersion: 3,
        outcome: "applied",
        serverRevision: 42,
        canonicalResponse: {
          answer: "server-confirmed-answer",
          markedForReview: false,
          eliminatedOptions: [],
          annotations: [],
        },
        contentHash: "hash-0",
      },
    ]);

    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    await engine.recover();

    const state = engine.getStates().get("q-1");
    expect(state).toBeDefined();
    // Confirmed state matches server
    expect(state?.confirmed?.payload.answer).toBe("server-confirmed-answer");
    // Pending draft overlay preserves draft answer
    expect(state?.pending?.payload.answer).toBe("draft-answer");
    expect(state?.pending?.writeId).toBe("recovered-write-1");
    // Visible answer is the pending draft
    expect(getVisibleResponse(state)?.answer).toBe("draft-answer");
  });

  it("seeds the next client version from the authoritative server snapshot", async () => {
    transport.fetchSnapshot = vi.fn().mockResolvedValue([
      {
        writeId: "server-write-7",
        questionId: "q-1",
        clientVersion: 7,
        outcome: "applied",
        serverRevision: 19,
        canonicalResponse: {
          answer: "server",
          markedForReview: false,
          eliminatedOptions: [],
          annotations: [],
        },
        contentHash: "hash-7",
      },
    ]);

    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    await engine.recover();
    await engine.acceptResponse("q-1", {
      answer: "new-local",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });

    expect(engine.getStates().get("q-1")?.pending?.clientVersion).toBe(8);
    engine.destroy();
  });

  it("keeps a command pending when the server response omits its acknowledgement", async () => {
    transport.sendBatch = vi.fn().mockResolvedValue({
      attemptRevision: 20,
      serverTime: new Date().toISOString(),
      acknowledgements: [],
    });

    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    await engine.acceptResponse("q-1", {
      answer: "not-acknowledged",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });
    await engine.flush();

    expect(engine.getPendingCount()).toBe(1);
    expect(engine.getStatus()).not.toBe("synced");
    engine.destroy();
  });

  it("recognizes backendCode when classifying a structured durability error", () => {
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    expect(
      (
        engine as unknown as { extractErrorCode: (error: unknown) => string | null }
      ).extractErrorCode({
        backendCode: "LEASE_FENCED",
      })
    ).toBe("LEASE_FENCED");
    engine.destroy();
  });

  it("ignores an acknowledgement for a write that was not sent by this engine", async () => {
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    (engine as unknown as { handleAcknowledgement: (ack: unknown) => void }).handleAcknowledgement({
      writeId: "unknown-write",
      questionId: "q-1",
      clientVersion: 1,
      outcome: "applied",
      serverRevision: 1,
      canonicalResponse: {
        answer: "forged",
        markedForReview: false,
        eliminatedOptions: [],
        annotations: [],
      },
      contentHash: "forged-hash",
    });

    expect(engine.getStates().has("q-1")).toBe(false);
    engine.destroy();
  });

  it("waits for an in-flight durable acceptance before submitting final commands", async () => {
    transport.submit = vi.fn().mockImplementation((_attemptId, request) =>
      Promise.resolve({
        attemptId: "att-1",
        submissionId: request.submissionId,
        status: "submitted",
        attemptRevision: 1,
        finalResponseDigest: "sha256:race",
        submittedAt: new Date().toISOString(),
        acknowledgements: request.finalCommands.map((command) => ({
          writeId: command.writeId,
          questionId: command.questionId,
          clientVersion: command.clientVersion,
          outcome: "applied",
          serverRevision: 1,
          canonicalResponse: command.response,
          contentHash: "sha256:response",
        })),
      })
    );

    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    const accepted = engine.acceptResponse("q-1", {
      answer: "race-safe",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });
    const submitted = engine.submit("att-1", 0);

    await accepted;
    const receipt = await submitted;
    expect(receipt.acknowledgements).toHaveLength(1);
    expect(transport.submit).toHaveBeenCalledTimes(1);
    expect(transport.submit).toHaveBeenCalledWith(
      "att-1",
      expect.objectContaining({ finalCommands: [expect.objectContaining({ questionId: "q-1" })] })
    );
    engine.destroy();
  });

  it("durably settles an edit that arrives while terminal submission is in flight", async () => {
    let resolveSubmit: (() => void) | undefined;
    transport.submit = vi
      .fn()
      .mockImplementation((_attemptId: string, request: SubmitAttemptV2Request) => {
        return new Promise<SubmitAttemptV2Response>((resolve) => {
          resolveSubmit = () =>
            resolve({
              attemptId: "att-1",
              submissionId: request.submissionId,
              status: "submitted",
              attemptRevision: 1,
              finalResponseDigest: "sha256:terminal",
              submittedAt: new Date().toISOString(),
              acknowledgements: request.finalCommands.map((command) => ({
                writeId: command.writeId,
                questionId: command.questionId,
                clientVersion: command.clientVersion,
                outcome: "applied",
                serverRevision: 1,
                canonicalResponse: command.response,
                contentHash: "sha256:response",
              })),
            });
        });
      });

    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    await engine.acceptResponse("q-1", {
      answer: "before-submit",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });
    const submission = engine.submit("sub-race", 1);
    await vi.waitFor(() => expect(transport.submit).toHaveBeenCalledTimes(1));

    const lateAcceptance = engine.acceptResponse("q-2", {
      answer: "during-submit",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });
    resolveSubmit?.();
    await lateAcceptance;
    await submission;

    expect(engine.getPendingCount()).toBe(0);
    expect(engine.getQuarantined().some((entry) => entry.questionId === "q-2")).toBe(true);
    // Archive-before-delete: the checkpoint becomes a tombstone audit record
    // (visible blocked, never resendable) instead of vanishing. The archive
    // write is async fire-and-forget, so wait for the tombstone to land.
    await vi.waitFor(() => {
      const stored = localStorage.getItem("response-checkpoint:v2:att-1:q-2");
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored ?? "{}")).toMatchObject({ tombstoned: true, questionId: "q-2" });
    });
    // Tombstoned drafts surface as visible-but-blocked on next recovery.
    const engine2 = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });
    await engine2.recover();
    expect(engine2.getBlockedQuestionIds()).toContain("q-2");
    expect(engine2.getBlockedCount()).toBe(1);
    engine2.destroy();
    engine.destroy();
  });

  it("fences new responses after recovery observes a terminal attempt", async () => {
    transport.fetchSnapshot = vi.fn().mockResolvedValue({
      attemptId: "att-1",
      protocolVersion: 2,
      deliveryStatus: "submitted",
      leaseEpoch: 1,
      controlEpoch: 2,
      attemptRevision: 4,
      deadlineAt: null,
      closingGraceUntil: null,
      responses: [],
    });

    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    await engine.recover();

    await expect(
      engine.acceptResponse("q-1", {
        answer: "after-terminal",
        markedForReview: false,
        eliminatedOptions: [],
        annotations: [],
      })
    ).rejects.toThrow();
    expect(engine.getStatus()).toBe("conflict_terminal");
    expect(engine.getPendingCount()).toBe(0);
    expect(transport.sendBatch).not.toHaveBeenCalled();
    engine.destroy();
  });

  it("does not publish an in-flight response after the engine is destroyed", async () => {
    let resolveBatch: ((response: ResponseBatchResponseV2) => void) | undefined;
    transport.sendBatch = vi.fn().mockImplementation(
      () =>
        new Promise<ResponseBatchResponseV2>((resolve) => {
          resolveBatch = resolve;
        })
    );
    const onStateChange = vi.fn();
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
      onStateChange,
    });

    await engine.acceptResponse("q-1", {
      answer: "in-flight",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });
    const flush = engine.flush();
    await vi.waitFor(() => expect(transport.sendBatch).toHaveBeenCalledTimes(1));
    onStateChange.mockClear();

    engine.destroy();
    resolveBatch?.({
      attemptRevision: 1,
      serverTime: new Date().toISOString(),
      acknowledgements: [],
    });
    await flush;

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it("submits attempt with final pending commands and clears local checkpoints", async () => {
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-1",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    await engine.acceptResponse("q-1", {
      answer: "final-answer",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    });

    const writeId = engine.getStates().get("q-1")?.pending?.writeId;
    if (!writeId) throw new Error("Expected final pending write id");
    expect(localStorage.getItem("response-checkpoint:v2:att-1:q-1")).not.toBeNull();

    transport.submit = vi.fn().mockResolvedValue({
      attemptId: "att-1",
      submissionId: "sub-1",
      status: "submitted",
      attemptRevision: 10,
      finalResponseDigest: "sha256:abc",
      submittedAt: new Date().toISOString(),
      acknowledgements: [
        {
          writeId,
          questionId: "q-1",
          clientVersion: 1,
          outcome: "applied",
          serverRevision: 10,
          canonicalResponse: {
            answer: "final-answer",
            markedForReview: false,
            eliminatedOptions: [],
            annotations: [],
          },
          contentHash: "hash-final",
        },
      ],
    });

    const receipt = await engine.submit("sub-1", 9);
    expect(receipt.status).toBe("submitted");
    expect(transport.submit).toHaveBeenCalledWith(
      "att-1",
      expect.objectContaining({
        submissionId: "sub-1",
        finalCommands: expect.arrayContaining([
          expect.objectContaining({ writeId, questionId: "q-1" }),
        ]),
      })
    );

    // Checkpoint must be cleared after successful receipt
    expect(localStorage.getItem("response-checkpoint:v2:att-1:q-1")).toBeNull();
    expect(engine.getQuarantined()).toHaveLength(0);
  });

  it("E1(a) harden: typing on a blocked question keeps the block and stays non-sendable (visible tracks latest)", async () => {
    // Hardens the frozen (a) contract beyond the preservation-suite pin:
    // repeated typing on the blocked question never drops the block, never
    // enqueues, and the submit gate keeps refusing until reconcile/discard.
    transport.fetchSnapshot = vi.fn().mockResolvedValue({
      attemptId: "att-1", protocolVersion: 2, deliveryStatus: "running",
      leaseEpoch: 1, controlEpoch: 1, attemptRevision: 1, responses: [],
    });
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1", attemptId: "att-1", leaseEpoch: 1, controlEpoch: 1, transport,
    });
    try {
      await engine.recover();
      await engine.acceptResponse("q-1", { answer: "blocked draft", markedForReview: false, eliminatedOptions: [], annotations: [] });
      engine.updateEpochs(1, 2);
      expect(engine.getBlockedCount()).toBe(1);
      await engine.acceptResponse("q-1", { answer: "edit one", markedForReview: false, eliminatedOptions: [], annotations: [] });
      await engine.acceptResponse("q-1", { answer: "edit two", markedForReview: true, eliminatedOptions: [], annotations: [] });
      expect(engine.getBlockedCount()).toBe(1);
      expect(engine.getBlockedQuestionIds()).toContain("q-1");
      expect(getVisibleResponse(engine.getStates().get("q-1"))?.answer).toBe("edit two");
      expect(getVisibleResponse(engine.getStates().get("q-1"))?.markedForReview).toBe(true);
      transport.sendBatch = vi.fn();
      await engine.flush();
      expect(transport.sendBatch).not.toHaveBeenCalled();
      await expect(engine.submit("sub-hardened", 1)).rejects.toThrow(/Blocked drafts need attention/);
      expect(engine.discardBlocked("q-1")).toBe(true);
      expect(engine.getBlockedCount()).toBe(0);
    } finally {
      engine.destroy();
    }
  });

  it("E2 prune: ack of a replacement write prunes the quarantine ledger (memory + durable key + event)", async () => {
    // Hardens the ack-superseded prune owned here: fence q-1 (ledger + tombstone),
    // retype after the tombstone, flush the resolving batch, and pin the splice
    // + durable delete + spec-exact event in this suite too (not only telemetry).
    const events: Array<{ name: string; fields?: Record<string, string | number | boolean | null | undefined> }> = [];
    transport.fetchSnapshot = vi.fn().mockResolvedValue({
      attemptId: "att-1", protocolVersion: 2, deliveryStatus: "running",
      leaseEpoch: 1, controlEpoch: 1, attemptRevision: 1, responses: [],
    });
    transport.sendBatch = vi.fn().mockImplementation(async (_attemptId: string, req: ResponseBatchRequestV2) => ({
      attemptRevision: 1, serverTime: new Date().toISOString(),
      acknowledgements: req.commands.map((command) => ({ writeId: command.writeId, questionId: command.questionId,
        clientVersion: command.clientVersion, outcome: "applied" as const, serverRevision: 1, canonicalResponse: command.response, contentHash: "hash-live" })),
    }));
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1", attemptId: "att-1", leaseEpoch: 1, controlEpoch: 1, transport,
      onDurabilityEvent: (name, fields) => { events.push({ name, fields }); },
    });
    try {
      await engine.recover();
      await engine.acceptResponse("q-1", { answer: "fenced", markedForReview: false, eliminatedOptions: [], annotations: [] });
      engine.updateEpochs(2, 1);
      await vi.waitFor(() => expect(engine.getQuarantined()).toHaveLength(1));
      const fencedWriteId = engine.getQuarantined()[0]?.writeId as string;
      await vi.waitFor(() => {
        const raw = localStorage.getItem("response-checkpoint:v2:att-1:q-1");
        expect(raw).not.toBeNull();
        expect((JSON.parse(raw as string) as { tombstoned?: boolean }).tombstoned).toBe(true);
      });
      await engine.acceptResponse("q-1", { answer: "replacement", markedForReview: false, eliminatedOptions: [], annotations: [] });
      await engine.flush();
      await vi.waitFor(() => expect(events.map((e) => e.name)).toContain("quarantine_pruned"));
      expect(engine.getQuarantined().filter((e) => e.questionId === "q-1")).toHaveLength(0);
      const pruned = events.filter((e) => e.name === "quarantine_pruned" && e.fields?.reason === "ack-superseded");
      expect(pruned.length).toBeGreaterThan(0);
      expect(pruned[0]?.fields?.questionId).toBe("q-1");
      const deletedKeys = storage.clear.mock.calls.map((call) => call[0] as string);
      expect(deletedKeys.some((key) => key.includes("v2_quarantine:att-1:") && key.includes(fencedWriteId))).toBe(true);
    } finally {
      engine.destroy();
    }
  });

  it("E2 tombstone: surfaced tombstone carries the fenced writeId and synthetic ids never re-quarantine", async () => {
    // Per-write tombstone shape (E2): the durable tombstone record stores the
    // fenced writeId, and recovery surfaces it as visible-but-blocked with the
    // synthetic id tombstoned-<Q>-<fencedWriteId> — never the old
    // tombstoned-<Q> shape — so two tombstones for one question cannot
    // collide. The synthetic id is audit surface only: fencing it again must
    // not grow the quarantine ledger.
    transport.fetchSnapshot = vi.fn().mockResolvedValue({
      attemptId: "att-1", protocolVersion: 2, deliveryStatus: "running",
      leaseEpoch: 1, controlEpoch: 1, attemptRevision: 1, responses: [],
    });
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1", attemptId: "att-1", leaseEpoch: 1, controlEpoch: 1,
      drainDebounceMs: 60_000, transport,
    });
    try {
      await engine.recover();
      await engine.acceptResponse("q-1", { answer: "fenced", markedForReview: false, eliminatedOptions: [], annotations: [] });
      const fencedWriteId = engine.getStates().get("q-1")?.pending?.writeId;
      if (!fencedWriteId) throw new Error("Expected fenced pending write id");
      engine.updateEpochs(2, 1);
      await vi.waitFor(() => expect(engine.getQuarantined()).toHaveLength(1));
      expect(engine.getQuarantined()[0]?.writeId).toBe(fencedWriteId);
      // The durable tombstone record carries the exact fenced writeId.
      await vi.waitFor(() => {
        const raw = localStorage.getItem("response-checkpoint:v2:att-1:q-1");
        expect(raw).not.toBeNull();
        const tombstone = JSON.parse(raw as string) as { tombstoned?: boolean; writeId?: string };
        expect(tombstone.tombstoned).toBe(true);
        expect(tombstone.writeId).toBe(fencedWriteId);
      });
      // Recovery surfaces the tombstone as visible-but-blocked with the
      // per-write synthetic id — containing the fenced writeId.
      const engine2 = new DurableResponseEngine({
        scheduleId: "sched-1", attemptId: "att-1", leaseEpoch: 1, controlEpoch: 1,
        drainDebounceMs: 60_000, transport,
      });
      try {
        await engine2.recover();
        const surfaced = engine2.getStates().get("q-1")?.pending;
        expect(surfaced?.blocked).toBeDefined();
        expect(surfaced?.writeId).toBe(`tombstoned-q-1-${fencedWriteId}`);
        expect(surfaced?.writeId).toContain(fencedWriteId);
        expect(surfaced?.writeId).not.toBe("tombstoned-q-1");
        expect(getVisibleResponse(engine2.getStates().get("q-1"))?.answer).toBe("fenced");
        // Synthetic tombstone ids are never re-fenced: repeated fences of the
        // synthetic id emit no new quarantine entry.
        const fenced = engine2 as unknown as {
          quarantineEntry: (command: ResponseCommandV2, reason: string) => void;
        };
        const synthetic: ResponseCommandV2 = {
          writeId: surfaced?.writeId as string,
          questionId: "q-1",
          clientVersion: 0,
          response: { answer: "fenced", markedForReview: false, eliminatedOptions: [], annotations: [] },
        };
        const before = engine2.getQuarantined().length;
        const tombstoneBefore = localStorage.getItem("response-checkpoint:v2:att-1:q-1");
        fenced.quarantineEntry(synthetic, "EPOCH_STALE");
        fenced.quarantineEntry(synthetic, "EPOCH_STALE");
        expect(engine2.getQuarantined()).toHaveLength(before);
        // The guard returns before any state touch: the durable tombstone
        // record is byte-identical (no tombstone-of-tombstone rewrite).
        expect(localStorage.getItem("response-checkpoint:v2:att-1:q-1")).toBe(tombstoneBefore);
      } finally {
        engine2.destroy();
      }
    } finally {
      engine.destroy();
    }
  });

  it("E2 RISK-6: conflict_fenced survives drain + epoch bump and clears only on discardBlocked", async () => {
    // A lease fence persists until a user-visible resolution: a subsequent
    // drain or epoch adoption must never silently clear it back to synced.
    transport.fetchSnapshot = vi.fn().mockResolvedValue({
      attemptId: "att-1", protocolVersion: 2, deliveryStatus: "running",
      leaseEpoch: 1, controlEpoch: 1, attemptRevision: 1, responses: [],
    });
    transport.sendBatch = vi.fn().mockRejectedValue({
      code: "LEASE_FENCED",
      message: "Fenced by newer session",
    });
    // Park the quarantine archive so the fenced draft stays visible-blocked
    // (discardable) instead of settling into a tombstone mid-test.
    let releaseArchive!: () => void;
    const archiveGate = new Promise<void>((resolve) => { releaseArchive = resolve; });
    const baseSave = storage.save.getMockImplementation();
    storage.save.mockImplementation((key: string, value: unknown) => {
      if (String(key).includes("v2_quarantine:")) return archiveGate.then(() => undefined);
      const impl = baseSave as unknown as ((k: string, v: unknown) => Promise<void>) | undefined;
      if (impl) return impl(key, value);
      return Promise.resolve(undefined);
    });
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1", attemptId: "att-1", leaseEpoch: 1, controlEpoch: 1, transport,
    });
    try {
      await engine.recover();
      await engine.acceptResponse("q-1", { answer: "fenced", markedForReview: false, eliminatedOptions: [], annotations: [] });
      await engine.flush();
      expect(engine.getStatus()).toBe("conflict_fenced");
      expect(engine.getQuarantined()).toHaveLength(1);
      expect(engine.getBlockedQuestionIds()).toContain("q-1");
      // A subsequent drain sends nothing new and never downgrades the fence.
      const sendsBefore = (transport.sendBatch as ReturnType<typeof vi.fn>).mock.calls.length;
      await engine.flush();
      expect(engine.getStatus()).toBe("conflict_fenced");
      expect(engine.getQuarantined()).toHaveLength(1);
      expect((transport.sendBatch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(sendsBefore);
      // Subsequent epoch bumps (lease, then control) never clear the fence.
      engine.updateEpochs(2, 1);
      expect(engine.getStatus()).toBe("conflict_fenced");
      engine.updateEpochs(2, 2);
      expect(engine.getStatus()).toBe("conflict_fenced");
      expect(engine.getQuarantined()).toHaveLength(1);
      // The explicit clearing path: discardBlocked prunes the ledger and the
      // lingering conflict resolves once nothing remains blocked/quarantined.
      expect(engine.discardBlocked("q-1")).toBe(true);
      expect(engine.getQuarantined()).toHaveLength(0);
      expect(engine.getBlockedCount()).toBe(0);
      expect(engine.getStatus()).toBe("synced");
      expect(engine.getLastError()).toBeNull();
    } finally {
      engine.destroy();
      releaseArchive();
    }
  });

  it("E2 RISK-6: conflict_terminal survives drain + epoch bump and clears only on discardBlocked", async () => {
    // Terminal half of the RISK-6 pin: a VERSION_COLLISION fence persists
    // across drains/epochs the same way conflict_fenced does.
    transport.fetchSnapshot = vi.fn().mockResolvedValue({
      attemptId: "att-1", protocolVersion: 2, deliveryStatus: "running",
      leaseEpoch: 1, controlEpoch: 1, attemptRevision: 1, responses: [],
    });
    transport.sendBatch = vi.fn().mockRejectedValue({ code: "VERSION_COLLISION" });
    let releaseArchive!: () => void;
    const archiveGate = new Promise<void>((resolve) => { releaseArchive = resolve; });
    const baseSave = storage.save.getMockImplementation();
    storage.save.mockImplementation((key: string, value: unknown) => {
      if (String(key).includes("v2_quarantine:")) return archiveGate.then(() => undefined);
      const impl = baseSave as unknown as ((k: string, v: unknown) => Promise<void>) | undefined;
      if (impl) return impl(key, value);
      return Promise.resolve(undefined);
    });
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1", attemptId: "att-1", leaseEpoch: 1, controlEpoch: 1, transport,
    });
    try {
      await engine.recover();
      await engine.acceptResponse("q-9", { answer: "colliding", markedForReview: false, eliminatedOptions: [], annotations: [] });
      await engine.flush();
      expect(engine.getStatus()).toBe("conflict_terminal");
      expect(engine.getQuarantined()).toHaveLength(1);
      const sendsBefore = (transport.sendBatch as ReturnType<typeof vi.fn>).mock.calls.length;
      await engine.flush();
      expect(engine.getStatus()).toBe("conflict_terminal");
      expect((transport.sendBatch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(sendsBefore);
      engine.updateEpochs(2, 1);
      engine.updateEpochs(2, 2);
      expect(engine.getStatus()).toBe("conflict_terminal");
      expect(engine.getQuarantined()).toHaveLength(1);
      expect(engine.discardBlocked("q-9")).toBe(true);
      expect(engine.getQuarantined()).toHaveLength(0);
      expect(engine.getBlockedCount()).toBe(0);
      expect(engine.getStatus()).toBe("synced");
      expect(engine.getLastError()).toBeNull();
    } finally {
      engine.destroy();
      releaseArchive();
    }
  });

  it("E2 P1: the sync checkpoint carries the issued clientVersion so checkpoint-only recovery preserves the write", async () => {
    // P1-observed fix: the inline intent checkpoint stores the provisional
    // clientVersion 0; without the versioned re-checkpoint after issuance an
    // IDB-less reload would see an unblocked v0 draft and drop it via the
    // clientVersion>0 gate — silently losing the write. Pin the real JSON.
    transport.fetchSnapshot = vi.fn().mockResolvedValue({
      attemptId: "att-1", protocolVersion: 2, deliveryStatus: "running",
      leaseEpoch: 1, controlEpoch: 1, attemptRevision: 1, responses: [],
    });
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1", attemptId: "att-1", leaseEpoch: 1, controlEpoch: 1,
      drainDebounceMs: 60_000, transport,
    });
    try {
      await engine.recover();
      await engine.acceptResponse("q-1", { answer: "durable answer", markedForReview: true, eliminatedOptions: [], annotations: [] });
      const issued = engine.getStates().get("q-1")?.pending;
      const issuedVersion = issued?.clientVersion;
      const issuedWriteId = issued?.writeId;
      if (!issuedVersion || !issuedWriteId) throw new Error("Expected an issued pending write");
      expect(issuedVersion).toBeGreaterThan(0);
      // Real checkpoint JSON parse — not a mock echo: the stored record must
      // carry the ISSUED version, never the provisional 0.
      const raw = localStorage.getItem("response-checkpoint:v2:att-1:q-1");
      expect(raw).not.toBeNull();
      const checkpoint = JSON.parse(raw as string) as { clientVersion?: number; writeId?: string };
      expect(checkpoint.writeId).toBe(issuedWriteId);
      expect(checkpoint.clientVersion).toBe(issuedVersion);
      expect(checkpoint.clientVersion).toBeGreaterThan(0);
      // Checkpoint-only recovery (IndexedDB unavailable: no drafts listed)
      // preserves the issued write as pending with its version intact.
      storage.list.mockResolvedValue([]);
      const engine2 = new DurableResponseEngine({
        scheduleId: "sched-1", attemptId: "att-1", leaseEpoch: 1, controlEpoch: 1,
        drainDebounceMs: 60_000, transport,
      });
      try {
        await engine2.recover();
        const revived = engine2.getStates().get("q-1")?.pending;
        expect(revived?.writeId).toBe(issuedWriteId);
        expect(revived?.clientVersion).toBe(issuedVersion);
        expect(getVisibleResponse(engine2.getStates().get("q-1"))?.answer).toBe("durable answer");
        expect(engine2.getPendingCount()).toBe(1);
      } finally {
        engine2.destroy();
      }
    } finally {
      engine.destroy();
    }
  });

  it("reports durability_fault and never a false saved state when all browser storage fails", async () => {
    // T2.3 storage-failure contract: when both the localStorage checkpoint
    // and the IndexedDB draft write fail, acceptResponse must surface
    // durability_fault (never saved_locally/synced) and reject, so the
    // provider bridge maps to syncState error + storage blocking and the save
    // UI can only show Needs attention — never a false saved confirmation.
    const statuses: string[] = [];
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-fault",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
      onStatusChange: (status) => statuses.push(status),
    });
    // Fail every browser-storage write. The engine touches window.localStorage
    // directly (not Storage.prototype); the suite-level draft-store mock
    // stands in for IndexedDB, so rejecting it fails the IndexedDB copy and
    // failing setItem fails the localStorage checkpoint — both together.
    storage.save.mockRejectedValue(new Error("idb unavailable"));
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    try {
      await expect(
        engine.acceptResponse("q-1", {
          answer: "A",
          markedForReview: false,
          eliminatedOptions: [],
          annotations: [],
        })
      ).rejects.toThrow("All browser durable storage failed");
    } finally {
      setItem.mockRestore();
    }
    expect(engine.getStatus()).toBe("durability_fault");
    expect(statuses).toContain("durability_fault");
    expect(statuses).not.toContain("saved_locally");
    expect(statuses).not.toContain("synced");
    engine.destroy();
  });

  it("SAT-004: assertBoundarySettled refuses unsettled visible work and settles on ack", async () => {
    transport.sendBatch = vi.fn().mockImplementation(() => new Promise(() => {}));
    const engine = new DurableResponseEngine({
      scheduleId: "sched-1",
      attemptId: "att-boundary",
      leaseEpoch: 1,
      controlEpoch: 1,
      transport,
    });

    // Fresh engine: nothing visible, nothing outstanding.
    expect(() => engine.assertBoundarySettled()).not.toThrow();

    const payload: ResponsePayload = {
      answer: "A",
      markedForReview: false,
      eliminatedOptions: [],
      annotations: [],
    };
    await engine.acceptResponse("q-1", payload);
    void engine.flush();
    await vi.waitFor(() => expect(transport.sendBatch).toHaveBeenCalledTimes(1));

    // A visible draft the server has not acknowledged is a boundary blocker
    // even though the queue is legitimately non-empty.
    expect(() => engine.assertBoundarySettled()).toThrow(/durably saved/i);

    // The server acknowledgement settles the boundary.
    const pending = engine.getStates().get("q-1")?.pending;
    engine["handleAcknowledgement"]({
      writeId: pending?.writeId ?? "missing-write-id",
      questionId: "q-1",
      clientVersion: 1,
      outcome: "applied",
      serverRevision: 10,
      canonicalResponse: payload,
      contentHash: "sha256:1",
    });
    expect(() => engine.assertBoundarySettled()).not.toThrow();
    engine.destroy();
  });
});
