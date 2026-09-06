# Rewrite Behavior Map — the full product (two git lineages)

> Current Go implementation note (2026-09-04): this map retains the Rust
> behavior inventory and target-plan language as provenance. The implemented
> runtime is `backend/go`: V2 is structural for all new attempts, ACT/IELTS/
> SAT completion is wired, terminalization is app-owned, and the Go worker
> reconciles timeout/provisional states. The former durability feature flags
> have no production consumers; only V1 compatibility routes remain for the
> measured legacy-attempt drain.

> Purpose: exhaustive inventory of logic/behavior across **both** local git lineages before a rewrite (Go or Bun). The company ships IELTS, SAT (Digital SAT practice), and ACT (incl. ACT Science); the last two live on *different branches* that never merged.
>
> **PART A (§0–§16, below)** = the analyzed mainline **“epic”** — `9b4414a` (“Merge main (sat 9 / V2 durability) into delivery remediation”, 2026-09-03), the IELTS + SAT codebase this session mapped and verified claim-by-claim. Verification note for Part A: every entry re-checked directly against source at that commit (pass 2026-09-04); no `[inf]`/`[gap]` markers remain.
> **PART B (§17+) = the second lineage “ACT fork”** — `origin/main` tip `6671ad1` (merge of PR #3 `codex/add-act-test`, fetch date 2026-09-04). Part B was added because ACT is also product code that a rewrite must preserve; it is verified to feature level against `origin/main:` file contents (deep per-line coverage of the ACT Science machinery, feature-level coverage of the fork’s parallel frontend refactor).
>
> Code base (epic): Rust axum modular monolith, MySQL/TiDB, React SPA frontend. ~88.7k lines backend (Rust + SQL), ~60 tables, 49 migrations, ~110 HTTP handlers, 4 worker job families, 2 runtime topologies.

---

## 0. What a rewrite must reproduce (short version)

1. The **HTTP API contract**: every route, method, error `code` string, conflict vocabulary, rate-limit semantics (see §5).
2. The **server-authoritative exam clock**: runtime state machine, deadlines, pause accumulation, 30s closing grace, fractional-second timestamps.
3. The **single-writer concurrency doctrine**: lock order `attempt → runtime → active section`; idempotent, replayable writes; one terminal owner (`seal`), immutable once written.
4. **Two durability protocols** (v1 mutation batches vs v2 response durability) selected per attempt by `protocol_version`, plus their fencing/idempotency/hash semantics (§7, §8).
5. **Hidden DB-side behavior**: triggers on `student_attempts` (legacy terminalization projection) and immutability triggers on `attempt_terminalizations` (migration 0043); uniqueness constraints that carry semantics (§9).
6. **Background machinery**: outbox (claim/lease/retry/terminal policy), grading projection (idempotent sync + CAS checkpoint), runtime/module timeout reconciliation, retention & media cleanup, storage-budget gating (§10).
7. **Live updates**: durable `live_update_events` bus + in-process fan-out + websocket leases/caps/reconnect snapshot (§11).
8. **Deployment topology**: single image runs `migrate` then api (+worker), or api alone in `activity_driven` mode (§2).

---

## 1. Deployment & process topology

- One Docker image (`backend/Dockerfile`, Railway; health `/healthz`). Entry `start.sh`:
  1. run `/app/migrate` (idempotent migration runner from `backend/crates/api/src/bin/migrate.rs`, uses `infrastructure/migrations.rs`, incl. `verify_runtime_schema` on API boot),
  2. start `api` (axum, port from `API_PORT`/`PORT`, default 4000),
  3. if `BACKGROUND_RUNTIME_MODE != activity_driven` also start `worker`.
- Two background topologies:
  - **continuous**: separate `worker` binary loops (outbox drain every `worker_fallback_interval_secs`; maintenance every `worker_maintenance_interval_secs`) + API in-process tasks: `spawn_live_update_listener` (poll DB bus for cross-instance events, every `live_update_poll_interval_ms`), `spawn_runtime_auto_advance`, rate-limiter cleanup.
  - **activity_driven** (Railway serverless): no separate worker. API embeds `ApiBackgroundJobs` behind `coordinator.rs`: it sleeps when idle; every HTTP request and websocket wakes it (`background_activity_middleware` returns 503 `"Service recovery failed; retry the request."` if critical recovery fails). While active it runs: runtime section/module timeout reconciliation (default every ~1s), live-update polling, outbox + grading projection (interval = min(fallback, projection interval)), maintenance (retention/media) per `worker_maintenance_interval_secs`.
- DB: MySQL or TiDB. Dev: `docker compose` TiDB + MinIO (`make db-up`). Every pooled connection runs `SET time_zone = '+00:00'` (see `state.rs::from_config`); code mixes `UTC_TIMESTAMP(6)` and `NOW()` (UTC after session tz) — **time discipline**: never compare app-local clock against DB-written timestamps in the same decision; read `UTC_TIMESTAMP(6)` inside the transaction when lock ordering matters.
- Object store: MinIO-compatible local storage for media (`infrastructure/object_store.rs`, `infrastructure/cache.rs` for shared-cache entries table).
- No Redis, no message broker: **the database is the queue/bus** (outbox, live_update_events, rate-limit counters, idempotency, leases, cache).

---

## 2. Config surface (env)

`backend/crates/infrastructure/src/config.rs` (~875 lines) is the full catalogue. Behavior-bearing groups:
- Runtime: `API_HOST/PORT`, `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DB_POOL_MAX_CONNECTIONS` (default 20; `RESOURCE_PROFILE=low` → 3), pool timeouts, `BACKGROUND_RUNTIME_MODE` (`continuous` default / `activity_driven`), idle grace / wake timeout / command queue cap, `RUNTIME_AUTO_ADVANCE_ENABLED` (default true) + tick.
- **Feature flags**: `LIVE_MODE_ENABLED`, `GRADING_PROJECTION_ENABLED`, `GRADING_SYNC_ON_READ_FALLBACK`, `STORM_ADMISSION_ENABLED` (join-storm admission queue), `MASTER_KEY_ENABLED` (default false; master credentials for provisioning tools), `PROMETHEUS_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `FRONTEND_DIST_DIR` (static SPA fallback). `RESPONSE_DURABILITY_V2_ENABLED` and `VITE_USE_V2_DURABILITY_ENGINE` were rollout flags and are removed from production reads.
- Auth: cookie names, `AUTH_SECRET` (HMAC attempt-token key + cookie signing; dev default rejected in prod by `validate_for_runtime`), session absolute/idle lifetimes, `ATTEMPT_TOKEN_TTL_MINUTES` (default 15).
- Rate limits + retry/retention knobs (see §5, §10): ~20 rate-limit vars incl. `RATE_LIMIT_GLOBAL` override, bucket cap, retention windows per class, cleanup batch limits, storage budget thresholds (`STORAGE_WARNING_BYTES` etc.).
- Delivery guardrails: `MAX_MUTATIONS_PER_BATCH` (200), `MAX_WRITING_ANSWER_CHARS` (50k), `MAX_TEXT_ANSWER_CHARS` (512), auto-submit batch size, heartbeat min write interval (`HEARTBEAT_PRESENCE_MIN_WRITE_INTERVAL_SECS`, 5), attempt session touch interval.
- Worker: poll/fallback/projection intervals, outbox/live notify channel names (unused in MySQL; notify is a no-op returning count — see `outbox.rs::notify_published`).

---

## 3. Auth & authorization model

Three credential types — reproduce exactly:
1. **Staff/student session cookie** (`__Host-session`; `AuthService`), double-submit CSRF cookie + `x-csrf-token` header + origin check (`VerifiedCsrf` extractor, `api/src/http/auth.rs`). Session rows in `user_sessions` with idle/absolute expiry (staff 30 min / student 60 min idle; absolute 12 h default); `logout`, `logout-all` revoke; `user_session_events` audit.
2. **Attempt token (Bearer)** for exam writes: signed `AttemptTokenClaims {token_id, user_id, schedule_id, attempt_id, client_session_id, exp, lease_epoch?, organization_id?}` (HMAC-SHA256, URL-safe payload.signature, constant-time compare). v1 tokens may omit `lease_epoch`; v2 tokens carry it. Server-side session rows in `attempt_sessions` allow revocation; v2 validates token→session binding on every write (`validate_token_session`, FOR UPDATE). `maybe_refresh_attempt_token` returns refreshed credential when close to expiry.
3. **Roles**: Admin, AdminObserver, Builder, Proctor, Grader, Student (`domain/auth.rs`). Handlers call `principal.require_one_of(&[...])` or finer helpers (`authorize_schedule`, `assigned_schedule_ids`, `require_exam_staff`...). `ActorContext` (role + org + optional schedule scope + optional student-key scope) is threaded into services, which re-check identity at the data boundary (`ensure_student_key_scope`, `attempt_owner_matches_actor`). No DB RLS (0002 is a stub; **all auth is app-level**).

---

## 4. API surface

Auth legend: `S`=session cookie; `CSRF`=cookie+csrf+origin; `B`=attempt Bearer token; `P`=public; roles = allowlist where known (role checks are in handler code).

### 4.1 Platform
| Method/Path | Handler | Auth | Behavior |
|---|---|---|---|
| GET /healthz | `health::healthz` | none | liveness |
| GET /readyz | `health::readyz` | none | readiness incl. DB/schema verification |
| GET /metrics | `health::metrics` | none | Prometheus |
| GET /api/v1/ws/*path | `ws::websocket_live` | S | live websocket; see §11 |
| `*` (fallback) | `frontend::serve_frontend` | none | SPA static files |

### 4.2 Auth (one nest: **`/api/v1/auth`**)
| Method/Path (full) | Handler | Auth | Notes |
|---|---|---|---|
| POST /api/v1/auth/login | `auth::login` | rate-limited per IP & per account | staff+student login; creates session; CSRF/session cookies |
| POST /api/v1/auth/student/entry | `auth::student_entry` | rate-limited per IP/schedule | student check-in by registration/wcode; **admission-queue aware when storm mode on** (position/retry info) |
| GET /api/v1/auth/session | `auth::session` | S | current user |
| POST /api/v1/auth/logout | `auth::logout` | S | revoke current session |
| POST /api/v1/auth/logout-all | `auth::logout_all` | S | revoke all user sessions |
| POST /api/v1/auth/activate | `auth::activate_account` | rate-limited | activation-token account activation |
| POST /api/v1/auth/password/reset-request | `auth::request_password_reset` | rate-limited per IP | issues password-reset token |
| POST /api/v1/auth/password/reset-complete | `auth::complete_password_reset` | rate-limited | consumes token, sets new password |

### 4.3 Exams (IELTS-style authoring) — nest **`/api/v1/exams`** (handlers `exams::*`)
- `GET|POST /api/v1/exams` (list/create), `GET|PATCH|DELETE /api/v1/exams/:id`, `PATCH /api/v1/exams/:id/draft` (save draft), `POST /api/v1/exams/:id/publish` (creates immutable `exam_versions`; publish validation; version ETag `exam-version-builder-v2:{exam_id}:{version_id}:{...}`)
- `GET /api/v1/exams/:id/events`, `GET /api/v1/exams/:id/validation`, `GET /api/v1/exams/:id/versions`, `GET /api/v1/exams/:id/versions/summary`, and `GET /api/v1/versions/:version_id` (`get_version_with_projection`, separate nest `/api/v1/versions`)
Versioned content lives as **JSON `config_snapshot`** (IELTS) → see §6.1.

### 4.4 SAT authoring (one nest: **`/api/v1/assessment-authoring`**; full paths below)
- `GET|POST /exams/:exam_id/shell` (get/open authoring shell), `GET /exams/:exam_id/preview` (preview projection), `POST /exams/:exam_id/load-sample`
- Workbook: `GET /exams/:exam_id/sat-workbook-template`; `POST /exams/:exam_id/sat-workbook-preview` (body cap 13 MB); `POST /exams/:exam_id/sat-workbook-commit` (16 MB); `GET /exams/:exam_id/sat-workbook-undo` (undo *state* read) and `POST /exams/:exam_id/sat-workbook-imports/:import_id/undo` (actual undo)
- Questions: `GET|POST /modules/:module_id/questions`, `POST /modules/:module_id/questions/batch`, `POST /questions/bulk`, `PATCH /modules/:module_id/question-order`, `GET|DELETE /exam-questions/:exam_question_id`, `POST /exam-questions/:exam_question_id/duplicate`, `PATCH /question-revisions/:revision_id`, `PATCH /exams/:exam_id/sections/:section_id/delivery-settings`, `POST /exams/:exam_id/validate`. Behaviors (all SAT): see §6.2.

### 4.5 Assessment access links (nests **`/api/v1/assessment-access`** + `/api/v1/public`; handlers all `assessment_access_links::*`)
- `GET /exams/:exam_id/overview`; `GET|POST /exams/:exam_id/links` (list/create)
- `GET|PATCH /links/:link_id`; `POST /links/:link_id/lifecycle` (open/close/expire…); `POST /links/:link_id/duplicate`; `GET /links/:link_id/members`; `GET /links/:link_id/activity`
- Public (invitee): `GET /api/v1/public/access-links/:link_id` (`get_public_link`)
Staff-scope helpers `require_*_staff` guard the staff routes.

### 4.6 Library & media
- Library (nest `/api/v1/library`, handlers `library::*`): `GET|POST /passages`, `GET|PATCH|DELETE /passages/:id`, `GET|POST /questions`, `GET|PATCH|DELETE /questions/:id`
- Media (nest `/api/v1/media`, handlers `media::*`, nest-wide 16 MB body cap): `POST /uploads` (create intent) → `PUT /uploads/:asset_id` (local object) → `POST /uploads/:asset_id/complete`; `GET /assets/:asset_id` (download), `GET /:asset_id` (metadata)
Media cleanup job removes orphans (see §10).

### 4.7 Settings (nest **`/api/v1/settings`**, handlers `settings::*`)
`GET|PUT /exam-defaults` (`get_exam_defaults`/`update_exam_defaults` — org defaults); `GET|POST /export-profiles` (`list_grading_export_profiles`/`create_grading_export_profile` — config for PDF/export builders).

### 4.8 Schedules & runtimes (nest **`/api/v1/schedules`**; handlers `schedules::*`)
| Method/Path | Handler | Notes |
|---|---|---|
| GET/POST /api/v1/schedules | `list_schedules`/`create_schedule` | list/create (schedule binds exam + published version + timing model + sections config) |
| GET/PATCH/DELETE /api/v1/schedules/:id | `get_schedule`/`update_schedule`/`delete_schedule` | update/delete (guarded on live runtimes) |
| GET /api/v1/schedules/:id/runtime | `get_runtime` | runtime snapshot + remaining seconds + revision |
| POST /api/v1/schedules/:id/runtime/commands | `apply_runtime_command` | start/pause/resume/complete etc.; on StartRuntime also admits queued students (see §6.4) |
| POST /api/v1/schedules/:id/register | `create_student_registration` | candidate registration (wcode, student identity); roles Student/Admin/Builder/Proctor |
| GET /api/v1/assessment-release/exams/:id | `assessment_release::get_release_state` | release-state read (SAT release configuration) |

### 4.9 Proctor (nest **`/api/v1/proctor`**; handlers `proctor::*`)
| Method/Path (under `/api/v1/proctor`) | Handler | Notes |
|---|---|---|
| GET /sessions | `list_sessions` | roster; provider-scoped (`provider_schedule_ids`); staff assignments respected |
| GET /sessions/:schedule_id | `get_session` | live roster detail |
| POST /sessions/:schedule_id/presence | `refresh_presence` | proctor presence heartbeat (`proctor_presence`) |
| POST /sessions/:sid/control/end-section-now | `end_section_now` | cohort control (§6.4) |
| POST /sessions/:sid/control/extend-section | `extend_section` | cohort control (§6.4) |
| POST /sessions/:sid/control/complete-exam | `complete_exam` | cohort control (§6.4) |
| POST /sessions/:sid/attempts/:aid/warn | `warn_attempt` | per-student control (§6.4) |
| POST /sessions/:sid/attempts/:aid/pause | `pause_attempt` | per-student control (§6.4) |
| POST /sessions/:sid/attempts/:aid/resume | `resume_attempt` | per-student control (§6.4) |
| POST /sessions/:sid/attempts/:aid/extend | `extend_attempt` | per-student control (§6.4) |
| POST /sessions/:sid/attempts/:aid/terminate | `terminate_attempt` | per-student control (§6.4) |
| POST /alerts/:alert_id/ack | `acknowledge_alert` | ack audit/violation alert |
| GET /live-mode | `live_mode` | degraded-live snapshot (`LiveModeService`) |

### 4.10 Student session (v1 protocol) — `/api/v1/student/sessions/:schedule_id`
| Path | Handler | Auth | Notes |
|---|---|---|---|
| GET (session) | `get_student_session` | S | static+live context; optional `refreshAttemptCredential=true` returns new attempt credential; read-only (never creates attempt) |
| GET /static | | S | schedule + version only (briefing data) |
| GET /live | | S + rate limits | runtime + attempt state; two rate scopes (schedule & global burst 50) |
| POST /precheck | `save_precheck` | S + CSRF + idempotency optional | **attempt creation point**; one atomic tx: attempt row (protocol_version stamped here), audit event, idempotency record |
| POST /bootstrap | | S + CSRF + rate limit/user | create-or-fetch attempt + **issue attempt credential** |
| POST /mutations:batch | `apply_mutation_batch` | B + rate limit/attempt (burst 50) | v1 write endpoint (strict op-command payload + allowlisted legacy envelope); §7 |
| POST /heartbeat | `record_heartbeat` | B + rate limit (burst 20) | heartbeat/disconnect/reconnect/lost; `responseMode=ack|full`; publishes `schedule_alert` live events; refreshes credential |
| POST /audit | `record_audit` | B + rate limit (burst 30) | writes `session_audit_logs`; `VIOLATION_DETECTED` also upserts `student_violation_events` (idempotent by business violation id, migration 0019) and merges into `violations_snapshot`; publishes `schedule_alert` for a subset of actions |
| POST /submit | `submit_student_session` | B + rate limit 5/300s + **required** Idempotency-Key | §7.3 |

Special headers (observability): `x-student-lifecycle-sampled`, `x-student-flush-cycle-id`, `x-student-submit-cycle-id`; answer-loss-risk telemetry counters keyed on conflicts.

### 4.11 Student v2 protocol — `/v2/student/attempts/:attempt_id` **and duplicated** `/api/v2/student/attempts/:attempt_id`
| Path | Handler | Notes |
|---|---|---|
| POST /responses:batch | `student_v2::save_responses_batch` | §8.2 |
| POST /submit | `student_v2::submit_attempt_v2` | §8.3 |
| POST /takeover | `student_v2::takeover_lease` | §8.4 |
| GET /responses | `student_v2::get_responses_snapshot` | authenticated snapshot (attempt+epochs+deadline+responses) |

> **Smell to preserve-or-fix**: identical handlers mounted at both prefixes (router.rs ~294 and ~309).

### 4.12 SAT module delivery (v1) — nest **`/api/v1/assessment-delivery`** (handlers `assessment_delivery::*`)
| Method/Path (under `/schedules/:schedule_id`) | Handler | Notes |
|---|---|---|
| POST /bootstrap | `bootstrap` | load blueprint (sections/modules/questions) + module attempt rows; reconcile timeouts |
| PATCH /responses/:exam_question_id | `save_response` | per-question save (revision + write-id guarded) → §6.7 |
| POST /modules/start | `start_module` | module `not_started→active` with timing gates |
| POST /modules/submit | `submit_module` | finalize module, compute raw score, adaptive route decision |
| POST /submit | `submit_assessment` | full assessment finalize: score + `student_submissions` + `assessment_results` + seal |

### 4.13 Grading (IELTS-style; SAT has its own results) — nest **`/api/v1/grading`** (handlers `grading::*`)
- `GET /sessions` (list w/ pagination & filters), `GET /sessions/:session_id`
- `GET|PUT|DELETE /schedules/:schedule_id/objective-overrides[/:question_id]`; `GET /schedules/:schedule_id/objective-grading-source`; `GET /schedules/:schedule_id/objective-integrity`; `POST /schedules/:schedule_id/objective-regrade-latest-draft`
- Submission reads: `GET /submissions/:submission_id` (+ `/sections`, `/writing-tasks`); `PUT /submissions/:submission_id/sections/:section/questions/:question_id/override`
- **Review workflow**: `POST /submissions/:id/start-review`, `GET|PUT /submissions/:id/review-draft` (durable drafts), `POST /submissions/:id/mark-grading-complete`, `POST /submissions/:id/mark-ready-to-release`, `POST /submissions/:id/release-now`, `POST /submissions/:id/schedule-release`, `POST /submissions/:id/reopen-review`, `GET /results/:result_id/events`
Export profile listing is under `/api/v1/settings/export-profiles`. See §6.6 for semantics.

### 4.14 Results & analytics — `/api/v1/results`
List results (IELTS + SAT via `/sat`, `/sat/:id`), analytics, CSV export (rate-limited per user), result events, get result.

### 4.15 Answer history (nest **`/api/v1/answer-history`**; handlers `answer_history::*`)
- `GET /submissions/:submission_id/overview` (`get_overview`); `GET /submissions/:submission_id/targets/:target_id` (`get_target_detail`, cursor pagination); `GET /submissions/:submission_id/export` (`export_target`, CSV)
- `GET /attempts/:attempt_id/overview` (`get_overview_by_attempt`); `GET /attempts/:attempt_id/targets/:target_id` (`get_target_detail_by_attempt`)
Read models over terminal snapshots/response rows.

### 4.16 One-off binaries (`backend/crates/api/src/bin/`)
`migrate` (migration runner), `e2e_seed` (seed production-like data for e2e; ~1.4k lines), `e2e_provision_staff`, `reset_legacy_sub_answers`, `reset_exam_migration`, `cleanup_exam_type`, `backfill_objective_auto_grading`. The last four are **data-fix tools for legacy content/submissions**; a rewrite should consciously decide whether they are still needed.

---

## 5. Cross-cutting semantics

### 5.1 HTTP envelope & errors
- Success envelope: `ApiResponse { data, requestId }` (`http/response.rs`). Errors: `ApiError` JSON with `code` (stable machine code), `message`, optional `details`, request id.
- **Stable codes you must preserve** (used by clients/tests): `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR` (422), `CONFLICT`, `INVALID_RESPONSE`, `RATE_LIMIT_EXCEEDED`, `TEMPORARY_UNAVAILABLE` (503), `CONNECTION_LIMIT`, `INSTANCE_CAPACITY`, `CAPACITY`, `SCHEDULE_CAPACITY`, `CSRF_REJECTED`, `INTERNAL_ERROR`, `DATABASE_ERROR`. Payload-level conflict reasons are in the `details.reason` field (see §7.3 vocabulary).
- Strict parsing: many bodies `deny_unknown_fields` (v1 mutation & submit); a **legacy envelope path** is allowlisted (older client compat) — see §7.2.

### 5.2 Rate limiting
Two layers: in-process token bucket (`RateLimiter`) and **DB-backed distributed counters** (`distributed_rate_limit_counters`, `DistributedRateLimiter`) with local fallback on failure. Rule names & defaults (config.rs; all counts overridable by `RATE_LIMIT_GLOBAL`):
| Route key | Key | Default | Burst |
|---|---|---|---|
| login | per IP / per account | 10/60s, 5/60s | |
| password reset | per IP | 3/300s | |
| student.entry | per IP / per schedule | 30/60s, 600/600s | |
| student.bootstrap | per user | 5/60s | |
| student.live | per schedule / global | 1200/60s, 10 000/60s | 50 |
| student.mutation_batch | per attempt | 100/60s | 50 |
| student.heartbeat | per attempt | 300/60s | 20 |
| student.audit | per attempt | 300/60s | 30 |
| student.submit | per attempt | 5/300s | |
| export | per user | 3/300s | |
Denied responses: 429 `RATE_LIMIT_EXCEEDED` with `retryAfterSeconds` details.

### 5.3 Idempotency (`infrastructure/idempotency.rs`)
Shared repository over `idempotency_keys` table: `(owner/student key, route_key, idempotency_key)` → stored response JSON, with **payload-hash conflict** semantics: same key + different request hash = 409. Retention windows per class (mutation 72h usable / 24h grace; submit 30d usable; violation 180d usable — config). Re-checks happen **inside the transaction after acquiring row locks** to make replay authoritative. Precheck/submit/mutations/heartbeat/audit each have route keys.

### 5.4 Notifications & events (write-time side effects, mostly in-tx)
- **Outbox** (`outbox_events`; cols aggregate_kind/aggregate_id/revision/event_family/payload + claim lease fields). Families enqueued in-tx (all verified call sites): `auto_submit_schedule_attempts_requested` (aggregate_kind `schedule`; enqueued by `auto_submit_schedule_attempts_in_tx`, dedupe-guarded per schedule via EXISTS check), `attempt_terminalized` (aggregate_kind `attempt_terminalization`; enqueued by `seal_attempt_in_tx` in delivery/mod.rs), `runtime_changed` (aggregate_kind `schedule_runtime`; payload `.event` ∈ `end_section_now`/`extend_section`/`complete_exam`; proctoring.rs commands), `roster_changed` (aggregate_kind `schedule_roster`; payload `.event` = the action incl. `warn_attempt`/`pause_attempt`/…/`extend_attempt`; proctoring.rs per-student commands). Worker `process_event` (worker/jobs/outbox.rs) executes **only** `auto_submit_schedule_attempts_requested` → `finalize_pending_schedule_attempts(pool, schedule_id, completion_reason, batch_size)` (completion_reason defaults `runtime_completed`; batch_size defaults config `auto_submit_batch_size`); every other family returns `Ok(())` so the row is marked published — durable record / future fan-out only. Claim/retry: `claim_batch` ≤100 rows, 60 s lease, expired leases stealable; a drain cycle runs ≤20 claim-batches (worker & API-embedded identical, see §10.1); on failure `mark_failed` applies exponential backoff 5 s·2^(attempts−1) capped 300 s and `failed_at` after `MAX_OUTBOX_ATTEMPTS`=8 (retry_disposition, infrastructure/outbox.rs); `purge_published` deletes rows published >72 h.
- **Live update bus** (`live_update_events`): appended in-tx by services with `origin_instance_id`; each instance polls others' rows (`poll_after`, excludes own instance id, 250 ms) and publishes into the in-memory hub (§11). Local events also published immediately + bus enqueue in background.

---

## 6. Subsystem behavior

### 6.1 IELTS content model (exams / versions / drafts)
- Tables `exam_entities` (provider_key `ielts`|`sat`), `exam_versions` (published snapshot incl. **`config_snapshot` JSON**: sections/modules/questions structure for IELTS-style), `exam_events` (history), `exam_memberships` (staff access to exam), `admin_default_profiles` (exam-defaults).
- Draft/publish: `save_draft` writes working copy; `publish` validates then creates a **new immutable version** (published version content is frozen; schedules bind `published_version_id`); builder ETag (`exam-version-builder-v2`) guards optimistic concurrency for content edits.
- Publish readiness is also enforced frontend-side; backend `get_validation` returns structured `ValidationIssue`s.

### 6.2 SAT content model & authoring
- Normalized tables (migration 0032+): `assessment_sections` (per exam version; section keys `reading-writing`, `math`; duration; break), `assessment_modules` (module keys like `rw-m1`, `rw-m2-lower`/`higher`, `math-m1`...; `adaptive_role` base/lower/higher; `tool_policy` calculator/reference sheet), `assessment_exam_questions` (join module→question revision; display order; pretest flag), `assessment_question_revisions` (rich content: stimulus/prompt/rationale as TipTap-ish document JSON + answer definitions), `assessment_routing_policies` + `assessment_route_decisions` (adaptive), `assessment_scoring_policies`, `sat_workbook_imports` (import recovery/undo).
- **Provider validation** (`domain/exam_provider/sat.rs`, `assessment/...`): 4-option MC with required correct id; Student-Produced-Response format rules (≤5 chars, fractions, decimals, sign rules — tests live in sat.rs); rich content node/mark allowlists incl. math LaTeX & images w/ alt; domains/skills enums for R&W and Math; question type/section pairing; math-only SPR. **A rewrite must port this validator — it encodes College-Board-like item rules.**
- Authoring APIs: shell (draft-locked edit surface), preview projection, sample exam loader, **Excel workbook template/import/undo** (`sat_workbook.rs`, calamine/rust_xlsxwriter): imports 6 modules / 147 questions; generates versioned templates with an embedded copyable **AI system prompt** (recent addition, see docs/superpowers/plans/2026-09-02); undo restores prior state from `sat_workbook_imports`.
- Question revisions are per-question versioned (`question_revision_updated_by` — migration 0036); `bulk_questions`/batch endpoints for large authoring operations.

### 6.3 Schedules, registration, admission
- Schedule = exam binding + cohort settings + timing model (`legacy_section_v1 | cohort_stage_v2 | cohort_section_v3`, migrations 0037/0038) + per-section durations/breaks (`exam_session_runtime_sections` come from schedule/blueprint at runtime creation).
- Registration rows `(schedule_id, student_key)` unique → candidate identity (name/email/wcode/access state, `access_state` incl. `withdrawn`), user binding, staff assignments (`schedule_staff_assignments` roles proctor/grader w/ per-schedule).
- **Admission control**: with `STORM_ADMISSION_ENABLED`, student entry goes through `student_admission_queue` (positional admission; migration 0025) to absorb join storms; rate limits per IP & schedule double as the coarse gate.
- **Live-mode degrade** (`LiveModeService`, `live_mode` snapshots + degraded flag) — when outbox/live machinery lags, sessions report degraded state; proctor UI must show it.

### 6.4 Runtime state machine & proctor controls
Runtime (`exam_session_runtimes`): `not_started → live → paused → completed|cancelled`, with `active_section_key`, `current_section_key` (retained for presentation), `waiting_for_next_section`, revision. Section rows (`exam_session_runtime_sections`) carry `planned_duration_minutes`, `extension_minutes`, `accumulated_paused_seconds`, `actual_start_at/paused_at`, projected times; per-section deadline = `actual_start_at + (planned+extension)·60s + paused`. **Pause freezes effective deadline; resume re-baselines.** Runtime completion contract (BEX-023): status completed only when structurally complete (end time or no current section / all sections complete).
- Student writes are admitted only while the **active** section window is open for their attempt (authoritative gate `lock_runtime_write_gate_tx`); a 30s `closing_grace_until` accepts last-keystroke mutations just past the deadline; outside grace → structured `DEADLINE_EXPIRED`/`SECTION_MISMATCH` conflicts.
- Proctor commands (schedule-level): end-section-now, extend-section(minutes), complete-exam; student-level: warn, pause, resume, extend(minutes), terminate. All idempotent, replayed safely; produce audit rows + `schedule_runtime`/`schedule_alert` live events + outbox auto-submit when runtime completes (`finalize_pending_schedule_attempts` batches of 50, reason `runtime_completed`/`auto_stop`).
- **Timeout reconciliation** (`proctoring::reconcile_expired_sections_at_with_origin`, api `runtime_auto_advance.rs` / embedded in background): finds expired active sections (server clock), advances them, seals time-expired module attempts, enqueues auto-submit; publishes `auto_advance_section` / `sat_module_timeout` events.
- V2 coupling: on pause/resume/advance for **protocol_version=2 attempts**, `sync_v2_runtime_timing_in_tx` re-projects `deadline_at` + `closing_grace_until` + bumps `control_epoch` on the attempt rows; extensions update via `extend_v2_attempt_deadline_in_tx`.

### 6.5 Student session phases & attempt lifecycle
Phases: `pre-check → lobby → exam → post-exam` (attempt.phase) alongside `delivery_status` (`running/paused/submitted/terminated/locked/cancelled`) and `proctor_status`. UI mapping table is BEX/FEX in `invariant1.md`; backend rules:
- **No student-triggered start**: attempt stays in lobby until runtime is `live`/`paused`; deadline comes from the server.
- Precheck creates or updates the attempt **atomically** with audit event + idempotency; idempotent under concurrent duplicates (unique (schedule_id, student_key) + retry loop).
- Attempt creation stamps `protocol_version = 2` and initial `deadline_at/closing_grace_until` derived from the runtime section (or schedule end). V1 rows are accepted only by the compatibility drain handlers.
- **Multi-session**: `active_client_session_id` claim with provider-neutral single-physical-writer helpers; v1 claims on bootstrap/refresh unless superseded; v2 claims guarded by lease epoch and requires explicit `/takeover` for a second device (see §8.4).
- Heartbeat & network events update presence (`student_attempt_presence`, heartbeat events) with min-write throttling; disconnect/reconnect/heartbeat-lost drive proctor alerts (idempotent by business id); they never modify answers.

### 6.6 Grading (IELTS-style) & results
- Sources: `student_submissions` (attempt terminal snapshot), `section_submissions`, `writing_task_submissions`; grading UI reads **projected** rows (`grading_sessions` etc.) maintained by the worker projection (see §10) and `grading_sync_on_read_fallback` option.
- Objective auto-grading grades from **final immutable snapshot**; regrade support via overrides (`grading_schedule_question_overrides`) + objective integrity checks (per-question consistency between snapshot and projection), triggered through regrade endpoints.
- Review workflow states: started → draft (durable, PUT w/ optimistic revision via `get_review_draft_revision` client side) → grading-complete → ready-to-release → released (now or scheduled) → reopen allowed; all transitions write `review_events` + release events; audit trail per result.
- Results: `student_results` (IELTS-style), `assessment_results` (SAT, see §6.7); analytics/export aggregations; CSV/PDF export profiles (frontend `Export Builder` downloads from these endpoints).

### 6.7 SAT delivery, scoring & results
Module attempt state machine: `not_started → active → review → submitted`, plus `locked` (time-expired finalization) — lock reasons include `time_expired`; **timeout recovery** allows final answer writes into a locked module within the grace window and repairs the module row. Adaptive routing: module 1 raw correct → policy decides module 2 lower/higher (`assessment_route_decisions`); scoring: raw → normalized → scaled per section via scoring policy (`assessment_scoring.rs`), reading-writing + math → total (400–1600 banding implemented by `total_score`). Practice mode scores immediately at final submit (`student_submissions` + `assessment_results` + `assessment_section_results`, provider_key `sat`, release_status `ready_to_release`); terminalized/invalidated outcomes produce `invalidated` results (see seal §9).
Preview schedules: attempts may be on "preview runtime" schedules where proctor/student actions differ (route checks `is_preview_runtime_schedule`).

---

## 7. v1 answer durability (protocol_version = 1)

### 7.1 Storage
- `student_attempts.answers / writing_answers / flags` JSON columns are the canonical v1 answer state (shape: answers by question id; writing_answers by task id; flags by question id).
- Ledger: `student_attempt_mutations` (immutable per-write record; `client_write_id`/mutation id unique — migration 0016), `student_attempt_answer_slots` (slot-scoped answer rows for sentence-completion/diagram items, migration 0015).
- Presence: `student_attempt_presence`, `student_heartbeat_events` (idempotent; 0045), `session_audit_logs`, `student_violation_events` (idempotent by violation business id; 0019).

### 7.2 Mutation batch endpoint
- Request: `{attemptId, mutations:[{mutationId, type, payload}]}` (strict `deny_unknown_fields`) **or** legacy envelope `{attemptId, studentKey?, clientSessionId?, mutations:[{id, seq, timestamp?, baseRevision?, type, payload}]}` where only answer-ish ops are allowlisted (`SetSlot/ClearSlot/SetScalar/ClearScalar/SetChoice/ClearChoice/SetFlag/SetEssayText/ClearEssayText`). The old Answer/WritingAnswer/Flag/Position/Violation/telemetry command shapes live in `domain/attempt.rs::MutationCommand` and are used internally; public API surfaces the op-commands.
- Server assigns `seq` 1..n per request; response carries per-write outcome + `serverAcceptedThroughSeq` watermark + `latestRevision`; conflicts are structured (vocabulary below).
- Semantics per batch: lock attempt row → runtime gate → idempotency key → validate batch (count ≤ 200, per-command validation incl. size/charset, text limits 512/50k) → apply **all or nothing** (no partial state on validation/db failure) → persist ledger row per accepted command → bump attempt `revision` → audit & lifecycle logs. Server accepts only if attempt writable: not terminal, session matches, runtime window open (deadline/grace/section active, not proctor-blocked).
- Position/violation/telemetry mutations are for internal/proctor flows; the public route maps them out (violation writes come through `/audit` instead).

### 7.3 Conflict vocabulary (stable `details.reason` strings)
`OBJECTIVE_LOCKED`, `DEADLINE_EXPIRED`, `SECTION_MISMATCH`, `ATTEMPT_PROCTOR_BLOCKED`, `BASE_REVISION_MISMATCH`, `ATTEMPT_SUBMITTED`, `ACTIVE_SESSION_SUPERSEDED`, `FINAL_FLUSH_REQUIRED`, `FINAL_PAYLOAD_HASH_MISMATCH`, `INVALID_MUTATION` (+ terminalization conflict details: `outcome`, `reason`, `terminalizationId`, `latestRevision`). HTTP status mostly 409; validation 422; auth 401/403.

### 7.4 Submit (v1)
Required `Idempotency-Key`. Payload: `{attemptId, lastSeenRevision, submissionId, clientFinalSeq?, serverAcceptedThroughSeq?, finalAnswerPatch?, finalClientSnapshotHash?}`. Server: lock attempt → runtime gate → if `protocol_version == 2` reject (`Protocol v2 attempts must be submitted through the response durability endpoint`) → require that all pending client mutations are accepted (seq watermark rules → else `FINAL_FLUSH_REQUIRED`); optional final answer patch reconciles the last keystrokes; optional final snapshot hash must match canonical server answers (`FINAL_PAYLOAD_HASH_MISMATCH` otherwise) → `seal_attempt_in_tx` (outcome `submitted`, reason `student_submit`) → idempotent replay returns stored receipt; one submission per attempt (ledger + `attempt_submissions`/`student_submissions`).

---

## 8. v2 response durability (protocol_version = 2)

### 8.1 Concepts
- New canonical storage (migration 0049): `attempt_responses_v2` (row per (attempt, question); module_id, epochs, client_version, write id, request & response hashes, server_revision), `attempt_mutations_v2` (immutable write ledger; UNIQUE(attempt, write_id), UNIQUE(attempt, lease_epoch, question, client_version)), `attempt_submissions_v2` (receipt per attempt; submission_id globally unique).
- Attempt row gains: `protocol_version` (default 1, immutable per attempt), `delivery_status`, `lease_epoch`, `control_epoch`, `response_revision`, `deadline_at`, `closing_grace_until`, `final_response_digest`.
- Hashing: canonical JSON (sorted keys, recursive) → sha256. Response hash per payload; command hash per (writeId, questionId, clientVersion, response); **final digest = sha256 over sorted `len:qid:len:hash;` concatenation** of all current responses (`final_response_digest` in durability_v2.rs).
- Epochs: `lease_epoch` = writer ownership (bumped only by takeover); `control_epoch` = bumped by proctor/control transitions (pause/resume/advance/seal); requests must carry both and match the attempt or get structured `LeaseFenced` / `ControlEpochStale` conflicts. `client_version` = per-question logical version from the writing client; server rejects version reuse for another write (`VersionCollision`).

### 8.2 Write (`responses:batch`)
Bearer attempt token (must include `lease_epoch` claim). Request `{leaseEpoch, controlEpoch, commands:[{writeId, questionId, clientVersion, response:{answer, markedForReview, eliminatedOptions, annotations}}]}` (≤100 commands; strict size/type validation: JSON depth 32, strings ≤64KB, payload ≤256KB, annotation objects with string ids). Transaction: lock attempt → validate claims/session/ownership (`ProtocolVersionUnsupported` if not v2) → idempotency by writeId (exact replay returns stored ack **even after terminal boundary**, but still requires current lease; new commands must pass epoch + runtime-writability checks) → runtime gate → apply per command: newest-wins by (lease, clientVersion); outcomes `applied | duplicate | superseded`; increment `response_revision` per applied change; write projection row + ledger row; **mirror into legacy `answers/writing_answers/flags` JSON** (read-model compat for snapshots/grading/answer-history). Response: per-command acknowledgements incl. canonical response + `content_hash`, plus `attemptRevision`, `serverTime`. Empty batch = live-runtime writability probe.

### 8.3 Submit (v2)
`{submissionId, leaseEpoch, controlEpoch, finalCommands?, expectedAttemptRevision}` + request hash. Semantics: idempotent receipt replay (same submissionId + same hash → stored receipt, still lease-checked); submissionId globally unique; `expectedAttemptRevision` must equal current `response_revision` (`VersionCollision` otherwise); flush final commands; compute final digest from current `attempt_responses_v2`; then **provider branch**:
- non-SAT: `terminalization` seal (submitted/student_submit) then update digest fields (receipt-first ordering remains the invariant even though current Go migrations remove the legacy triggers).
- SAT: **provisional** — set `delivery_status='submitted'`, `phase='post-exam'`, digest, revision+1, control_epoch+1 **without `submitted_at`/`final_submission`** so provisional state cannot be mistaken for a terminalization before provider scoring runs; the provider (module completion path) writes `assessment_results`, and the Go worker repairs gaps.
Insert immutable receipt row; commit.

> **Full spec:** `docs/v2-provisional-state-design.md` (who may write in the provisional window, trigger interaction walkthrough); implementation sequence with test gates in §15.1.

### 8.4 Takeover (multi-tab/device)
Explicit endpoint: verify token/session binding for same candidate, ensure attempt not terminal, bump `lease_epoch` (unless same session id), revoke other `attempt_sessions`, issue **new attempt token** with new lease claim. Old session writes fail fencing thereafter (`LeaseFenced`/`ACTIVE_SESSION_SUPERSEDED`).

### 8.5 Snapshot
`GET /responses`: in one tx: lock attempt, validate session + lease, return `{protocolVersion, deliveryStatus, leaseEpoch, controlEpoch, attemptRevision, deadlineAt, closingGraceUntil, responses:[…]}` for hydration/recovery.

---

## 9. Terminalization & DB-owned logic

### 9.1 seal (application-owned terminal fact)
`seal_attempt_in_tx` is the **only** writer of terminal state (used by v1 submit, v2 non-SAT submit, proctor terminate/complete, auto-submit, timeout). Semantics:
- outcomes `submitted | terminated`; allowed reasons: `student_submit, sat_complete, time_expired, auto_stop, proctor_complete, proctor_end, proctor_force_submit, proctor_terminate, legacy_unknown`.
- Lock order: attempt → runtime/active section (fence against races). Idempotent: existing terminalization + same intent → return stored receipt (`created:false`); incompatible → `TerminalizationConflict`.
- Body (one tx, delivery/mod.rs::`seal_attempt_in_tx`): lock attempt FOR UPDATE → if a terminalization exists, replay if intent compatible (re-materialize SAT result from stored snapshot, `created:false`) else `TerminalizationConflict` → validate outcome/reason + optional `min_answer_revision` fence → if SAT & terminated: `lock_sat_modules_in_tx` → build server `final_snapshot` JSON (answers/writing/flags + answer_revision; SAT also module attempts + per-question responses; provider_key read from exam) → INSERT immutable `attempt_terminalizations` row (incl. terminalization_id, request_id, actor_kind, answer_revision, effective_at) → conditional-claim `UPDATE student_attempts` (`phase=post-exam`, `delivery_status`, merged `final_submission` enriched with submittedAt/completionReason/terminalizationOutcome/terminalizationId (+answers/writingAnswers/flags/providerKey), `submitted_at=COALESCE(submitted_at,…)`, `control_epoch+1`; terminated also sets proctor_status/proctor_note/proctor_updated_*; the WHERE clause refuses to clobber an already-terminal row → `Conflict`) → `materialize_sat_terminal_result_in_tx` when provider is SAT → enqueue outbox row (aggregate_kind `attempt_terminalization`, event family `attempt_terminalized`). **Seal emits no live-update event itself** — sockets are told by the wrapping route handlers (proctor controls) or by later `schedule_runtime`/`schedule_roster` events / `/live` polling (§11).
- SAT materialization in same tx: create/update `assessment_results` (`outcome_status` derived: terminated-by-proctor → `invalidated_proctor`, other terminate → `invalidated_timeout`, else pending→scored later); on re-termination after scoring, delete section results, set `release_status='invalidated'`, store `score_payload` with reason/snapshot.

### 9.2 DB triggers (historical Rust compatibility behavior)
- `attempt_terminalizations_legacy_projection` (AFTER UPDATE on student_attempts): when `submitted_at` flips NULL→non-NULL and no terminalization exists, INSERT IGNORE a conservative receipt (`reason legacy_unknown`, `actor system`, snapshot from JSON columns). **V2 submit deliberately avoids setting submitted_at for SAT to prevent this trigger from firing prematurely.**
- `attempt_terminalizations_legacy_insert` (AFTER INSERT): same guard for rows inserted already-submitted (backfills).
- `attempt_terminalizations_immutable_update / _delete`: historical SIGNAL 45000 on any UPDATE/DELETE.
- Migration 0043 also backfills existing submitted attempts at migration time.
- Outbox/live-notify triggers were removed (0011 no-op) — polling-based. In the
  current Go lineage, migration 0051 removes the remaining terminalization
  triggers on MySQL and TiDB skips trigger DDL; the application/worker own the
  equivalent receipt and repair invariants.

---

## 10. Background jobs

### 10.1 Worker (`worker/src/main.rs`) & API-embedded equivalence
Cycle: drain outbox — a drain cycle is ≤20 claim-batches, each claiming ≤100 rows and breaking early on an empty batch (`MAX_OUTBOX_BATCHES_PER_CYCLE` loop is identical in worker `drain_outbox_until_empty` and API-embedded `run_outbox`, background.rs) — then repair SAT terminal results (`repair_sat_terminal_results(pool, 250)`, worker main; API embedded drives 250-row runtime/module reconciliation batches, `RUNTIME_RECONCILIATION_BATCH_SIZE`), then run grading projection. Maintenance loop (every `worker_maintenance_interval_secs`, floor 60 s in worker main): storage budget inspection → retention cleanup (respecting budget level) → media cleanup. API activity-driven mode runs the same set through `ApiBackgroundJobs` with its own cadences. **Both topologies must exist or be consciously merged in the rewrite.**

### 10.2 Grading projection (`worker/jobs/grading_projection.rs` + `application/grading/mod.rs::run_projection_cycle`)
Idempotent incremental sync of source rows (schedules, submissions/attempts, sections, writing tasks) into grading read tables; per-cursor watermark persisted in `shared_cache_entries` key `grading_projection_state_v1` with **optimistic CAS on revision** (concurrent workers may replay batches but only one advances checkpoint; failure counters; bootstrap window 24h when uninitialized; `GRADING_PROJECTION_ENABLED=false` disables). Lag + failure counters exposed in run reports/telemetry.

### 10.3 Retention (`worker/jobs/retention.rs`)
Batch deletes (configurable `RETENTION_CLEANUP_BATCH_LIMIT`) over: shared cache (grace `RETENTION_SHARED_CACHE_GRACE_HOURS`), idempotency keys (usable hours + grace; submit/violation classes longer), user sessions (30d), heartbeats (7d), mutations (30d), outbox, distributed rate counters, live update events — windows all config; budget `level` can tighten behavior. Outbox published purge additionally lives in `outbox.rs::purge_published` (72h).

### 10.4 Media cleanup (`worker/jobs/media.rs`)
Orphan detection (assets with no upload completion / dangling references) + object deletion.

---

## 11. Live updates & websockets

- Event model: `LiveUpdateEvent {kind, id, revision, event}` (`domain/schedule.rs`), kind ∈ `schedule_runtime | schedule_roster | schedule_alert | attempt`. **Verified production `event` strings** (no `[inf]` left): `start_runtime|pause_runtime|resume_runtime|complete_runtime` (routes/schedules.rs `apply_runtime_command`); `end_section_now|extend_section|complete_exam` (routes/proctor.rs cohort controls, kind `schedule_runtime`); `attempt_changed` (proctor.rs warn/pause/resume/terminate → one `schedule_roster` + one `attempt` event each) and `attempt_extended` (kind `attempt`, extend); `auto_advance_section` (proctoring.rs + runtime_auto_advance.rs + background.rs reconcile); `sat_module_timeout` (attempt + schedule_roster, same reconcile sites); `sat_module_started`/`sat_module_submitted` (routes/assessment_delivery.rs, attempt + schedule_roster); `violation_snapshot_changed` (schedule_roster, routes/student.rs audit) and `alert_changed` (schedule_alert, same route); `network_disconnected|network_reconnected|heartbeat_lost|student_network` (schedule_alert, heartbeat route). Test-only strings — `runtime_tick`, `mutated`, `changed` (live_updates.rs/ws.rs tests) — are never emitted by production code.
- Publishing — two verified paths: (1) HTTP route handlers publish after a successful service call via `state.publish_live_update` (api/state.rs): immediate in-process hub fan-out + a spawned task appends the `live_update_events` row (after commit; the code comment states the DB bus exists for reconnect/replay and the poller reconciles missed events); (2) application-internal transitions (runtime section auto-advance & completion reconcile, proctoring.rs) call `LiveUpdateBusRepository::enqueue_in_tx` inside the state-change transaction. Rows carry `origin_instance_id`; each instance polls others' rows (`poll_after`: `sequence_id > cursor`, `origin_instance_id <> own`, LIMIT 200) every `live_update_poll_interval_ms` (default 250 ms; in activity-driven mode the background cycle drives the poll).
- Hub (`api/src/live_updates.rs`): broadcast channels: global, per-schedule topic, per-attempt topic; idle topics GC'd; in-process caps default total 600 / per user 5 / per schedule 600 (config.rs), enforced on connection-open and subscribe, and mirrored by the DB-backed `websocket_connection_leases` acquired before upgrade (lease heartbeat every 30 s, ws.rs).
- Role filtering (`should_forward_event`, routes/ws.rs): students get `schedule_runtime` only when `event.id` == their socket's schedule (and that schedule is allowed) and `attempt` only when `event.id` == their socket's attempt **and** the socket has no schedule filter; staff (non-students) get `schedule_runtime|schedule_roster|schedule_alert` when `event.id` ∈ their allowed schedules and their socket isn't an attempt-only subscription, and `attempt` events only when `event.id` == their explicit attempt subscription.
- Socket flow (`routes/ws.rs`): auth by session cookie before upgrade → resolve allowed schedule ids by role (platform roles see all; Builder=org schedules; Proctor/Grader=staff assignments; Student=registrations not withdrawn) → authorize requested `scheduleId`/`attemptId` (attempt→schedule mapping checked) → DB **websocket lease** acquisition (`websocket_connection_leases` w/ caps + 30s heartbeat) → send `{type:"connected"}` → if subscribed to a schedule, send current `runtime_snapshot` frame if `lastSeenRuntimeRevision` older → forward events with role-based filtering:
  - Student: `schedule_runtime` for their schedule; `attempt` only for their own attempt on an attempt-only socket (exact rule above).
  - Staff: `schedule_runtime/roster/alert` for allowed schedules (never on attempt-only sockets); `attempt` only with explicit attempt subscription.
  - Slow-client handling: bounded outbound queue; saturation → coalesce to latest event; disconnect code 1008 after `websocket_slow_client_disconnect_ms`. Broadcast lag tolerated (Lagged ignored). Inbound client frames: only ping/pong/close handled; other messages ignored.

---

## 12. Observability & telemetry

- `tracing` (env filter) + optional OTLP export (disabled in activity-driven mode to preserve Railway sleep); Prometheus metrics (`/metrics`) via `infrastructure/telemetry.rs` (storage budget, websocket connection counts, background wake results); DB op timings; **student answer-loss-risk counters** and lifecycle sampling logs (`event=student_save_lifecycle`, flush/submit stages) — these are the production observability net for the "no lost answers" promise; preserve equivalents in rewrite.

---

## 13. Constraints & unique keys carrying behavior (schema contract)

Reproduce exactly (see migrations):
- `student_attempts`: UNIQUE(schedule_id, student_key); immutability of `protocol_version` (no UPDATE path changes it); CHECKs on wcode formats (relaxed in 0026 for some shapes) and delivery_status values.
- `schedule_registrations` UNIQUE(schedule_id, student_key); `proctor_presence` UNIQUE(schedule, proctor, left_at) (0013); `student_attempt_mutations` write-id uniqueness (0016); `student_violation_events` business-violation-id dedupe (0019) with `ON DUPLICATE KEY UPDATE id=id` upsert pattern; heartbeat dedupe (0045).
- v2 tables: UNIQUE(attempt, client_write_id) & UNIQUE(attempt, lease_epoch, question_id, client_version) on mutations; UNIQUE(submission_id) on submissions; PRIMARY KEY (attempt_id, question_id) on responses — the database *is* the idempotency/conflict arbiter for concurrent duplicates.
- `attempt_terminalizations` PRIMARY KEY (attempt_id), UNIQUE terminalization_id, immutability triggers, FK cascade-safe (no delete path).
- `exam_session_runtime_sections`/`cohort_control_events` widened to TIMESTAMP(6) (0049) — **do not round times to seconds**.
- `grading_*` projections & `assessment_*`: dedupe/ordering indexes for "sort memory hot path" (0023/0024), `required_identity_index_names` (0047), timestamp precision (0029/0048) — index audit will matter when re-deriving schema for a new stack.

---

## 14. What is NOT in the backend (avoid reimplementing or clarify with product)

- **No server-side user/admin management CRUD** beyond auth/session/activation (no `/admin/users` etc. in router). Admin features in the UI (`e2e/admin-users.spec.ts`) target surfaces that currently do not exist server-side; `e2e/TEST_STATUS.md` records stale tests and selector drift. Confirm product intent before budgeting for them.
- No LLM/AI grading: `@google/genai` appears in the frontend deps and a browser-secrets test references a *retired* Gemini credential; writing grading is a human review workflow. AI in the repo = authoring prompt sheet for SAT Excel import only.
- No attachments in audit payloads beyond JSON; websocket client→server messages other than ping/pong are ignored.
- No Redis/pub-sub: notify functions are no-ops.
- **Old stale e2e**: proctor `Monitor/Alerts/Warn`-selectors etc. differ from current UI (TEST_STATUS.md). Not backend behavior.

---

## 15. Rewrite strategy notes (Go or Bun)

- **Bun (TypeScript) wins on**: sharing the *entire* domain/type layer with the existing 192k-line React frontend (types like `StudentAttempt`, `ExamSessionRuntime`, mutation commands already exist in `src/types`); single language across stack; fast iteration; built-in TS. Bun+SQLite is NOT an option (MySQL/TiDB required); use Bun's `mysql2`-class driver or Drizzle/Kysely. Watch: single-threaded event loop under CPU-heavy work (Excel import via calamine ↔ SheetJS) and connection-pool discipline.
- **Go wins on**: mature typed SQL (sqlx/pgx-style), goroutine concurrency for websocket fan-out & polling loops, single static binary (current Docker image builds one anyway), stronger default for CPU-heavy authoring jobs. Loses type sharing with the frontend (must duplicate domain types or generate them).
- Either way, **port order that de-risks**: (1) schema + migrations + app-owned terminalization, (2) auth + sessions + tokens, (3) schedules/runtimes/proctor commands + timeout reconciliation, (4) V1 compatibility drain, (5) V2 protocol, (6) SAT module delivery+scoring, (7) grading projection + review + release, (8) live bus + websockets, (9) media/retention/outbox jobs, (10) bin tools & observability. Each implemented step runs against the same MySQL/TiDB state because all concurrency is row-lock discipline.
- **Preserve the test contracts as the spec**: `backend/tests/contracts/student_contract.rs` (2.9k lines), `proctor_contract`, `grading_contract`, `builder_contract`, `auth_contract`, `answer_history_contract`, `scheduling_contract`, integration suites (`sat_adaptive_runtime`, `mutation_replay`, `response_durability_v2_proof_tests`, `attempt_write_invariant_guard`, `exam_lifecycle`, `revision_tracking`), `invariant1.md` (BEX/FEX contract matrix), k6 + Playwright prod suites. These encode the behavior map more precisely than any prose.
- See `docs/backend-rewrite-map` companion: `invariant1.md` §8 lists per-PR/nightly/pre-release commands to re-run as equivalence gates.

### 15.1 Two-phase completion protocol (v2 provisional + seal) — implementation sequence with test gates

Spec sources: `docs/v2-provisional-state-design.md` (provisional window, write matrix), `docs/terminalization-design.md` (seal), `docs/proctor-control-design.md` (proctor interplay). Every stage runs against the same MySQL/TiDB as the Rust system (strangler pattern); each stage must keep the three cross-cutting rules: **(R1)** lock order attempt → runtime → active section everywhere; **(R2)** receipt-first ordering inside the seal tx (INSERT receipt → claim UPDATE); **(R3)** the claim predicate's OR-branch `(delivery_status = 'submitted' AND phase = 'post-exam' AND final_submission IS NULL)` verbatim — it is the provisional handshake.

| Stage | Build (deliverable) | Key invariants to hold | Gate (must pass before next stage) |
|---|---|---|---|
| **0. Schema** | Migrations 0032/0043/0049 equivalents: `attempt_terminalizations` (+CHECKs, PK attempt_id, immutable triggers), `attempt_responses_v2` / `attempt_mutations_v2` / `attempt_submissions_v2`, attempt row gains (`protocol_version`, `delivery_status`, epochs, `deadline_at`, `closing_grace_until`, `final_response_digest`, `answer_revision`) | 0043 backfill of historical terminal rows; `45000` immutability on update/delete; trigger fires only on NULL→non-NULL `submitted_at` with no existing receipt | Migration smoke on empty + pre-populated DBs; `INSERT IGNORE` duplicate-receipt proof; `exam_enum_decode.rs`, `grading_enum_decode.rs` (enum/CHECK vocab) |
| **1. Pure gates & hashing** | `ensure_attempt_writable`, `ensure_attempt_not_terminal`, `ensure_runtime_response_writable` (30s closing grace, server clock), `canonicalize_json`/`canonical_json_hash`, `final_response_digest` (sorted `len:qid:len:hash;` sha256), response validation limits (256KB payload, depth 32, ≤512 array items, ≤64KB strings) | No client clocks anywhere; hash determinism independent of JSON key order | Unit tests ported from `response_durability_v2.rs` `mod tests` (1975+): hash/digest vectors, validation rejections, gate matrices incl. paused/locked/expired/post-exam cases |
| **2. V2 batch write** | `responses:batch` tx: lock attempt → identity/session/epoch checks → `batch_is_exact_replay` (writeId+hash) → runtime gate (R1) → `apply_commands_tx`: idempotent replay (Duplicate), `VersionCollision`, newest-wins by (lease, clientVersion), projection row + immutable ledger row + legacy `answers/writing_answers/flags` JSON mirror; empty batch = writability probe | Exact replay allowed **after** terminal boundary but only with current-lease token; new commands fenced by epochs + runtime window | `mutation_replay.rs`; `response_durability_v2_proof_tests.rs`; `attempt_write_invariant_guard.rs` (write invariant under concurrency); `student_contract.rs` v2 write sections |
| **3. Seal core** | `seal_attempt_in_tx`: attempt lock → replay-or-conflict (**outcome-only** intent compatibility) → outcome/reason enum checks → optional `min_answer_revision` fence → SAT `lock_sat_modules_in_tx` on terminate → snapshot builder (SAT `assessment.{moduleAttempts,responses}` extension, FOR UPDATE) → receipt INSERT (R2) → claim UPDATE (R3; terminated branch sets `proctor_status='terminated'`, submitted branch adds `AND proctor_status <> 'terminated'` + `AttemptProctorBlocked` on failure) → SAT result materialization (`pending`/`invalidated_proctor`/`invalidated_timeout`) → outbox `attempt_terminalized` in-tx, **no live event** | Receipt immutability; cross-outcome second seal → `TerminalizationConflict`, never clobber; replay re-materializes SAT result idempotently | `delivery/mod.rs` unit tests (5135+); `student_contract.rs` submit/terminate sections; `attempt_write_invariant_guard.rs` seal portion |
| **4. V2 submit — non-SAT** | `submit_attempt_v2` non-SAT branch: flush final commands → digest → **seal first, then digest UPDATE** (order prevents trigger re-arm: `OLD.submitted_at` already non-NULL + receipt exists) → `attempt_submissions_v2` receipt (request_hash; submissionId globally unique; `expectedAttemptRevision` == `response_revision` else `VersionCollision`) | Receipt replay idempotent but lease-checked; digest attests exact answer state | `response_durability_v2_proof_tests.rs`; `student_contract.rs` v2 submit; `idempotency_smoke.rs` |
| **5. Provisional submit — SAT branch** | Provisional UPDATE: `delivery_status='submitted'`, `phase='post-exam'`, `response_revision`, digest, `revision+1`, `control_epoch+1` **without** `submitted_at`/`final_submission`; guard `WHERE submitted_at IS NULL AND final_submission IS NULL AND delivery_status NOT IN ('terminated','locked','cancelled')`; ≠1 row → `AttemptNotWritable` rollback; receipt INSERT; commit | Trigger never fires (predicate false); write window closed (students locked out, §8.3/§v2-design §3 matrix) | `response_durability_v2.rs` unit tests (provisional guard + failure path); `student_contract.rs` SAT v2 submit; `attempt_write_invariant_guard.rs` |
| **6. SAT module completion + real result** | `finalize_module_tx` (writes **only** `assessment_*` tables — never `student_attempts`; adaptive routing via `assessment_route_decisions` + next-module insert) → `complete_assessment`: proctor check → all-modules-submitted check → scoring from `assessment_scoring_policies` → `student_submissions`/`assessment_results`/`assessment_section_results` → seal `sat_complete` (R2/R3 claim the provisional row); re-seal path returns stored result | Module path cannot satisfy any trigger predicate; result tables are trigger-free; seal claims provisional via R3 | `sat_adaptive_runtime.rs`; `exam_lifecycle.rs`; `student_contract.rs` SAT sections; `attempt_write_invariant_guard.rs` |
| **7. Timeout reconciler + auto-submit** | `reconcile_attempt_timeout` (0..32 bounded finalize loop → `complete_assessment`), worker `reconcile_expired_modules_at` (GET_LOCK `ielts_sat_runtime_reconciliation`), `auto_submit_schedule_attempts_in_tx` (deduped outbox `auto_submit_schedule_attempts_requested`; **SAT legacy_section_v1 with still-valid module clock → skip**; outcome `terminated` for SAT / `submitted` for IELTS), `repair_sat_terminal_results` gap-healing | Cohort expiry never overrides a still-valid personal module clock; single-instance determinism; worker replay idempotent | `sat_adaptive_runtime.rs` (timeout paths); `proctor_contract.rs` (complete-exam); `outbox_smoke.rs` (dedupe); `attempt_write_invariant_guard.rs` |
| **8. Proctor interplay** | terminate on provisional (claim OR-branch 2, §4.4/§6 of `proctor-control-design.md`), pause/resume `control_epoch+1` + resume deadline compensation + `sync_v2_runtime_timing_in_tx`, extend-attempt module+deadline propagation, warn/pause/resume hard-block checks | `ControlEpochStale` fences in-flight V2 batches; terminate mid-provisional → authoritative `terminated` receipt + `invalidated_proctor` result, no duplicate | `proctor_contract.rs`; `student_contract.rs` proctor-blocked sections; `attempt_write_invariant_guard.rs` |
| **9. Equivalence audit** | Full two-lineage union suite run against the new stack + migration smoke + `invariant1.md` §8 per-PR/nightly/pre-release commands + k6/Playwright E2E (v2 submit → provisional → complete → release) | Zero drift vs. Rust behavior for every stage gate; no `legacy_unknown` receipts on any exercised path | All suites green; manual E2E: student submit → proctor terminate mid-provisional → verify receipt + invalidated result |

Known gap to decide before stage 7: provisionally-submitted attempts whose modules are all already submitted and whose `complete_assessment` never runs are stuck (`submitted`/`post-exam`, `submitted_at NULL`, no receipt — no worker sweeps that state; see `v2-provisional-state-design.md` §9). Either add the watchdog in stage 7 or accept client-driven completion — but the equivalence suite must define the expected outcome first.

---

## 16. Must-not-lose checklist (final)

1. 30s closing grace + server-clock authority (no client clocks).
2. Global lock order attempt → runtime → active section in every student/proctor write path.
3. protocol_version routing fences + flag agreement across client/server builds.
4. Canonical JSON + sha256 semantics for v2 hashes and digest (ordering, key sort, no whitespace sensitivity).
5. Idempotency-key + business-id idempotency + outbox claim/retry/terminal policy.
6. Legacy projection: v2 writes still mirror `answers/writing_answers/flags` JSON; SAT v1 `assessment_question_responses` still read as projection while migration incomplete.
7. Triggers on student_attempts/attempt_terminalizations (or move equivalent logic into the app *transactionally* and prove it in migration tests).
8. Ephemeral-but-important knobs: rate-limit route keys/bursts, retention windows, admission queue, storage budgets, websocket caps, activity-driven wake semantics (503-on-unrecovered).
9. Audit log event vocabulary & alert-live-event mapping; answer-loss telemetry counters.
10. Multi-instance live-update bus semantics (origin_instance_id exclusion) and per-instance websocket leases.

---

# PART B — second lineage: the ACT fork (`origin/main`)

## 17. Lineage map: two parallel versions of the same product family

**Both lineages start from the same merge-base commit `14a40f3` (2026-08-20) and then evolve the same codebase in parallel. They were never merged; git reports the divergence as ahead-21/behind-6 and any mechanical merge produces 129 conflict hunks in 27–28 files.**

| | Lineage A “epic” (local `main` = this repo’s HEAD) | Lineage B “ACT fork” (`origin/main`) |
|---|---|---|
| Tip | `9b4414a` (2026-09-03) | `6671ad1` (PR #3 `codex/add-act-test`, fetched 2026-09-04) |
| Unique commits | 21 (`sat1`…`sat9`, SAT authoring docs/plans, delivery remediation, V2 durability merge) | 6 (`8214dbf feat: add ACT exam workflow`, `536e9bf`, `e45486b`, `0a4a896`, `30d916a` CI/test infra, merge `6671ad1`) |
| Product additions | SAT (Digital SAT practice): modules/adaptive routing/scoring/V2 response durability | ACT: exam type `ACT` + `science` section; **plus its own parallel frontend/backend refactors** |
| Where it lives | Local branches/worktrees of this checkout (analyzed in Part A) | Remote `origin` (`teaching01-netizen/IELTS-LMS`); refs `origin/main` |
| Other remotes | `pee`, `pee_warwick2`, `peewarwick` → `adisak-coder/IELTS-LMS` (relationship unconfirmed; treat as mirrors/sources of the epic lineage) | |

**Migration-number collision (must fix in a rewrite):** both lineages created a migration numbered `0032` with different content — epic `0032` = SAT content-model tables (`assessment_sections`, `assessment_modules`, `assessment_exam_questions`, …); ACT fork `0032_act_science_support.sql` = widened CHECKs for `exam_type='ACT'` and section key `science`. A rewritten migration plan must be renumbered and reconciled against a real DB, not copied.

**What the ACT fork is NOT:** it is not “upstream progress” or “epic + CI”. Its `feat: add ACT exam workflow` commit independently re-architected large parts of the shared frontend (138 files, +17 887/−9 098 in `14a40f3..origin/main`) — services, types, student UI, grading UI, builder — and touched the same backend files the epic rewrote (delivery, grading, results, scheduling, contracts). Treat the two as **two candidate implementations of the same product**, and make the rewrite the third, canonical one.

### 17.1 Which shared files disagree (the 28-file “must-decide” list)
Every file below exists in *both* lineages with different content (from the failed merge attempt). For the rewrite each is a decision: which lineage’s behavior is canonical, or what union to build. File → epic side adds | ACT-fork side adds.

| File | Epic side (Part A behavior) | ACT fork side adds |
|---|---|---|
| `backend/crates/application/src/grading/mod.rs` | Projection/read-model grading, IELTS objective overrides (reading/listening), review workflow | ACT-aware session search (`config_snapshot.general.type='ACT'` EXISTS sub-query), `science` override section, `list_act_science_reports` service, `compute_act_science_score` |
| `backend/crates/application/src/results.rs` | IELTS/SAT results listing | ACT science report query (same `list_act_science_reports`), ACT results surfacing |
| `backend/crates/api/src/routes/results.rs` | IELTS+SAT result routes | `GET /api/v1/results/act-science` handler (`list_act_science_reports`) |
| `backend/crates/api/src/router.rs` | SAT authoring/delivery/v1+v2 student mounts | `/act-science` route in the results nest (fork has no `/sat` results routes — it predates SAT) |
| `backend/crates/application/src/delivery/mod.rs` | v1/v2 durability, seal, terminalization | Seal-time ACT scoring: `compute_act_science_score(config_snapshot, content_snapshot, final_answers, now)` → injects `score` into `final_submission` JSON; delivery refactor `load_version_with_executor` |
| `backend/crates/application/src/scheduling.rs`, `…/validation.rs`, `…/version_serializer.rs`, `…/answer_history.rs`, `domain/src/attempt.rs`, `domain/src/grading.rs`, `domain/src/exam.rs` | attempt lifecycle, validation, version projection, answer history, attempt/current_module model | ACT enum (`ExamType::Act`), `Science` current_module, `ActScienceScoreReport` type, science-aware validation/serialization/answer-history |
| `backend/crates/api/src/routes/student.rs` & `schedules.rs` | v1 student session, schedule commands | ACT science handling; test `submit_request_rejects_client_supplied_score` |
| 6 contract suites (`student_contract`, `proctor_contract`, `grading_contract`, `builder_contract`, `scheduling_contract`, `answer_history_contract`) + `mutation_replay` | Epic’s behavior contracts (incl. V2) | ACT-side expectations (science sections/reports) — the **equivalence gate for the rewrite = the union of both suites** |
| Frontend: `AdminExams`, `admin/contracts`, `AdminRoot`, `authSession`, `BuilderRoot`, `previewRuntimeSessionService`, `exam-authoring/*`, `proctor/*`, `studentAttemptRepository(+test)`, `examDeliveryService`, `examLifecycleService`, `developmentFixtures`, `StudentApp`, `types/domain.ts`, `types.ts` | Epic frontend (V2 client, delivery remediation) | ACT product UI + fork’s own refactor (see §20) |
| `vite.config.ts`, `.env.example` | epic defaults | fork defaults (port/env variance) — trivial to decide |

## 18. ACT product — behavior map (fork, verified `origin/main:`)

ACT is modeled **inside the classic IELTS-style exam pipeline** (exam entities/versions with `config_snapshot` JSON), not as a provider-key module like SAT.

### 18.1 Exam-type & schema model
- `ExamType::Act` (`domain/src/exam.rs`, serde `"ACT"`, storage round-trip tests) — third `exam_type` beside `Academic`/`General Training`. Provider dimension: ACT stays in the builder world (provider key unchanged); do not confuse with SAT’s `provider_key='sat'` world.
- Migration `0032_act_science_support.sql` widens CHECK constraints to accept `'ACT'` (`exam_entities.exam_type`) and section key `'science'` on `exam_session_runtime_sections.section_key`, `student_attempts.current_module`, `section_submissions.section`. **It drops and recreates the checks by name lookup** — the migration assumes MySQL 8 CHECK naming.
- Section keys in play for ACT: the four classic-ACT sections were folded into the existing section model; the *new* section is `science`. Objective-override allowlist on the fork is `reading | listening | science` — meaning ACT objective sections are graded through the existing reading-style MC path plus the new science path.

### 18.2 Authoring (frontend, `src/…` on fork)
- Exam defaults expose `type: ACT` and a `science` section with its own module config (`src/constants/examDefaults.ts`: `DEFAULT_ACT_EXAM_SUMMARY = "Standard ACT Exam"`, preset `"ACT Science"`, `normalizeModuleConfig(base.sections.science, …)`).
- Builder authoring for science stimuli: `ActScienceWorkspace.tsx` + `ActScienceQuestionBuilderPane.tsx` — stimulus = `{id, title, content, blocks, images, wordCount}`; blocks created by `createActScienceBlock`; question counts per block via `getBlockQuestionCount`; stimuli in the `ExamState` used by the builder. (Science = passage/graph-style multi-question “stimuli”.)
- Builder config UI additions: `ExamConfigTabs`, `BasicInfoTab`, `ModulesTab`, `TimingTab`, `ValidationSummary` handle ACT/science (tests `ActScienceConfigTabs.test.tsx`).

### 18.3 Delivery & sealing (backend, fork)
- Seal path (`delivery/mod.rs:1364`) for ACT attempts computes the science objective score at terminalization: `compute_act_science_score(&version.config_snapshot, &version.content_snapshot, &final_answers, now)` and writes it into the `final_submission` JSON `score` field. Server-computed only — a fork test asserts the client cannot supply the score (`submit_request_rejects_client_supplied_score`).
- `compute_act_science_score` lives in `application/src/grading/mod.rs:3674` (unit-tested at 6406/6492) and returns an `ObjectiveScoreSummary`-style result with `totalScore`/`maxScore`/`percentage` (plus `correct_count`, `total_questions`, `percentage` in the report row mapper).

### 18.4 Grading & results (backend, fork)
- Objective override allowlist extended to `science` (grading/mod.rs:505, message “Only reading, listening, and ACT Science objective answers can be overridden.”).
- Session list search understands ACT: when a search term is present, the query adds `EXISTS(SELECT 1 … JSON_UNQUOTE(JSON_EXTRACT(versions.config_snapshot,'$.general.type')) = 'ACT' AND submissions.student_name LIKE ?)`; grading sessions query joins `exam_entities` and is provider-scoped (`provider_key='ielts'` on the fork — ACT lives under the IELTS-style provider).
- `list_act_science_reports` (grading/mod.rs:1282, `ActScienceScoreReportRow` 3544) reads `student_submissions` joined to `section_submissions (section='science')`, schedules, versions — filtered to ACT exams and non-preview runtimes — and maps `auto_grading_results` (`totalScore`/`maxScore`/`percentage`) into `ActScienceScoreReport` (domain/grading.rs:656) with submission/schedule/exam/student identity + `grading_status`.
- Route: `GET /api/v1/results/act-science` → `results::list_act_science_reports` (results.rs:58 route file; application results.rs:48). Frontend consumes it via `gradingService.ts:284` → `GET /v1/results/act-science`.

### 18.5 Student flow (frontend, fork)
- Student app renders the science section (`StudentScience.tsx` + `StudentApp` integration; `StudentExamWorkspace` etc.). Science question renderer reuses the reading-style workspace pieces (`QuestionRenderer`, `StimulusPane`, `StudentMaterialWithQuestionPane`, block-section layout).
- Fork’s student UI also carries highlight tools (`studentHighlightToolContext.ts`) and interaction/motion behavior (many component tests) that overlap conceptually with the epic’s own student revamp — **pick one implementation in the rewrite**.

### 18.6 Contract/test surface (fork — the fork’s own spec)
- New frontend component tests: `ActScienceWorkspace.test.tsx`, `ActScienceQuestionBuilderPane.test.tsx`, `AdminExams.act.test.tsx`, `AdminResults.test.tsx`, `StudentScience.test.tsx`, `examUtils.act.test.ts`, `developmentFixtures.test.ts`, `AdminRoot.logout.test.tsx`, plus reworked admin/proctor/student tests.
- Backend: contract suites updated for ACT expectations; `startup_migrations_smoke.rs` added (migration boot test); mutation_replay covers ACT.
- Tooling added by fork: `lighthouserc.cjs`, prettier-change check script + tests, Playwright config tests, `docs/agents/*` (domain/issue-tracker/triage-labels).

## 19. Union rewrite checklist (both lineages, nothing lost)

1. **Products:** IELTS (builder-based, band scores, human/objective review), SAT (normalized modules, adaptive routing, v1+v2 durability), ACT (builder-based + `science` section, seal-time science scoring, `act-science` reports) — all three must be first-class in the rewrite.
2. **Pick one canonical lineage per shared subsystem** using the §17.1 table; where behavior exists only on one side, port it; where both sides changed the same behavior, decide (tests from both suites become the gate).
3. **One migration sequence** — renumber/collide-check (the `0032` collision), re-create all CHECK constraints + triggers (0043), never guess from either branch’s numbering.
4. **One frontend** — the fork and the epic each contain a parallel student/admin/builder UI; merge *features* (ACT science, V2 client, delivery remediation, SAT room), not *files*. Use the union of component tests as the spec.
5. **Backend machinery** (Part A §0–§16) is lineage-agnostic and must be preserved regardless: clock authority + 30s grace, lock order, idempotency/outbox, triggers, live bus, ws leases, rate limits, retention, activity-driven mode.
6. **New ACT-specific must-preserve:** seal-time server-side ACT science scoring (never trust client score), `science` section plumbing across runtime/attempt/submission/grading rows, ACT-aware grading search, `act-science` reports endpoint + admin UI, ACT exam-type handling in builder/validation/serialization.
7. **Test gates:** run the *union* of both contract suites (epic’s incl. V2 proof tests; fork’s incl. ACT science + migrations smoke) as the equivalence gate for every ported subsystem.
8. **Migrate the repo topology too:** choose one remote as canonical (`origin` = ACT fork, other mirrors = epic lineage) or create a fresh repo; the current multi-remote setup (`origin`, `pee*`, plus Freebuff session branches) is a foot-gun.

## 20. Frontend map (both lineages, structured inventory)

> Depth note: Part A sessions mapped the frontend at feature/route level (verified); deep per-component behavior of either lineage’s UI is captured in its own test suites and is a further documentation pass if needed. This section gives the rewrite its map and pointers.

- **Stack (epic):** React SPA, Vite, TypeScript (~192k lines), Tailwind; `src/products/*` (product entry/route shells, e.g. `products/sat` → `SatSessionRoomRoute`), `src/features/*` (`student`, `student-delivery`, `builder`, `exam-authoring`, `proctor`, `admin`, `auth`), `src/services/*` (api client, `backendBridge`, `examDeliveryService`, `examLifecycleService`, `studentAttemptRepository`, `attemptCredentialAdapter`, mutation outbox, grading), `src/types/*` (domain.ts etc.), `src/components/*` (shared + student/admin/builder components), Playwright `e2e/` + Vitest unit suites, `invariant1.md` = BEX/FEX contract matrix, `vite.config.ts` (default backend `http://127.0.0.1:4001`).
- **Stack (ACT fork):** same stack; adds ACT product UI + its parallel refactor — 138 files differ from the merge-base (student highlights/interactions, admin grading UI incl. export buttons & print flows, builder ACT science, exam-authoring surfaces, services/types rework).
- **Route-level map (epic, verified):** `StudentSessionRoute` (IELTS student session), `student-delivery/routes/SatStudentSessionRoute` + `products/sat/routes/SatSessionRoomRoute` (SAT module room), builder/exam-authoring admin surfaces; websocket client on `/api/v1/ws/*path`.
- **Rewrite guidance for the frontend:** port the union of *features* with the union of component tests as the spec; TypeScript domain types already centralize the API contract (`src/types`) — regenerate them from the rewritten backend instead of hand-copying; the v1/v2 engine toggle (`VITE_USE_V2_DURABILITY_ENGINE`) and protocol_version must match the rewritten backend’s chosen durability protocol (Part A decision).
> **Per-component frontend map:** see `docs/frontend-rewrite-map.md` — behavior per component derived from the union of both lineages’ Vitest suites (student, builder IELTS/SAT/ACT, admin grading, exam-authoring, proctor), with component + suite file anchors.

## 21. Open questions for the rewrite (product decisions, not code gaps)

1. Canonical future product set: IELTS + SAT + ACT simultaneously? (Both lineages evolved as if they were the only product.)
2. Which grading model survives: epic’s projection-based IELTS grading vs fork’s ACT-science-augmented variant (union, presumably).
3. ACT exam modeling: keep ACT in the classic builder pipeline (fork’s choice) or normalize like SAT? Affects runtime sections, scoring, exports.
4. Which student UI implementation (epic student revamp vs fork highlight/interaction suite) becomes the base.
5. Migration strategy for a live DB with both `0032` migrations ever applied? (If ACT ran in production, its schema has ACT checks; the epic’s SAT schema has SAT tables — a real environment must be audited before renumbering.)
6. Durability protocol for ACT: v1-only today (fork predates V2) — adopt v2 for ACT too, or keep per-exam protocol flags.

---

*End of Part B. Part A (§0–§16) above remains the verified map of the epic lineage; Part B adds the ACT fork so the rewrite can be planned against the union.*

---

## 22. Backend file-coverage audit (epic lineage; 118 source files)

Method: every `*.rs` under `backend/crates/{domain,application,infrastructure,api,worker}/src` (test dirs excluded) mapped to the doc sections that mention it (stem match). 105 files carry ≥1 direct reference; the 13 without are described in §22.2. Fork-lineage additions are covered in Part B (§17–§21). Index entries use `crate:path`.

### 22.1 domain (19)

- `domain:src/answer_history.rs` — §4, §15, §17
- `domain:src/assessment/attempt.rs` — §0, §2
- `domain:src/assessment/content.rs` — §0, §4, §6
- `domain:src/assessment/delivery.rs` — §0, §4, §5, §6
- `domain:src/assessment/mod.rs` — §0, §1, §3, §4
- `domain:src/assessment/question.rs` — §4
- `domain:src/assessment/result.rs` — §4, §6
- `domain:src/assessment/structure.rs` — §1, §2, §5, §6
- `domain:src/attempt.rs` — §0, §2
- `domain:src/auth.rs` — §0, §3, §4
- `domain:src/durability_v2.rs` — §8, §15
- `domain:src/exam.rs` — §0, §3, §4
- `domain:src/exam_provider/mod.rs` — §0, §1, §3, §4
- `domain:src/exam_provider/registry.rs` — see 22.2
- `domain:src/exam_provider/sat.rs` — §0, §4, §6
- `domain:src/grading.rs` — §0, §1, §4
- `domain:src/lib.rs` — §4, §9
- `domain:src/library.rs` — §4
- `domain:src/schedule.rs` — §3, §4

### 22.1 application (32)

- `application:src/adaptive_routing.rs` — see 22.2
- `application:src/answer_history.rs` — §4, §15, §17
- `application:src/assessment_access_links.rs` — §4
- `application:src/assessment_authoring.rs` — see 22.2
- `application:src/assessment_delivery.rs` — §4, §11
- `application:src/assessment_release.rs` — §4
- `application:src/assessment_scoring.rs` — §6
- `application:src/auth.rs` — §0, §3, §4
- `application:src/builder.rs` — §4, §6, §15, §17
- `application:src/delivery/mod.rs` — §0, §1, §3, §4
- `application:src/delivery/mutation_batch.rs` — §4, §5
- `application:src/delivery/ports.rs` — §4, §6, §10, §17
- `application:src/delivery/response_durability_v2.rs` — §15
- `application:src/delivery/session_context.rs` — see 22.2
- `application:src/delivery/submit_attempt.rs` — §4
- `application:src/grading/mod.rs` — §0, §1, §3, §4
- `application:src/grading/objective_integrity.rs` — see 22.2
- `application:src/grading/ports.rs` — §4, §6, §10, §17
- `application:src/grading/projection_sync.rs` — see 22.2
- `application:src/grading/review_actions.rs` — see 22.2
- `application:src/grading/session_queries.rs` — see 22.2
- `application:src/lib.rs` — §4, §9
- `application:src/library.rs` — §4
- `application:src/media.rs` — §0, §1, §4
- `application:src/proctoring.rs` — §5, §6, §11
- `application:src/results.rs` — §4, §6
- `application:src/sat_workbook.rs` — §6
- `application:src/scheduling.rs` — §15, §17
- `application:src/student_access/mod.rs` — §0, §1, §3, §4
- `application:src/student_access/repository.rs` — §5
- `application:src/validation.rs` — §4, §6, §7
- `application:src/version_serializer.rs` — §17

### 22.1 infrastructure (20)

- `infrastructure:src/actor_context.rs` — see 22.2
- `infrastructure:src/auth.rs` — §0, §3, §4
- `infrastructure:src/authorization.rs` — §3
- `infrastructure:src/cache.rs` — §1, §10
- `infrastructure:src/config.rs` — §1, §2, §4
- `infrastructure:src/database_monitor.rs` — see 22.2
- `infrastructure:src/distributed_rate_limit.rs` — §5
- `infrastructure:src/idempotency.rs` — §0, §1, §4, §5, §6
- `infrastructure:src/lib.rs` — §4, §9
- `infrastructure:src/live_mode.rs` — §4, §6
- `infrastructure:src/live_update_bus.rs` — see 22.2
- `infrastructure:src/migrations.rs` — §0, §1, §6, §13, §15, §18
- `infrastructure:src/object_store.rs` — §1
- `infrastructure:src/outbox.rs` — §0, §1, §2, §5
- `infrastructure:src/pool.rs` — §1, §2, §5, §10, §15
- `infrastructure:src/rate_limit.rs` — §5
- `infrastructure:src/telemetry.rs` — §4, §7, §10, §12
- `infrastructure:src/tracing.rs` — §12
- `infrastructure:src/tx.rs` — §4, §5, §6
- `infrastructure:src/websocket_lease.rs` — see 22.2

### 22.1 api (41)

- `api:src/background.rs` — §1, §5, §6, §10, §11
- `api:src/background/coordinator.rs` — §1
- `api:src/bin/backfill_objective_auto_grading.rs` — §4
- `api:src/bin/cleanup_exam_type.rs` — §4
- `api:src/bin/e2e_provision_staff.rs` — §4
- `api:src/bin/e2e_seed.rs` — §4
- `api:src/bin/migrate.rs` — §0, §1, §4
- `api:src/bin/reset_exam_migration.rs` — §4
- `api:src/bin/reset_legacy_sub_answers.rs` — §4
- `api:src/frontend.rs` — §0, §4, §6, §14
- `api:src/http/auth.rs` — §0, §3, §4
- `api:src/http/error.rs` — §0, §5
- `api:src/http/pagination.rs` — §4
- `api:src/http/rate_limit.rs` — §5
- `api:src/http/request_id.rs` — §9
- `api:src/http/response.rs` — §0, §4
- `api:src/lib.rs` — §4, §9
- `api:src/live_updates.rs` — §11
- `api:src/main.rs` — §0, §1, §3, §4
- `api:src/router.rs` — §4, §14, §17
- `api:src/routes/answer_history.rs` — §4, §15, §17
- `api:src/routes/assessment_access_links.rs` — §4
- `api:src/routes/assessment_authoring.rs` — see 22.2
- `api:src/routes/assessment_delivery.rs` — §4, §11
- `api:src/routes/assessment_release.rs` — §4
- `api:src/routes/auth.rs` — §0, §3, §4
- `api:src/routes/exams.rs` — §4
- `api:src/routes/grading.rs` — §0, §1, §4
- `api:src/routes/health.rs` — §1, §4
- `api:src/routes/library.rs` — §4
- `api:src/routes/media.rs` — §0, §1, §4
- `api:src/routes/mod.rs` — §0, §1, §3, §4
- `api:src/routes/proctor.rs` — §4, §5, §6
- `api:src/routes/results.rs` — §4, §6
- `api:src/routes/schedules.rs` — §4
- `api:src/routes/settings.rs` — §4, §6
- `api:src/routes/student.rs` — §0, §3, §4
- `api:src/routes/student_v2.rs` — §4
- `api:src/routes/ws.rs` — §2, §3, §4
- `api:src/runtime_auto_advance.rs` — §1, §6, §11
- `api:src/state.rs` — §0, §1, §4, §6

### 22.1 worker (6)

- `worker:src/jobs/grading_projection.rs` — §10
- `worker:src/jobs/media.rs` — §0, §1, §4
- `worker:src/jobs/outbox.rs` — §0, §1, §2, §5
- `worker:src/jobs/retention.rs` — §0, §1, §2, §10, §15
- `worker:src/lib.rs` — §4, §9
- `worker:src/main.rs` — §0, §1, §3, §4

### 22.2 The 13 files without literal doc mentions (now mapped)

| File | What it is | Doc home |
|---|---|---|
| `api:routes/assessment_authoring.rs` | HTTP handlers for SAT authoring: get_authoring_shell/open_authoring_shell/preview, question CRUD+batch+bulk, workbook template/preview/commit/undo, sample load, validate, duplicate, reorder, delivery settings | §4.4 (§-mapped handlers) |
| `application:src/assessment_authoring.rs` | SAT authoring service (~1.9k lines): authoring/section/module/routing shells, preview projection, question summaries/detail, validation report, bulk/reorder/duplicate, workbook commit & undo state | §4.4, §6.2 |
| `application:src/adaptive_routing.rs` | AdaptiveRoute + RoutingError + AdaptiveRoutingPolicy trait + PracticeThresholdRouting (route decision from raw-correct threshold) | §6.7 |
| `application:src/delivery/session_context.rs` | 4-line marker stub `SessionContextUseCase` — logic lives in delivery/mod.rs (half-applied modularization) | §7/§8 |
| `application:src/grading/review_actions.rs` | 4-line marker stub `ReviewActionsUseCase` — logic lives in grading/mod.rs | §6.6 |
| `application:src/grading/session_queries.rs` | 4-line marker stub `SessionQueriesUseCase` — logic lives in grading/mod.rs | §4.13/§6.6 |
| `application:src/grading/projection_sync.rs` | 4-line marker stub `ProjectionSyncUseCase` — logic in grading/mod.rs + worker grading_projection | §10.2 |
| `application:src/grading/objective_integrity.rs` | Objective answer-key integrity engine: answer_key_issue (InvalidAnswerKey/MissingAnswerKey/AnswerKeyViolatesScoringRule), malformed answers, strict_text_values, max_word_count, AMBIGUOUS_SECTION_MAPPING | §6.6 |
| `domain:src/exam_provider/registry.rs` | 10-line registry: `provider_for(&str) -> Option<&dyn ExamProvider>` | §6.1/§6.2 |
| `infrastructure:src/actor_context.rs` | ActorRole/AccessScope/ActorContext + builders (schedule scope, student-key scope, is_platform_write) | §3 |
| `infrastructure:src/database_monitor.rs` | Health/telemetry inspections: ping_database, inspect_outbox_backlog, inspect_storage_budget, grading-projection snapshot; StorageBudgetLevel/Thresholds | §10.1/§12 |
| `infrastructure:src/live_update_bus.rs` | LiveUpdateBusRepository: enqueue / enqueue_in_tx / poll_after / latest_sequence_id / purge_older_than_hours | §5.4, §11 |
| `infrastructure:src/websocket_lease.rs` | WebsocketLeaseRepository: acquire (caps) / release / heartbeat / cleanup_expired over websocket_connection_leases | §11 |

---
*End of coverage audit appendix.*

## 23. God-file decomposition — delivery/mod.rs & grading/mod.rs (function-level inventory)

> Method: every `fn` declaration was extracted with its line (epic `9b4414a`). Delivery/mod.rs = 6 405 lines with 134 fn declarations (≈74 production + ≈60 unit tests); grading/mod.rs = 7 324 lines with 167 fn declarations (≈95 production + ≈72 unit tests, some in-method helpers). Line anchors below are the first/last fn of each cluster; the four 4-line stubs (§22.2) were *meant* to hold several of these clusters — see §23.3. Test regions are behavior specs: move them with the code they pin.

### 23.1 delivery/mod.rs clusters
| Cluster | Lines | Key functions (production) | Responsibility | Doc | Future home |
|---|---|---|---|---|---|
| A. Terminalization & seal | 135–856 | `terminalization_intent_is_compatible`, `build_terminal_snapshot`, `sat_terminal_outcome_status`, `materialize_sat_terminal_result_in_tx`, `load_terminalization_in_tx`, `lock_schedule_terminalization_scope_in_tx`, `lock_attempt_terminalization_scope_in_tx`, `lock_sat_modules_in_tx`, `build_server_terminal_snapshot`, `seal_attempt_in_tx` | single-writer terminal fact: replay-or-conflict, immutable receipt, SAT module lock & result materialization, legacy JSON projection | §9.1, §9.2, §6.7 | delivery/terminalization |
| B. Provider-writer helpers | 256–358 | `claim_provider_attempt_writer_in_tx`, `mark_provider_attempt_exam_phase_in_tx`, `increment_provider_attempt_answer_revision_in_tx`, `sync_v2_runtime_timing_in_tx`, `extend_v2_attempt_deadline_in_tx` | v1/v2 shared row mutation primitives + v2 deadline/control projection | §6.4, §8.1 | delivery/provider_writes |
| C. Errors & scoping | 856–938 | `DeliveryError::{conflict, conflict_reason, conflict_reason_code}`, `ensure_student_key_scope`, `delivery_status_is_terminal`, `attempt_owner_matches_actor`, `attempt_owner_for_actor`, `map_scheduling_error` | error vocabulary + student-key/authz re-checks at the data boundary | §5.1, §3 | delivery/errors |
| D. Service config & write gate | 939–1091 | `DeliveryService::{from_config,new,with_auth,with_runtime_tuning,with_auth_runtime_tuning}`, `runtime_tuning`, `auth_service`, `lock_runtime_write_gate_tx` | construction/tuning; the authoritative runtime window gate (deadline/grace/section/proctor) | §1, §2, §6.4 | delivery/runtime_gate |
| E. Session-context reads | 1092–1196 | `get_session_context`, `get_session_context_with_attempt_credential`, `get_static_session_context`, `get_live_session_context` | session read model assembly — **matches stub `delivery/session_context.rs`** | §4.10, §6.5 | session_context |
| F. Precheck & attempt creation | 1197–1525 | `persist_precheck` | atomic attempt creation + audit + idempotency (protocol_version stamped here) | §4.10, §6.5 | session_context |
| G. Bootstrap & credential | 1526–1691 | `bootstrap`, `bootstrap_with_attempt_credential`, `attach_attempt_credential` | create-or-fetch attempt + attempt-token issuance | §4.10, §3 | session_context |
| H. Mutation batch dispatch | 1692–2179 | `apply_mutation_batch`, `apply_mutation_batch_at` | v1 batch entry (with `delivery/mutation_batch.rs` + v2 in `response_durability_v2.rs`) | §7.2, §8.2 | delivery/mutation_batch |
| I. Heartbeat & presence | 2180–2464 | `record_heartbeat` | heartbeat/network events, throttling, alerts | §4.10, §6.5, §11 | delivery/presence |
| J. Submit | 2465–2881 | `submit_attempt`, `submit_attempt_with_metadata` | v1/v2 submit orchestration (with `delivery/submit_attempt.rs`) | §7.4, §8.3 | delivery/submit_attempt |
| K. Attempt load/claim internals | 2882–3437 | `get_or_create_attempt(_on)`, `update_attempt(_on_connection, _preserving_revision)`, `load_schedule`, `load_version`, `load_runtime`, `load_attempt_by_student_key/_by_wcode/_by_id(_for_update)`, `load_registration_by_student_key` | row acquisition & single-writer claim primitives | §6.5, §0 (#3 lock order) | session_context/claims |
| L. Idempotency & route keys | 3438–3581 | `idempotency_repository`, `idempotency_request_hash`, `lookup/store_idempotent_response(_on_connection)`, `derive_student_key`, `*_route_key` | idempotency-key semantics re-checked under row locks | §5.3 | infrastructure/idempotency (already) |
| M. Auto-submit & repair | 3582–3772 | `auto_submit_schedule_attempts_in_tx`, `finalize_pending_schedule_attempts`, `repair_sat_terminal_results`, `force_finalize_attempt_if_pending` | cohort auto-submit (dedupe-guarded outbox) + SAT terminal-result healing | §6.4, §8.3, §10.1 | delivery/finalize |
| N. Submit response & batch validation | 3773–4001 | `build_submit_response`, `determine_phase`, `first_enabled_module`, `validate_batch_sequences/_mutation_ids`, `validate_contiguous_sequences` | response shaping + seq/mutation-id validation | §7.2, §7.4 | mutation_batch |
| O. Mutation application core | 4002–4994 | `objective_mutation_gate` (+`allow/block`), `derive_authoritative_phase`, answer-schema builders (`build_answer_schema`, `register_section/_sub_answer_tree_constraints`, `slots_for_constraint` …), `apply_mutation`, `apply_final_answer_patch`, merge/set helpers | per-command semantics: schema-derived slots, section gates, newest-wins, JSON merge rules | §7.2 (v1 semantics) | mutation_batch |
| T. Unit tests | 4995–6379 | ≈60 tests: mutation gates (runtime deadline/proctor state, trusted ingress), answer schema indexing (reading slots, roman headings, sub-answer trees, MC limits), apply rules (positions/telemetry, unknown-id ignore, command-style set/clear), terminalization compatibility | behavior spec — move with O/B/A | §7 | same as code |

### 23.2 grading/mod.rs clusters
| Cluster | Lines | Key functions | Responsibility | Doc | Future home |
|---|---|---|---|---|---|
| A. Session queries | 1–458 | `preview_runtime_exclusion_sql`, `list_sessions_query_parts`, `list_sessions_query`, `ensure_grading_writer`, `maybe_sync_on_read`, `ensure_can_grade_schedule`, `list_sessions(_page)`, `get_session_detail(_page)` | grading session list/detail SQL + preview-runtime exclusion + read-fallback sync — **matches stub `grading/session_queries.rs`** | §4.13, §6.6 | session_queries |
| B. Submission reads | 459–634 | `get_submission_summary/_sections/_writing_tasks/_bundle`, `override_objective_question` (entry) | read model projections for review UI | §6.6 | session_queries |
| C. Review workflow | 635–1097, 1369–1607 | `start_review`, `get_review_draft`, `save_review_draft`, `mark_grading_complete`, `mark_ready_to_release`, `reopen_review`, `release_now`, `schedule_release`, `transition_release_status`, `ensure_valid_release_transition`, `insert_review_event` | state machine + release gates + events — **matches stub `grading/review_actions.rs`** | §6.6 | review_actions |
| D. Results & analytics | 1282–1368 | `list_results`, `get_result`, `get_result_events`, `analytics`, `export_results` | results surface (see also application/results.rs) | §4.14, §6.6 | results |
| E. Objective-integrity gates | 1429–1607 | `ensure_objective_integrity_for_submission`, `lock_and_validate_objective_integrity_for_submission` | per-submission integrity lock+validate (engine helpers already in `grading/objective_integrity.rs`) | §6.6 | objective_integrity |
| F. Projection cycle | 1608–1666, 2645–3204 | `run_projection_cycle`, `ensure_materialized_state`, `sync_sessions_from_schedules`, `sync_submissions_from_attempts`, `ensure_section_submissions(_with_mode/_objective_section_submissions)`, `reopen_after_objective_regrade`, `refresh_session_counters_for_schedules`, `backfill_objective_auto_grading_from_snapshots` | incremental read-model sync (worker runs the same `run_projection_cycle`; CAS watermark in shared_cache) — **matches stub `grading/projection_sync.rs`** | §10.2 | projection_sync |
| G. Overrides & grading source | 1667–2644 | `backfill_objective_auto_grading`, `regrade_schedule/exam_objectives_from_latest_draft`, `list_schedule_objective_overrides`, `get_schedule_objective_grading_source_version_id`, `get_objective_integrity_overview`, `upsert/delete_schedule_objective_override`, `append_schedule_override_event`, `upsert/load_schedule_objective_grading_source` | per-schedule/per-question overrides + grading-source pinning | §4.13, §6.6 | overrides |
| H. Shared mapping helpers | 3205–4192 | `student_submission_query`, `question_number`, `append_result_scope`, `append_projection_cursor`, `build_section_sync_specs`, `map_schedule_status`, writing-task normalization/descriptors, objective-section indexers (`build_objective_answer_sections`, `register_block_slot_sections` …) | SQL + content-shape mapping shared by F/G/B | §6.6 | shared |
| I. Objective auto-grading engine | 4193–5750 | `ObjectiveAnswerSpec::{matches,awarded_score}`, exact-text/shared-sentence normalization & matching, `compute_objective_auto_grading_results`, scoring-spec builders (text/choice/multi-MC/sub-answer-tree), overrides application, `recalculate_objective_totals`, quarantine rules (unsupported/ambiguous mapping), `mark_duplicate_objective_spec` | the objective grading rules engine (with `grading/objective_integrity.rs`) | §6.6 | objective_grading |
| J. Band & writing result builders | ~7143–7324 | `build_section_bands`, `extract_overall_band`, `average_band`, `build_writing_results(_result)` | IELTS band aggregation & writing review-result payloads | §6.6 | review/results |
| T. Unit tests | 5751–~7111 | ≈60 tests: release integrity gates (override requirement, verified audit, obsolete source), objective rules (one-word rule, missing key, blank verified, malformed key quarantine, unsupported types, ambiguous mapping, shared-sentence permutations/consumption/case, multi-MC, word limits, unicode whitespace), sync plan excludes writing/speaking | behavior spec — move with I/E/C | §6.6 | same as code |

### 23.3 Stub ↔ real-code mapping (the split the stubs intended)
| Stub (4-line) | Real logic today (this section) | To complete the split, move |
|---|---|---|
| `delivery/session_context.rs` | 23.1 E, F, G, K | session reads, precheck/bootstrap creation, attempt load/claim internals |
| `grading/session_queries.rs` | 23.2 A, B | list/detail query assembly + submission read projections |
| `grading/review_actions.rs` | 23.2 C (+ J) | review state machine, release gates, events, band/writing builders |
| `grading/projection_sync.rs` | 23.2 F | projection cycle + materializers (share with worker job) |
| *(no stub)* | 23.1 A/B/I/J/M, 23.2 E/I | candidate new modules: terminalization, presence, finalize, objective_grading |

**Do-not-break rules when decomposing:** (1) each cluster runs inside the same transaction as its callers today — preserve tx boundaries when moving code; (2) the write-path clusters (23.1 A/B/O) are locked behind `lock_runtime_write_gate_tx`/row locks — the lock order attempt → runtime → active section must stay in one transaction; (3) grading tests (§23.2 T) encode release gates & objective rules — they must move with the code, not be regenerated; (4) `objective_integrity.rs` already exists — finish by moving 23.2 E callers + I helpers next to it.
---
*End of §23 god-file decomposition.*
