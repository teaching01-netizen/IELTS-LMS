import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COEDIT_LIFECYCLE_CLOSE_PREFIX,
  INITIAL_SAVE_STATE,
  coeditLifecycleFromCloseReason,
  colorForActor,
  parseCoeditSaveFailureMessage,
  parseCoeditLifecycleMessage,
  resolveCoeditEnabled,
  type CoeditClientCapability,
  type CoeditSaveStateName,
} from "../contracts";
import { isSameDocument, parseCoeditDocumentName } from "../documentIdentity";
import { resolveCoeditFrontendFlag, VITE_AUTHORING_REALTIME_COEDITING } from "../flags";
import { deriveSaveState } from "../saveState";
import { sha256Hex } from "../stateHash";
import { CoeditUnavailableError, requestCoeditToken, scheduleTokenRefresh } from "../tokenApi";

const backendPost = vi.fn();
vi.mock("../../../infrastructure/examAuthoringBackendGateway", () => ({
  backendPost: (...args: unknown[]) => backendPost(...args),
}));

afterEach(() => {
  backendPost.mockReset();
  vi.useRealTimers();
});

function capability(overrides: Partial<CoeditClientCapability> = {}): CoeditClientCapability {
  return {
    server: true,
    frontendEnabled: true,
    activeEditableDraft: true,
    writeCapableRole: true,
    ...overrides,
  };
}

describe("co-edit enablement", () => {
  it("enables collaboration when the co-edit gates are satisfied", () => {
    expect(resolveCoeditEnabled(capability())).toBe(true);
  });

  it("degrades to the legacy editor when any co-edit gate is false", () => {
    for (const gate of Object.keys(capability()) as Array<keyof CoeditClientCapability>) {
      expect(resolveCoeditEnabled(capability({ [gate]: false }))).toBe(false);
    }
  });

  it("does not depend on the unrelated legacy event or delivery sockets", () => {
    // Prompt characters travel over the dedicated Hocuspocus room. Structural
    // events and exam-level delivery may be rolled out independently.
    expect(resolveCoeditEnabled(capability())).toBe(true);
  });

  it("treats the frontend flag as a kill switch, never as an enabler", () => {
    // Server says no: the local flag cannot turn collaboration on.
    expect(resolveCoeditEnabled(capability({ server: false, frontendEnabled: true }))).toBe(false);
    // Server says yes, kill switch off: legacy editor.
    expect(resolveCoeditEnabled(capability({ frontendEnabled: false }))).toBe(false);
  });

  it("keeps the frontend co-edit posture enabled without Vite configuration", () => {
    expect(resolveCoeditFrontendFlag()).toBe(true);
    expect(resolveCoeditFrontendFlag({ [VITE_AUTHORING_REALTIME_COEDITING]: "true" })).toBe(true);
    expect(resolveCoeditFrontendFlag({ [VITE_AUTHORING_REALTIME_COEDITING]: "1" })).toBe(true);
    expect(resolveCoeditFrontendFlag({ [VITE_AUTHORING_REALTIME_COEDITING]: "on" })).toBe(true);
    expect(resolveCoeditFrontendFlag({ [VITE_AUTHORING_REALTIME_COEDITING]: "no" })).toBe(true);
    expect(resolveCoeditFrontendFlag({ [VITE_AUTHORING_REALTIME_COEDITING]: true })).toBe(true);
  });
});

describe("document identity", () => {
  it("accepts only the frozen opaque name shape", () => {
    const parsed = parseCoeditDocumentName("coedit:v1:abc-123");
    expect(parsed?.documentId).toBe("abc-123");
    expect(parseCoeditDocumentName("coedit:v2:abc")).toBeNull();
    expect(parseCoeditDocumentName("coedit:v1:")).toBeNull();
    expect(parseCoeditDocumentName("exam-question:1")).toBeNull();
    expect(parseCoeditDocumentName("coedit:v1:has space")).toBeNull();
  });

  it("compares names exactly, and never treats a missing name as equal", () => {
    expect(isSameDocument("coedit:v1:a", " coedit:v1:a ")).toBe(true);
    expect(isSameDocument("coedit:v1:a", "coedit:v1:b")).toBe(false);
    expect(isSameDocument(null, "coedit:v1:a")).toBe(false);
    expect(isSameDocument("coedit:v1:a", undefined)).toBe(false);
  });
});

