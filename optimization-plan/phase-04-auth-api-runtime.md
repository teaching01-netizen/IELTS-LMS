# Phase 04 — Auth, API Semantics & Runtime Boundaries

**Wave:** B (parallel with Phase 02 and Phase 03 after contract freeze).
**Owners:** Security owner (WP05) / Contract-API owner (WP06) / Runtime owner (WP07).
**Sources:** `docs/optimize.md` WP05 + WP06 + WP07; contracts C04 / C05 / C07; invariants I06 / I07 / I11; acceptance AC07 / AC13 / AC14 / AC15 / AC16 plus touchpoints AC03 / AC08 / AC11.
**Status:** Planning only. This file changes no code, migrations, config, or production data. Every checkbox starts unchecked.

---

## 1. Objective

Harden the three coupled boundaries between the user and the exam state machine, without changing intended product behavior:

1. **Authentication / authorization / admission / media / privacy (WP05).** No unauthorized read, write, admission row, media byte, or redacted field is reachable by path-parameter tampering, bearer confusion, stale-cache replay, revoked-session reuse, CSRF/origin bypass, or frontend-only guard. Closed-by-default pre-mint admission stays closed. Media and rich-text paths are ownership-checked, validated, and injection-safe. Telemetry and errors are minimized and redacted (I11) with no legal-compliance-certification claims.
2. **API serialization, retry ownership, conditional-read semantics (WP06).** Every wire response matches the frozen OpenAPI contract in envelope, code, status, nullability, limits, and pagination. Exactly one layer owns retries per operation, with explicit budget / jitter / cancellation / `Retry-After` behavior; mutation retries are keyed to stable identities so a lost-response-after-commit never duplicates a mutation. The bootstrap POST-returning-304 anomaly is resolved to a standards-compliant shape with a compatible migration path; caches never cross attempt / user / version boundaries; obsolete in-flight responses never clobber newer state.
3. **Runtime clocks, caching, API/worker process boundaries (WP07).** Server time is the sole timing authority; pause / resume / extension / grace are explicit and enforced at write time, independent of UI freshness. Every cache and event channel is inventoried per-process (API vs worker — never assumed shared memory even when co-packaged in one container); worker-originated mutations reach API-visible state through a durable bus / invalidation signal / bounded authoritative refresh within a documented C05 freshness bound. Per-poll SQL accounting is honest (credential/session touch included). Slow networks, background tabs, reconnect jitter, event loss, WS capacity limits, and poll fallback all converge to authoritative state; no 2-second fast-lane hint is advertised as a delivery guarantee.

**Release bar:** AC07, AC13, AC14, AC15, AC16 pass against the frozen candidate plus the AC03 / AC08 / AC11 touchpoints in section 13; no BLOCKING finding remains; already-satisfied requirements close with fresh evidence, not assertion.

---

## 2. Scope / Out of Scope

### 2.1 In scope — WP05 (auth / admission / media / privacy)

- Role-by-resource-by-operation matrix for all six roles (`admin`, `admin_observer`, `builder`, `proctor`, `grader`, `student`), including observer read-only scope, grader session-scoped grading rights, proctor schedule-scoped supervision, and cross-organization denial. Both the middleware layer (`internal/authz`) and the handler/service second layer (DB-backed scope).
- Path-parameter vs bearer-ownership checks on every delivery / runtime / student-mutation / grading / media route: URL `scheduleID` / `attemptID` / `assetID` reconciled against bearer claims or session actor, never trusted alone.
- Session lifecycle: expiry (staff 30m idle / student 60m idle / 12h absolute per `internal/auth/auth.go`), logout-all with audit rows, revocation propagation, takeover rotation (old device fenced), strict vs stateless `ATTEMPT_VERIFY` modes, stale-cache fail-closed behavior (session cache and runtime snapshot).
- Closed-by-default pre-mint admission: entry gate, invite-code / access-link resolution, historical captcha and metadata-exposure gaps; any external verifier is an approved dependency + secret-management decision, not a silent addition.
- Transport guards: CSRF double-submit verification, cookie attributes (`__Host-`, `Secure`, `HttpOnly`, `SameSite`), same-origin / cross-origin deployment assumptions, request body limits (`MaxStudentBodyBytes` 256 KiB / `MaxAdminBodyBytes` 2 MiB / `MaxWorkbookBodyBytes` 64 MiB / media 16 MiB + 1 headroom byte), identity-mismatch failures.
- Media: ownership on intent / upload-bytes / finalize / download / delete, content-type + magic-byte + decoded-pixel validation (25 Mpx / 8192 px caps; WebP byte-cap-only caveat documented), safe object-key paths (no traversal), finalization state machine (`pending -> finalized | orphaned | deleted`, 24h orphan flip, `delete_after_at` reap), download access control, orphan cleanup ownership.
- Injection: stored-XSS review of rich-text / workbook-import rendering, allowlist validation, output-encoding at render; every SQL construction in touched trees audited for parameterization.
- Privacy: data minimization (projections return only needed fields), retention boundaries (replay / terminal / incident evidence protected from premature cleanup), telemetry / log redaction (no answers, tokens, passwords, unnecessary student identifiers — I11). No compliance-certification language anywhere.
- Targeted dependency review for exposure (auth / crypto / cookie / multipart / image-decode surface); minimal version bumps with regression checks, never blanket upgrades.

### 2.2 In scope — WP06 (API serialization / retry / conditional reads)

- Actual-serialization contract tests for every touched handler: success envelopes, error envelopes (`{code, message, details?, requestId}`), HTTP status codes, nullability (`null` vs omitted vs empty string), collection limits, cursor/keyset pagination stability, redaction of answer keys on student-visible shapes.
- Wire-DTO separation **only where leakage creates real ambiguity** (e.g. internal `acks` vs wire `acknowledgements`, Go identifier vs wire `SUBMISSION_ID_MISUSE`); simple endpoints keep direct shapes — no gratuitous mapping layers.
- Per-operation retry ownership: exactly one retrying layer per operation across the `apiClient.ts` fetch wrapper, TanStack Query (`queryClient.ts`), `DurableResponseEngine` (engine internals owned by Phase 03 — this phase defines the API-side half and the boundary rule), and worker retry (owned by Phase 02 — this phase codifies the contract). Budgets, exponential backoff + jitter, cancellation via `AbortSignal`, `Retry-After` / 429 handling, idempotency-key / write-ID / submission-ID binding for mutations.
- Bootstrap POST/304 investigation: reproduce current behavior (POST bootstrap with `If-None-Match` returning 304), decide the standards-compliant target — preferred: compatible **GET read path** for conditional bootstrap reads + POST retained as full-response command (or documented POST-never-304 behavior) — then migrate consumers (`satDeliveryGateway.ts`, `bootstrapEtag.ts`) with old/new interop tests; caches keyed by attempt + user + version; obsolete-request cancellation so late responses cannot overwrite newer route/attempt data.

### 2.3 In scope — WP07 (runtime clocks / caching / process boundaries)

- Per-process cache/event inventory: API process vs worker process (even when co-packaged in one container). Every in-memory structure (`VersionCache`, `Snapshot` cache, session/session-lookup cache, rate-limit buckets, WS hub, live-update bus cursor) tagged with owning process, scope, capacity, TTL, invalidation source. Nothing assumed to cross processes via memory.
- Durable visibility mechanism selection: reuse the existing `live_update_events` DB bus + per-instance poller + in-process hub fan-out (see `internal/liveupdates/bus.go`), and/or explicit invalidation signals, and/or bounded authoritative refresh (snapshot TTL + poll `sinceRevision`). No new queue infra (no Redis).
- Scoped keys + bounded capacity + explicit TTL + authorization-safe invalidation for every cache: key includes tenant / schedule / attempt / user / published-version / revision where applicable; capacity bounded (`VersionCacheMaxVersions` 50, snapshot TTL 1s, poll steady 25s / fast-lane 2s x 60s window, session-cache TTLs per section 6); invalidation is auth-safe (revocation / takeover / pause / publish / terminate invalidate; a hit can never serve data the caller is no longer authorized to see).
- Honest per-poll SQL accounting: end-to-end SQL per poll **including** auth/session touch; "zero-SQL" advertised only for paths proven to perform none.
- Server-time authority + pause / resume / extension / grace: `platform/clock` abstraction, DB/server NOW at write gates, never browser wall time; pause bumps `control_epoch`; extension recomputes deadline server-side; grace `closing_grace_until` inclusive server-side check; stale-lease writes fenced (I06); correctness holds when browser is stale (I07).
- Degraded-channel handling: slow networks (query-timeout budgets + 429 shed), background-tab throttling, reconnect jitter, event loss (bus cursor + poll fallback), staff WS capacity (600 total / 5 per user / 600 per schedule, queue 128, 1500ms slow-client drop, 60s lease / 30s heartbeat), student WS retirement (410 `STUDENT_WS_RETIRED` + runtime-poll), poll fallback as the supported path. Fast-lane hint (2s polls for 60s after a control command) is a hint, not a guarantee — a client sleeping on the 25-30s steady interval may not observe the change until its next poll.
- Write-time independence: timing and authorization re-enforced inside the write transaction on locked rows; UI freshness (poll revision, snapshot age, WS event arrival) never gates safety.

### 2.4 Out of scope (owned elsewhere — do not duplicate)

- **Scoring / terminal logic (Phase 02):** answer-source resolver, adaptive routing, key revision, terminalization authority, submission-ID ownership internals, autosubmit fan-out completion rules, SAT provisional-to-final reconciliation. This phase touches those only as a consumer of their error codes and as coordinator on shared runtime/worker files.
- **Durability engine internals (Phase 03):** write-ID issuance, ack matching, journal / checkpoint / quarantine, replay-across-epoch rules, storage-quota handling. This phase defines the API retry half and the C07 boundary rule; engine internals stay with Phase 03.
- **Index DDL / pool sizing / migration execution (Phase 05):** query-shape freeze is an input to Phase 05; this phase authors no index DDL, changes no pool sizes for performance, allocates no migration numbers.
- No rewrite, no new infrastructure, no blanket dependency upgrades, no timeout increases as diagnosis substitutes, no weakened assertions, no compliance-cert claims, no production data repair.

---

## 3. Dependencies

### 3.1 Depends on Phase 01 (blocking — no mutation work until frozen)

| Need | Frozen artifact | Consumer in this phase |
|---|---|---|
| C04 Authorization & caching vX | Role/assignment/attempt checks, revocation semantics, session/token binding, auth-cache invalidation rule, max propagation delay bound | WP05 matrix, session-cache + snapshot hardening, negative-API tests |
| C05 Runtime & read freshness vX | Server-clock authority, revision ordering, ETag/conditional-read semantics, poll cadence hints, pause/extension behavior, cache keys + invalidation, worker-change visibility bound | WP07 cache/bus/poll/clock work, bootstrap GET/POST decision, AC11/AC16 tests |
| C07 Error & retry vocabulary vX | Exact wire codes / field names (`SUBMISSION_ID_MISUSE`, `acknowledgements`, etc.), per-operation retry owner table, budgets / jitter / cancellation / `Retry-After` | WP06 envelope + retry work, apiClient/queryClient changes, contract tests |
| AC01–AC20 matrix + fixtures | AC07 / AC13 / AC14 / AC15 / AC16 owned here; AC03 / AC08 / AC11 touchpoint expectations; deterministic IELTS / SAT-adaptive / ACT fixtures; C09 workload profile | All test work in section 13 |
| OpenAPI baseline | Current `api/openapi/openapi.yaml` wire fields, limits, pagination, error shapes recorded before tightening | WP06 serialization tests; contract owner approves any tightening |

If Phase 01 revises C04 / C05 / C07 mid-wave, this phase stops mutating the affected scope, rebases to the new version, and re-runs the affected contract tests. Never invent shared semantics locally.

### 3.2 Shared-file sequencing with Phase 02 (Wave B parallel)

