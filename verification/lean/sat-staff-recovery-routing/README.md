# SAT staff recovery routing verification

Lean 4.19.0 model and evidence for three SAT staff authoring behaviours that
decide where a recovery action lands: publish-finding routing, deep-link
consumption, and room-target pinning.

- [SPEC.md](./SPEC.md) — guarantees, requirements, formal boundary
- [ASSUMPTIONS.md](./ASSUMPTIONS.md) — assumptions with owners and validation
- [TRACEABILITY.md](./TRACEABILITY.md) — requirement → theorem → source → test, with separate status fields
- [PROOF_REPORT.md](./PROOF_REPORT.md) — commands, axiom audit, proved groups, adversarial schedules
- [PRODUCTION_TEST_PLAN.md](./PRODUCTION_TEST_PLAN.md) — scenarios still to run
- [RECOMMENDATIONS.md](./RECOMMENDATIONS.md) — the defect found and fixed, and what remains
- `evidence/` — build, audit and trace transcripts plus the source-hash snapshot

Rebuild from this directory:

```bash
lake build SatStaffRecoveryRouting Model Safety Counterexamples AxiomAudit
lake env lean AxiomAudit.lean
lake env lean Counterexamples.lean
```

The Lean result is about the abstract model only. The TypeScript correspondence
is reviewed and tested, not mechanized, and no production evidence exists yet:
see the verdict in `PROOF_REPORT.md`.
