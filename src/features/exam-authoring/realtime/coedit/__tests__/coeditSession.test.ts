import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  COEDIT_LIFECYCLE_CLOSE_PREFIX,
  COEDIT_OVERSIZED_REASON,
  COEDIT_WRITE_REFUSED_REASON,
  INITIAL_SAVE_STATE,
  coeditLifecycleFromCloseReason,
  coeditRecoveryFromSaveFailure,
  colorForActor,
  parseCoeditSaveFailureMessage,
  parseCoeditLifecycleMessage,
  resolveCoeditEnabled,
  type CoeditClientCapability,
  type CoeditSaveStateName,
  type CoeditSaveFailureMessage,
} from "../contracts";
import { parseCoeditDocumentName } from "../documentIdentity";
import { deriveSaveState } from "../saveState";
import { encodeStateVectorBase64, toBase64 } from "../stateVector";
import { CoeditUnavailableError, requestCoeditToken } from "../tokenApi";

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
});

describe("save state", () => {
  const base = {
    localStateVector: "vector-a",
    acknowledgedStateVector: "vector-a",
    questionRevision: 4,
    connected: true,
    inFlight: false,
    error: null,
    lifecycle: null,
  } as const;

  it("starts idle before any sync", () => {
    const state = deriveSaveState({
      ...base,
      localStateVector: null,
      acknowledgedStateVector: null,
      connected: false,
    });
    expect(state.name).toBe("unsaved");
    expect(state.message).toMatch(/Reconnecting/);
  });

  it("reports saved only for the acknowledged current state vector", () => {
    expect(deriveSaveState({ ...base }).name).toBe("saved");
  });

  it("never moves newer work to saved when an older vector was acknowledged", () => {
    // The acknowledgement arrived, then the author kept typing. A stale ack
    // must not label the newer state durable.
    const state = deriveSaveState({
      ...base,
      localStateVector: "vector-b",
      acknowledgedStateVector: "vector-a",
    });
    expect(state.name).toBe("unsaved");
    expect(state.questionRevision).toBe(4);
  });

  it("shows syncing while a store is in flight", () => {
    const state = deriveSaveState({
      ...base,
      localStateVector: "vector-b",
      acknowledgedStateVector: "vector-a",
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
    // connectionCopy; nothing here may leak a document name or a state vector.
    for (const name of ["idle", "unsaved", "syncing", "saved"] as CoeditSaveStateName[]) {
      const state = deriveSaveState({ ...INITIAL_SAVE_STATE, name });
      expect(state.message ?? "").not.toMatch(/coedit:|vector-/);
    }
  });
});

/**
 * One prior browser session: merging these into a room is what an IndexedDB
 * replay (or a returning author) does, and each one adds a client id to the
 * state vector, which is what made the vector length cross the lengths that the
 * removed client-side SHA-256 padded differently (55 mod 64).
 */
function mergePriorSessions(doc: Y.Doc, sessions: number): void {
  for (let index = 0; index < sessions; index += 1) {
    const prior = new Y.Doc();
    prior.getMap(`prior-session-${index}`).set("k", index);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(prior));
  }
  doc.getXmlFragment("prompt").insert(0, [new Y.XmlElement("paragraph")]);
}

describe("state vector identity", () => {
  it("encodes base64 exactly as the service does", () => {
    // Standard alphabet with padding, byte-for-byte what Buffer.toString does
    // on the service side; a mismatch here would break the comparison silently.
    expect(toBase64(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe("AAECAwQFBgcICQ==");
    expect(toBase64(new Uint8Array())).toBe("");
  });

  it("round-trips every byte for the lengths at and around the old failure", () => {
    for (const length of [1, 54, 55, 56, 63, 64, 119, 183]) {
      const bytes = Uint8Array.from({ length }, (_value, index) => (index * 7 + 3) & 255);
      const decoded = atob(toBase64(bytes));
      expect(decoded.length).toBe(length);
      for (let index = 0; index < length; index += 1) {
        expect(decoded.charCodeAt(index)).toBe(bytes[index]);
      }
    }
  });

  it("reaches saved for a real vector from a room with prior sessions", () => {
    const doc = new Y.Doc();
    mergePriorSessions(doc, 3);
    const vector = encodeStateVectorBase64(doc);
    expect(vector.length).toBeGreaterThan(0);

    const state = deriveSaveState({
      localStateVector: vector,
      acknowledgedStateVector: vector,
      questionRevision: 4,
      connected: true,
      inFlight: false,
      error: null,
      lifecycle: null,
    });
    expect(state.name).toBe("saved");
    // The same vector, unacknowledged, must not claim durability.
    expect(
      deriveSaveState({
        localStateVector: vector,
        acknowledgedStateVector: null,
        questionRevision: 4,
        connected: true,
        inFlight: false,
        error: null,
        lifecycle: null,
      }).name,
    ).toBe("unsaved");

    // The lengths at which the removed client-side SHA-256 padded differently
    // from the service's, so a committed room could never show Saved. Save
    // truth must not depend on the length of anything.
    for (const byteLength of [55, 119, 183]) {
      const padded = toBase64(Uint8Array.from({ length: byteLength }, (_value, index) => (index * 7 + 3) & 255));
      expect(
        deriveSaveState({
          localStateVector: padded,
          acknowledgedStateVector: padded,
          questionRevision: 4,
          connected: true,
          inFlight: false,
          error: null,
          lifecycle: null,
        }).name,
      ).toBe("saved");
    }
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
      reason: null,
      requiresResync: false,
    });
  });

  it("reads the stale-hash resync signal from a moved-commit refusal", () => {
    expect(
      parseCoeditSaveFailureMessage({
        type: "coedit.save_failed",
        documentName: "coedit:v1:doc-1",
        retryable: false,
        reason: "coedit_previous_hash_mismatch",
        requiresResync: true,
      }),
    ).toEqual({
      type: "coedit.save_failed",
      documentName: "coedit:v1:doc-1",
      retryable: false,
      reason: "coedit_previous_hash_mismatch",
      requiresResync: true,
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

describe("refusal recovery", () => {
  const failure = (overrides: Partial<CoeditSaveFailureMessage> = {}): CoeditSaveFailureMessage => ({
    type: "coedit.save_failed",
    documentName: "coedit:v1:doc-1",
    retryable: false,
    reason: null,
    requiresResync: false,
    ...overrides,
  });

  it("offers the export for a commit that moved past this room", () => {
    const recovery = coeditRecoveryFromSaveFailure(
      failure({ reason: "coedit_previous_hash_mismatch", requiresResync: true }),
    );
    expect(recovery?.issue).toBe("rejected");
    expect(recovery?.message).toMatch(/Reload the prompt/);
  });

  it("offers the export for a write the room refused outright", () => {
    // The reason string the service sends (mirrored in its beforeSync hook).
    expect(COEDIT_WRITE_REFUSED_REASON).toBe("coedit_write_refused");
    const recovery = coeditRecoveryFromSaveFailure(failure({ reason: COEDIT_WRITE_REFUSED_REASON }));
    expect(recovery?.issue).toBe("rejected");
    expect(recovery?.message).toMatch(/refused your latest changes/);
    expect(recovery?.message).toMatch(/Copy them out/);
  });

  it("names the size refusal as its own issue", () => {
    expect(COEDIT_OVERSIZED_REASON).toBe("coedit_oversized");
    const recovery = coeditRecoveryFromSaveFailure(failure({ reason: COEDIT_OVERSIZED_REASON }));
    expect(recovery?.issue).toBe("oversized");
    expect(recovery?.message).toMatch(/too large to save as one collaborative document/);
  });

  it("leaves an unexplained failure on the retry path", () => {
    // No special recovery: a transient failure must not claim the work is at
    // risk in ways the author cannot act on.
    expect(coeditRecoveryFromSaveFailure(failure({ retryable: true }))).toBeNull();
    expect(coeditRecoveryFromSaveFailure(failure({ reason: "coedit_revision_conflict" }))).toBeNull();
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

