import { afterEach, describe, expect, it } from "vitest";
import {
  AUTHORING_ENTRY_INTENT_TTL_MS,
  consumeAuthoringDraftOnEntry,
  peekAuthoringDraftOnEntry,
  requestAuthoringDraftOnEntry,
} from "../authoringEntryIntent";

const EXAM = "exam-1";
const OTHER_EXAM = "exam-2";

afterEach(() => {
  // The slot is module state: leave it empty for the next test.
  consumeAuthoringDraftOnEntry(EXAM);
  consumeAuthoringDraftOnEntry(OTHER_EXAM);
});

describe("authoring entry intent", () => {
  it("arms nothing on its own", () => {
    expect(peekAuthoringDraftOnEntry(EXAM)).toBe(false);
    expect(consumeAuthoringDraftOnEntry(EXAM)).toBe(false);
  });

  it("arms only the exam the gesture names", () => {
    requestAuthoringDraftOnEntry(EXAM);
    expect(peekAuthoringDraftOnEntry(EXAM)).toBe(true);
    expect(peekAuthoringDraftOnEntry(OTHER_EXAM)).toBe(false);
  });

  it("is one-shot: the first consume spends it", () => {
    requestAuthoringDraftOnEntry(EXAM);
    expect(consumeAuthoringDraftOnEntry(EXAM)).toBe(true);
    expect(peekAuthoringDraftOnEntry(EXAM)).toBe(false);
    expect(consumeAuthoringDraftOnEntry(EXAM)).toBe(false);
  });

  it("keeps the newest gesture (the last click is the one navigating)", () => {
    requestAuthoringDraftOnEntry(EXAM);
    requestAuthoringDraftOnEntry(OTHER_EXAM);
    expect(peekAuthoringDraftOnEntry(EXAM)).toBe(false);
    expect(peekAuthoringDraftOnEntry(OTHER_EXAM)).toBe(true);
  });

  it("expires, so a stale click cannot arm a later arrival", () => {
    const requestedAt = 1_000;
    requestAuthoringDraftOnEntry(EXAM, requestedAt);
    expect(peekAuthoringDraftOnEntry(EXAM, requestedAt + AUTHORING_ENTRY_INTENT_TTL_MS)).toBe(true);
    expect(
      peekAuthoringDraftOnEntry(EXAM, requestedAt + AUTHORING_ENTRY_INTENT_TTL_MS + 1)
    ).toBe(false);
  });

  it("spends an expired gesture rather than leaving it armed", () => {
    requestAuthoringDraftOnEntry(EXAM, 1_000);
    const spent = consumeAuthoringDraftOnEntry(EXAM, 1_000 + AUTHORING_ENTRY_INTENT_TTL_MS + 1);
    expect(spent).toBe(false);
    expect(peekAuthoringDraftOnEntry(EXAM)).toBe(false);
  });
});