| Shared surface | Primary owner while active | This phase's access |
|---|---|---|
| `backend/go/internal/runtime/` (service, snapshot, poll, fence) | **Phase 04 (runtime owner)** for cache/TTL/poll/clock/invalidation shape; Phase 02 reads for terminal interaction | Phase 04 mutates cache/poll/clock paths; Phase 02 submits terminal-gate needs as review comments, does not edit concurrently |
| `backend/go/internal/liveupdates/` (bus, hub, admission) | **Phase 04** for bus/hub/admission/capacity | Phase 02 reads event kinds for terminal fan-out; new event kinds need joint review |
| `backend/go/internal/delivery/` (bootstrap, versioncache, reconcile) | **Phase 02 (integrity owner)** for source/scoring resolver; **Phase 04** for bootstrap HTTP semantics + VersionCache bounds | Sequence explicitly: Phase 04 bootstrap GET/POST + cache-key work lands first or ownership is transferred in writing; never concurrent edits to `service.go` / `versioncache.go` |
| `backend/go/internal/student/` (readthrough, presence) | **Phase 04** for read-path auth + row-first visibility; Phase 02 reads for result projection | Same-file edits sequenced |
| `backend/go/cmd/worker/main.go` + `internal/app/app.go` wiring | **Phase 02 (worker owner)** for fan-out orchestration; **Phase 04** for bus-consumer wiring + cache ownership tags | Phase 04 submits wiring needs (bus poller start, cache construction params) to worker/integration owner; no concurrent wiring edits |
| `api/openapi/openapi.yaml` | **Contract owner (L0 designates)** — neither phase edits directly | Both phases submit schema-change proposals; contract owner applies |

Coordination protocol: announce intended file set at wave kickoff; transfer ownership explicitly in the handoff log; worktrees isolate edits but not contracts — integration review still required.

### 3.3 What Phase 07 consumes from this phase

- Frozen C04 / C05 / C07 implementation + implemented version numbers.
- AC07 / AC13 / AC14 / AC15 / AC16 evidence plus AC03 / AC08 / AC11 touchpoint evidence, linked to the frozen candidate.
- Documented C05 freshness bound per channel and per sleep/reconnect condition (the numbers Phase 07 rehearses against).
- Error-envelope + retry-ownership tables (section 6) as the oracle for integrated fault injection.
- Rollback compatibility notes: which endpoint shapes (POST bootstrap, old ETag clients) must keep working during the rollback window.

### 3.4 What Phase 05 / Phase 06 consume

- **Phase 05:** stable query shapes for auth/session-touch, bootstrap, poll, media, admission paths + honest per-poll SQL measurements (section 7 step 15) as tuning evidence.
- **Phase 06:** metric/alert semantics for auth-revocation failures, cache-freshness failures, rate-limit sheds, WS drops, bootstrap/poll latency distributions; redaction rules for new instrumentation.

---

## 4. Affected Files (rediscover exact symbols before editing)

> Paths were re-enumerated from the working tree during planning. Counts drift — **re-verify with grep / read at implementation start** and update this table if the tree moved. Historical line numbers from `docs/optimize.md` are not authoritative.

### 4.1 Backend — auth / authz / admission (WP05)

| Path | Role in this phase |
|---|---|
| `backend/go/internal/auth/auth.go` (~872 lines: cookie-session auth, CSRF, password hashing, attempt-token issuance, `ActorContext`, role consts) | Session lifecycle, CSRF verification, attempt-bearer issuance, `ActorContext` scope rules |
| `backend/go/internal/auth/sessioncache_impl.go` (306), `sessionlookup_cache_impl.go`, `attemptverify_impl.go` (72), `attemptverify_read.go`, `sessioncache_test.go` + emit tests | Revocation-aware session/lookup caches, read-vs-write verify modes, invalidation on logout-all / takeover |
| `backend/go/internal/authz/authz.go` (217: fail-closed table), `middleware.go` (141), `table_staff.go` (224), `table_auth.go` (22), `table_fullpath.go`, `authz_policy_test.go` | Role-by-resource-by-operation matrix, deny-closed unknown-route rule, MinRole first layer + advisory ScopeKind |
| `backend/go/internal/accesslinks/service.go` (1276) + `service_test.go` | Pre-mint admission domain: audience/mode/lifecycle enums, fencing, roster reads, entry resolution (no auth checks inside — handlers own them) |
| `backend/go/cmd/api/handlers_auth.go` (558: `actorOf`, `requireSession`, `requireRole`, session-response shape) | Cookie-session handlers, session-response contract uniformity |
| `backend/go/cmd/api/entry_gate.go`, `entrygate_test.go`, `entry_handler_test.go`, `entry_invite_code_test.go`, `entry_email_gate_test.go`, `entry_clientgone_test.go`, `student_entry_policy_test.go` | Entry-gate enforcement, invite-code paths, client-gone behavior |
| `backend/go/cmd/api/authz_wiring_test.go`, `middleware_order_test.go`, `student_context.go`, `student_context_resolve_test.go`, `attemptverify_wiring_test.go`, `sessioncache_wiring_test.go` | Wiring + order tests that must keep passing (middleware order is load-bearing) |

### 4.2 Backend — media + injection surface (WP05)

| Path | Role |
|---|---|
| `backend/go/internal/media/service.go` (469: 16 MiB cap, pixel/dimension caps, `pending -> finalized / orphaned / deleted`, objectstore fronting) + `service_test.go` | Ownership, validation, finalization, orphan transitions |
| `backend/go/cmd/api/handlers_media.go` (98: intent / upload-bytes with +1 headroom byte to 413 / download) + `media_cache_test.go` | HTTP guards: role gates, body caps, content-type handling |
| `backend/go/internal/platform/objectstore/objectstore.go`, `local.go` | Safe key construction, traversal rejection, store contract |
| Authoring / import handlers (`backend/go/cmd/api/handlers_authoring.go`, `authoring_authorization.go`, `sat_workbook_template.go`, `MaxWorkbookBodyBytes` path in `platform/httpx`) + `internal/authoring/` | Workbook-import XSS / allowlist / size-limit review; authorization on authoring verbs |
| All SELECT / INSERT / UPDATE construction in touched services (`accesslinks`, `media`, `auth`, `runtime`, `delivery`, `student`, `schedules`) | Parameterization audit (placeholders only) |

### 4.3 Backend — API semantics (WP06)

| Path | Role |
|---|---|
| `api/openapi/openapi.yaml` (3868 lines, 136 routes) | Sole wire authority (contract owner). Tests assert against it; `openapi_drift_test.go` stays green |
| `backend/go/cmd/api/handlers_delivery.go` (237: `deliveryBootstrapHandler`, bearer-vs-URL schedule check, ETag pre-probe, `verifyAttemptReadBearer`) | Bootstrap POST/304 investigation + GET-path introduction |
| `backend/go/cmd/api/handlers_v2.go` (969: bearer extraction, V2 resolver, batch writes, terminal paths) | Serialization, nullability, resolver ownership checks |
| `backend/go/cmd/api/handlers_v1_writes.go`, `handlers_domain.go`, `handlers_admin.go`, `handlers_grading.go`, `handlers_grading_sessions.go`, `handlers_library.go`, `handlers_proctor.go`, `handlers_accesslinks.go`, `handlers_release.go`, `handlers_proctor_notes.go` | Per-handler envelope / code / pagination / redaction review |
| `backend/go/cmd/api/etag.go` + `etag_test.go` (48), `response_contract_test.go`, `http_contract_test.go`, `pagination_contract_test.go`, `method_not_allowed_test.go`, `student_redaction_test.go`, `contracts_mysql_test.go` | Existing contract-test seam — extend, do not fork |
| `backend/go/internal/platform/apperrors/errors.go` (envelope with code/message/details/requestId, `statusFor` map) + `status_mapping_test.go` | C07 code-to-status authority |
| `backend/go/internal/platform/httpx/httpx.go` (timeouts, body limits, request-ID, security headers, `WriteError`), `middleware.go`, `ratelimit_tiers.go`, `ratelimit_fallback.go`, `denyalenvelope_test.go`, `query_timeout.go`, `querytimeout_test.go`, `budgetwrap_test.go`, `ratelimit_*_test.go` | Body limits, timeouts, rate-limit tiers + denial envelopes, unknown-error hook discipline |

### 4.4 Backend — runtime / process boundary (WP07)

| Path | Role |
|---|---|
| `backend/go/internal/runtime/service.go` (655: cohort clock state machines, lock order attempt->runtime->section, revision + control-epoch fencing, grace) | Clock authority, pause/resume/extend/sync, fencing |
| `backend/go/internal/runtime/snapshot.go` (207: `SnapshotTTL` 1s, `CheckWritable` pre-gate, in-tx re-check contract) + snapshot tests, `fence_test.go` | Snapshot staleness bound + pre-gate vs authoritative-gate split |
| `backend/go/internal/runtime/poll.go` (59: `PollFastLaneWindow` 60s, `PollFastLaneSecs` 2, `PollSteadySecs` 25, poll view struct) | Poll projection + adaptive interval |
| `backend/go/cmd/api/handlers_runtime_poll.go` (157: `verifyAttemptReadBearer` on reads, 304 on sinceRevision match, visibility-bound comment) + poll/snapshot/command-gate tests | Poll handler: auth, 304, budget, visibility documentation |
| `backend/go/internal/liveupdates/bus.go` (523: `live_update_events` DB bus, 250ms x 200 poll, hub fan-out, 1500ms slow-drop, lease TTL 60s / heartbeat 30s) + admission + hub/forward/slowdisc/lease tests | Cross-instance bus, hub, WS admission caps (600 / 5 / 600, queue 128) |
| `backend/go/cmd/api/handlers_ws.go`, `ws_admission.go`, admission/gate/livebus tests | WS admission + student-socket retirement (410) + live-bus modes |
| `backend/go/internal/delivery/service.go`, `versioncache.go` (199: max 50 versions, infinite-TTL-until-publish + revision-fail-closed, singleflight) + versioncache/invalidate/cachedsections/reconcilefast tests | Bootstrap content-tree cache: keys, bounds, invalidation on publish |
| `backend/go/internal/student/service.go`, `readthrough.go` (93: row-first posture), readthrough/presence tests, `telemetry.go`, `v1_write.go` | Read-path auth + row-first visibility, presence accounting |
| `backend/go/internal/platform/clock/clock.go` (+ contract test) | Time abstraction; tests use Fixed, prod uses System / DB time |
| `backend/go/cmd/worker/main.go` (899) + fan-out / cursor / outbox-drain tests; `backend/go/internal/app/app.go` (149: shared service graph) | Worker-originated mutations that must become API-visible (coordinate with Phase 02 per section 3.2) |
| `backend/go/cmd/api/main.go` (950: chi router, middleware spec order, graceful shutdown) | Middleware order + wiring (integration owner approves changes) |

### 4.5 Frontend — auth / API / runtime (WP05–WP07 client halves)

| Path | Role |
|---|---|
| `src/features/auth/` (LoginPage, ActivateAccountPage, PasswordReset pages, RequireAuth, authSession, gateways, attemptCredentialStorage, authForms) | Login/activation/reset flows, route guards (presentation only — never safety), credential storage hygiene |
| `src/shared/api/apiClient.ts` (719: ApiClient, CSRF cookie merge, per-request token/csrf, timeout, retry count, ApiResponse envelope) | Single-fetch retry half, CSRF merge, abort/cancellation, envelope parsing |
| `src/shared/api/queryClient.ts` (252: default stale 5min, liveQueryPolicy 15s/2min, staticQueryPolicy 30min/60min, default retry 3 + exp-backoff, 429 fail-fast predicate, structured queryKeys) | Query-cache + query-retry half; cache-key scoping; 429 fail-fast |
| `src/shared/api/__tests__/queryClient.retry.test.ts`, `entryQueueHeaders.test.ts` | Existing retry/header seams — extend |
| `src/features/student-delivery/infrastructure/satDeliveryGateway.ts`, `bootstrapEtag.ts` (+ test), `heartbeatCoalesce.ts` (+ test), delivery contracts | Bootstrap conditional-read consumer, ETag handling, heartbeat coalescing |
| Proctor / grading consumers (`src/components/proctor/ProctorDashboard.tsx`, `src/components/admin/StudentReviewWorkspace.tsx`; enumerate gateway files at start — the prompted glob pattern returned empty, so rediscover) | Obsolete-request cancellation, roster/subscription handling, redaction compliance |
| Rich-text / import renderers (rediscover at start: grep dangerouslySetInnerHTML) | Stored-XSS hardening + allowlist review |

