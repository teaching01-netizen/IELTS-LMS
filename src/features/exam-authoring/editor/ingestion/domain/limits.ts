/**
 * Phase 01 — normative ingestion budgets.
 *
 * These are the outer bounds for the whole program (overall-plan section 8
 * "bounded failures"). Later phases import these constants instead of
 * forking numbers; adapter-level tighter caps (phase 05) derive from them.
 * Over-limit input is truncated plus warned, never thrown and never hung.
 */
export const INGESTION_LIMITS = {
  clipboardChars: 500_000,
  htmlDepth: 32,
  nodeCount: 2_000,
  textNodeChars: 20_000,
  tableRows: 250,
  tableCols: 50,
  tableCells: 5_000,
  latexChars: 5_000,
  fileBytes: 10 * 1024 * 1024,
  executionMs: 1_500,
} as const;

export type IngestionBudgetKey = keyof typeof INGESTION_LIMITS;

export interface BudgetExceeded {
  budget: IngestionBudgetKey;
  observed: number;
  allowed: number;
}

/** Typed budget failure. Carries budget names plus counts only, never input. */
export class IngestionBudgetExceededError extends Error {
  readonly budget: IngestionBudgetKey;
  readonly observed: number;
  readonly allowed: number;

  constructor(detail: BudgetExceeded) {
    super(
      "ingestion budget exceeded: " +
        detail.budget +
        " observed " +
        detail.observed +
        " allowed " +
        detail.allowed,
    );
    this.name = "IngestionBudgetExceededError";
    this.budget = detail.budget;
    this.observed = detail.observed;
    this.allowed = detail.allowed;
  }
}
