# PROOF REPORT

- Repo commit: `a42d37bf803e8f3ebd3e365ec3c18f5e8a1722e9` + uncommitted working tree (branch `codex/excel-import-guidance`)
- Toolchain: `leanprover/lean4:v4.19.0` (Lean 4.19.0, commit 6caaee842e94), core only, no Mathlib
- Command: `cd verification/lean/sat-module1-gate && rm -rf .lake/build && lake build` → exit 0 (`evidence/lake-build.txt`)
- No `sorry`, `admit`, `axiom`, `native_decide` in `proof/` (grep exit 1)
- `leanchecker` not run (not bundled with this toolchain)

## Axiom audit (`proof/AxiomAudit.lean`)
| Theorem | Axioms |
|---|---|
| m1Hard_shown_requires_threshold | propext |
| m1Easy_shown_requires_below | propext, Quot.sound |
| m1Hard_qualified_iff / m1Easy_qualified_iff | propext / propext, Quot.sound |
| unforced_never_gated | propext |
| gate_matches_routing | none |
| total_needs_both | propext, Quot.sound |
| reachable_inv | propext |
| qualified_seal_shows_cell | propext |
| F1/F2/F2b counterexamples, m1Hard_score_reachable | none |

Standard axioms only.

## Findings
| ID | Bug in first implementation | Lean witness | Fix | Regression test |
|---|---|---|---|---|
| F1 | Forced section with no route decision row got no flag → converted (fail-open; unreachable today only via the cross-module "M2 inserted with decision in same tx" invariant) | `F1_missing_decision_converts`, `F1_fixed` | Query driven by the attempt's published sections, LEFT JOIN decisions; NULL decision ⇒ `false` | `TestFixedModule2WithoutRouteDecisionIsUnavailable` |
| F2 | Gate checked only `T ≥ 1`; `m1_easy` with `T > ops` qualified every student; raw outside `[0, ops]` accepted | `F2_threshold_above_ops_converts`, `F2b_raw_above_ops_converts` | Same range checks as `chooseAdaptiveRoute` using `rd.operational_question_count` | easy threshold above ops, hard raw above ops, easy negative raw |

Mutation check: reverting the gate to pre-fix semantics fails all 4 new tests (`evidence/go-tests.txt`).

## Anti-vacuity
- `Init` allows any shape, decision and flag (garbage) — only `sealed = false`, `shown = none`.
- `m1Hard_score_reachable`: a converted m1_hard score is reachable, so REQ-1 is not vacuous.
- REQ-3 (`*_qualified_iff` ← direction) rules out the trivial "never convert" gate.
- `Step.overlay` quantifies over every cell (every revision); `degrade` and `reseal` are included.

## Status
- **Formal:** PROVED (model theorems above)
- **Correspondence:** REVIEWED_WITH_TESTS (hand-mapped; sqlmock unit tests, not MySQL)
- **Production evidence:** NOT_TESTED (no MySQL integration or deployed run)
- **Verdict:** CONDITIONAL — blockers: A6 legacy results; MySQL-backed test of the LEFT JOIN query.
