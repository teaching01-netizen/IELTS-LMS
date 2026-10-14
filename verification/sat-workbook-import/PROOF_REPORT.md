# PROOF_REPORT

## Environment
| Item | Value |
|---|---|
| Source commit | `a0b0d902` **plus an uncommitted working tree** (the import rework is not committed) |
| Lean | 4.19.0 (commit `6caaee842e94`, arm64-apple-darwin23.6.0) |
| Lake | 5.0.0-6caaee8 |
| Project | `verification/sat-workbook-import` (`lean-toolchain` pinned; no dependencies, core Lean only) |
| Command | `lake build` (re-run from clean after the final edit) |
| Exit status | 0 — `Build completed successfully` |

## Result (Formal status)
**PROVED** (kernel-checked, 0 errors, 0 `sorry`): `reach_inv` and corollaries `at_most_one_effect`, `commit_scope_isolation`, `commit_step_scope`, `commit_installs_checked_content`, `commit_applies_only_to_checked_draft`, `stale_commit_is_noop`, `claimed_key_commit_is_noop`, `retry_after_applied_is_noop`, `commit_of_used_import_is_noop`, `undo_restores_snapshot`, `undo_discards_only_the_import`; witnesses `effect_is_reachable`, `naive_loses_edit`, `real_commit_blocked`.

Method: initiation (`inv_init`) + consecution over every `Step` constructor (`inv_step`) → `reach_inv` by induction. Two linter warnings (unused hypotheses) are harmless.

## Axiom audit (`#print axioms`, transitive)
All theorems depend only on `propext`, `Classical.choice`, `Quot.sound` (standard). Source scan: no `sorry`, `admit`, `axiom`, `native_decide`, `opaque`, `implemented_by`. `leanchecker` binary is **not shipped** in this toolchain → independent re-check **NOT_RUN**.

## What this does and does not prove
* PROVED: the *abstract protocol model* in `Model.lean` satisfies REQ-1…REQ-6 for arbitrary numbers of modules, previews, keys, retries, crashes and concurrent edits.
* NOT PROVED: that the Go/SQL implementation refines the model. Correspondence is `REVIEWED_WITH_TESTS` (TRACEABILITY.md); atomicity (A1), the revision-bump convention (A4) and digest soundness (A3) are assumptions.
* NOT PROVED: liveness; linearizability; capacity.
* Model abstractions: content is an opaque `Nat`; the draft snapshot is a ghost field (the implementation relies on A4 instead of storing it); `Init` has an empty registry (A5).

## Anti-vacuity review
* `Init` allows any draft/revision; recovery = reachable states (crash is a stutter step). ✔
* `Inv` is not assumed of itself: it is established inductively. ✔
* Guards fire: `effect_is_reachable`. Guard is load-bearing: removing `hrev` from `commitApply` breaks `inv_step` (mutation run on a copy). ✔
* ACK vs commit separated: `crash` and `commitAbort` leave state unchanged; the retry theorems quantify over them. ✔
* Weakest point: "all authors" is modelled by one abstract `edit` event whose revision-bump is *assumed* (A4). A writer that forgets to bump invalidates REQ-4/REQ-6.

## Defects found while verifying (all fixed; see RECOMMENDATIONS.md)
1. Receipt lookup ran before the exam-row lock in a REPEATABLE READ transaction, pinning later reads to a pre-lock snapshot.
2. Issues from other sheets were attributed to the module owning the same *row number* on Questions.
3. UI told the user to fix "modules marked Needs attention" when none was marked.
