import { describe, it, expect, vi, beforeEach } from "vitest";
import { DurableResponseEngine, type TransportClient } from "../DurableResponseEngine";
import {
  getVisibleResponse,
  type ResponsePayload,
  type ResponseBatchResponseV2,
  type SubmitAttemptV2Request,
  type SubmitAttemptV2Response,
} from "../types";

describe("DurableResponseEngine", () => {
  let transport: TransportClient;

  beforeEach(() => {
    localStorage.clear();
    transport = {
      sendBatch: vi.fn(),
      submit: vi.fn(),
      fetchSnapshot: vi.fn().mockResolvedValue([]),
    };
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
    expect(localStorage.getItem("response-checkpoint:v2:att-1:q-2")).toBeNull();
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
});
