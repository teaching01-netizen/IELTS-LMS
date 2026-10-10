# Lean proof report

## Verdict and exact target

**Formal status: `PROVED` for the named abstract theorems below.** This is not a proof of the Go/MySQL implementation. The package checks a pure transaction-visible model (`SatAccessCodeStart.lean`) and an aggregate reservation/waiter/active-worker/runtime transition model (`OperationalModel.lean`). `Initial` assumes the same budget, waiter, worker-count, and runtime predicates later named `Invariant`; the operational theorem therefore applies only to states in that explicitly restricted initial set. `emptyState_initial` confirms that the selected empty state belongs to it.

The primary operational theorem is:

```lean
theorem all_reachable_states_preserve_invariant {s : State}
    (h : Reachable s) : Invariant s
```

`Reachable` is the inductive closure of every modeled `Step`. `transition_preserves_invariant` case-splits over every constructor of `Action`; `all_reachable_states_preserve_invariant` proves initiation and consecution by induction. The invariant now includes the abstract bound `activeStartWorkers ≤ startWorkerLimit`; `workerBound_transition` proves that each modeled action preserves that bound for every state/action under the prior bound. This is a safety theorem, not a queue-fairness or timing theorem. Other business lemmas prove that pending-only saturation chooses `wait` rather than `cooldown`, a full waiter bound chooses `busy`, internal wait/wake/re-claim does not modify modeled identity quotas, stale generation claims do not reserve against a rotated generation, and modeled runtime commits preserve the published plan. The base state-model theorems cover eligible start projection, replay preservation, distinct-candidate commutativity, and the aggregate 200-slot budget.

```lean
theorem workerBound_transition (s : State) (action : Action)
    (h : workerBound s) :
    workerBound (transition s action)
```

The liveness limitation is now made explicit by this checked model statement:

```lean
theorem saturated_worker_can_stutter_for_any_finite_length
    (s : State) (actor : Nat) (n : Nat)
    (hFull : s.activeStartWorkers = s.startWorkerLimit) :
    repeatedSaturatedAcquire s actor n = s
```

For every finite `n`, repeated acquisition attempts while all modeled start workers are occupied make no progress. This refutes an unconditional successful-admission claim from the worker-count invariant alone. It does not model elapsed time or prove a 15-second timeout: a timeout action exists, but the model has no clock or fairness rule requiring that action to run. Successful start still depends on worker release, scheduling, database availability, and remaining request deadline.

The exact theorem statements are compiled and printed by `AxiomAudit.lean` with `#check`; its `#print axioms` list is the transitive audit. No theorem is advertised beyond the displayed model statement.

## Reproducible project and commands

- Project: `verification/lean/sat-access-code-start`
- Toolchain pin: `leanprover/lean4:v4.19.0`
- Lean observed: `Lean (version 4.19.0, arm64-apple-darwin23.6.0, commit 6caaee842e94, Release)`
- Lake observed: `5.0.0-6caaee8`
- Dependencies: no external Lake packages; `lake-manifest.json` is retained.
- Repository HEAD at task start: `d1bf8cceb3f0f6c5325b3359963c80a6def8ec0c`; source and proof edits in this run are working-tree changes, not part of that commit.

Commands run from the project directory:

```sh
lake env lean --version
lake build SatAccessCodeStart OperationalSafety Counterexamples AxiomAudit
lake env lean AxiomAudit.lean
```

The explicit four-root build completed successfully. `AxiomAudit.lean` compiled; the observed transitive axiom output was:

| Theorem | `#print axioms` output |
| --- | --- |
| `successful_start_commits_acceptance_and_activation` | `propext`, `Classical.choice`, `Quot.sound` |
| `distinct_candidate_commits_commute` | `propext`, `Quot.sound` |
| `replay_preserves_original_attempt_state` | `propext`, `Classical.choice`, `Quot.sound` |
| `reserve_respects_failure_limit` | `propext`, `Quot.sound` |
| `Operational.all_reachable_states_preserve_invariant` | `propext`, `Quot.sound` |
| `Operational.workerBound_transition` | `propext`, `Quot.sound` |
| `Operational.saturated_worker_acquire_stutters` | `propext`, `Quot.sound` |
| `Operational.saturated_worker_can_stutter_for_any_finite_length` | `propext`, `Quot.sound` |
| `Operational.pending_saturation_waits_instead_of_cooldown` | `propext`, `Quot.sound` |
| `Operational.internal_claim_retry_does_not_recharge_identity_quotas` | `propext` |
| `Operational.claim_after_rotation_cannot_reserve_for_new_generation` | `propext`, `Quot.sound` |
| `Operational.cold_runtime_commit_pins_the_published_plan` | `propext` |
| `Operational.remote_runtime_wins_cold_start_race` | `propext` |
| `Operational.crash_preserves_durable_budget_and_runtime` | `propext` |
| `Operational.Counterexamples.unguarded_read_check_write_exceeds_limit` | no axioms reported |

The observed proof dependency list contains only Lean's standard `propext`, `Classical.choice`, and `Quot.sound`; no custom axiom or `sorryAx` appeared. `leanchecker` is not installed in this pinned toolchain (`lake env leanchecker --help` returned “no binary leanchecker”). No independent checker was run.

## Hostile-execution and anti-vacuity review

- **Meaningful transitions exist:** claims, mismatch/success settlement, original-window expiry, window rollover, rotation, waiting/wakeup/timeout/cancel, start-worker acquire/release, local/remote runtime commits, stale-exclusive rollback/shared retry, quota charging, crash, and restart are constructors of `Action`; rejected modeled operations stutter by their guard conditions.
- **Arbitrary finite interleavings:** `Reachable` quantifies over any finite sequence of `Step`s. `actor` and reservation generations are not a faithful identity ledger; aggregate counter algebra is what is proved.
- **Concurrent read-check-write hazard:** `Counterexamples.unguarded_read_check_write_exceeds_limit` checks the concrete arithmetic counterexample `199 + 2 = 201`. It illustrates why serialization is needed; it is not a test or proof of MySQL locking.
- **Crash/ACK gap:** `crash_preserves_durable_budget_and_runtime` preserves only model fields named durable. The model does not represent an HTTP ACK, a SQL commit result lost with the connection, or a client retry history. No linearizability theorem is present.
- **Initialization:** `Initial` is defined as the invariant. The proof does not show all production startup/restore rows satisfy it; only `emptyState_initial` proves the selected empty state.
- **Atomicity:** `commitFirstStart` is one pure state update. This proves neither that SQL is issued in one transaction nor that commit is durable on a production engine.
- **Liveness/fairness:** `saturated_worker_can_stutter_for_any_finite_length` shows arbitrary finite no-progress prefixes under a permanently saturated worker gate. No scheduler fairness, database availability, retry success, clock/deadline, or service-rate premise is included; no successful-admission or elapsed-time theorem is claimed.
- **No hidden bounded-to-unbounded claim:** the model is not a 600-user throughput theorem. The runtime test provides finite local evidence only.

## Proof-to-production boundary

The model is a reviewable abstraction, not a generated implementation and not linked by a mechanized simulation/refinement proof to Go, SQL, the Go SQL driver, InnoDB, session timezone, DB failover, or deployment config. The local MySQL tests exercise concrete code paths and are separate empirical evidence. The per-request `Server-Timing` headers are application-level measurements, not proof of a deadline/liveness guarantee. Local row-lock counters and HTTP timings do not establish production behavior. The hard 600-candidate latency gate failed; readiness is blocked independently of the Lean result. Full assumptions and mapping are in `ASSUMPTIONS.md` and `TRACEABILITY.md`.