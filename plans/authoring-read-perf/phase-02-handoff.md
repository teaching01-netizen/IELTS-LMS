# Phase 02 → Phase 03 Handoff Note (Main Agent verification)

**Gate result: Phase 02 PASSED.** Independently verified by the Main Agent.

## What I verified myself (evidence)

| Claim | How I verified | Result |
| --- | --- | --- |
| 7 new + 2 modified files exist | `ls` | ✅ |
| Build / vet clean | `go build ./...`, `go vet` | ✅ |
| All 12 golden tests pass (5 nested + 7 bulk) | `go test -run TestGolden -v` | ✅ 12/12 PASS |
| Equivalence on real MySQL (147q) | `TEST_MYSQL_DSN=... go test -run TestEquivalence` | ✅ 5/5 PASS |
| **Statement budget gate is NON-VACUOUS** | **mutation test**: injected a 5th `SELECT 1` into `loadShellTree` | ✅ BOTH gates FAILED as required |
| Delivery redaction | `go test ./internal/delivery/ -run Bulk -v` | ✅ 5/5 PASS incl. TestDeliveryBulkRedaction |
| One shared JSON oracle for both paths | `grep readPerfGoldenShellJSON` | ✅ same literal asserted from nested AND bulk |
| `Shell()` NOT wired (Phase 02 scope) | `grep -c bulkShell service.go` | ✅ 0 |
| Phase 02 files gofmt-clean | `gofmt -l` on the 8 files | ✅ empty |

**Mutation test detail (the important one).** I injected an extra query into the bulk path:
- Structural gate: `FAIL — could not match actual sql: "SELECT 1"` ✅
- Live driver gate: `bulkShell issued 6 statements, want exactly 5 (1 identity + 4 tree)` ✅
- Restored byte-identical (`diff` clean).

## Confirmed statement-count delta

| Path | Before | After | AT-07 gate |
| --- | --- | --- | --- |
| Shell tree (`bulkShell`) | 13 | **5** (1 identity + 4 tree) | ≤8 ✅ |
| LoadSections (delivery) | 9 | **3** | — |
| Preview composed | 22 | **8** (5 + 3) | ≤12 ✅ |
| OpenShell | 15 | 15 unchanged | Phase 03 owns |

Payload bytes identical in every measured row (90,962 B shell / 220,573 B preview) — the strongest signal the projection is unchanged.

## My own error, disclosed

My first mutation attempt used a stale anchor (`sections, err := loadBulkSections(...)`) but the real signature returns three values (`sections, missingTable, err`). The Python `assert` fired, so **nothing was mutated**, and the gate "passing" was meaningless. I reported this to myself as a possible finding, then re-ran with the correct anchor — both gates caught the injected query. **Lesson applied: always verify a mutation actually applied before interpreting its result.** No defect existed in the agent's work.

## Defects the agent found in my draft (all fixed, verified)

1. Identity resolved OUTSIDE the snapshot tx → identity/revision could disagree with the tree. Now inside.
2. Empty-sections path issued 3 discarded reads → short-circuits to 2 statements, matching nested behavior.
3. `withReadSnapshot` panicked on `NewService(nil, nil)` → explicit guard; nil-runner-with-pool degrades to direct reads.
4. Routing first-row-wins + `tool_policy {}` defaulting were implicit → documented and pinned by unit tests.
5. **Two defects caught by the equivalence harness itself** (not by review): a scan-order bug in the delivery bulk module loader (`section_id` scanned into the wrong column) and a `tool_policy` seeding assumption.

## Constraints Phase 03 must respect

1. **`bulkShell` deliberately has NO provider gate**, matching today's `Shell()`. Do NOT add one during cutover — non-SAT draft behavior must not change.
2. **`LoadSectionsBulkWithRevision` probes the revision INSIDE the same snapshot** (4 statements, not 3) so `VersionCache.GetChecked` can fail closed on a revision that genuinely describes the tree. Use `BulkSectionsLoader(ctx, versionID)` for the `VersionLoader` shape.
3. **Nested golden expectations in `readperf_golden_test.go` become obsolete once `Shell()` is cut over.** Phase 03 must retire them deliberately (replace with bulk expectations), not delete them silently, and must keep the shared JSON literal passing from the new path.
4. **`WithTxReadOnly` needs no change** — verified correct (`ReadOnly:true` → `START TRANSACTION READ ONLY`, always rolls back, never takes row locks).
5. **No migration** — all four hot SELECTs are index lookups; bulk loaders reuse the same access paths.

## Remaining Phase-03 work

- Cut `Shell()` over to `bulkShell` (keep the func name/signature; no route or JSON change).
- Rewrite `Preview()` as a single bulk build (remove the discarded `Shell()` call).
- Decide OpenShell fast-path with a concurrent-open proof.
- Inject `VersionCache` via constructor (nil-safe, authz-before-cache, keyed by version+revision).
- Retire/replace the now-obsolete nested statement-shape expectations.