---

## 5. New Files (all proposed — prefer extending current tests when they already own the behavior)

| Proposed path | Purpose |
|---|---|
| `backend/go/cmd/api/authz_matrix_test.go` | Executable role-by-resource-by-operation matrix (every role x every route x allow/deny + scope second layer). Owns AC13 permit/deny assertions |
| `backend/go/cmd/api/bearer_ownership_test.go` | Path-param vs bearer-ownership: URL/schedule/attempt/asset mismatch, revoked/rotated/expired bearers on reads and writes, cross-user/org fixtures |
| `backend/go/cmd/api/session_revocation_test.go` | Expiry / logout-all / takeover / strict-vs-stateless / stale-cache with deterministic clocks. AC07 slice |
| `backend/go/cmd/api/admission_closed_test.go` | Closed-by-default pre-mint admission: bad codes, audience violations, revision fencing, zero admission-row creation on deny |
| `backend/go/cmd/api/csrf_origin_body_test.go` | CSRF / cookie-attribute / origin / body-limit / identity-mismatch matrix incl. 400/401/403/413 envelopes. AC14 slice |
| `backend/go/cmd/api/media_ownership_test.go` | Media intent-to-upload-to-finalize-to-download-to-orphan lifecycle with cross-owner denial, oversize/type/pixel rejection, traversal rejection |
| `backend/go/cmd/api/xss_import_contract_test.go` + frontend richTextAllowlist test | Stored-script fixtures through import-to-store-to-render; allowlist + encoding assertions |
| `backend/go/cmd/api/error_envelope_contract_test.go` | Golden serialization tests for every C07 code: exact code, status, envelope keys, details redaction, requestId presence. AC14 slice |
| `backend/go/cmd/api/retry_identity_test.go` | Lost-response-after-commit: same-ID/same-payload gives compatible ack, no duplicate mutation. AC03/AC08 touchpoints |
| `backend/go/cmd/api/bootstrap_compat_test.go` | Old-POST + new-GET interop: 200/304 matrix, ETag / If-None-Match, auth + redaction + version-key correctness on both paths. AC15 |
| `backend/go/internal/runtime/cache_inventory.md` | Per-process cache/event inventory (section 6.4 table in durable form): owner process, key scope, capacity, TTL, invalidation, SQL cost |
| `backend/go/cmd/api/poll_visibility_test.go` | Two-process visibility: worker mutation to API observation within C05 bound; event-loss + sleeping-poll-loop cases. AC11/AC16 |
| `backend/go/cmd/api/clock_authority_test.go` | Server-time authority: stale/fast/slow browser clocks, pause/resume/extension/grace boundaries, write-time enforcement independent of poll freshness |
| `src/shared/api/__tests__/retryOwnership.test.ts` | Client retry-ownership: apiClient vs Query vs engine — who retries what; 429/Retry-After; abort supersedes |
| `src/shared/api/__tests__/queryKeyIsolation.test.ts` | Cache-key isolation: attempt/user/version boundary tests; no cross-contamination on account switch |
| `src/features/student-delivery/__tests__/bootstrapCompat.test.ts` | Consumer migration: old/new client x old/new server matrix for bootstrap + poll |
| `docs/production-hardening/cache-freshness-bound.md` (proposed evidence dir) | Human-readable C05 bound statement per channel/condition for Phase 07 rehearsal |

Test-file names are suggestions. If an existing file already owns the behavior (e.g. `runtime_poll_test.go`, `etag_test.go`), extend it instead of creating a near-duplicate.

---

## 6. Interfaces / Contracts (consume frozen versions — this phase invents none)

> **Authority rule:** the contract owner is the sole authority on schema/wire. This phase implements C04 / C05 / C07 **as frozen in Phase 01** and records the implemented versions below at implementation start (fill in vX). Any needed wire change is a proposal back to the contract owner, never a unilateral edit to `openapi.yaml` or DTOs.

- **C04 Authorization & caching:** implemented version ____ (Phase 01 output).
- **C05 Runtime & read freshness:** implemented version ____.
- **C07 Error & retry vocabulary:** implemented version ____.

### 6.1 Error-envelope table (C07 — from `internal/platform/apperrors/errors.go` + `httpx.WriteError`; re-verify at start)

Wire shape (failures render this JSON with the mapped status; success shapes keep their contract bodies):

```json
{ "code": "SESSION_EXPIRED", "message": "Session expired.", "details": {}, "requestId": "<echoed-or-minted-uuid>" }
```

- `details` omitted when empty; never carries answers, tokens, passwords, or unnecessary student identifiers (I11 — assert per-code in tests).
- `requestId`: echoes sanitized client `X-Request-Id` (printable ASCII, max 128 chars) else mints uuid; always echoed back as response header.
- Unknown (non-`apperrors`) errors render `INTERNAL` 500 via the unknown-error hook (counted, not leaked). Tests may override via `SetUnknownHook`.

| Wire `code` | HTTP | When | Retryable by client? | Notes |
|---|---|---|---|---|
| `BAD_REQUEST` | 400 | Malformed shape / predicate failure | No (fix request) | Body-limit failures prefer `PAYLOAD_TOO_LARGE` |
| `VALIDATION_ERROR` | 422 | Semantic validation failure | No | Includes unsupported-provider / invalid-assessment variants |
| `UNSUPPORTED_PROVIDER` / `INVALID_ASSESSMENT` | 422 | Provider / assessment policy rejection | No | Keep distinct — do not collapse into generic 422 |
| `UNAUTHORIZED` | 401 | Anonymous on authed route | No (re-authenticate) | — |
| `SESSION_EXPIRED` | 401 | Missing / expired / revoked cookie session | No (re-authenticate; logout-all revokes) | Frontend unauthorized handler routes to login; must not retry |
| `ATTEMPT_TOKEN_INVALID` | 401 | Bad / revoked / rotated / schedule-mismatched bearer (reads **and** writes) | No (re-issue via supported flow) | Read paths verify in **both** ATTEMPT_VERIFY modes |
| `ATTEMPT_TOKEN_EXPIRED` | 401 | Expired bearer (TTL 15m, refresh at 5m or less) | No (refresh/re-issue) | Distinguish from INVALID in tests |
| `FORBIDDEN` | 403 | Authenticated but role/scope denies | No | Includes unknown-route deny-closed (logged) |
| `CSRF_FAILED` | 403 | CSRF mismatch | No (reload token; single user-initiated retry only) | — |
| `LEASE_FENCED` | 403 | Stale lease epoch write | No as same write (reconcile as **new** write per C02 — Phase 03 owns) | I06 |
| `ATTEMPT_PROCTOR_BLOCKED` | 403 | Proctor-blocked attempt | No | — |
| `NOT_FOUND` | 404 | Absent row **or** hidden by scope (no existence oracle) | No | Cross-user/org probes render 404, never 403-with-existence |
| `METHOD_NOT_ALLOWED` | 405 | Wrong verb | No | — |
| `CONFLICT` | 409 | Generic fencing conflict | Caller-dependent (see retry table) | Prefer specific codes below where defined |
| `CONTROL_EPOCH_STALE` | 409 | Write under superseded control epoch (pause/resume/extend bumped it) | New reconciled write only (Phase 03) | Never silent-delete pending data (AC07) |
| `VERSION_COLLISION` | 409 | Optimistic-concurrency revision mismatch | Refresh-then-single-retry with fresh revision | — |
| `WRITE_ID_CONFLICT` | 409 | Same write-ID, **different** payload | No (surface; do not auto-resolve) | Same-ID/same-payload gives compatible ack (idempotent) |
| `TERMINALIZATION_CONFLICT` / `TERMINAL_INVARIANT_VIOLATION` | 409 | Conflicting / invariant-breaking terminal transition | No (Phase 02 owns recovery) | — |
| `SUBMISSION_ID_MISUSE` | 409 | Submission-ID replay misuse (wire name stable; Go identifier differs — assert wire string) | No (client bug — surface) | Re-verify serialization; never rename wire via Go-identifier cleanup |
| `RESPONSE_REVISION_MISMATCH` | 409 | Response revision mismatch | Refresh-then-retry once | — |
| `RUNTIME_REVISION_STALE` | 409 | Stale expected runtime revision on proctor command | Refresh-then-single-retry ("Runtime changed; refresh before retrying.") | — |
| `ASSESSMENT_CONFLICT` / `ACTIVE_SESSION_SUPERSEDED` | 409 | Schedule / session supersession | Refresh-then-decide (user-visible) | — |
| `DEADLINE_EXPIRED` / `ATTEMPT_NOT_WRITABLE` | 422 | Past grace / non-live runtime | No | Server-time decided |
| `RATE_LIMITED` / `RATE_LIMIT_EXCEEDED` | 429 | Tier shed | **Never blind-retry.** Honor `Retry-After`; fail fast; single user-initiated retry after window only | `shouldRetryQuery` returns false on 429 |
| `LEASE_ACQUIRE_FAILED` | 429 | Contended lease acquisition | Bounded backoff per C07 budget only | — |
| `PAYLOAD_TOO_LARGE` | 413 | Over body cap (media +1-byte headroom probe, student 256 KiB, admin 2 MiB, workbook 64 MiB) | No (shrink request) | Must fire before truncation |
| `SERVICE_UNAVAILABLE` / `SERVICE_RECOVERY_FAILED` | 503 | Dependency down / degraded | Bounded retry per owner table (GETs only, or stable-identity replays) | **DB outage is not invalid credentials** — section 11 rule 7 |
| `INTERNAL` | 500 | Unclassified (hook-counted) | No auto-retry storm (bounded GET retry only) | Never leak driver text |
| `STUDENT_WS_RETIRED` | 410 | Student WS attempt (body carries poll-migration hint) | No (migrate to poll) | Retirement marker, not a retryable error |
| wire field `acknowledgements` | — | Wire spelling is `acknowledgements` (not internal `acks`) | — | Golden-test the spelling on every ack-bearing shape |

### 6.2 Retry-ownership table (C07 — exactly one owner per operation)

| Operation class | Sole retry owner | Allowed retries | Non-owner layers must |
|---|---|---|---|
| Durable response-batch writes (issued write-ID) | **DurableResponseEngine (Phase 03)** — exact replay of same write-ID/same payload | Bounded budget per C02/C07; stop at terminal / lease-fence / control-epoch change (reconcile as new write instead) | `apiClient` sends once per call (no fetch-level retry on mutations); React Query retry 0 on response mutations |
| Submission / terminal seal (submission-ID) | **Terminal caller (Phase 02/04 seam)** — stable submission-ID replay | Lost-response-after-commit: identical replay gives compatible ack; same-ID/different-payload gives conflict surfaced | No transport-level mutation retry |
| Idempotent GETs (bootstrap-GET, poll, roster/version reads) | **Calling layer** (`apiClient` for direct fetches; TanStack Query for cached queries) | Exp-backoff + jitter, capped budget, AbortSignal cancellation; 429 / 401 / 403 / 404 / 409-specific / 410 / 413 never retried automatically | Engine never replays GETs as writes |
| Mutations without stable identity (admission mint, media intent creation) | **No automatic retry.** User-initiated single retry only, after reading current state | — | All three client layers set retry 0 / false for these |
| Worker jobs (autosubmit fan-out, reconciliation) | **Worker (Phase 02)** — lease + idempotency per C06 | Bounded retries, poison isolation, DLQ (Phase 02 detail) | API never re-drives worker jobs via client retry |
| Rate-limited (429 + `Retry-After`) | **Nobody automatically.** Surface the tier + backoff; user- or scheduler-initiated retry after window | `shouldRetryQuery` false; `apiClient` does not loop on 429 | Log tier + `Retry-After`; do not amplify shed load |

