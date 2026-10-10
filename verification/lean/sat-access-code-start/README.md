# SAT access-code start verification

This pinned Lake project contains an abstract transaction-state model and a
separate aggregate admission/runtime transition model. It proves model
properties only; it does not mechanize a refinement proof for Go, SQL, MySQL,
the HTTP boundary, or a deployed environment.

## Build and audit

Run from this directory with the pinned Lean 4.19.0 toolchain:

```sh
lake build SatAccessCodeStart OperationalSafety Counterexamples AxiomAudit
lake env lean AxiomAudit.lean
```

`AxiomAudit.lean` prints the exact statements with `#check` and audits their
transitive dependencies with `#print axioms`. `leanchecker` is unavailable in
the pinned toolchain. See `PROOF_REPORT.md` for command output and axiom lists.

## Model files

- `SatAccessCodeStart.lean`: pure first-start projection, owner/writer/code/
  generation/window preconditions, pinned runtime, per-attempt activation and
  deadline, replay state preservation, distinct-candidate commutativity, and
  aggregate reservation budget.
- `OperationalModel.lean`: aggregate state and transitions for claims,
  pending/failure settlement, expiry/window/generation changes, bounded
  waiters and active start workers, local/remote runtime initialization,
  stale-exclusive retry, and process crash/restart.
- `OperationalSafety.lean`: initial-state and all-transition invariant
  preservation plus admission/budget/runtime lemmas.
- `Counterexamples.lean`: two unsynchronized claims at 199 produce 201.
- `AxiomAudit.lean`: exact theorem statement and axiom checks.

The operational model's `Initial` predicate assumes the same budget, waiter,
worker-count, and runtime-plan predicates as `Invariant`; `emptyState_initial`
includes the chosen empty state. `workerBound_transition` proves the abstract
active-worker count never exceeds the modeled limit across any modeled action.
`saturated_worker_can_stutter_for_any_finite_length` shows that a full worker
gate can remain without admission progress for any finite number of acquisition
attempts if no worker release is scheduled. The model has no fairness, clock,
DB-pool initialization, or availability premise and proves no Go refinement,
timeout bound, successful-start liveness, queue latency, or capacity result.

## Implementation correspondence

Relevant Go and schema anchors:

- `backend/go/internal/delivery/sat_code_entry.go`: `StartWithCode`,
  `codeStartTx`, `reserveStartCodeComparison`, quota accounting, reservation
  settlement, and sweeper.
- `backend/go/internal/delivery/sat_start_code_admission.go`: per-process
  bounded admission coordination; it is not the cross-process authority.
- `backend/go/internal/delivery/sat_entry_state.go`: committed ACK and selected
  module ownership/current-scope content read.
- `backend/go/migrations/0080_sat_access_code_start.sql`: attempt acceptance
  constraint, one code row per schedule, per-generation guard, and ledger rows.
- `backend/go/migrations/0081_sat_start_code_reservation_slots.sql`: creates
  and backfills the 200 durable reservation slots.

The former shared-guard path's extra cold diagnostic tied 161s cumulative
guard-lock timing to a 162s InnoDB row-lock delta, while content assembly and
the full reservation claim also remained expensive. After migration 0081, two
additional local 600 waves expose per-response waits (cold p95 6.671s; warm
4.687s) and 40/232 transport resets with no timing header. All nine recorded
600 waves missed the p95/drain hard gate. Production readiness is blocked.
See `SPEC.md`, `ASSUMPTIONS.md`, `TRACEABILITY.md`, `PROOF_REPORT.md`,
`PRODUCTION_TEST_PLAN.md`, and `RECOMMENDATIONS.md` for full scope and gaps.
