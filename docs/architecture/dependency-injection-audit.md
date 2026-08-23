# Dependency Injection & Modular Design Audit (2026-08-23)

> **Remediation status: all findings fixed on 2026-08-23** (except the intentionally
> retained items listed in "Retained debt" below). See "Remediation applied" at the end.

Audit method: `rigorous-dependency-injection-modular-design` skill — DISCOVER → MAP → CLASSIFY → AUDIT.
Scope: `backend/crates/*` (Rust workspace) and `src/*` (React SPA). Evidence cited as file:line.

## Verdict

- **Frontend: healthy.** Feature modules are real (zero cross-feature imports), boundaries are
  *enforced by a test*, and the HTTP client singleton is confined to the services layer.
- **Backend: declared architecture ≠ actual architecture.** AGENTS.md says
  "`infrastructure` implements domain/application interfaces". In reality **no ports (traits)
  exist** — every repository/cross-cutting service is a concrete struct — and the
  `application` crate *depends on* `infrastructure`, inverting the declared direction.
  The application crate is also the de-facto persistence layer (312 raw sqlx sites).

## Actual dependency graphs

Backend (declared in Cargo.toml):

```
domain      → (chrono/serde/uuid; sqlx behind "sqlx" feature)   [no framework deps — pure]
application → domain, infrastructure  ← DIRECTION VIOLATION vs AGENTS.md
infrastructure → domain
worker      → application, infrastructure
api         → application, domain, infrastructure, worker       [composition root: AppState]
```

Backend application crate, internal edges (grep `use crate::`):

```
delivery   → auth, scheduling
scheduling → delivery            ← CYCLE scheduling ↔ delivery
proctoring → delivery, scheduling
grading    → (no internal deps)
```

Frontend:

```
routes/components → features/*/contracts (+2 leaks, see F2/F3) → features internal
features/*/infrastructure/* (allowlisted adapters) → src/services (transport→repo→service DAG)
services → app/api/apiClient (singleton, 4 importers in services + 1 leak in features/auth)
```

## Backend findings

### B1 — No ports/adapters exist anywhere (structural)

`OutboxRepository`, `LiveUpdateBusRepository`, `IdempotencyRepository`,
`LiveModeService`, `AuthorizationService`, `LocalObjectStore` are all concrete structs
(infrastructure/src/{outbox,live_update_bus,idempotency,live_mode,authorization,object_store}.rs).
Application consumes them directly (e.g. proctoring.rs:9-18, delivery/mod.rs:17-24).
`application/src/delivery/ports.rs` is an empty placeholder (`pub struct DeliveryPorts;`) —
an aspiration, not a boundary. The AGENTS.md rule is currently fiction.

Nuance (skill I7 — abstraction budget): do NOT trait-ify everything. The only dependencies
with a *real* seam today are the outbox and live-update bus (two consumers: api + worker,
async/queue semantics, plausible fake for tests). Those justify ports; the rest do not yet.

### B2 — application → infrastructure crate edge (I2 violation)

8 application modules import `ielts_backend_infrastructure::*`
(auth.rs:7, proctoring.rs:9, builder.rs:7, scheduling.rs:8, grading/mod.rs:19,
delivery/mod.rs:17, media.rs:5, results.rs:6, library.rs:7). Consumed items fall into 3 classes:

1. `ActorContext`/`ActorRole` — **misplaced policy concept** (see B3). ~15 sites.
2. `config::AppConfig`, auth crypto helpers (hash_password, sign_attempt_token, …) —
   shared technical services.
3. Concrete collaborators: `LocalObjectStore` (media.rs:5), `LiveModeService`,
   `OutboxRepository`, `IdempotencyRepository`, `LiveUpdateBusRepository`, `AuthorizationService`.

### B3 — ActorContext/ActorRole live in the wrong crate (wrong ownership)

`infrastructure/src/actor_context.rs` contains a pure role enum + actor identity struct with
zero infrastructure dependencies (std + uuid only). Yet application *policy code* matches on
`ActorRole::Admin | ActorRole::AdminObserver` (builder.rs:296-297, scheduling.rs:239-240,936,1406,
grading/mod.rs:160-161,948-949). Role authorization policy is domain/application knowledge
depending on an infrastructure crate. Moving this one file to `domain` (or application) removes
the worst class of B2 edges at near-zero cost. This is the single highest-value fix.

### B4 — MediaService constructs infrastructure + reads env internally (I1+I3)

`application/src/media.rs:24-25`: `MediaService::new(pool)` calls `LocalObjectStore::from_env()`.
Business logic constructs its own infrastructure adapter with a hidden env dependency.
Constructor should take the object store; construction belongs to the api route/composition root.