describe("save state", () => {
  const base = {
    localStateHash: "hash-a",
    acknowledgedStateHash: "hash-a",
    questionRevision: 4,
    connected: true,
    inFlight: false,
    error: null,
    lifecycle: null,
  } as const;

  it("starts idle before any sync", () => {
    const state = deriveSaveState({
      ...base,
      localStateHash: null,
      acknowledgedStateHash: null,
      connected: false,
    });
    expect(state.name).toBe("unsaved");
    expect(state.message).toMatch(/Reconnecting/);
  });

  it("reports saved only for the acknowledged current hash", () => {
    expect(deriveSaveState({ ...base }).name).toBe("saved");
  });

  it("never moves newer work to saved when an older hash was acknowledged", () => {
    // The acknowledgement arrived, then the author kept typing. A stale ack
    // must not label the newer state durable.
    const state = deriveSaveState({
      ...base,
      localStateHash: "hash-b",
      acknowledgedStateHash: "hash-a",
    });
    expect(state.name).toBe("unsaved");
    expect(state.questionRevision).toBe(4);
  });

  it("shows syncing while a store is in flight", () => {
    const state = deriveSaveState({
      ...base,
      localStateHash: "hash-b",
      acknowledgedStateHash: "hash-a",
      inFlight: true,
    });
    expect(state.name).toBe("syncing");
  });

  it("surfaces a transport failure as retryable or final", () => {
    const retryable = deriveSaveState({
      ...base,
      error: { message: "Collaboration service unavailable.", retryable: true },
    });
    expect(retryable.name).toBe("error");
    expect(retryable.retryable).toBe(true);
    expect(retryable.message).toBe("Collaboration service unavailable.");

    const final = deriveSaveState({
      ...base,
      error: { message: "Prompt is too large to save.", retryable: false },
    });
    expect(final.retryable).toBe(false);
  });

  it("reads a lifecycle close off the wire reason and nothing else", () => {
    // The service closes a replaced room with this exact string; it is the only
    // signal that lets the client offer the export the design requires.
    expect(coeditLifecycleFromCloseReason(`${COEDIT_LIFECYCLE_CLOSE_PREFIX}draft_replaced`)).toEqual({
      issue: "replaced",
      message: expect.stringMatching(/replaced/i),
    });
    expect(
      coeditLifecycleFromCloseReason("coedit:workbook_replaced")?.issue,
    ).toBe("replaced");
    for (const reason of [
      "coedit:exam_published",
      "coedit:question_deleted",
      "coedit:feature_disabled",
      "coedit:other",
    ]) {
      expect(coeditLifecycleFromCloseReason(reason)?.issue).toBe("closed");
    }
  });

  it("keeps a transport close on the offline path", () => {
    // Hocuspocus' own reasons, an empty reason, and an unknown label are not
    // lifecycle decisions: the room is merely disconnected.
    expect(coeditLifecycleFromCloseReason("Reset Connection")).toBeNull();
    expect(coeditLifecycleFromCloseReason("coedit:not-a-reason")).toBeNull();
    expect(coeditLifecycleFromCloseReason("")).toBeNull();
    expect(coeditLifecycleFromCloseReason(null)).toBeNull();
    expect(coeditLifecycleFromCloseReason(undefined)).toBeNull();
  });

  it("lets a destructive lifecycle outrank every other signal", () => {
    const state = deriveSaveState({
      ...base,
      error: { message: "boom", retryable: true },
      connected: false,
      inFlight: true,
      lifecycle: "closed" as CoeditSaveStateName,
    });
    expect(state.name).toBe("closed");
  });

  it("keeps every state free of transport internals", () => {
    // The workspace renders this through the one save-area vocabulary in
    // connectionCopy; nothing here may leak a document name or a state hash.
    for (const name of ["idle", "unsaved", "syncing", "saved"] as CoeditSaveStateName[]) {
      const state = deriveSaveState({ ...INITIAL_SAVE_STATE, name });
      expect(state.message ?? "").not.toMatch(/coedit:|hash-/);
    }
  });
});

describe("state hashing", () => {
  it("matches the server's SHA-256 for the empty and known vectors", () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is a pure hex digest of the exact bytes", () => {
    const first = sha256Hex(new Uint8Array([1, 2, 3]));
    const second = sha256Hex(new Uint8Array([1, 2, 4]));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(sha256Hex(new Uint8Array([1, 2, 3]))).toBe(first);
  });
});