Budget/jitter/cancellation rule (applies wherever retries are allowed): full-jitter exponential backoff (`sleep = rand(0, min(cap, base * 2^attempt))`), total budget bounded (count **and** deadline), every retryable call takes an AbortSignal and checks it before each attempt; superseded requests (route/attempt change, logout, terminal transition) abort rather than resolve.

### 6.3 Rate-limit / shed contract (what 429 means)

- Tiers + `Retry-After` header + denial envelope (`RATE_LIMITED` / `RATE_LIMIT_EXCEEDED`) are server-authoritative. Clients honor the header, do not substitute their own backoff curve.
- Authenticated-user, per-schedule, and global tiers shed in that order; entry/bootstrap/poll tiers are the most likely to 429 under storm. Tests assert the exact envelope + header on shed, and that no client layer retries automatically.

### 6.4 Cache-key / invalidation spec (C04 + C05 — the inventory Phase 07 rehearses)

| Cache | Owning process | Key scope (all required) | Capacity | TTL / freshness | Invalidation (auth-safe) | SQL cost |
|---|---|---|---|---|---|---|
| `delivery.VersionCache` (assembled published trees) | API process only (worker never reads it) | versionID (+ implicit revision check — stale entry fails closed to miss) | 50 versions LRU + singleflight collapse | Infinite until publish; revision check on every hit | Invalidate(versionID) on authoring publish path; publish-during-exam never mutates pinned attempt trees (I08) | Miss = assembly queries; hit = 0 assembly SQL (auth touch still applies at handler) |
| `runtime` Snapshot cache (B2 lock-free write pre-gate) | API process only | scheduleID | Bounded per-schedule map (evict idle; never unbounded) | SnapshotTTL 1s max staleness; CheckWritable pre-gate only — in-tx ensureWritable on locked rows is authoritative | Any runtime command (pause/resume/extend/sync/seal) bumps revision + control epoch; mismatch gives exactly one synchronous refresh + retry, then 422/409 (never silent accept, never lost write) | Hit = 0 runtime SQL; miss/refresh = committed-read header (+ section row when active). Auth/session touch counted separately |
| Session / session-lookup cache (`internal/auth`) | API process only | sessionID / token hash to (user, role, org, expiry, revocation stamp) | Bounded LRU + TTL | Idle TTLs (staff 30m / student 60m / absolute 12h); attempt-session TTL 15m, touch 60s, refresh at 5m or less | Logout-all, explicit revocation, takeover rotation invalidate immediately; revocation check fails closed on cache error (error is not valid). Max propagation delay = C04 bound (fill from Phase 01) | Document honestly: cache-hit saves the session SELECT but the handler business reads remain |
| Runtime poll projection (PollView) | API serves; client caches per React Query key | Server: scheduleID + revision; client: sessions/scheduleID/live/attemptID/userID/versionID/revision (attempt/user/version-safe — never bare scheduleID) | Client liveQueryPolicy (stale 15s, GC 2min) for live; static shapes use staticQueryPolicy | Server adaptive: 2s fast-lane x 60s after control command, else 25s steady (pollAfterSecs); sinceRevision match gives 304 | Control command bumps revision + bus event + snapshot invalidation; client refetches on revision change; account-switch purges all attempt-scoped keys | Steady-state hit = handler auth touch + (snapshot-hit ? 0 : 1-2) SQL. Report the full number — section 7 step 15 |
| Bootstrap ETag (VersionTag + bootstrapEtag.ts) | API assembles; client caches per attempt/version | attemptID + userID + publishedVersionID + contentRevision (never shared across attempts/users/versions) | Bounded (one entry per open attempt; evict on route leave) | ETag validator; If-None-Match match gives 304 (GET path; POST never 304 after migration — section 7 step 10) | Publish bumps version (old attempts stay pinned); redaction changes alter ETag | Pre-probe = 2 indexed probes before assembly (count them) |
| WS hub + live-update bus cursor | Per-process hub; DB `live_update_events` bus shared | Hub subscription: (schedule plus own-attempt) filtered by ShouldForward role filter | Hub queue 128, slow-drop at 1500ms; bus poll 200 rows / 250ms | Bus-to-hub 250ms-or-less intra-instance + poll interval client-side | Lease expiry / admission caps enforced per instance via websocket_connection_leases + singleton lock | Bus poll = 1 indexed range SELECT per instance per 250ms (attribute it) |
| Rate-limit buckets | Per-process local (verify at start whether tier store is local-only or shared; the localonly test is the oracle) | User / schedule / global tier keys | Bounded map + sweep | Window per tier | N/A (shed, not cached-auth) | 0 SQL on local path — state it only if proven |

Invalidation safety rule: any authorization-affecting change (revocation, role/schedule reassignment, org move, attempt termination, media ownership change, grading-release change) must invalidate or scope-bypass every cache that could serve the old decision. A cache hit the caller is no longer authorized for is a security defect, not a performance win.

### 6.5 Freshness bound (C05 — stakeholder-signed numbers; Phase 07 rehearsal oracle)

| Channel / condition | Bound | What it guarantees / does not guarantee |
|---|---|---|
| Attempt-scoped control effect to polling student (awake tab, healthy net) | pollAfterSecs or less (30s or less steady; 2s fast-lane for 60s after the command) | UI **observes** the new revision within the bound. **Writes are gated immediately** regardless — the bound is observability, not safety. |
| Control effect to sleeping/backgrounded tab | Next wake + poll (unbounded while suspended) | No guarantee while suspended; on wake the client does a bounded authoritative refresh before accepting input as fresh. |
| Worker mutation (provisional seal, autosubmit, reconcile) to API reads | C05 worker-visibility bound (fill from Phase 01; proposal: 30s or less via bus + bounded refresh, restart-safe) | Survives API restart, worker restart, event loss (bus cursor + refresh cover the gap). AC11/AC16 assert it across **distinct processes**. |
| Snapshot staleness at write pre-gate | 1s or less (SnapshotTTL) | Pre-gate only; authoritative in-tx re-check always runs. A write landing ~1s past a pause is fenced, never silently accepted. |
| Session revocation to enforcement | C04 propagation bound or less (fill from Phase 01; target: immediate on next request — no stale-cache window beyond one TTL at most, and cache errors fail closed) | Old device after takeover and stale-control-epoch writers are denied with distinct, recoverable errors (AC07). |
| 2-second fast-lane | Hint only | **Never** advertised as "2s delivery guarantee" in code comments, docs, or UI copy. A client sleeping on the steady interval will not see it. |

### 6.6 Clock + request contract

- `platform/clock.Clock` injected everywhere time is decided; prod uses System + DB NOW at write gates, tests use Fixed. Browser wall time is **never** an input to acceptance (deadline, grace, TTL, lease, pause math).
- Every mutating handler documents: body limit applied, auth primitive used (`requireSession` / `requireRole` / bearer verify), ownership check performed, idempotency key honored, error codes possible. Reviewers check the five lines before approving.

---

## 7. Step-by-Step Implementation

> Sequencing rule: steps 0–2 first (evidence + matrix + session/bearer). Steps 3–6 (admission, transport, media, injection, privacy) may parallelize after step 1 with disjoint files. Steps 7–9 (serialization, retry, bootstrap) follow the C07 freeze. Steps 10–14 (inventory, bus, clock, channels, accounting) coordinate shared files with Phase 02 per section 3.2. Each step: reproduce, then failing test, then smallest complete repair, then producer checks, then evidence row (template in section 14).

### Step 0 — Baseline, rediscovery, hypothesis log (0.5–1 day)

1. Record candidate identity: `git rev-parse HEAD`, dirty-tree hashes, `api/openapi/openapi.yaml` hash, schema head (read `backend/go/cmd/migrate/` lineage — do not assume numbers), config fingerprint (flags incl. ATTEMPT_VERIFY, CSRF cookie names, CORS origins, WS caps), lockfiles.
2. Re-enumerate section 4: grep dangerouslySetInnerHTML; grep QueryRowContext/QueryContext/ExecContext entry points; grep MaxBytesReader/MaxBodyBytes/MaxUploadBytes; grep ATTEMPT_VERIFY/VerifyAttempt; grep If-None-Match/writeETagOrNotModified/VersionTag; grep SnapshotTTL/PollSteadySecs/VersionCacheMax; list gateway files under `src/features/*/infrastructure/`.
3. Run the read-only baseline: `npm run typecheck`, `npm run lint`, focused Go tests for auth/authz/accesslinks/media/runtime/liveupdates plus cmd/api contract tests. Classify pre-existing failures separately — never "fix" them by weakening assertions.
4. Reproduce each suspected WP05–WP07 defect before editing (revocation-vs-cache, bearer-vs-path, POST-304, stale-snapshot accept, 429-retry storm, WS-cap drop, orphan leak). Log each as confirmed / already-fixed-with-evidence / not-reproduced / environment-dependent. Already-satisfied items close with evidence, no code churn.

### Step 1 — Role-by-resource-by-operation matrix + closed-by-default audit (WP05)

1. Extend the proposed `authz_matrix_test.go` to enumerate **every** route in `cmd/api/main.go` by all six roles (+ anonymous + bearer-only) asserting: (a) middleware MinRole decision, (b) handler second-layer scope decision with DB fixtures (own schedule vs assigned vs foreign; own attempt vs foreign; own org vs foreign org), (c) unknown-route deny-closed for an unlisted probe route.
2. Fix gaps by **adding table entries + handler scope checks**, never by widening a role or by relying on frontend RequireAuth. `admin_observer` stays read-only (any write gives 403); `grader` writes only within assigned grading sessions; `proctor` commands only within assigned schedules; `student` only own attempt via bearer/session binding; cross-org always 404-or-403-without-oracle (pick per C04, apply uniformly).
3. Assert the two-layer discipline in review: middleware enforces MinRoles only; SelfOnly / AssignedSchedule / AttemptOwner scope enforced in handler/service with a DB lookup. Any Bearer-passthrough must have its handler-side verify visible within ~30 lines (bootstrap, V2 writes, runtime poll).
4. Deliverable: matrix table in the test file header (copy into the evidence row) with all allow/deny green.

### Step 2 — Path-param vs bearer-ownership + session/revocation/takeover hardening (WP05, I06/I07)

1. Write `bearer_ownership_test.go`: for each bearer-bound route (bootstrap, V2 batch, runtime poll, student session reads, presence), assert URL-to-claim reconciliation: matching proceeds; mismatched scheduleID/attemptID gives 401/404 without touching business state; tampered payload/signature gives ATTEMPT_TOKEN_INVALID; expired gives ATTEMPT_TOKEN_EXPIRED; revoked/rotated (post-takeover) gives 401 **in both** ATTEMPT_VERIFY modes on **reads** (the existing verifyAttemptReadBearer discipline — writes keep their in-tx fence, reads never skip the session-table touch).
2. Write `session_revocation_test.go` with clock.Fixed + controllable session store: expiry boundaries (idle 30m staff / 60m student / absolute 12h), logout-all revokes all sessions + emits audit rows, takeover rotates attempt_sessions and fences the old device next write (not silent deletion — AC07), strict vs stateless mode parity on reads, stale session-cache entry fails closed (cache error or post-revocation hit renders 401, never 200).
3. Implement: revocation-aware session/session-lookup cache (invalidate on logout-all / revocation / rotation; stamp comparison on hit; error means deny). Keep the illustrative shape in section 8.2 as the pattern; wire TTLs from config, not literals.
4. Regression guard: **DB-outage gives 503 SERVICE_UNAVAILABLE, never 401/403.** Fault the session DB in the test and assert the code is SERVICE_UNAVAILABLE (AC13/AC14 slice). This is the "DB-outage is not invalid-credentials" rule — reviewers check it explicitly.