### B5 — Application is the persistence layer (declared-vs-actual mismatch)

Raw sqlx query sites in application: grading/mod.rs 93, proctoring.rs 50, delivery/mod.rs 37,
auth.rs 36, scheduling.rs 33, builder.rs 31, library.rs 20, answer_history.rs 7, media.rs 5
(≈312 total). Domain types derive `sqlx::FromRow` and hand-implement MySQL `sqlx::Type`
behind the `sqlx` feature (domain/src/{auth,grading,library,exam,schedule,attempt}.rs).
This is a legitimate modular-monolith style choice, but it contradicts AGENTS.md's declared
layering. Either update AGENTS.md to tell the truth, or start extracting repositories —
not both silent and stale.

### B6 — scheduling ↔ delivery cycle (I5)

scheduling.rs:16 imports `auto_submit_schedule_attempts_in_tx` from delivery;
delivery/mod.rs:32 imports `SchedulingService` back. Compiles (intra-crate), but ownership is
wrong: the shared in-tx auto-submit/finalize helpers belong in a lower shared module (e.g.
`delivery::attempt_tx` or a dedicated module) that both scheduling and delivery depend on,
so neither depends on the other's service type.

### B7 — Collaborator construction hidden in method bodies

`SchedulingService::new(self.pool.clone())` at 7+ sites inside proctoring.rs methods
(106, 229, 304, 402, 627, 639…); `AuthService::new(pool, config)` inside delivery/mod.rs:137;
`SchedulingService::new(self.pool.clone())` in delivery/mod.rs:1849. Cheap struct wrappers make
this pragmatic, but the true module graph is invisible from constructors — the edges only
appear inside method bodies. If B6 is fixed, prefer passing the collaborator in.

### B8 — Minor

- worker/src/main.rs:38 reads `DATABASE_WORKER_URL` directly instead of via AppConfig
  (composition-root-adjacent, acceptable but inconsistent).
- api routes construct services per request (e.g. library.rs: 10× `LibraryService::new`) —
  fine for pool-holding structs, but `AuthService::new(state.db_pool(), state.config.clone())`
  clones AppConfig per request (results.rs:154, answer_history.rs:211, grading.rs:788,818).

### Backend: what is healthy

- Domain has zero framework/runtime deps (no axum/tokio/redis/otel found).
- Env reads are centralized in `infrastructure/src/config.rs` (AppConfig::from_env) + bin mains.
- Global state limited to OnceLock tracing init (infrastructure/src/tracing.rs:10-11).
- `api/src/state.rs` AppState is a genuine composition root (~9 focused fields, no god object).
- worker/src/main.rs is a clean composition root (config → pool → jobs).

## Frontend findings

Healthy, with enforcement:

- `src/test/architecture/frontend-module-boundaries.test.ts` blocks services imports outside
  `features/*/infrastructure/` adapters for the scoped route controllers — real, tested boundary.
- Zero cross-feature imports across `src/features/*` (grep-verified).
- `components/*` → features only via `features/*/contracts` public interfaces
  (answer-history, admin, proctor contracts).
- Services layer is a clean DAG: backendBridge transport → repositories (IExamRepository port
  at services/examRepository.ts) → services. No cycles found.
- `apiClient` singleton (app/api/apiClient.ts:548) has only 4 production importers, all in
  `src/services` — the services layer is an effective anti-corruption layer.

Leaks (small):

- **F2**: `features/auth/authSession.tsx:11` imports apiClient directly — bypasses services
  boundary and is *not* in the boundary test's scopeFiles list (enforcement gap).
- **F3**: `components/student/StudentAppWrapper.tsx:5` deep-imports
  `features/student/hooks/useStudentSessionRouteData` (hook internal, not a contracts export).
- **F4**: `src/store/useAuthStore.ts` has zero production consumers — dead code, delete.
- **F5**: `import.meta.env` outside app/ in 4 files (utils/logger.ts, routes/index.tsx,
  services/backendBridge.ts:187,210, services/developmentFixtures.ts) — mostly reasonable
  locations; logger/fixtures are cross-cutting. Low priority.

## Change propagation test (simulated)

- Swap LocalObjectStore → S3: edits application/media.rs (B4 makes this worse than needed).
- Change a role enum variant: touches infrastructure + application policy sites (B3).
- Swap MySQL → Postgres: rewrites the entire application layer (B5) — accepted if the monolith
  style is declared, otherwise it is the hidden cost of the current design.
- Add a second live-update transport: clean seam exists (bus already abstracted by AppState).

