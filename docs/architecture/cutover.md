# Cutover Plan — strangler migration Rust to Go (plan 121-127)

## 121. Sequence (no big-bang swap)

```text
1  schema convergence (canonical Go migrations 0001..0053, additive/fix-forward)
2  Go platform (config/db/tx/httpx/errors/telemetry/clock/crypto)
3  auth (sessions, attempt tokens, CSRF, roles)
4  runtime/scheduling
5  terminalization (receipt-first, immutable)
6  V2 core (write algorithm, hashing vectors)
7  IELTS V2 completion
8  ACT V2 completion (server-authoritative Science score)
9  SAT V2 completion (provisional + watchdog)
10 proctor
11 grading/results
12 live updates + websocket leases
13 workers (outbox, repair, projection, retention, media)
14 frontend V2-only (ports architecture, no V1 response durability path)
15 drain V1 compatibility routes (no new V1 attempts)
16 remove V1 compatibility routes (only after active V1 count = 0 + safety window)
17 remove Rust-era artifacts
```

Each stage ships behind the single-writer rule (123) with rollback to the
previous API version (runbook `rollback-api-version.md`).

## 122. Shadow reads

Read-only migrated services may run Rust and Go in parallel. Normalize
nondeterministic fields (request ids, timestamps) and compare. Never
dual-execute a write for comparison.

## 123. Single writer during cutover

Every mutation endpoint routes to exactly one implementation. Shadow only
pure reads or replay against isolated fixtures.

## 124. V1 retirement stages

Stage 1: all newly created attempts use V2 (`protocol_version = 2`).
Stage 2: frontend becomes V2-only (no V1 mutation/submit send paths).
Stage 3: existing V1 active attempts continue through the legacy stack.
Stage 4: observe until zero:

```sql
SELECT COUNT(*) FROM student_attempts
WHERE protocol_version = 1 AND submitted_at IS NULL;
```

Stage 5: hold the agreed safety window with V1 traffic at zero:

```sql
-- application metric: v1_mutation_requests_total, v1_submit_requests_total
```

Stage 6: remove V1 mutation/submit routes and code, legacy transport,
repository paths, flags and conflict-only code.

Never convert an actively running V1 exam into V2 mid-attempt (plan 124).

## 125. Historical V1 data

Do not manufacture fake V2 mutation histories for completed attempts.
Grading/results continue from immutable submission/terminal snapshots. Migrate
data only when a real downstream consumer requires it.

## 126. Compatibility projections

V2 may keep mirroring `student_attempts.answers`, `writing_answers` and
`flags` while grading/history/read paths depend on them. This is a read-model
compatibility decision, not a second response authority. Removal requires
proof that all consumers migrated.

## 127. Feature flags

Final architecture has no `RESPONSE_DURABILITY_V2_ENABLED` or
`VITE_USE_V2_DURABILITY_ENGINE` product switch. V2 is the product and the
frontend is structurally V2-only. The Go API retains only the compatibility
V1 mutation/submit routes needed to drain already-running legacy attempts;
those routes are measured and removed after the retirement gates below.

| Flag | Owner | Expiry | Deletion ticket |
|------|-------|--------|-----------------|
| `RESPONSE_DURABILITY_V2_ENABLED` | backend | — | REMOVED round 74 (dead: zero consumers; V2-only is structural via creation gate + engine reject) |
| `VITE_USE_V2_DURABILITY_ENGINE` | frontend | — | REMOVED — no production reads remain |

## 130. Database change policy (binding on every migration)

Every schema change after 0050 must be backward-compatible with the
running binary during rolling deploy, bounded in row/time scope,
reviewed for locking, load-tested at realistic row counts, and shipped
with a rollback or forward-fix plan. No giant table rewrite during peak
exam hours. The original 0001..0050 union was additive-only by construction.
The current Go lineage extends it with 0051 (drop trigger-era
terminalization hooks), 0052 (ACT provider identity checks), and 0053
(attempt user-id backfill). The Go migrator skips trigger DDL on TiDB and
terminalization is now owned by the Go application boundary.

## 131. Security review gates (pre-cutover checklist)

Each gate names its evidence; the cutover ticket links all of them:

- authorization matrix → `auth/authz_test.go` (12 role x family) + tenant-boundary cases;
- CSRF verification → `auth` VerifyCSRF 403 `CSRF_REJECTED` path;
- cookie policy → `__Host-` prefix, Secure/HttpOnly/SameSite=Strict;
- attempt-token scope → claims bind user+schedule+attempt+session;
- token expiry/revocation → TTL/idle/absolute + revoke-all;
- rate-limit abuse → 429 `RATE_LIMITED` + `Retry-After`;
- body-size abuse → httpx tiers 256KiB/2MiB/64MiB;
- workbook parser abuse → bounded xlsx parse, no formula eval;
- rich-content sanitization → builder content allowlist;
- object-store authorization → signed URLs, org-scoped keys;
- websocket subscription authorization → `forward_test.go` 15-case matrix;
- cross-tenant repository tests → org-pinned queries, copy-immutability.

## 140-141. Final architecture and doctrine

Section 140 is the target diagram: React (UI/features/V2 local
durability/generated client) → Go monolith (auth/exams/authoring/
scheduling/runtime/V2 core/proctor/grading/results/live) → completion
policies (IELTS/SAT/ACT) → terminalization (immutable receipt/snapshot)
→ MySQL/TiDB → Go worker (reconcile/watchdog/project/repair/retain).
What is NOT in the diagram is load-bearing: no V1 response durability path,
no Rust binaries, no product-choice flags. Temporary V1 compatibility routes
exist only for the measured drain window. Section 141 restates the doctrine:
V2 canonical, single-writer terminalization, receipt-first, additive-
only frontend, explicit SQL on correctness paths, tx in services,
no globals, UTC everywhere.