### Step 3 — Closed-by-default pre-mint admission + captcha/metadata review (WP05)

1. Write `admission_closed_test.go`: anonymous/bad-code/expired-link/wrong-audience/over-capacity/fenced-revision entry attempts create **zero** admission rows and leak **zero** row-existence (uniform 404/403 + envelope). Valid invite path mints exactly one row with revision fence.
2. Audit historical captcha + metadata-exposure gaps: enumerate what entry/admission responses currently expose (link metadata, roster presence, schedule existence) and trim to the minimum the pre-mint client needs. Any external captcha/verifier is a **proposal** (dependency + secret-management + fallback-when-verifier-down behavior) for L0 approval — do not wire a vendor in this phase without it.
3. Keep `accesslinks/service.go` auth-free (returns NotFound/validation only); enforce all gating in handlers. No change to admission business rules without an approved spec (section 2.4).

### Step 4 — CSRF / cookies / origin / body-limits / identity-mismatch (WP05, AC14)

1. Write `csrf_origin_body_test.go` matrix: missing/stale CSRF gives CSRF_FAILED 403; cookie-attribute assertions (__Host- prefix, Secure, HttpOnly, SameSite per deployment profile); same-origin vs configured cross-origin (allowed origins only; mismatched Origin on cookie-authed mutations denies); per-route body caps (student 256 KiB / admin 2 MiB / workbook 64 MiB / media 16 MiB+1) give PAYLOAD_TOO_LARGE 413 with envelope (prove the +1-headroom probe fires before truncation); session-user vs body-claimed-user mismatch gives 401/403.
2. Implement the smallest repair that makes the matrix green (usually: missing MaxBytesReader on one handler, CSRF check skipped on a new verb, CORS origin wildcard left from development). Verify middleware order via `middleware_order_test.go` — order is load-bearing (confirm actual WithRequestID / SecurityHeaders / auth / authz / rate-limit / handler order in `main.go` and record it).
3. Frontend half: verify `apiClient.ts` CSRF merge (per-request csrf takes precedence over cookie-derived __Host-csrf/csrf over default header) sends the token on every cookie-authed mutation and never requires it on bearer-only student paths. Add a unit test for the precedence.

### Step 5 — Media ownership / validation / paths / finalization / download / orphans (WP05, AC20 touchpoint)

1. Write `media_ownership_test.go` lifecycle: intent (owner-kind + owner-ID recorded, role-gated) to upload-bytes (owner match, 16 MiB+1 gives 413, magic-byte + extension + pixel-cap validation, traversal-filename rejection) to finalize (pending-to-finalized, idempotent finalize, finalize-by-non-owner gives 403/404) to download (finalized-only, owner/scope-checked, correct content-type, cache headers that do not leak across owners) to delete/orphan (24h pending-to-orphaned flip, delete_after_at reap owns bytes + row; maintenance path covered).
2. Harden `media/service.go` + `handlers_media.go`: ownership predicate on every verb (illustrative shape section 8.1); key construction via a single safeObjectKey(ownerKind, ownerID, assetUUID, ext) allowlist function (no caller-concatenated paths); image validation per current caps (25 Mpx / 8192 px; WebP keeps byte-cap + documents the gap); oversize detected before full buffering where the framework allows.
3. Orphan/retention: prove the reaper preserves terminal/incident evidence (coordinate retention boundaries with Phase 05 — this phase defines the media half). Unavailable-media download degrades (placeholder + recoverable error), never freezes the exam shell (AC20 slice).

### Step 6 — Stored-XSS (rich text / import) + parameterized-query audit (WP05)

1. XSS: grep dangerouslySetInnerHTML + workbook-import renderers + question-body/passage renderers. Feed stored-script fixtures (script tag, event handler, javascript: URI, SVG-onload, CSS-expression, markdown-link smuggling) through import-to-store-to-render in `xss_import_contract_test.go` (backend allowlist) + frontend richTextAllowlist test (render). Repair with an allowlist sanitizer at the **render boundary** (plus import-time validation for early rejection); output-encode by default; no javascript: schemes; SVG/MathML only if the allowlist explicitly covers them. Assert the sanitizer runs even when the author is privileged (privilege is not trust).
2. SQL: audit every query string in touched packages for interpolation; convert any remaining Sprintf-built predicates to placeholders; add a grep-based CI assertion (or extend an existing lint test) that fails on Sprintf-built SELECT in the touched trees. All dynamic IN lists expand to per-element placeholders.
3. Keep grading-review and export consumers (Phase 02) rendering through the same sanitizer — shared helper, not per-page copies.

### Step 7 — Minimization / retention / redaction, targeted dep updates (WP05, I11)

1. Projection audit: student-visible shapes (bootstrap, poll, session read, review) must not carry answer keys, other students identifiers, internal revision notes, or secret-adjacent fields. Extend `student_redaction_test.go` with a field-allowlist assertion per shape (fail on unexpected key addition — this is how future key leaks are caught).
2. Telemetry/logs: assert (redaction/schema/cardinality checks) that no answer body, token, password hash, or high-cardinality student identifier lands in metric labels or structured logs; IDs only in controlled diagnostic context with justification. Cover unknownHook, access logs, telemetry registry, and the new tests own fixtures.
3. Retention: document which rows this phase paths create (sessions, session events, admission rows, media rows/bytes) and their retention owner; replay/terminal/incident evidence is never cleaned by media/session reapers.
4. Dependencies: run the vulnerability review scoped to auth/crypto/cookie/multipart/image-decode; apply **targeted** bumps only, each with its regression suite green. Record versions in the evidence row. No blanket update.
5. Language rule: docs, comments, and UI copy describe concrete behaviors ("tokens revoked on logout-all; propagation within C04 bound") — never "compliant", "certified", or similar certification claims.

### Step 8 — Actual-serialization contract tests (WP06, AC14)

1. Extend response/http/pagination contract tests + new `error_envelope_contract_test.go`: for every touched handler assert status + exact envelope keys + wire code strings (especially SUBMISSION_ID_MISUSE, ATTEMPT_TOKEN_*, SESSION_EXPIRED, STUDENT_WS_RETIRED), acknowledgements spelling, nullability (null vs omitted), collection limits (default/max/page-token stability), keyset ordering, and redaction allowlists. Golden files live beside the tests; `openapi_drift_test.go` stays green — any intentional tightening is a contract-owner-approved version bump with changelog entry, not a silent test edit.
2. Wire-DTO separation **only where section 6.1 shows real ambiguity** (ack spelling, submission-code naming, internal revision vs wire revision). Each new DTO gets a mapping unit test both directions. Simple CRUD shapes keep direct encoding — reviewers reject mapping layers without a cited ambiguity.
3. Malformed-input matrix (AC14): truncated JSON, wrong types, oversized arrays, duplicate keys, unknown fields (ignore-per-policy, never crash), charset edge cases give exact 400/413/422 + envelope, no stack-trace leak, no retry storm (assert client behavior in section 13.3).

### Step 9 — Per-operation retry ownership + budgets/jitter/cancellation/Retry-After (WP06, AC03/AC08)

1. Codify section 6.2 in code: `apiClient` fetch wrapper retries **only** idempotent GETs (bounded, jittered, signaled); mutation methods set retries 0 and require an idempotency/write/submission identity from the caller. `queryClient` keeps shouldRetryQuery (429 fail-fast) and sets retry 0 on all mutation hooks; add Retry-After parsing that surfaces the server backoff to UI (countdown copy, not a silent loop). The durability engine remains the sole mutation replayer (Phase 03) — this phase adds the boundary tests proving the other two layers stay out of its way.
2. Write `retry_identity_test.go` (backend) + `retryOwnership.test.ts` (frontend): lost-response-after-commit matrix — same-ID/same-payload gives compatible ack, no duplicate row/side-effect; same-ID/different-payload gives conflict surfaced; different-ID/same-version gives independent write; 429 with Retry-After gives no automatic retry from any layer; aborted signal gives no late-write, no late-state-overwrite. Illustrative policy shape in section 8.3.
3. Cancel obsolete requests: every gateway fetch takes an AbortSignal owned by the route/attempt lifecycle; on route/attempt/user change the previous signal aborts and late responses are discarded **before** cache-write (assert with a race test: slow old response vs fast new response — new wins deterministically).

### Step 10 — Bootstrap POST/304 investigation to compatible GET read path (WP06, AC15)

1. Reproduce: capture current bootstrap behavior (POST + If-None-Match gives 304 with empty body) in `bootstrap_compat_test.go` + document why it violates HTTP semantics (304 is defined for GET/HEAD conditional reads; POST-304 confuses intermediaries, caches, and client retry logic).
2. Implement the compatible target (contract-owner approved; preferred shape):
   - GET bootstrap path (frozen path from C05): bearer-bound, ETag/If-None-Match conditional, 200-with-body or 304-empty per RFC; same auth + redaction + version-key rules as POST.
   - POST bootstrap retained during the migration window as a **full-response command** (always 200-with-body, ignores conditional headers or documents that it does) so old clients keep working.
   - Both paths share one assembler + one ownership check (no forked logic); ETag construction identical; cache keys attempt/user/version-scoped on the client.
3. Migrate `satDeliveryGateway.ts` + `bootstrapEtag.ts` to GET-first with POST fallback (feature-detected, not version-sniffed where possible); prove old-client/new-server and new-client/compatible-old-server interop in `bootstrapCompat.test.ts`; keep the compatible endpoint until Phase 07 adoption evidence permits retirement (WP16 rule). Illustrative handler/client shapes in section 8.4.
4. Guard: caches keyed per section 6.4; a 304 never carries a body and never updates stored state except validators; redacted keys never cached across privilege boundaries.

### Step 11 — Per-process cache/event inventory (WP07, AC11/AC16 foundation)

1. Write `backend/go/internal/runtime/cache_inventory.md`: instantiate the section 6.4 table with measured numbers (capacities, TTLs, key fields, invalidation call-sites with file:line, per-path SQL counts from logs). Tag every entry API-process vs worker-process. Anything not attributable gets a "NOT MEASURED — do not claim" marker.
2. Enforce boundedness in code: VersionCacheMaxVersions, snapshot map eviction, session-cache LRU, hub queue 128 + slow-drop, bus poll 200/250ms, rate-limit map sweep. Add capacity tests (fill past bound gives eviction, not growth; concurrent thundering-herd gives singleflight single load).
3. Auth-safe invalidation tests: revocation / role-reassignment / org-move / termination / publish fixtures assert the next request re-checks (no stale-allow). Cache-error injection (poison the cache, drop the backing row) asserts fail-closed deny, never fail-open allow.

### Step 12 — Durable bus / invalidation / bounded-refresh selection + worker-to-API visibility (WP07, AC11)

1. Confirm the mechanism (no new infra): worker-originated mutations (provisional seal, autosubmit outcomes, reconcile-finalize, runtime commands issued from worker paths) AppendInTx to `live_update_events` inside their business transaction; each API instance polls sequence_id-greater-than-cursor AND origin-not-own ORDER BY sequence_id LIMIT 200 every 250ms and feeds its hub; readers that miss the bus fall back to bounded authoritative refresh (snapshot TTL + sinceRevision poll). Document the choice per mutation kind in the inventory.
2. Write `poll_visibility_test.go` as a **two-process** test (never single-process-shared-memory): start API + worker as separate processes (or separate binaries against the same disposable DB), kill the worker after SAT provisional state, restart, assert the API observes final seal/result within the C05 bound; repeat with bus-event loss injected (drop N events) and assert bounded-refresh still converges. This is the AC11 core. Illustrative wiring shape in section 8.5.
3. Lock discipline preserved: attempt -> runtime -> section ordering stays; seal/runtime-commands/reconcile keep FOR UPDATE locking; snapshot stays a pre-gate. Restart-safe: cursors and jobs are durable (DB), never in-memory offsets.

