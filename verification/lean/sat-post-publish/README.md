# SAT post-publish verification

Lean 4.19.0 model and evidence artifacts for the SAT staff publish completion lifecycle.

- [SPEC.md](./SPEC.md) — guarantees and formal boundary
- [ASSUMPTIONS.md](./ASSUMPTIONS.md) — assumptions and unknowns
- [TRACEABILITY.md](./TRACEABILITY.md) — requirement-to-model/code/test mapping
- [PROOF_REPORT.md](./PROOF_REPORT.md) — proof and axiom audit results
- [PRODUCTION_TEST_PLAN.md](./PRODUCTION_TEST_PLAN.md) — executed evidence and remaining scenarios
- [RECOMMENDATIONS.md](./RECOMMENDATIONS.md) — remaining implementation and production gates

Rebuild with `lake build SatPostPublish Model Safety Liveness Traces Counterexamples Provenance AxiomAudit`, then `lake env lean AxiomAudit.lean` from this directory. The Lean result is about this abstract model only. Execution transcripts and final source hashes are retained in `evidence/`.
