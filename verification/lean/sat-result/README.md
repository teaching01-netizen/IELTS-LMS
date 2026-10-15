# SAT result verification

Lean 4.19.0 model, proofs and evidence for SAT result reporting, release and
student authorization, the staff breakdown, and the answered-exam paper and
its print gate. The current global score-conversion policy has a separate
model and verification package at [`../sat-score-conversion`](../sat-score-conversion/README.md).

- [SPEC.md](./SPEC.md): the requirement as verified, the guarantees, and what is implemented vs planned
- [ASSUMPTIONS.md](./ASSUMPTIONS.md): assumptions (A-*), unknowns (U-*) and limitations (L-*)
- [TRACEABILITY.md](./TRACEABILITY.md): plan row → theorem → code → test, with separate statuses
- [PROOF_REPORT.md](./PROOF_REPORT.md): the verdict (**CONDITIONAL**), axiom audit, fixes, hostile schedules and anti-vacuity review
- [PRODUCTION_TEST_PLAN.md](./PRODUCTION_TEST_PLAN.md): executed evidence and remaining scenarios
- [RECOMMENDATIONS.md](./RECOMMENDATIONS.md): fixes made and ranked follow-ups (R-1…R-9)

Rebuild from this directory:

```bash
rm -rf .lake/build && lake build
lake env lean AxiomAudit.lean
```

## Module map

| File | Contents |
| --- | --- |
| `Model.lean` | `Convert` (table entries, fail-closed lookup, totals), `Scoring` (module fold), `Report` (`classroomRaw` grouping and completeness), `Attach` (staff nesting), `Release` (student projection and client gate), `ResultMachine` (seal / terminate / repair / environment steps), `Paper` (circles, answer map, completeness), `PrintGate` (download flow), `CloseAck` (close vs in-flight edit) |
| `Safety.lean` | Invariants, their preservation by every step, reachability, and the business corollaries cited in TRACEABILITY |
| `Counterexamples.lean` | Pre-fix behaviours (marked fixed), kept limitations, and anti-vacuity witnesses |
| `AxiomAudit.lean` | `#print axioms` for 116 declarations |
| `SatResult.lean` | Root import |
| `evidence/` | Build, axiom, Go, MySQL, vitest, typecheck and lint transcripts, plus `source-snapshot.json` |

The Lean results are about these definitions. They link to Go, SQL and
TypeScript through review and tests, not through a mechanized refinement. The
global score-conversion implementation is separate from this package's result
and release model; neither Lean model proves the complete production path.
