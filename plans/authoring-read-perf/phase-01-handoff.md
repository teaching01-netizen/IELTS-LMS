# Phase 01 → Phase 02 Handoff Note (Main Agent verification)

**Gate result: Phase 01 PASSED.** Independently verified by the Main Agent, not accepted on report alone.

## What I verified myself (evidence)

| Claim | How I verified | Result |
| --- | --- | --- |
| 3 test files + baseline report exist | `ls` | ✅ 3 files + 266-line report |
| Non-gated tests pass | `go test -run "ReadPerf|Golden"` | ✅ ok |
| Full authoring suite green | `go test ./internal/authoring/...` | ✅ ok |
| Statement budget asserts 13/15/22 | read test body (readperf_bench_test.go:541-580) | ✅ hard assertions, not prints |
| Golden oracle is NON-VACUOUS | **mutation test**: injected `providerKey+"-MUTATED"` into Shell, ran golden | ✅ FAILED as required; restored byte-identical (diff vs backup clean) |
| Fixture cleanup leaves no rows | SQL count `slug LIKE 'readperf-sat-%'` after runs | ✅ 0 |
| Reserved files untouched | grep readperf in service.go/readiness.go/bulk_read.go/tx.go | ✅ 0 matches |
| CPU finding | ran TestReadPerfSummaryCPU | ✅ 216,578 ns/op, 1,819 allocs/op (agent reported ~154,000 ns/op — see note below) |

## Corrections to the agent's report

1. **CPU number understated.** Agent reported `~154,000 ns/op`; I measured **216,578 ns/op** (1,819 allocs/op) for a rich single_choice question. Report §3.6 should be read as a lower bound. The conclusion is unchanged and if anything stronger: ~147 questions × ~216µs ≈ **32 ms of pure single-core CPU per Shell() projection**.
2. **Latency gate correctly loosened.** The agent's correction (gate on query count, not single-run p95) is right and I accept it — 10 identical runs spread up to 2.33×, while query count was exactly 13.00/15.00/22.00 every run with byte-identical payloads. AT-07 now gates: shell 13→≤8, preview 22→≤12, openshell ≤10.

## CRITICAL FINDING — blocker the agent did not flag

**`readperf_golden_test.go` locks the SQL statement shape, not just behavior.**

The golden tests build sqlmock expectations for the *current N+1 sequence*:

```go
readPerfModuleRows(mock, "sec-rw", ...)      // one modules query per section
readPerfQuestionRows(mock, "mod-rw-1", ...)  // one questions query PER MODULE
readPerfQuestionRows(mock, "mod-rw-2", ...)
...
if err := mock.ExpectationsWereMet(); err != nil {
    t.Fatalf("Shell statement shape drifted from the baseline: %v", err)
}
```

When Phase 02 replaces 13 queries with 4 version-scoped bulk queries, **these tests will fail** — not because behavior broke, but because the implementation legitimately changed. That is a false-positive gate.

**Required handling (Phase 02 must do this deliberately, not silently delete tests):**
- The **JSON golden string** (`readPerfGoldenShellJSON`) is the real oracle — it must stay byte-identical and continue passing after the rewrite. That is the AT-01 proof.
- The **sqlmock statement-shape expectations** must be updated to the new bulk sequence, with the old expectations replaced (not deleted wholesale).
- The stronger proof is the equivalence test from `plans/authoring-read-perf/phase-02-database-read-shape.md` §2.10: run OLD nested loaders and NEW bulk loaders against the **same real MySQL fixture** and assert identical output. sqlmock cannot prove that.
- Add a regression test asserting the bulk path issues **≤ 4 statements** for the tree (the query-count gate).

## Starting point for Phase 02 (already reviewed by Main Agent)

`backend/go/internal/authoring/bulk_read.go` (untracked, 13,796 B) — my draft, reviewed and cleaned (removed dead `providerKeyOf`, gofmt clean, `go build`/`go vet` clean):
- `resolveShellIdentity` — single JOIN for provider + draft id + revision
- `loadBulkSections / loadBulkModules / loadBulkRouting / loadBulkQuestionRows` — 4 version-scoped SELECTs
- `assembleShellTree` — pure function rebuilding the nested Shell
- `withReadSnapshot` — wraps reads in a read-only REPEATABLE READ tx
- `bulkShell` — orchestrates; **not yet wired into `Shell()`**

`backend/go/internal/platform/tx/tx.go` — added `WithTxReadOnly` (read-only REPEATABLE READ, always rolls back, never takes row locks). Tested manually against MySQL 9.6.

**Phase 02 must NOT trust my draft** — review it, write the equivalence test, and prove it against the real fixture before wiring `Shell()`.
