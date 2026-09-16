import { describe, expect, it } from "vitest";
import type { CoeditConnectionPhase, CoeditLifecyclePhase, CoeditSaveState } from "../../../realtime/coedit";
import { coeditDisplayStatusFor, coeditSaveStatusFor, combineSaveStatus } from "../coeditSaveTruth";

describe("coeditSaveStatusFor", () => {
  it("maps the collaborative states onto the existing save vocabulary", () => {
    expect(coeditSaveStatusFor("saved")).toBe("saved");
    expect(coeditSaveStatusFor("syncing")).toBe("saving");
    expect(coeditSaveStatusFor("unsaved")).toBe("unsaved");
    expect(coeditSaveStatusFor("error")).toBe("error");
  });

  it("never reports saved for a state that has not been acknowledged", () => {
    // `idle` is "we have not synced yet", which must not read as durable.
    expect(coeditSaveStatusFor("idle")).toBe("unsaved");
  });
});

describe("combineSaveStatus", () => {
  it("is transparent when co-editing is off", () => {
    expect(combineSaveStatus("saved", null)).toBe("saved");
    expect(combineSaveStatus("unsaved", null)).toBe("unsaved");
  });

  it("never lets a prompt acknowledgement claim a pending field save", () => {
    expect(combineSaveStatus("unsaved", "saved")).toBe("unsaved");
    expect(combineSaveStatus("saving", "saved")).toBe("saving");
    expect(combineSaveStatus("error", "saved")).toBe("error");
  });

  it("never lets a field save claim an unacknowledged prompt", () => {
    expect(combineSaveStatus("saved", "unsaved")).toBe("unsaved");
    expect(combineSaveStatus("saved", "saving")).toBe("saving");
    expect(combineSaveStatus("saved", "error")).toBe("error");
  });

  it("reports saved only when both writers are saved", () => {
    expect(combineSaveStatus("saved", "saved")).toBe("saved");
  });

  it("prefers a destructive state over a merely offline one", () => {
    expect(combineSaveStatus("offline", "error")).toBe("error");
    expect(combineSaveStatus("offline", "saved")).toBe("offline");
  });
});

describe("coeditDisplayStatusFor", () => {
  const state = (name: CoeditSaveState["name"]): CoeditSaveState => ({
    name,
    localStateVector: name === "saved" ? "vector-current" : "vector-new",
    acknowledgedStateVector: name === "saved" ? "vector-current" : "vector-old",
    questionRevision: 4,
    message: null,
    retryable: name === "error",
  });

  const input = (overrides: Partial<{
    saveState: CoeditSaveState | null;
    connectionPhase: CoeditConnectionPhase;
    hasEstablishedConnection: boolean;
    lifecyclePhase: CoeditLifecyclePhase;
    readOnly: boolean;
    pendingSince: number | null;
    autosaveStatus: "saved" | "unsaved" | "saving" | "offline" | "error" | "conflict";
    now: number;
  }> = {}) => ({
    saveState: state("saved"),
    connectionPhase: "connected" as const,
    hasEstablishedConnection: true,
    lifecyclePhase: "active" as const,
    readOnly: false,
    pendingSince: null,
    autosaveStatus: "saved" as const,
    now: 10_000,
    ...overrides,
  });

  it("shows Saved only when the exact current state is acknowledged", () => {
    expect(coeditDisplayStatusFor(input())).toBe("saved");
    expect(coeditDisplayStatusFor(input({ saveState: state("unsaved"), pendingSince: 9_999 }))).toBe("saving");
  });

  it("keeps Saving stable until the three-second threshold, then uses Still saving", () => {
    expect(coeditDisplayStatusFor(input({ saveState: state("syncing"), pendingSince: 7_001 }))).toBe("saving");
    expect(coeditDisplayStatusFor(input({ saveState: state("syncing"), pendingSince: 7_000 }))).toBe("still_saving");
  });

  it("projects connection, failure, access, and publish lifecycle states", () => {
    expect(coeditDisplayStatusFor(input({ connectionPhase: "disconnected", pendingSince: 9_900 }))).toBe("offline");
    expect(coeditDisplayStatusFor(input({ connectionPhase: "connecting" }))).toBe("reconnecting");
    expect(
      coeditDisplayStatusFor(
        input({
          connectionPhase: "connecting",
          hasEstablishedConnection: false,
          saveState: state("unsaved"),
          pendingSince: 9_999,
        }),
      ),
    ).toBe("saving");
    expect(coeditDisplayStatusFor(input({ saveState: state("error") }))).toBe("error");
    expect(coeditDisplayStatusFor(input({ readOnly: true }))).toBe("view_only");
    expect(coeditDisplayStatusFor(input({ lifecyclePhase: "freezing" }))).toBe("finishing");
    expect(coeditDisplayStatusFor(input({ lifecyclePhase: "frozen" }))).toBe("view_only");
    expect(coeditDisplayStatusFor(input({ autosaveStatus: "conflict" }))).toBe("conflict");
  });

  it("never flashes Saved during initial setup or after a stale acknowledgement", () => {
    expect(
      coeditDisplayStatusFor(
        input({
          saveState: state("idle"),
          connectionPhase: "connecting",
          hasEstablishedConnection: false,
        }),
      ),
    ).toBe("saving");
    expect(
      coeditDisplayStatusFor(
        input({
          saveState: {
            ...state("unsaved"),
            localStateHash: "hash-newer",
            acknowledgedStateHash: "hash-older",
          },
        }),
      ),
    ).not.toBe("saved");
  });
});