### Step 13 — Server-time authority + pause/resume/extension/grace (WP07, I06/I07, AC07/AC16)

1. Write `clock_authority_test.go` with clock.Fixed + DB-time control: exact deadline/grace boundaries (last millisecond before vs first after closing_grace_until), pause (writes fence with CONTROL_EPOCH_STALE/ATTEMPT_NOT_WRITABLE, pending data preserved not deleted), resume (new control epoch; reconciled writes accepted as **new** writes), extension (deadline recomputed server-side; attempts created before extension see the new deadline only via authoritative refresh), slow/fast/stale browser clocks (acceptance identical — browser offset is irrelevant).
2. Prove write-time independence: drive writes with a deliberately stale poll revision + stale snapshot + missed WS events and assert the in-tx gate still enforces correctly (I07). UI freshness affects what the student **sees**, never what the server **accepts**.
3. SAT/proctor clock edges: proctor pause vs student submit race (one compatible terminal outcome — touchpoint with Phase 02 AC09; this phase asserts the clock half), break/overlay behavior stays client-side presentation (no server-time mutation from UI).

### Step 14 — Slow-net / background / reconnect / event-loss / WS-capacity / poll-fallback (WP07, AC16)

1. Channel tests: slow network (query-timeout budget gives 503 + bounded client retry on GETs only); backgrounded tab (timers throttled — on-wake authoritative refresh before fresh claims); reconnect jitter (full-jitter backoff, no thundering-herd on mass reconnect); event loss (dropped bus/WS frames — poll fallback converges within C05 bound); staff WS capacity (600/5/600 + queue-128 + 1500ms slow-drop gives shaped 429/close with recoverable UI, never silent roster freeze); student WS gives 410 + poll migration path.
2. Sleeping-poll-loop case (the named edge): control command lands while the client sleeps on its 25s steady timer — assert convergence on next poll (30s or less from wake) and immediate write-gate enforcement if the sleeping client writes first. Assert no copy anywhere promises "2s delivery".
3. Poll-fallback is a first-class supported path (not a degraded afterthought): same auth, same redaction, same revision ordering, same freshness bound. Mode-specific compat tests per the WP07 rollback rule.

### Step 15 — Honest per-poll SQL accounting + Phase 05/06 handoff measurements (WP07)

1. Instrument-then-measure (no tuning yet — tuning is Phase 05): log end-to-end SQL per poll **including** session/attempt touch, snapshot hit/miss, section-row read, bus-cursor poll amortization. Produce the before-table Phase 05 needs (p50/p95 SQL-per-poll, rows examined, lock waits) on a representative fixture. Mark any "zero-SQL" claim with its exact boundary (e.g. "snapshot-hit poll performs zero **runtime-row** SQL; session-touch SELECT still runs").
2. Hand the metric names, label sets (bounded — no student IDs in labels), alert threshold proposals, and redaction attestations to Phase 06. Pair each proposed alert (revocation-failure, freshness-breach, shed-spike, WS-drop-spike) with an owner + runbook pointer + a test that can fire it.

---

## 8. Code / Pseudocode (illustrative — adapt to actual symbols; contract owner approves wire shapes)

### 8.1 Ownership check (handler second layer — the pattern every bearer/param route follows)

```go
// requireAttemptOwnership reconciles the URL param against the verified
// bearer claims AND the locked domain row. Call after verifyAttemptReadBearer
// (reads) or the in-tx edge verify (writes); before any business read.
func requireAttemptOwnership(
    ctx context.Context, q tx.Tx,
    claims crypto.AttemptClaims, urlScheduleID, urlAttemptID string,
) (*AttemptScope, error) {
    if urlScheduleID != "" && urlScheduleID != claims.ScheduleID {
        // Path/bearer mismatch: no oracle, no state touched.
        return nil, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential.")
    }
    if urlAttemptID != "" && urlAttemptID != claims.AttemptID {
        return nil, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential.")
    }
    // Locked domain re-check: revocation / takeover / termination that
    // landed after issuance still fences here (I06/I07).
    scope, err := loadAttemptScopeForUpdate(ctx, q, claims.AttemptID)
    if err != nil || scope.ScheduleID != claims.ScheduleID || scope.Revoked() || scope.Terminated() {
        return nil, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential.")
    }
    if scope.LeaseEpoch != claims.LeaseEpoch {
        return nil, apperrors.New(apperrors.CodeLeaseFenced, "Stale session; refresh before retrying.")
    }
    return scope, nil
}
```

Media ownership follows the same shape with assetID loaded for update to (ownerKind, ownerID) and compared against the actor/bearer scope; mismatch renders 404 (no existence oracle) when the caller has no listing right, 403 when the denial itself is informative per C04 — pick one per route and test it.

### 8.2 Revocation-aware session-cache read (fail closed; error is not valid)

```go
// getSession enforces: cache hit + stamp match + expiry + revocation, else
// single-flight authoritative load. Any cache error fails closed to deny.
func (c *SessionCache) getSession(ctx context.Context, db *sql.DB, sessionID string, now time.Time) (*auth.Session, error) {
    if e, ok := c.get(sessionID); ok {
        if e.expiresAt.After(now) && e.revokeStamp == c.revokeFloor(sessionID) && !e.revokedAt.Valid {
            return e.session, nil
        }
        c.invalidate(sessionID) // stale or revoked: never serve
    }
    sess, err := auth.LoadSessionRow(ctx, db, sessionID, now) // authoritative
    if err != nil {
        return nil, apperrors.New(apperrors.CodeServiceUnavailable, "Session store unavailable.")
        // NOTE: DB outage gives 503, never 401/403 (see section 11 rule 7).
    }
    if sess == nil || sess.Revoked() || !sess.Live(now) {
        return nil, apperrors.New(apperrors.CodeSessionExpired, "Session expired.")
    }
    c.put(sessionID, sess)
    return sess, nil
}

func (c *SessionCache) onLogoutAll(userID string) { c.bumpUserFloor(userID) }      // revocation stamp
func (c *SessionCache) onTakeover(keepTokenID string) { c.bumpAttemptFloor(keepTokenID) }
```

### 8.3 Client retry policy (exactly-once ownership; 429 fail-fast; abort-first)

```ts
// apiClient.ts — only idempotent GETs retry here. Mutations pass retries: 0
// and carry a stable identity (writeId / submissionId / idempotencyKey).
export async function getJSON<T>(path: string, opts: { signal: AbortSignal; budgetMs?: number }): Promise<T> {
  const budget = opts.budgetMs ?? 8000;
  const deadline = Date.now() + budget;
  let attempt = 0;
  for (;;) {
    opts.signal.throwIfAborted();
    try {
      return await fetchOnce<T>(path, opts.signal);
    } catch (e) {
      if (isAbort(e) || isAuthDeny(e) || isRateLimited(e) || isGone(e) || Date.now() >= deadline) throw e;
      if (!isRetryableNetOr503(e)) throw e; // 400/403/404/409-specific/410/413 never loop
      await sleep(fullJitter({ baseMs: 150, attempt, capMs: 2000 }));
      attempt += 1;
    }
  }
}

// queryClient.ts — mutations never retry at this layer:
//   mutations: { retry: 0 },
//   queries: { retry: (n, e) => shouldRetryQuery(n, e) }, // false on 429

// Obsolete-response guard (every gateway):
//   const data = await getJSON(url, { signal });
//   if (signal.aborted) return;                    // superseded: discard before cache-write
//   queryClient.setQueryData(scopedKey, data);     // scopedKey includes attempt+user+version
```

### 8.4 Conditional GET (new) + compatible POST (retained) — bootstrap seam

```go
// GET bootstrap — the standards-compliant conditional read.
func bootstrapGetHandler(app *App) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        bearer, ok := requireBearer(w, r); if !ok { return }
        claims, err := verifyAttemptReadBearer(app, r, bearer)
        if err != nil { httpx.WriteError(w, r, invalidCredential()); return }
        if _, err := requireAttemptOwnership(r.Context(), app.DB, claims, chi.URLParam(r, "scheduleID"), ""); err != nil {
            httpx.WriteError(w, r, err); return
        }
        _, _, etag, _ := app.Delivery.VersionTag(r.Context(), claims.ScheduleID)
        if writeETagOrNotModified(w, r, etag) { return } // 304, empty body
        out, err := app.Delivery.Bootstrap(r.Context(), claims.ScheduleID, claims.AttemptID, urlScheduleID)
        if err != nil { httpx.WriteError(w, r, MapDBError(err)); return }
        w.Header().Set("ETag", quote(etag)); httpx.WriteJSON(w, http.StatusOK, out)
    }
}
// POST bootstrap — retained command: always 200-with-body, ignores
// conditional headers (documents that POST never returns 304).
```

```ts
// bootstrapEtag.ts — GET-first with POST fallback, attempt/user/version-safe key.
export async function loadBootstrap(ctx: { scheduleId: string; attemptId: string; userId: string; versionId: string; signal: AbortSignal }) {
  const key = ['bootstrap', ctx.scheduleId, ctx.attemptId, ctx.userId, ctx.versionId] as const;
  const cached = readBootstrapCache(key);
  const get = await tryConditionalGet<Bootstrap>(BOOTSTRAP_GET, cached?.etag, ctx.signal);
  if (get.notModified && cached) return cached.body;   // 304: keep stored body, update validators only
  if (get.ok) { writeBootstrapCache(key, get); return get.body; }
  if (get.status === 404 || get.status === 410) return fallbackPostBootstrap(ctx, key); // compat path
  throw get.error;
}
```

### 8.5 Worker-to-API visibility (durable bus, restart-safe — illustrative wiring)

```go
// Worker: mutation + bus append share one transaction (never append-after-commit).
func (w *Worker) sealProvisional(ctx context.Context, attemptID string) error {
    return w.txRunner.InTx(ctx, func(q tx.Tx) error {
        if err := w.terminal.SealProvisionalTx(ctx, q, attemptID); err != nil { return err }
        return liveupdates.AppendInTx(ctx, q, liveupdates.Event{
            Kind: liveupdates.KindScheduleRuntime, // or KindAttempt per C05 mapping
            TargetID: scheduleIDOf(attemptID), Revision: nextRevision,
            Name: "provisional-sealed", Payload: minimalIDsOnly,
        })
    })
}

// API instance: durable cursor poll to hub fan-out to bounded-refresh fallback.
// Cursor stored in DB (or durable local file keyed by instance); never pure memory.
func (s *BusPoller) loop(ctx context.Context) {
    t := time.NewTicker(250 * time.Millisecond); defer t.Stop()
    for { select {
    case <-ctx.Done(): return
    case <-t.C:
        evts, next, err := s.store.Since(ctx, s.cursor, 200)
        if err != nil { telemetry.Count("bus_poll_error"); continue } // keep old cursor: at-least-once
        for _, e := range evts { if e.Origin != s.instanceID { s.hub.Broadcast(e) }; s.caches.OnEvent(e) }
        s.cursor = next; s.persistCursor(next)
    } }
}
```

---

## 9. Data / State Flow

### 9.1 Authenticated request (cookie session or attempt bearer)

```
client -- Cookie / Authorization: Bearer --> WithRequestID -> SecurityHeaders
  -> session/bearer resolve -> authz middleware (MinRole / deny-closed)
  -> rate-limit tier check (shed gives 429 + Retry-After + envelope)
  -> handler: ownership check (URL-to-claim-to-locked-row) -> revision/epoch fence
  -> service tx (server-time gates) -> envelope (200/304/4xx/5xx + requestId)
  -> access-log (redacted) + telemetry (bounded labels)
```

