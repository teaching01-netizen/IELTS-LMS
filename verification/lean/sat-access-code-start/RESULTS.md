# Verification and qualification results

Date: 2026-10-10. Repository HEAD at task start: `d1bf8cceb3f0f6c5325b3359963c80a6def8ec0c`; task changes are in the working tree. Earlier six qualification/diagnostic waves used `sat_start_code_600_20261010` through 0080. The two additional per-request timing waves used a fresh local scratch schema, `sat_start_code_individual_wait_verify`, migrated through 0081; no production data.

## Lean

Lean 4.19.0 (`arm64-apple-darwin23.6.0`, compiler commit `6caaee842e94`) successfully built all four roots:

```sh
lake build SatAccessCodeStart OperationalSafety Counterexamples AxiomAudit
lake env lean AxiomAudit.lean
```

`AxiomAudit.lean` checks exact theorem statements and prints transitive axioms. Only standard `propext`, `Classical.choice`, and `Quot.sound` were reported; the arithmetic counterexample reported no axioms. The saturated-gate theorem proves arbitrary finite no-progress prefixes when no worker release is scheduled; it does not prove elapsed-time or successful-admission liveness. No `sorryAx` or custom axiom appeared. `leanchecker` is unavailable in this pinned toolchain. Formal status is limited to abstract Lean statements; it is not an implementation proof. Details: `PROOF_REPORT.md`.

## Go and MySQL tests

- `go test -race ./internal/delivery` passed.
- `go test -race ./internal/delivery -run '^TestSATStartAdmission' -count=1` passed.
- `go test ./cmd/api -run '^(TestSATAccessCode|TestSATStartCode)' -count=1` passed against local MySQL.
- A previous full `go test ./cmd/api` run had one unrelated fixture failure in `TestAuthoringHTTPContractsMySQL` (“Module 1 has 5 of 27 questions”); that full package run was not repeated.
## Individual queue-wait timing

The HTTP handler returns a per-response `Server-Timing` header for application admission waits. The local 600-wave test parses each response separately and emits an optional synthetic `student_index` line. Header timing is not whole-request latency and does not exist for TCP resets/no-response requests.

On the fresh local scratch schema migrated through 0081:

| Mode | HTTP responses / no response | End-to-end p50 / p95 / p99 / max | Per-response admission p50 / p95 / p99 / max | Drain |
| --- | ---: | --- | --- | ---: |
| Cold | 560 / 40 TCP resets | 3.881s / 6.942s / 7.034s / 7.038s | 3.764s / 6.671s / 6.869s / 6.897s (560 samples) | 7.041s |
| Warm | 368 / 232 TCP resets | 1.233s / 4.944s / 4.997s / 5.003s | 2.625s / 4.687s / 4.892s / 4.919s (368 samples) | 5.003s |

Warm accepted/started count is 369 including one setup start; cold is 560. Each had one runtime. The per-request wait varied; start-worker waiting was the dominant stage in returned timing samples. The 40/232 transport resets have no response header and therefore no observed queue-wait value. These local waves failed the p95 <2s gate and do not establish production capacity.


## Current HTTP performance results

The synchronized HTTP harness used one API process and a 32-connection pool on local MySQL 9.6.0 / Go 1.26.3 / 8 logical CPUs. Full per-wave percentiles, response counts, pool waits, optional stage histograms, and Performance Schema guard-digest snapshots are in `PRODUCTION_TEST_PLAN.md`.

All six 600-candidate waves missed the hard gate (p95 <2.0s and drain ≤2.0s):

- Cold runs: p95 9.567s, 9.958s, 4.924s; drain 9.863s, 10.049s, 5.012s. First run completed 600; second had one 503 despite 600 persisted starts; third had four transport resets and 596 persisted starts.
- Warm runs: p95 5.842s, 5.378s, 2.072s; drain 5.956s, 5.479s, 2.400s. Results ranged from all 601 expected starts (600 candidates plus setup start) to 279 persisted starts with 322 transport resets.
- Every wave had exactly one runtime. The evidence does not meet the all-runs correctness/performance gate.

An additional diagnostic cold 600 wave (not part of the six-run qualification set) had 78 errors (34 `START_CODE_BUSY`, 44 transport resets), 522 accepted/started, one runtime, p95 6.940s, and drain 7.104s. `guard_lock` summed to 160.995s across 556 calls; global InnoDB row-lock time rose 162.050s (+836 waits). `state_content_assembly` summed to 941.932s and the whole `reservation_claim` to 682.669s; these per-request sums overlap. Guard contention is material, but removing it alone is not shown to satisfy the latency gate.

The 200-candidate comparison had no errors and one runtime (p95 2.233s, drain 2.283s). The 2,000-candidate diagnostic had 736 accepted/started and one runtime; 1,264 requests failed (1,241 transport resets, 23 `START_CODE_BUSY`). It does not certify AT15.

Formal status is limited to the checked abstract Lean theorems, including worker-bound preservation and the saturated-gate no-progress witness. Correspondence to executable Go/SQL is not mechanized. No deployed-production run was performed.