describe("collaborator colours", () => {
  it("derives a stable colour per actor and separates different actors", () => {
    expect(colorForActor("actor-1")).toBe(colorForActor("actor-1"));
    expect(colorForActor("actor-1")).toMatch(/^#[0-9a-f]{6}$/i);
    const colors = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => colorForActor(id)));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe("publish lifecycle messages", () => {
  it("accepts only the private publish freeze/unfreeze shape", () => {
    expect(
      parseCoeditLifecycleMessage({
        type: "coedit.lifecycle",
        documentName: "coedit:v1:doc-1",
        phase: "freezing",
        reason: "publish",
      }),
    ).toEqual({
      type: "coedit.lifecycle",
      documentName: "coedit:v1:doc-1",
      phase: "freezing",
      reason: "publish",
    });
    expect(
      parseCoeditLifecycleMessage({
        type: "coedit.lifecycle",
        documentName: "coedit:v1:doc-1",
        phase: "active",
        reason: "publish",
      })?.phase,
    ).toBe("active");
  });

  it("ignores malformed, unknown, and cross-purpose lifecycle messages", () => {
    for (const message of [
      null,
      "coedit.lifecycle",
      { type: "coedit.lifecycle", documentName: "", phase: "freezing", reason: "publish" },
      { type: "coedit.lifecycle", documentName: "doc", phase: "frozen", reason: "publish" },
      { type: "coedit.lifecycle", documentName: "doc", phase: "freezing", reason: "delete" },
      { type: "coedit.other", documentName: "doc", phase: "freezing", reason: "publish" },
    ]) {
      expect(parseCoeditLifecycleMessage(message)).toBeNull();
    }
  });
});

describe("persistence failure messages", () => {
  it("accepts the private retryability projection without exposing transport detail", () => {
    expect(
      parseCoeditSaveFailureMessage({
        type: "coedit.save_failed",
        documentName: "coedit:v1:doc-1",
        retryable: true,
      }),
    ).toEqual({
      type: "coedit.save_failed",
      documentName: "coedit:v1:doc-1",
      retryable: true,
    });
  });

  it("ignores malformed save failure messages", () => {
    expect(
      parseCoeditSaveFailureMessage({
        type: "coedit.save_failed",
        documentName: "doc",
      }),
    ).toBeNull();
    expect(
      parseCoeditSaveFailureMessage({
        type: "coedit.save_failed",
        documentName: "doc",
        retryable: "yes",
      }),
    ).toBeNull();
  });
});

describe("token api", () => {
  const valid = {
    token: "body.signature",
    documentName: "coedit:v1:doc-1",
    serviceUrl: "wss://coedit.example",
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    schemaVersion: 1,
    fieldSet: "prompt",
    mode: "write" as const,
    actorId: "actor-1",
    displayName: "Ada",
    capability: true,
  };

  it("requests the token for the exam question and validates the response", async () => {
    backendPost.mockResolvedValue(valid);
    await expect(requestCoeditToken("eq-1")).resolves.toMatchObject({ documentName: "coedit:v1:doc-1" });
    expect(backendPost).toHaveBeenCalledWith(
      "/v1/assessment-authoring/exam-questions/eq-1/coedit-token",
      {},
    );
  });

  it("refuses a response with an invalid document name, field set, or mode", async () => {
    for (const override of [
      { documentName: "exam-question:1" },
      { fieldSet: "answer" },
      { mode: "admin" },
      { token: "" },
      { serviceUrl: "" },
      { actorId: "" },
    ]) {
      backendPost.mockResolvedValue({ ...valid, ...override });
      await expect(requestCoeditToken("eq-1")).rejects.toThrow();
    }
  });

  it("treats a disabled server capability as a normal posture, not an author-facing error", async () => {
    const { ApiError } = await import("../../../../../shared/api-client/errors");
    backendPost.mockRejectedValue(
      new ApiError({
        code: "SERVICE_UNAVAILABLE",
        message: "Prompt collaboration is disabled.",
        status: 503,
        details: { coeditReason: "coedit_disabled" },
      }),
    );
    await expect(requestCoeditToken("eq-1")).rejects.toBeInstanceOf(CoeditUnavailableError);
  });
});

describe("token refresh scheduling", () => {
  it("refreshes ahead of expiry and never later than five seconds out", () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    const onRefresh = vi.fn();
    const cancel = scheduleTokenRefresh(now / 1000 + 300, onRefresh, () => now);

    vi.advanceTimersByTime(239_000);
    expect(onRefresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    cancel();
  });

  it("returns a cancel function so a StrictMode double mount cannot leak a timer", () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    const onRefresh = vi.fn();
    const cancel = scheduleTokenRefresh(now / 1000 + 300, onRefresh, () => now);
    cancel();
    vi.advanceTimersByTime(600_000);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
