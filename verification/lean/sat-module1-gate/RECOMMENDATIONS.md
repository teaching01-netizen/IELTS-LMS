# RECOMMENDATIONS (ranked)

1. **Done — F1 fail-open on missing decision.** Fixed in `markModule1QualificationTx`.
2. **Done — F2 range checks.** Fixed; gate now mirrors `chooseAdaptiveRoute`.
3. **R1 — Backfill legacy results (A6).** Results sealed before this change have no
   `module1Qualified` and still convert under any revision. Run the repair sweep (or a one-off
   job reusing `markModule1QualificationTx`) over SAT results whose plan has an `m1_*` shape.
4. **R2 — MySQL integration test** for the new LEFT JOIN query (PRODUCTION_TEST_PLAN 1–2).
5. **R3 — Share the routing predicate.** The gate re-implements `chooseAdaptiveRoute`'s range
   checks; moving the predicate into a leaf package (e.g. `satpublish`) removes drift risk.
6. **Open question — boundary.** Implemented as raw ≥ T for Hard (same as adaptive routing).
   If the business rule is strictly "more than T", change `raw >= thr` and the UI copy together.
