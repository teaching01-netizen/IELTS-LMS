# Inserted-images delivery verification

Lean 4.19.0 shape model and evidence artifacts for the IELTS inserted-image
delivery slot (the "diagram does not appear in the section preview" fix).

- [SPEC.md](./SPEC.md) — guarantees and formal boundary
- [ASSUMPTIONS.md](./ASSUMPTIONS.md) — assumptions (A1–A7), unknowns (U1–U5)
- [TRACEABILITY.md](./TRACEABILITY.md) — requirement → theorem → code → test mapping
- [PROOF_REPORT.md](./PROOF_REPORT.md) — verdict, proof results, axiom audit, adversarial review
- [PRODUCTION_TEST_PLAN.md](./PRODUCTION_TEST_PLAN.md) — executed evidence and remaining scenarios
- [RECOMMENDATIONS.md](./RECOMMENDATIONS.md) — ranked fixes and follow-ups

Rebuild with:

```bash
lake build InsertedImagesDelivery Model Safety Counterexamples AxiomAudit
lake env lean AxiomAudit.lean
```

Module map:

| File | Contents |
| --- | --- |
| `Model.lean` | slots, URL classes, blocks, selection, frame shapes, key material |
| `Safety.lean` | placement (S1/S1b), no-empty-container (S2), exclusions (S3), selection (S4), provenance (S5), keys (S6) |
| `Counterexamples.lean` | compiled witnesses for the reported block, the mixed payload, the map exclusion and the key-collision hazard |
| `AxiomAudit.lean` | `#check` + `#print axioms` for every theorem cited in the report |

The Lean result is about this abstract shape model only: it proves placement,
selection, provenance and key uniqueness, not React, the DOM, image loading, the
backend, or that a student sees pixels. Execution transcripts and source hashes
are retained in `evidence/`.