Revocation anywhere in the chain (logout-all, takeover rotation, role/org change, termination) invalidates the cache floors so the **next** request re-checks authoritatively. Cache errors and DB outages render 503/deny — never stale-allow, never credential-mapped 401.

### 9.2 Bootstrap conditional-read flow (post-migration)

```
cold:  GET bootstrap --> ownership check --> VersionTag probe (2 indexed reads)
         miss assembles (VersionCache hit ? 0 : N SQL) --> 200 + ETag + redacted body
         client stores (key = attempt+user+version, body + validators)
warm:  GET bootstrap + If-None-Match --> tag match gives 304 empty (no body, no state update but validators)
       tag differ gives 200 + new body (atomic cache replace; old response aborted if superseded)
compat: old POST client --> POST bootstrap --> always 200-with-body (no 304) --> same assembler/checks
```

### 9.3 Runtime command to student convergence (two processes)

```
proctor/API tx: pause/resume/extend --> revision+1, control_epoch+1, grace recompute
  --> AppendInTx(live_update_events) --> commit
API instances: bus poll (250ms) --> hub fan-out --> snapshot invalidate --> pollAfterSecs fast-lane (2s x 60s)
student: next poll (within bound) --> new revision --> UI refresh
  ...meanwhile any write from a stale client --> in-tx fence (control/lease/grace) --> 409/422, data preserved
worker path: provisional/autosubmit/reconcile --> same bus --> API observes within C05 bound (restart-safe via cursor)
loss fallback: dropped bus/WS events --> bounded authoritative refresh (snapshot TTL + sinceRevision poll) converges
```

### 9.4 Media lifecycle states

```
intent(pending, owner bound) --> upload-bytes(validated, 16 MiB or less) --> finalize(finalized)
  | 24h without finalize --> orphaned --> reaper deletes bytes+row (delete_after_at)
  | owner/reaper delete --> deleted
download allowed only in finalized by owner/scope; every transition re-checks ownership.
```

---

## 10. Edge Cases (each needs an explicit test or a cited already-passing test)

1. **Revocation vs cache:** session revoked / rotated after cache fill gives next request 401 even on cache hit; cache-error injection gives deny, not allow.
2. **Expired bearer mid-exam:** read and write both 401 with distinct ATTEMPT_TOKEN_EXPIRED; UI offers re-issue/refresh path, never silent retry; pending engine work preserved (Phase 03 boundary).
3. **Takeover (AC07):** second device mints new bearer; old device next write fenced (ATTEMPT_TOKEN_INVALID / LEASE_FENCED); old pending data surfaced distinctly (not silently deleted, not silently uploaded over the new session).
4. **Stale control epoch after pause (AC07):** in-flight batch under old epoch gives CONTROL_EPOCH_STALE 409; pending preserved; reconciled **new** write after fresh state (Phase 03 executes, this phase asserts the code + no-loss).
5. **Path/bearer mismatch:** URL schedule/attempt differs from claim gives deny without business-state touch and without existence oracle.
6. **Cross-user / cross-org / cross-assignment probe (AC13):** valid session, foreign resource gives uniform deny (404-or-403 per C04, no row-existence signal, no admission-row creation, no timing oracle beyond unavoidable).
7. **Bad entry codes / audiences:** no admission row, no roster leak, envelope-stable errors.
8. **CSRF / origin / cookie-attribute gaps:** missing/stale token, cross-origin cookie-authed mutation, __Host- downgrade gives deny; identity-mismatch (body user differs from session user) gives deny.
9. **Body-limit boundaries:** exactly-cap passes, cap+1 gives 413 with envelope before truncation; chunked smuggling and Content-Length lies both capped by MaxBytesReader.
10. **Rate-limit (AC14):** shed renders 429 + Retry-After + envelope; no layer auto-retries; UI shows backoff; mass-reconnect uses jitter, not synchronized hammering.
11. **Malformed input:** truncated JSON, type confusion, oversized arrays, unknown fields give exact 400/413/422, no panic, no stack leak, no retry storm.
12. **Lost-response-after-commit (AC03/AC08 touchpoint):** server committed, ack lost — identical replay returns compatible ack with zero duplicate mutation/side-effect; same-ID/different-payload gives conflict surfaced.
13. **Blocked/quarantined work at submit (AC08 touchpoint):** submit does not render false-complete; stable idempotency identity retained; recovery choices preserved.
14. **Old/new consumer combos (AC15):** old-POST/new-server, new-GET/old-server (documented fallback or clean 404-to-POST path), new/new conditional matrix — all assert status/body/auth/redaction/version-key parity.
15. **Worker kill after provisional (AC11 touchpoint):** kill -9 worker post-provisional, restart, assert API-observed final seal within C05 bound across distinct processes.
16. **Event loss:** drop bus events / WS frames — bounded refresh still converges within bound; no forever-stale UI.
17. **Stale cache serving:** snapshot/version/session caches never serve post-revocation, post-publish-pinned-violation, or post-termination data; every such case has a negative test.
18. **Sleeping poll loop:** command lands during 25s steady sleep — convergence on next poll + immediate write-gate enforcement; no "2s guarantee" assertion anywhere.
19. **Backgrounded tab / throttled timers:** on-wake refresh precedes any "fresh" claim; timers re-derive from server revision, not accumulated client ticks.
20. **WS capacity:** 600/5/600 caps, queue-128 overflow, 1500ms slow-client drop give shaped close/429 + recoverable UI (roster shows stale-explicit state, not frozen-looks-live).
21. **Media edges:** oversize/type/pixel/traversal/finalize-twice/finalize-by-other/download-pending/download-after-delete/unavailable-store give exact codes, no partial bytes served, no orphan leak.
22. **XSS payloads:** script/event-handler/javascript:/SVG-onload/markdown-smuggle through import-to-store-to-render neutralized at render boundary even for privileged authors.
23. **Clock edges:** exact deadline/grace millisecond boundaries, pause-during-write, extension-after-pause, fast/slow/stale browser clocks give server-time verdicts identical.
24. **DB outage:** session store / runtime row / bus table unreachable gives 503 envelope (never 401/403/404-masquerade), unknown-hook counted, client shows recoverable-degraded (not "wrong password").
25. **Account switching:** user B login on shared device purges user-A attempt caches (query-key isolation test); no cross-user bootstrap/poll/grade leakage.

---

## 11. Errors (see section 6.1 table for the full code-to-status map)

1. **Envelope discipline:** every touched handler returns code/message/details/requestId via httpx.WriteError; no ad-hoc http.Error, no driver-text passthrough, no stack-trace body. requestId always present (echo-or-mint).
2. **Code stability:** wire strings frozen by C07 (SUBMISSION_ID_MISUSE, ATTEMPT_TOKEN_INVALID/EXPIRED, SESSION_EXPIRED, STUDENT_WS_RETIRED, acknowledgements spelling). Tests assert the literal wire strings; a Go-identifier rename never renames the wire without a contract-owner version bump.
3. **Denial uniformity:** cross-boundary probes use the C04-chosen 404-or-403 consistently (no per-handler improvisation); unknown routes deny closed 403 + structured log regardless of role.
4. **Conflict taxonomy:** LEASE_FENCED / CONTROL_EPOCH_STALE / VERSION_COLLISION / WRITE_ID_CONFLICT / RUNTIME_REVISION_STALE / RESPONSE_REVISION_MISMATCH stay distinct — clients branch on them (refresh-and-retry-once vs reconcile-as-new vs surface). Never collapse to generic 409 in a "simplification".
5. **Rate-limit honesty:** 429 carries tier + Retry-After; clients surface, never loop. DO_NOT_RETRY_STATUS + shouldRetryQuery cover Query; apiClient covers direct fetches; engine covers durability replays (Phase 03) — all three tested.
6. **Size errors:** 413 fires from the +1-headroom probe **before** truncation on every capped route; message names the limit without echoing payload bytes.
7. **DB-outage rule:** any session/authz/ownership lookup failure due to store unavailability renders SERVICE_UNAVAILABLE 503 (never UNAUTHORIZED/FORBIDDEN/NOT_FOUND). Rationale: misclassifying outage as credential failure locks users out with the wrong recovery ("re-login") and masks the incident. Assert with faulted-store tests on session, attempt-session, and bus-cursor reads.
8. **Unknown-error hook:** non-apperrors failures render INTERNAL 500 + fire the hook (counted, alertable). No silent masking; tests override via SetUnknownHook and assert the count.

---

## 12. Performance / Security (non-negotiable rules + measured work)

1. **Never roll back to an authorization bypass.** If a security fix breaks a feature, disable the feature or forward-repair; restoring the last "working" binary that contains the bypass is forbidden. Rollback compatibility in section 7 steps 10/14 covers wire shapes, never vulnerable logic. (WP05 rollback rule.)
2. **Forward-repair rule:** revocation, ownership, redaction, and injection fixes ship forward (new candidate + recheck). The incident procedure stops cohort expansion first, preserves journals/evidence, contains without weakening ownership, then repairs.
3. **Safety never depends on frontend guards.** RequireAuth, role-gated menus, hidden buttons, and route wrappers are presentation only. Every guarantee in section 6 is enforced server-side and proven by negative-API tests with crafted requests (curl/Go tests), not by clicking the UI.
4. **Write-time independence:** snapshot, poll revision, ETag, WS event, and React Query freshness are performance/UX inputs only. Timing (closing_grace_until, lease/control epochs, pause state) and authorization (role/scope/ownership/revocation) are re-decided inside the write transaction on locked rows. A fully stale client gets a correct deny/fence, never a stale allow.
5. **Honest per-poll SQL accounting (no "zero-SQL" inflation):** report session/attempt-touch + snapshot hit/miss + section-row + amortized bus-cursor SQL separately. Claim "zero-SQL" only for the exact sub-path proven to issue none, with the measurement attached. Phase 05 tunes from these numbers — inflated claims cause under-provisioning on exam day.
6. **Bounded everything:** VersionCache 50 + LRU + singleflight; snapshot map eviction; session-cache LRU + TTL; hub queue 128 + 1500ms slow-drop; bus 200/250ms; rate-limit map sweep; client gcTime bounds. New caches without capacity + TTL + invalidation are rejected in review. No unbounded in-memory growth on any hot path.
7. **Body/timeout budgets are safety devices:** keep MaxStudentBodyBytes / MaxAdminBodyBytes / MaxWorkbookBodyBytes / 16 MiB media + server timeouts (ReadHeader 5s / Read 15s / Write 30s / Idle 120s) tight; with-query-timeout wraps on herd paths (bootstrap, poll). Do not raise timeouts to quiet slow-DB alerts — diagnose (Phase 05) instead.
8. **WS/DB failure posture:** slow-client drop and tier shed are load-shedding, not error storms — clients back off, UI degrades explicitly, evidence preserved. DB slowness surfaces as bounded 503s with budgets, not hung connections.
9. **Redaction as a gate:** any new field, log line, metric label, or error details entry is reviewed for I11 before merge; high-cardinality IDs stay out of label sets; answer/token/password material never leaves the trust boundary (tests fail on violation).
10. **No 2-second-guarantee language:** comments, docs, runbooks, and UI copy describe the fast-lane as a hint ("polls every 2s for 60s after a command; steady-state observers converge within pollAfterSecs"). The word "guarantee" never modifies the fast-lane.
11. **Targeted deps only:** vulnerability-driven, minimal bumps with green regression suites; record before/after versions. Blanket upgrades are a Phase 07 rejection reason.

---

## 13. Tests (AC07 / AC13 / AC14 / AC15 / AC16 + AC03 / AC08 / AC11 touchpoints + negative API, contract, process+browser)

> Touchpoint rows are co-owned: this phase asserts its half (codes, envelopes, retry-no-duplication, visibility bound) and Phase 02/03 assert theirs (terminal outcome, engine replay). Conceal nothing behind skips: unavailable environment gives NOT RUN with reason, never PASS.

### 13.1 AC07 — Takeover + stale control (this phase leads the auth/clock half)

