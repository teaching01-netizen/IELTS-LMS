import { describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { createSatFinalizationGate } from "../satFinalizationGate";

function payload(attemptId: string, state: string, revision: number): AssessmentDeliveryBootstrap {
  return {
    versionId: "version",
    attempt: {
      id: attemptId,
      moduleAttempts: [{ id: "ma-1", state, revision }],
      responses: [],
    },
  } as unknown as AssessmentDeliveryBootstrap;
}

describe("SAT finalization gate", () => {
  it("claims each revision once and lets a later revision through", () => {
    const gate = createSatFinalizationGate<null>();
    const key = gate.revisionKey("attempt-a", payload("attempt-a", "submitted", 1));
    expect(gate.claim(key)).toBe(true);
    expect(gate.claim(key)).toBe(false);
    const next = gate.revisionKey("attempt-a", payload("attempt-a", "submitted", 2));
    expect(gate.claim(next)).toBe(true);
  });

  it("scopes the revision key by attempt, so a rotated identity cannot inherit a claim", () => {
    const gate = createSatFinalizationGate<null>();
    const first = gate.revisionKey("attempt-a", payload("attempt-a", "submitted", 1));
    const second = gate.revisionKey("attempt-b", payload("attempt-b", "submitted", 1));
    expect(gate.claim(first)).toBe(true);
    expect(gate.claim(second)).toBe(true);
  });

  it("releases a failed claim so a retry can finalize the same revision", () => {
    const gate = createSatFinalizationGate<null>();
    const key = gate.revisionKey("attempt-a", payload("attempt-a", "submitted", 1));
    gate.claim(key);
    gate.release(key);
    expect(gate.claim(key)).toBe(true);
  });

  it("ignores a release for a revision it does not hold", () => {
    const gate = createSatFinalizationGate<null>();
    const held = gate.revisionKey("attempt-a", payload("attempt-a", "submitted", 1));
    const other = gate.revisionKey("attempt-a", payload("attempt-a", "submitted", 2));
    gate.claim(held);
    gate.release(other);
    expect(gate.claim(held)).toBe(false);
  });

  it("single-flights concurrent finalizations and starts fresh once settled", async () => {
    const gate = createSatFinalizationGate<string>();
    let resolve!: (value: string) => void;
    const first = gate.begin(() => new Promise<string>((res) => { resolve = res; }));
    const run = vi.fn(async () => "second");
    const joined = gate.begin(run);
    expect(run).not.toHaveBeenCalled();
    expect(joined).toBe(first);
    resolve("first");
    await expect(first).resolves.toBe("first");
    await expect(gate.begin(run)).resolves.toBe("second");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("clears the in-flight slot after a rejection", async () => {
    const gate = createSatFinalizationGate<string>();
    await expect(gate.begin(async () => { throw new Error("completion backend down"); })).rejects.toThrow(
      "completion backend down",
    );
    const run = vi.fn(async () => "recovered");
    await expect(gate.begin(run)).resolves.toBe("recovered");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reset drops both the claim and the in-flight slot", async () => {
    const gate = createSatFinalizationGate<string>();
    const key = gate.revisionKey("attempt-a", payload("attempt-a", "submitted", 1));
    gate.claim(key);
    void gate.begin(() => new Promise<string>(() => {}));
    gate.reset();
    expect(gate.claim(key)).toBe(true);
    const run = vi.fn(async () => "after-reset");
    await expect(gate.begin(run)).resolves.toBe("after-reset");
  });
});
