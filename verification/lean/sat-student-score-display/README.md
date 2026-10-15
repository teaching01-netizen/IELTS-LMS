# SAT student score display verification

This core-Lean project formalizes the score-selection behavior in the released
SAT Classroom student report. The theorems apply to the model in `proof/`; the
TypeScript/React correspondence and production limits are recorded in
`TRACEABILITY.md` and `PROOF_REPORT.md`.

```sh
lake build
lake env lean --run Replay.lean proof.Model proof.Safety proof.Counterexamples proof.AxiomAudit
```

The project pins Lean 4.19.0 and has no external Lake packages.