| Case | Layers | Expects |
|---|---|---|
| Old device writes after takeover rotation | Go API integration + browser (two sessions) | 401/ATTEMPT_TOKEN_INVALID or LEASE_FENCED; new session unaffected; old pending surfaced distinctly, not deleted |
| Batch under stale control epoch after pause | DB barrier + API + engine boundary | CONTROL_EPOCH_STALE 409; pending preserved; reconciled new write accepted after fresh state |
| Stale snapshot write ~1s past pause | API (snapshot TTL manipulation) | Pre-gate may pass; in-tx gate fences 422/409; no silent accept |
| Clock/lease matrix both winners where valid | Race tests with explicit ordering | Both orderings converge to defined outcomes (no silent overwrite — I06) |

### 13.2 AC13 — Cross-boundary denial without leak or admission write

Matrix over roles x (foreign user / foreign org / unassigned schedule / foreign attempt / bad entry code): every probe gives C04-chosen deny (404-or-403 uniform) + stable envelope; **zero** admission rows created; **zero** existence oracle (response identical for absent vs forbidden); revocation-cached probes still deny (cache cannot bypass revocation). Layers: Go negative-API (crafted requests, no UI) + DB row-count assertions.

### 13.3 AC14 — Transport-error fidelity + no retry storm

CSRF/origin/body/malformed/expired-bearer/rate-limit matrix gives exact status + envelope per section 6.1; 429 carries Retry-After; instrument all three client layers and assert **zero** automatic retries on 401/403/404/409-specific/410/413/429; single user-initiated retry after window allowed. Layers: Go contract + frontend retryOwnership test + browser (expired bearer + shed simulation).

### 13.4 AC15 — Conditional-read + compat interop

Old-POST/new-server, new-GET/old-server (documented fallback), new-GET/new-server (200/304 matrix with If-None-Match), auth/redaction/version-key parity across both paths, attempt/user/version cache isolation, obsolete-response discard race. Layers: Go bootstrap_compat test + frontend bootstrapCompat test + HTTP-level (raw 304-has-no-body assertion).

### 13.5 AC16 — Degraded-channel convergence within C05 bound

Worker command / event loss / stale cache / sleeping poll loop / backgrounded tab / throttled timers / WS-capacity shed — UI reaches authoritative state within the section 6.5 bound per condition; writes enforce immediately regardless. Layers: two-process integration + browser (background/reconnect simulation) + WS-cap tests.

### 13.6 Touchpoints owned primarily elsewhere (this phase asserts its half)

| AC | Primary | This phase asserts |
|---|---|---|
| AC03 lost-response-after-commit | Phase 02/03 | Identical replay gives compatible ack, no duplicate mutation/side-effect; same-ID/different-payload gives conflict; envelope + status exact |
| AC08 submit with blocked work / lost receipt | Phase 03/04-seam | No false-complete; stable idempotency identity; retry bound to it; envelope exact |
| AC11 worker-kill after provisional | Phase 02 + this phase | API observes worker-originated change across distinct processes + restart within C05 bound (event-loss variant included) |

### 13.7 Negative-API suite (safety proof — crafted requests, not UI clicks)

Bearer tampering, param confusion, method confusion (405), unknown-route deny-closed, privilege-escalation bodies (role/org/schedule fields in JSON ignored — server derives scope from session/claims), oversized/deep payloads, charset attacks, concurrent revocation-during-request. Every case asserts status + wire code + no-state-change + redacted log.

### 13.8 Contract suite (wire fidelity)

Golden envelope tests per section 6.1, nullability/limit/pagination tests per section 7 step 8, acknowledgements spelling, SUBMISSION_ID_MISUSE wire string, redaction allowlists, openapi_drift green. Old/new consumer combos per the AC discriminating-design rules (same-ID/same-payload, same-ID/different-payload, different-ID/same-version, stale lease, stale control, terminal replay separately).

### 13.9 Process + browser suite (boundary reality)

Two-process visibility (AC11/AC16), restart survival (API restart, worker restart, DB slowdown), browser storage-failure + expired-token + deadline-storm behavior, deterministic clocks (no arbitrary sleeps — clock.Fixed, transaction barriers, network interception).

---

## 14. Verification Commands (confirm actual scripts/flags in WP00 baseline first; never run production-targeting configs by name alone)

```bash
# --- static ---
npm run typecheck
npm run lint
npx tsc --noEmit -p .
go vet ./...                                   # from backend/go

# --- focused backend suites (this phase) ---
go test ./internal/auth/... ./internal/authz/... ./internal/accesslinks/... ./internal/media/...
go test ./internal/runtime/... ./internal/liveupdates/... ./internal/delivery/... ./internal/student/...
go test ./internal/platform/httpx/... ./internal/platform/clock/... ./internal/platform/apperrors/...
go test ./cmd/api/ -run 'Authz|Bearer|Session|Admission|Csrf|Origin|Body|Media|Xss|Envelope|Retry|Bootstrap|Poll|Clock|Visibility|Etag|Pagination|Contract|Drift|Ratelimit|Redaction|WsAdmission|Livebus' -count=1

# --- frontend suites (this phase) ---
npm run test:run -- src/shared/api/__tests__/retryOwnership.test.ts src/shared/api/__tests__/queryKeyIsolation.test.ts src/shared/api/__tests__/queryClient.retry.test.ts
npm run test:run -- src/features/student-delivery/__tests__/bootstrapCompat.test.ts src/features/student-delivery/__tests__/bootstrapEtag.test.ts
npm run test:run -- src/features/auth/__tests__ src/features/exam-authoring/__tests__/richTextAllowlist.test.tsx

# --- two-process visibility (needs disposable DB; never production) ---
go test ./cmd/api/ -run 'TestPollVisibility|TestWorkerRestartSeal' -count=1 -v

# --- contract / openapi ---
go test ./cmd/api/ -run 'TestOpenapiDrift|TestResponseContract|TestPaginationContract|TestHttpContract' -count=1

# --- e2e slices (authorized staging / local only) ---
npx playwright test e2e/auth e2e/bootstrap-compat e2e/runtime-poll --project=chromium

# --- per-poll SQL accounting (evidence for Phase 05) ---
go test ./cmd/api/ -run 'TestPollSQLAccounting' -count=1 -v 2>&1 | tee /tmp/poll-sql.txt
```

**Evidence template per scenario** (copy into the phase ledger; attach raw logs, not summaries):

```text
Requirement/scenario: (ACxx + C-contract version)
Work package and owner: (WP05/WP06/WP07 + name)
Behavioral contract version: (C04 vX / C05 vX / C07 vX)
Implementation files: (paths + rev)
Candidate identity: (source rev + dirty hashes, schema head, config fingerprint, lockfiles)
Producer checks: (command, env, exit status, artifact path)
Observed result: PASS / FAIL / NOT RUN / BLOCKED (+ reason)
Known limitation / residual risk:
Rollback/recovery evidence:
Next action / handoff need:
```

---

## 15. Completion Checklist (all must be checked or explicitly closed with evidence)

- [ ] C04 / C05 / C07 implemented versions recorded (section 6) and match Phase 01 freeze; any deviation is a contract-owner-approved bump with changelog.
- [ ] Role-by-resource-by-operation matrix test green incl. observer/grader/proctor scope + cross-org denial; unknown routes deny closed.
- [ ] Path-param vs bearer-ownership enforced on every bearer route (reads **and** writes, both verify modes); mismatch/tamper/expired/revoked/rotated matrix green.
- [ ] Session expiry / logout-all / revocation / takeover / strict-vs-stateless / stale-cache tests green; revocation fails closed; DB-outage renders 503 (never 401/403).
- [ ] Closed-by-default admission proven (zero rows / zero leak on deny); captcha/metadata gaps reviewed; no unapproved external verifier wired.
- [ ] CSRF / cookie-attribute / origin / body-limit / identity-mismatch matrix green; middleware order recorded and tested.
- [ ] Media lifecycle (intent-to-upload-to-finalize-to-download-to-orphan) ownership-checked + validated + traversal-safe; orphan reaper preserves protected evidence; unavailable-media degrades (AC20 slice).
- [ ] Stored-XSS fixtures neutralized at render boundary; SQL audit shows zero interpolated predicates in touched trees (+ CI guard).
- [ ] Minimization/retention/redaction attestations recorded; no answer/token/password in telemetry-labels/logs/errors; no compliance-cert language.
- [ ] Targeted dep review done with versions recorded; no blanket upgrades.
- [ ] Actual-serialization golden tests green (envelopes, codes, nullability, limits, pagination, acknowledgements spelling, SUBMISSION_ID_MISUSE wire string); openapi_drift green.
- [ ] Wire-DTO separation only where ambiguity cited; each DTO has bidirectional mapping tests.
- [ ] Retry-ownership table implemented and tested in all three client layers + worker boundary; 429/Retry-After fail-fast; abort-supersedes proven; mutation retries bound to stable identities (AC03/AC08 touchpoints green).
- [ ] Bootstrap POST/304 resolved: compatible GET read path live (or documented POST behavior approved), shared assembler/checks, old/new interop green, attempt/user/version-safe caches, obsolete-response discard proven (AC15 green).
- [ ] Per-process cache/event inventory written with measured capacities/TTLs/keys/invalidation/SQL costs; all caches bounded + auth-safe; no shared-memory assumption.
- [ ] Worker-to-API visibility proven across distinct processes + restart + event-loss within C05 bound (AC11 touchpoint green).
- [ ] Server-time authority + pause/resume/extension/grace tests green; write-time enforcement independent of UI freshness (I06/I07).
- [ ] Slow-net / background / reconnect / event-loss / WS-capacity / poll-fallback tests green within bound (AC16); no "2s guarantee" language remains (grep-verified).
- [ ] Honest per-poll SQL table delivered to Phase 05; metric/alert/redaction handoff delivered to Phase 06.
- [ ] Shared-file coordination with Phase 02 logged (who owned what, when transferred); no concurrent same-file edits outstanding.
- [ ] No BLOCKING findings open; IMPORTANT items repaired or formally accepted with authority recorded.

---

## 16. Handoff (to Phase 05 / Phase 06 / Phase 07 + Phase 02 coordination close-out)

1. **To Phase 07 (rehearsal/rollout):** frozen C04/C05/C07 version numbers implemented; AC07/AC13/AC14/AC15/AC16 + AC03/AC08/AC11-touchpoint evidence bundle (candidate identity + raw logs per section 14 template); the section 6.5 freshness-bound statement per channel/condition as the rehearsal oracle; rollback-compatibility notes (POST bootstrap + old ETag clients supported until adoption evidence); known residual risks with NOT-RUN/BLOCKED items and reasons.
2. **To Phase 05 (MySQL tuning):** stable query shapes for session-touch, bootstrap pre-probe + assembly, poll (hit/miss), media intent/finalize/download, admission resolution, bus-cursor poll; measured per-poll SQL table (sections 7 step 15 / 12 rule 5) with dataset/config attached; explicit non-goals (no index DDL in this phase).
3. **To Phase 06 (observability/CI):** metric + label definitions (bounded sets), alert proposals with owner/threshold-rationale/runbook/test-that-fires-it, redaction attestations, contract/retry/visibility tests to promote into CI gates; flaky-test ownership for any timing-sensitive test added here.
4. **To Phase 02 (close-out):** shared-file transfer log (runtime/liveupdates/delivery/student/worker/app wiring — who holds each file at wave end); any new event kind or error code introduced here with consumer impact; terminal/race touchpoint results (AC09-adjacent clock half) for their integration.
5. **Retained compat paths:** POST bootstrap full-response behavior, old ETag clients, student poll fallback, 410-with-migration for student WS — all retained until Phase 07/WP16 adoption evidence permits retirement. If retirement is unsafe, document the retained contract and stop (WP16 rule).
6. **Planning close-out:** this file is the plan only. Implementation, test execution, deployment evidence, and independent review remain future work owned by the implementers + L4.

