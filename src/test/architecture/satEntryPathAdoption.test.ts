import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readProductionSourceFiles } from "./architectureScanner";

/**
 * Tripwire: every entry-shaped ack must be offered to the durability engine.
 *
 * The server bumps `student_attempts.control_epoch` inside the transaction that
 * opens or confirms a module and then answers the transition command with the
 * post-commit epoch. The client used to drop it (the merge into a bootstrap
 * payload has no epoch field), so the first answer after entry rode the pre-bump
 * fence and was refused 409 CONTROL_EPOCH_STALE.
 *
 * Adoption now lives at one choke point — `resolveEntryPayload` in the SAT
 * controller, via `application/satEntryControlEpoch` — so EVERY entry-shaped ack
 * inherits it, whichever command produced it.
 *
 * IF THIS TEST FAILS, someone has wired one of the offer/recovery endpoints for
 * the first time. That may be exactly what you intended: do not delete the
 * assertion to make the failure go away. Instead route that response through
 * `resolveEntryPayload` (or call `adoptEntryControlEpochFromAck` directly) so
 * the ack's epoch still reaches the engine, then record the new call site here.
 */
const ENTRY_ACK_ENDPOINTS = ["enterModule", "entryState", "markStageVisible"] as const;

const SAT_CONTROLLER = "src/features/student-delivery/hooks/useSatExamController.ts";

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

/** Production files that CALL one of the optional entry endpoints. */
function entryEndpointCallSites(endpoint: string): string[] {
  // Call-shaped only: `.enterModule(` / `.enterModule?.(`. The port declaration
  // and API implementation are not call sites.
  const pattern = new RegExp(`\\.${endpoint}\\??\\.?\\s*\\(`);
  return readProductionSourceFiles().filter((file) => pattern.test(readSource(file)));
}

describe("SAT entry ack adoption coverage", () => {
  for (const endpoint of ENTRY_ACK_ENDPOINTS) {
    it(`has no caller of ${endpoint} that bypasses the entry resolver`, () => {
      const callSites = entryEndpointCallSites(endpoint);
      expect(
        callSites,
        `${endpoint} is now called from ${callSites.join(", ")}. Route the ack through ` +
          "resolveEntryPayload (or call adoptEntryControlEpochFromAck) so its post-commit " +
          "control epoch is offered to the engine, then update this test."
      ).toEqual([]);
    });
  }

  it("offers the ack epoch before the payload is merged or committed", () => {
    const controller = readSource(SAT_CONTROLLER);
    const adoptIndex = controller.indexOf("adoptEntryControlEpoch(response, source)");
    const mergeIndex = controller.indexOf("applyEntryAck(base, response)");
    // Both must exist: if either was renamed, re-pin this invariant rather than
    // dropping it — the ordering is what makes any future entry path safe.
    expect(adoptIndex).toBeGreaterThan(-1);
    expect(mergeIndex).toBeGreaterThan(-1);
    expect(adoptIndex).toBeLessThan(mergeIndex);
  });

  it("keeps the adoption seam free of framework and engine imports", () => {
    // The seam is application-layer: it must stay pure (no React, no engine, no
    // storage) so both the controller and any future caller can use it.
    const seam = readSource("src/features/student-delivery/application/satEntryControlEpoch.ts");
    // Import lines only: the doc comment is allowed to NAME the engine it
    // delegates the decision to.
    expect(seam).not.toMatch(/^import[^\n]*['"]react['"]/m);
    expect(seam).not.toMatch(/^import[^\n]*DurableResponseEngine/m);
    expect(seam).not.toMatch(/^import[^\n]*durableDraftStore/m);
  });
});
