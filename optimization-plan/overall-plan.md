# Optimization Plan — Overall Plan

**Source:** `docs/optimize.md` (planning deliverable; implementation has not started).
**Method:** ai-planning-workflow — Main Agent owns WHAT / WHY / ORDER / DEPENDENCIES / OWNERSHIP. Phase Agents own HOW (file-by-file, step-by-step) inside each phase file.
**Plan folder:** `optimization-plan/` (this file + `phase-01` … `phase-07`).

---

## 1. Goal

Deliver production-quality implementation across frontend, backend, persistence, operations, and verification for the IELTS / SAT / ACT examination and proctoring platform, preserving intended product behavior. Prioritize the exam lifecycle over cosmetic refactoring:

> Student intent → recoverable answer → acknowledged write → authoritative submission → correct score → authorized result.

Release target (from source): no unresolved critical correctness or security defects, no silent answer loss in the defined fault model, bounded performance at a demonstrated supported load, and tested recovery when components fail. "No bugs" is not a provable target and is explicitly NOT the goal.

## 2. Target architecture (as mapped in source — to be confirmed in Phase 01)

- **Client (React + Vite SPA):** student exam delivery, proctor dashboard, admin review, authoring/grading UI. One shared durability engine owns write identity, ack matching, pending intent, replay, conflict handling (`src/shared/durability/DurableResponseEngine.ts`, transport, per-provider persistence adapters).
- **API process (Go):** auth, admission, delivery/bootstrap, response writes, terminalization authority, runtime state, media — backed by MySQL. OpenAPI contract in `api/openapi/openapi.yaml`.
- **Worker process (Go, separate process even when co-packaged in one container):** deadline autosubmit fan-out, SAT provisional→final reconciliation, retries, dead-lettering. Owns no in-memory state shared with the API; worker-originated mutations must reach API-visible state via a durable bus / invalidation signal / bounded authoritative refresh — never assumed shared memory.
- **Persistence (MySQL):** response batches, attempts, terminal facts, job/outbox tables, grading queues. Migration lineage under `backend/go/cmd/migrate/`. No new queue infra (no Redis/another queue), no sharding, no microservices.
- **Observability/test:** telemetry in `backend/go/internal/platform/telemetry/`, k6 load profiles in `k6/`, Vitest + Playwright + Go suites, CI gates.

## 3. Major decisions

1. **ROADMAP execution, not a flat task list.** Response durability, terminalization, scoring, contracts, schema, and rollout have dependent safety obligations, so phases run in gated waves (§6). Early-start exceptions only: measurement baselines, migration/restore preparation, CI baseline (no dependents blocked on them).
2. **Contracts freeze before consumers.** C01–C09 contract versions (§4) are frozen in Phase 01. No backend/frontend worker invents shared semantics; a contract change invalidates only its producer/consumer phases.
3. **Investigate before repairing.** Every suspected defect is reproduced or benchmarked first; confirmed defects get a failing behavioral test, then the smallest complete repair. Already-satisfied requirements are closed with evidence, not code churn.
4. **Single-mutation-owner rule.** One owner per file/logical scope at a time; read access may overlap, concurrent edits may not. Shared surfaces (API schema, durability engine, terminalization resolver, app wiring, migration lineage, CI files) have a sole authority — see ownership registry in §7.
5. **Evidence-gated cleanup last.** Structural simplification and compatibility retirement (V1 writes, duplicate stores, redundant gateways) happen only after behavior is protected by tests and adoption evidence proves removal safe. If unsafe, the compatibility path is retained and documented.
6. **No wholesale changes without measured need:** no rewrite, no blanket dependency upgrades, no new infrastructure, no guessed index DDL, no timeout increases as diagnosis substitutes, no weakened assertions to turn tests green.
7. **Candidate discipline.** Each integrated state is frozen (source revision + dirty-tree hashes, schema version, config fingerprint, lockfiles) and independently checked before release claims. BLOCKING findings must be repaired; IMPORTANT needs repair or explicit authorized acceptance.

## 4. Frozen contract set (Phase 01 output — consumers depend on these versions)

| ID | Contract | Why it gates dependents |
|---|---|---|
| C01 | Response ownership & scoring authority per provider (adaptive routing, key revision, pretest/unadministered/null semantics, legacy fallback) | Phases 02, 03 |
| C02 | Durable write & replay (attempt/lease/control epochs, write ID, canonical payload, ack/revision, retry vs new-write rules) | Phases 02, 03 |
| C03 | Terminalization (provisional vs terminal, submission-ID ownership, outcome compatibility, result availability) | Phase 02 |
| C04 | Authorization & caching (role/assignment/attempt checks, revocation, session/token binding, invalidation delay bound) | Phase 04 |
| C05 | Runtime & read freshness (server-clock authority, ETag/conditional reads, poll hints, pause/extension, worker-change visibility bound) | Phases 02, 04 |
| C06 | Work ownership & projection (job identity, lease, idempotency, completion, failure classes, recovery commands) | Phase 02 |
| C07 | Error & retry vocabulary (exact wire codes/envelopes, single retry owner per operation, budgets/jitter/cancellation) | Phases 03, 04 |
| C08 | Client storage (versioned namespaces, per-attempt isolation, milestones, quota/denial, compaction, account switching, bundle compat) | Phase 03 |
| C09 | Workload & SLO profile (concurrency, arrival/write cadence, storms, devices/networks, flags, resource limits) | Phases 05, 06, 07 |