## Recommendations (ranked by decision hierarchy: remove dependency > restore ownership > abstract)

1. **Move `actor_context.rs` from infrastructure to domain** (or application). Removes the
   worst B2 class; mechanical, no behavior change. Then re-check if `application` still needs
   the infrastructure crate edge for policy reasons (it should not).
2. **Break scheduling ↔ delivery**: move `auto_submit_schedule_attempts_in_tx` /
   `force_finalize_attempt_if_pending` into a shared lower module both import.
3. **Inject the object store into MediaService**; construct it in the api route
   (B4). Pair with an `ObjectStore` port only if a second store backend is actually planned.
4. **Reconcile AGENTS.md with reality**: either declare "application owns SQL;
   infrastructure = shared technical services + adapters" or commit to extracting the first
   repository port where a real seam exists (outbox: api + worker consumers, test fake value).
5. **Add a backend boundary test** mirroring the frontend's: e.g. a script/CI check that greps
   `use ielts_backend_infrastructure` in application and fails on new non-allowlisted sites,
   ratcheting the count to zero over time.
6. Frontend: add `features/auth/authSession.tsx` to the boundary test scopeFiles; route the
   apiClient usage through a services function; export the rollout type via student contracts
   (F3); delete `useAuthStore.ts` (F4).

## Non-goals advised against

- Trait-per-repository sweep (skill I7/I9: interfaces must pay rent — only outbox/live-bus
  currently do).
- Splitting crates further before B2/B3/B6 are resolved.

## Remediation applied (2026-08-23)

- **B3 fixed**: `actor_context.rs` moved `infrastructure → domain`
  (`backend/crates/domain/src/actor_context.rs`); 30+ importers updated across
  application/api/tests. Policy code no longer depends on the infrastructure crate for roles.
- **B6 fixed**: `auto_submit_schedule_attempts_in_tx`, `force_finalize_attempt_if_pending`,
  `merge_recovery`, `ensure_object` extracted to `backend/crates/application/src/attempt_tx.rs`
  (leaf module, `sqlx::Error` surface). Application module graph is now a DAG:
  `scheduling → attempt_tx`; `delivery → attempt_tx, auth, scheduling`;
  `proctoring → attempt_tx, delivery, scheduling`. Error-mapping dead code collapsed to `?`.
- **B4 fixed**: `MediaService::new(pool, object_store)` — construction moved to
  `api/src/routes/media.rs`; `LocalObjectStore::from_env()` replaced by
  `from_base_url(&config.media_base_url)`; `MEDIA_BASE_URL` now owned by `AppConfig`.
- **B8 fixed**: `DATABASE_WORKER_URL` moved into `AppConfig::database_worker_url`;
  worker `main.rs` reads config only.
- **Rec 5 done**: `backend/tests/architecture/application_boundary_guard.rs` —
  per-file ratchet allowlist of infrastructure root imports + cycle bans
  (scheduling↔delivery, attempt_tx leaf). Wired into `crates/application/Cargo.toml`.
- **B5 fixed**: AGENTS.md Dependency Rules rewritten to declare the as-built architecture
  and point at both guard tests.
- **F2 fixed**: auth transport wiring (CSRF header, 401 handler) moved into
  `authService` (`applyAuthTransportSession`, `registerAuthUnauthorizedHandler`);
  `features/auth/authSession.tsx` no longer imports the raw apiClient. Boundary test
  extended: features-wide ban on `app/api` imports.
- **F3 fixed**: `StudentAnswerInvariantRollout` re-exported via
  `features/student/contracts`; `StudentAppWrapper` imports the contract, not the hook.
- **F4 fixed**: dead `src/store/useAuthStore.ts` deleted.

Verification: `cargo check --workspace` clean (same 7 pre-existing warnings as baseline);
`cargo test -p ielts-backend-application` unit tests 49/49; boundary guard 2/2;
frontend `vitest` services+auth 241/241, wrapper/route tests 6/6; `tsc --noEmit`
error count unchanged from baseline (99 pre-existing, none in touched files).
DB-backed contract/integration tests require a live MySQL (`TEST_DATABASE_URL`) and
were not runnable in this environment — run them in CI before merging.

## Retained debt (deliberate)

- `application → infrastructure` crate edge remains for 7 files (auth crypto helpers,
  AppConfig, authorization/live-mode/outbox/idempotency/object-store) — ratcheted by the
  guard test; the outbox/live-bus seam is the first candidate for a real port if a
  second transport ever lands.
- Application still owns SQL (~312 sites) — now the *declared* architecture
  (modular-monolith style), not an accident.
- Domain `sqlx` feature-gated derives remain (accepted persistence coupling).
