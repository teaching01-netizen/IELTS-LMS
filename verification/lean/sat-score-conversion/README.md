# Global SAT score conversion verification

Lean 4.19.0 model and proofs for [`docs/scoreconverimplement.md`](../../../docs/scoreconverimplement.md)
(migration `0087`, `internal/satscoring`, `internal/satconvert/content.go`).

- [SPEC.md](./SPEC.md) · [ASSUMPTIONS.md](./ASSUMPTIONS.md) · [TRACEABILITY.md](./TRACEABILITY.md)
- [PROOF_REPORT.md](./PROOF_REPORT.md) (verdict **CONDITIONAL**) · [PRODUCTION_TEST_PLAN.md](./PRODUCTION_TEST_PLAN.md) · [RECOMMENDATIONS.md](./RECOMMENDATIONS.md)

```bash
rm -rf .lake/build && lake build
lake env lean AxiomAudit.lean
lake env lean --run Replay.lean Model Safety Counterexamples   # independent kernel replay
```

| File | Contents |
| --- | --- |
| `Model.lean` | `Content.resolve` (exact-dimension lookup), drafts/revisions, the active pointer, `Step` (create, save, publish, idempotent republish, seal, release, stutter), `display` |
| `Safety.lean` | Invariant `Inv`, preservation by every step, reachability, business corollaries |
| `Counterexamples.lean` | Naive (unserialized) publish forks the history; the real publish rejects the stale publisher; non-vacuity witnesses |
| `AxiomAudit.lean` | `#print axioms` for 23 declarations |
| `Replay.lean` | Independent `Environment.replay` checker (no `leanchecker` binary ships with this toolchain) |
| `evidence/` | Lean build, axiom audit, replay, Go/MySQL test and soak transcripts |

The Lean results are about these definitions. They reach the Go and SQL only through review and
tests (TRACEABILITY.md); no mechanized refinement exists.
