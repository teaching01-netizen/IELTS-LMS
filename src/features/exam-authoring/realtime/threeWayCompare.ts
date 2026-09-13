import type { QuestionRevision } from "../contracts/assessment";

/**
 * Field-granular, value-equality three-way comparison.
 *
 * Deliberately NOT a rich-text merge: a `prompt` edited on both sides is a
 * CONFLICT even when the edits look disjoint, because deciding otherwise would
 * require character-level intent we do not have. Field-pick merging is out of
 * scope; `Use latest` and `Keep editing` are both wholesale.
 *
 * Values are compared through a canonical stringify (recursively sorted object
 * keys, order-sensitive arrays) so two structurally identical revisions built
 * in different orders compare equal — and so comparison never depends on
 * property insertion order.
 */

/** Fixed presentation/compare order. Never reorder without updating tests. */
export const COMPARE_FIELD_KEYS = [
  "stimulus",
  "prompt",
  "choices",
  "answer-key",
  "rationale",
  "metadata",
  "accessibility",
  "classification",
] as const;

export type CompareFieldKey = (typeof COMPARE_FIELD_KEYS)[number];

export type FieldFate =
  | "unchanged" // base == local == remote
  | "local-only" // base == remote, local differs
  | "remote-only" // base == local, remote differs
  | "same-change" // local == remote != base
  | "conflict"; // all three differ

export interface FieldClassification {
  field: CompareFieldKey;
  fate: FieldFate;
}

/**
 * Canonical form of a slice. Object keys are sorted; arrays keep their order
 * (except `tags`, which the metadata slice sorts explicitly, because tag order
 * carries no meaning). `undefined` keys are dropped so a slice that merely
 * omits a field equals one that omits it explicitly.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) continue;
      out[key] = normalize(entry);
    }
    return out;
  }
  return value === undefined ? null : value;
}

/**
 * The eight slices a three-way compare is computed over. `classification` is
 * display-only: `questionType` is surfaced so a type change is visible, but no
 * resolver path ever writes it back.
 */
const FIELD_SLICES: Record<CompareFieldKey, (revision: QuestionRevision) => unknown> = {
  stimulus: (r) => r.stimulus,
  prompt: (r) => r.prompt,
  choices: (r) =>
    r.answer.kind === "single_choice" ? r.answer.options : r.answer.acceptedResponses,
  "answer-key": (r) =>
    r.answer.kind === "single_choice"
      ? { correctOptionId: r.answer.correctOptionId }
      : {
          normalizeFraction: r.answer.normalizeFraction,
          normalizeDecimal: r.answer.normalizeDecimal,
          numericTolerance: r.answer.numericTolerance,
        },
  rationale: (r) => r.rationale,
  metadata: (r) => ({
    sectionKey: r.metadata.sectionKey,
    domain: r.metadata.domain,
    skill: r.metadata.skill,
    difficulty: r.metadata.difficulty,
    tags: [...r.metadata.tags].sort(),
  }),
  accessibility: (r) => r.accessibility,
  classification: (r) => ({ questionType: r.questionType }),
};

export function fieldSlice(key: CompareFieldKey, revision: QuestionRevision): unknown {
  return FIELD_SLICES[key](revision);
}

/** Classify ONE field from its three values. Total and side-effect free. */
export function fateOf(base: unknown, local: unknown, remote: unknown): FieldFate {
  const b = canonicalStringify(base);
  const l = canonicalStringify(local);
  const r = canonicalStringify(remote);
  if (l === b && r === b) return "unchanged";
  if (l !== b && r === b) return "local-only";
  if (l === b && r !== b) return "remote-only";
  if (l === r) return "same-change";
  return "conflict";
}

/** All eight rows, in the fixed order, always (never a filtered list). */
export function classifyQuestionFields(args: {
  base: QuestionRevision;
  local: QuestionRevision;
  remote: QuestionRevision;
}): FieldClassification[] {
  return COMPARE_FIELD_KEYS.map((field) => ({
    field,
    fate: fateOf(
      FIELD_SLICES[field](args.base),
      FIELD_SLICES[field](args.local),
      FIELD_SLICES[field](args.remote),
    ),
  }));
}

/**
 * Content equality ignoring revision bookkeeping (`id`, `revision`,
 * `semanticRevision`, `state`). This is the only notion of "did I change
 * anything" the divergence store uses — a save that only bumped `revision`
 * must NOT read as a local edit.
 */
export function documentContentEquals(a: QuestionRevision, b: QuestionRevision): boolean {
  return COMPARE_FIELD_KEYS.every(
    (field) => canonicalStringify(FIELD_SLICES[field](a)) === canonicalStringify(FIELD_SLICES[field](b)),
  );
}

/**
 * True when neither side touched a field the other touched (one side changed
 * nothing, or only different fields changed). Displayed as "auto-mergeable in
 * principle"; nothing is ever auto-written.
 */
export function isAutoMergeable(classifications: readonly FieldClassification[]): boolean {
  return !classifications.some((row) => row.fate === "conflict");
}

/** True when both sides changed the same field differently. */
export function hasSameFieldConflict(
  classifications: readonly FieldClassification[],
): boolean {
  return classifications.some((row) => row.fate === "conflict");
}

/** True when the local side actually changed something. */
export function hasLocalChanges(classifications: readonly FieldClassification[]): boolean {
  return classifications.some((row) => row.fate === "local-only" || row.fate === "conflict");
}
