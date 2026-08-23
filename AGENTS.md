# Codebase Guide for AI Agents

## System Type
This repository is a modularizing monolith for an online exam platform.

## Mission
Do not only patch code. Improve the repository's memory so future changes are safer.

## Main Rule
Never change behavior before identifying the owning module and invariants.

## Required Development Loop
1. Map ownership and boundaries.
2. Reproduce with a focused test or script.
3. Implement the smallest safe change.
4. Verify with relevant tests/checks.
5. Add memory artifact (test/doc/script/log policy).
6. Compress if local complexity is growing.

## Dependency Rules
- Prefer module-local changes over cross-cutting edits.
- Do not import another module's internal files.
- Expose inter-module behavior via explicit public interfaces.
- Keep dependency direction one-way where possible:
  - `api/worker -> application -> domain`
  - `infrastructure -> domain` (shared technical services: config, crypto, telemetry, repositories for cross-cutting concerns)
- Backend layering (declared as-built, 2026-08):
  - `domain` owns business types and the actor/role policy concepts (`domain::actor_context`).
  - `application` owns use cases AND their SQL (modular-monolith style). Infrastructure imports from application are a ratcheted legacy debt: `backend/tests/architecture/application_boundary_guard.rs` pins the exact allowlist. Never add a new entry without an architecture note.
  - Shared attempt-transaction helpers live in `application::attempt_tx`, a leaf module; do not recreate scheduling/delivery cycles (enforced by the same guard test).
  - All env access goes through `infrastructure::config::AppConfig` (plus `bin/*` composition mains). Never read env inside application/domain business logic.
  - Infrastructure construction (pools, object stores) happens at composition roots (`api/src/state.rs`, route handlers, worker `main.rs`), never inside application service constructors.
- Frontend layering (enforced by `src/test/architecture/frontend-module-boundaries.test.ts`):
  - Features never import each other; consumers reach features only via `features/*/contracts`.
  - Only `src/services` may import the raw API client; features use service functions.
  - Feature route controllers reach services only through `features/*/infrastructure` adapters.

## Critical Invariants
- Submitted exam answers are immutable.
- Autosave must be idempotent.
- Student-visible "saved/verified" state must match persisted reality.
- Timer fairness must not be bypassed by reload/refresh.
- Integrity and audit events must be append-only and traceable.

## Dangerous Areas
- Exam submission and autosave flows.
- Session recovery/reconnect behavior.
- Grading mutation and publication workflows.
- Permission/role boundary checks.
- Payment confirmation and retries.

## Mandatory Before/After Checklist
Before editing:
1. Read module docs and relevant tests.
2. Identify "must not break" behavior.
3. Add or update failing characterization test when behavior is unclear.

After editing:
1. Run targeted tests and report results.
2. Add or update at least one memory artifact:
   - regression test
   - failure-case note
   - diagnostic script
   - architecture decision note
3. If behavior changed, update module docs.

## Compression Rule
If 3+ tactical patches accumulate in one area, stop patching and propose a local abstraction/refactor.
