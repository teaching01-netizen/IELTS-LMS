import type { SatSectionKey, SatRunnerState } from "../application/satRunnerReducer";
import { resolveSatExamToolPolicy } from "./satToolPolicy";

/**
 * Single calculator-availability selector (burst plan FR-05/INV-001).
 *
 * Three call sites previously forked this decision: the route's live-module
 * gate (`state.toolCapabilities.calculator && stateModule`), the pending-module
 * gate (`resolveSatExamToolPolicy(pendingSectionKey, pending.toolPolicy)`),
 * and the shell's `calculatorAvailable` prop. All three now read this one
 * selector, so a Math-only + module-policy-gated calculator (INV-001) holds
 * identically under concurrency, skew, and republish — including the C13
 * fail-closed case (R&W pending with an authored calculator policy).
 */

/** Minimal structural module: id + authored tool policy. */
export interface SatCalculatorCandidateModule {
  readonly id: string;
  readonly toolPolicy: Record<string, unknown> | string[];
}

export interface SatCalculatorAvailabilityInput {
  /** Runner phase; only module/review (live) and directions/break (prewarm) qualify. */
  phase: SatRunnerState["phase"];
  /** Runner `toolCapabilities.calculator` for the live module (false outside module/review). */
  calculatorCapable: boolean;
  /** Resolved live module (module/review phases). */
  stateModule: SatCalculatorCandidateModule | null;
  /** Upcoming module awaiting entry (directions/break phases). */
  pendingModule: SatCalculatorCandidateModule | null;
  /** Section of the pending module; unknown sections read as Reading and Writing. */
  pendingSectionKey: SatSectionKey;
}

/**
 * Returns the Desmos-eligible module or null. Live (module/review) prefers
 * the runner-gated state module; directions/break prewarm the pending module
 * only when its own section+policy resolve to Math-with-calculator. Every
 * other phase — and any unresolvable section — is bare (INV-002).
 */
export function selectCalculatorAvailable(
  input: SatCalculatorAvailabilityInput,
): SatCalculatorCandidateModule | null {
  if (input.phase === "module" || input.phase === "review") {
    return input.calculatorCapable && input.stateModule ? input.stateModule : null;
  }
  if (input.phase === "directions" || input.phase === "break") {
    if (!input.pendingModule) return null;
    return resolveSatExamToolPolicy(input.pendingSectionKey, input.pendingModule.toolPolicy)
      .calculator
      ? input.pendingModule
      : null;
  }
  return null;
}