Invariants I01–I12 and acceptance scenarios AC01–AC20 from the source ride along unchanged; Phase 01 maps each AC to fixtures + owning phase, Phase 07 runs all 20 against the integrated candidate.

## 5. Constraints

**Not authorized by this plan alone:** production load tests / deployment / data repair / deletion / migration execution / credential access; changes to timing, scoring, grading-permission, or admission business rules without approved specs; rewrite / blanket upgrades / new queue / microservices / sharding; removing compat paths because they look old; claiming compliance, unlimited capacity, or readiness from unit tests alone.
**Must preserve:** version pinning, routes/API compatibility, server-side timing + permissions, response fencing, immutable terminal facts, grading-release intent, accessibility + active input (IME, focus, selection, undo).
**Must not do:** hide errors, weaken assertions, grow timeouts instead of diagnosing, bypass auth/fences, silently drop pending work, add unmeasured infra.
**Known uncertainties (Phase 01 must resolve with evidence):** SAT V2/legacy divergence current state; API/worker process separation; bootstrap POST/304 HTTP semantics; "zero-SQL polling" scope; throughput figures are goals not capacity; unconfirmed flags/resources/RPO/RTO/devices/release policy; possibly stale tests/line numbers/migration counts.

## 6. Phase list, ownership, execution order

| Phase | File | Source WPs | Owner | Depends on |
|---|---|---|---|---|
| 01 — Baseline, contracts & acceptance matrix | `phase-01-baseline-contracts.md` | WP00, WP01 | L0 + contract owner | none |
| 02 — Scoring chain, terminalization & job ownership | `phase-02-scoring-terminalization.md` | WP02, WP04 | Integrity/worker owner | 01 |
| 03 — Client durability, rendering & exam UX | `phase-03-client-durability-performance.md` | WP03, WP08, WP09 | Client durability + experience owners | 01 (provider adapters need C01/C02/C08 frozen); WP08 needs 03+API/runtime contracts |
| 04 — Auth, API semantics & runtime boundaries | `phase-04-auth-api-runtime.md` | WP05, WP06, WP07 | Security / contract-API / runtime owners | 01; coordinate shared runtime/worker files with Phase 02 |
| 05 — MySQL tuning, migrations & restore | `phase-05-data-mysql-migrations.md` | WP11, WP12 | Database/operations owner | 01–04 query-shape freeze + measurement evidence for WP11; WP12 preparation starts with 01 |
| 06 — Observability, budgets, CI & fixtures | `phase-06-observability-ci.md` | WP10, WP13 | Operations/test owner | WP00 baseline; metric semantics finalize with 01; starts early, gates harden as phases land |
| 07 — Integrated rehearsal, rollout & cleanup | `phase-07-rehearsal-rollout-cleanup.md` | WP14, WP15, WP16 | L0 integration + authorized ops | all required correctness/security/UI phases + 05 + 06; WP16 conditional on evidence |

**Waves:**

```text
Wave A: Phase 01 (baseline → frozen C01–C09 + AC01–AC20 matrix)
Wave B: Phases 02, 03, 04 in parallel (02↔04 coordinate shared runtime/worker file ownership;
        03 provider adapters start only after C01/C02/C08 frozen)
        + Phase 06 early instrumentation + Phase 05 restore-prep (WP12 part)
Wave C: Phase 05 tuning (needs stable query shapes + measurement evidence)
Wave D: Phase 07 rehearsal → staged rollout → conditional cleanup
```text

Critical path: baseline → contracts → scoring/durability + terminal/job correctness → integrated fault tests → capacity/restore evidence → staged release.

## 7. Shared-surface ownership registry (sole authority while active)

API schema/wire DTOs → contract owner (L0 designates). Shared durability engine + storage format → client durability owner. Provider adapters → assigned provider owner after contract freeze. Terminalization + response-source resolver → integrity owner. `cmd/api/main.go` wiring → integration owner. `internal/app/app.go` graph → integrity/integration owner. Worker orchestration/fan-out → worker owner. Migration filenames/DDL → database owner (allocate from live lineage, never assume next number). Query/index/pool tuning → database owner after query-shape freeze. CI/deploy files → operations owner. Cross-feature integration tests → integration test owner. Same-file needs across phases are sequenced or ownership is explicitly transferred — worktrees isolate edits, not contracts.

## 8. Completion criteria

Implementation is complete when: all phase checklists are verified or explicitly closed as already-satisfied with evidence; no BLOCKING findings remain (IMPORTANT either repaired or formally accepted); AC01–AC20 pass against the frozen integrated candidate; capacity/recovery claims cite workload, resources, config, distributions, and raw evidence; external approvals (SLOs, RPO/RTO, flags, rollback package, policy changes) and recovery evidence are recorded; the delivered candidate is the reviewed candidate. Delivering this plan completes planning only — every implementation checkbox starts unchecked.
