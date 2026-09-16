import { describe, expect, it } from "vitest";
import { compareCoeditDecimalStrings } from "../protocol";
import {
  COEDIT_EPOCH_MISMATCH_REASON,
  COEDIT_FINAL_STORE_REQUIRED_REASON,
  COEDIT_FREEZE_CONFLICT_REASON,
  COEDIT_PHASE1_REASONS,
  COEDIT_SEED_CONFLICT_REASON,
  COEDIT_STALE_CACHE_REASON,
  isCoeditDecimalString,
  isCoeditLifecycleOperation,
  parseCoeditDurabilityMetadata,
} from "../protocol";

const ROOM = "coedit:v2:exam-1";
const HASH = "a".repeat(64);

describe("co-edit protocol contracts", () => {
  it("orders counters beyond the Number range without rounding", () => {
    // `Number("9007199254740993")` rounds to 9007199254740992, which would make
    // two distinct commit sequences compare equal — and "equal" means "ignore
    // this acknowledgement" in the provider.
    expect(compareCoeditDecimalStrings("9007199254740993", "9007199254740992")).toBe(1);
    expect(compareCoeditDecimalStrings("9007199254740992", "9007199254740993")).toBe(-1);
    expect(compareCoeditDecimalStrings("9007199254740993", "9007199254740993")).toBe(0);
    expect(compareCoeditDecimalStrings("7", "18446744073709551615")).toBe(-1);
  });

  it("refuses to order anything that is not a counter", () => {
    expect(compareCoeditDecimalStrings("7", undefined)).toBeNull();
    expect(compareCoeditDecimalStrings("7", "01")).toBeNull();
    expect(compareCoeditDecimalStrings("7", -1)).toBeNull();
    expect(compareCoeditDecimalStrings("1e3", "2")).toBeNull();
    expect(compareCoeditDecimalStrings("", "2")).toBeNull();
  });

  it("keeps BIGINT counters as exact canonical decimal strings", () => {
    expect(isCoeditDecimalString("9007199254740993")).toBe(true);
    expect(isCoeditDecimalString("18446744073709551615")).toBe(true);
    expect(isCoeditDecimalString("01")).toBe(false);
    expect(isCoeditDecimalString("-1")).toBe(false);
    expect(isCoeditDecimalString("18446744073709551616")).toBe(false);
    expect(isCoeditDecimalString(1)).toBe(false);
  });

  it("validates lifecycle ownership and expiry without coercion", () => {
    expect(
      isCoeditLifecycleOperation({
        freezeOperationId: "operation-1",
        freezeExpiresAt: 1_800_000_000,
      }),
    ).toBe(true);
    expect(
      isCoeditLifecycleOperation({
        freezeOperationId: "operation 1",
        freezeExpiresAt: 1_800_000_000,
      }),
    ).toBe(false);
  });

  it("parses durable cache metadata and preserves large counters exactly", () => {
    const metadata = parseCoeditDurabilityMetadata({
      room: ROOM,
      stateEpoch: "9007199254740993",
      stateHash: HASH,
      commitSequence: "18446744073709551615",
      safeToDiscardCache: false,
    });
    expect(metadata).toEqual({
      room: ROOM,
      stateEpoch: "9007199254740993",
      stateHash: HASH,
      commitSequence: "18446744073709551615",
      safeToDiscardCache: false,
    });
    expect(
      parseCoeditDurabilityMetadata({
        room: ROOM,
        stateEpoch: "1",
        stateHash: "not-a-sha256",
        commitSequence: "2",
        safeToDiscardCache: true,
      }),
    ).toBeNull();
  });

  it("exposes the closed Phase 1 reason vocabulary", () => {
    expect(COEDIT_PHASE1_REASONS).toEqual([
      COEDIT_FREEZE_CONFLICT_REASON,
      COEDIT_EPOCH_MISMATCH_REASON,
      COEDIT_SEED_CONFLICT_REASON,
      COEDIT_FINAL_STORE_REQUIRED_REASON,
      COEDIT_STALE_CACHE_REASON,
    ]);
  });
});
