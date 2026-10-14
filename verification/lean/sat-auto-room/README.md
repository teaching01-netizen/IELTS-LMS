# SAT automatic room verification

Start with [PROOF_REPORT.md](PROOF_REPORT.md). It separates checked model theorems, implementation correspondence and production evidence.

```sh
cd verification/lean/sat-auto-room
lake build
lake env lean proof/AxiomAudit.lean
lake env lean --run Replay.lean proof.Model proof.Safety proof.Counterexamples
```

No external Lean packages are required. Toolchain/dependencies and source hashes are pinned. `SPEC.md`, `ASSUMPTIONS.md`, `TRACEABILITY.md`, `PRODUCTION_TEST_PLAN.md` and `RECOMMENDATIONS.md` document the boundary and remaining blockers. Generated `.lake` output is ignored; evidence is retained.
