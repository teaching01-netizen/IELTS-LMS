# Phase 01 — Harness Unblock (seed FK 1451 + fresh seed + Playwright green)

> Lane: student-answer durability close-out. Stage: PLAN ONLY (this file is the plan; implementation agents execute it without redesigning).
> Overall plan: plans-durability/overall-plan.md (goal, blockers B1/B2/B3, phases, ownership, standing rules).
> Phase objective: fix the e2e_seed cleanup FK failure, re-seed fresh fixtures, get e2e/student-durability.spec.ts 5/5 plus e2e/smoke.spec.ts control green on chromium.
> Unblocks: L4 re-run plus rollout confidence (Phase 04). Parallel phases 02 (tsc) / 03 (k6) are independent of this file.

## 1. Objective

Turn blocker B1 (overall-plan section 3) into green-with-evidence:

1. Fix cleanup() in backend/go/cmd/e2e_seed/main.go lines 297-334 so a re-run no longer dies with MySQL Error 1451 on the exam_versions.parent_version_id self-FK (declared backend/go/migrations/0003_exam_core.sql lines 62-73, no ON DELETE clause, therefore NO ACTION).
2. Run a fresh e2e_seed against the local DB (ielts_go_fresh) regenerating e2e/.generated/backend-e2e-manifest.json plus the four storage-state files.
3. Re-run Playwright on chromium: e2e/student-durability.spec.ts 5/5, then e2e/smoke.spec.ts as the control (it fails identically at the same global-setup line pre-fix — overall-plan B1 control proof), total durability budget under 5 min.
4. Record pasted terminal output for both specs. Zero source changes outside backend/go/cmd/e2e_seed/.

## 2. Dependencies

None on other phases (02/03/04/05). This phase has no prerequisites except a local MySQL instance holding the ielts_go_fresh database (see backend/.env lines 11-15) and the checked-in toolchain (Go 1.26.3 per backend/go/go.mod line 3, module example.com/ielts-proctoring; Playwright chromium).

e2e/global-setup.ts lines 56-79 always runs 'go run ./cmd/migrate' BEFORE 'go run ./cmd/e2e_seed', so by the time cleanup runs, migration 0051_drop_terminalization_triggers.sql (which drops the 0043 immutability triggers) is applied. The implementation agent MUST NOT run the seed binary against a database that has not been migrated to head (see edge E4).

## 3. Affected / new files

MODIFY (only file): backend/go/cmd/e2e_seed/main.go — function cleanup() only (lines 297-334). No flag, struct, manifest-shape, or storage-state change.

REGENERATED OUTPUTS (not source edits): e2e/.generated/backend-e2e-manifest.json, e2e/.generated/builder.storage-state.json, e2e/.generated/student.storage-state.json, e2e/.generated/unregistered-student.storage-state.json, e2e/.generated/admin.storage-state.json (paths from e2e/support/backendE2e.ts lines 4-12).

NO NEW FILES. No new unit tests (rationale in section 8, note N1).

## 4. Contracts / interfaces (unchanged — verify, do not redesign)

- func cleanup(ctx context.Context, db *sql.DB) error — signature unchanged; still runs inside one transaction, still scoped to the four seed slugs (e2e-builder-backend-draft, e2e-builder-draft-durability, e2e-student-backend-live, e2e-act-science-backend — main.go lines 32-35) and the five seed emails (main.go lines 28-39).
- Seed CLI flags unchanged: --manifest --builder-storage --student-storage --unregistered-student-storage --admin-storage --frontend-origin (parsed main.go lines 274-295, invoked by e2e/global-setup.ts lines 62-79 with cwd backend/go).
- Manifest JSON shape unchanged — must still satisfy the BackendE2EManifest interface in e2e/support/backendE2e.ts lines 14-71 (builder / student / act / studentSelfPaced / unregisteredStudent / auth.adminLifecycle). Only the ID values rotate.
- Spec contract (read-only, owned by src/, NOT this phase): the five scenarios in e2e/student-durability.spec.ts lines 27-61 drive REAL backend bumps (POST /api/v1/schedules/:id/runtime/commands pause/extend, POST /api/v2/student/attempts/:id/takeover) and a best-effort live-engine probe that fails LOUD. The implementation agent must not 'fix' spec failures by editing the spec.

## 5. Root cause (grounded)

- cleanup() deletes, in order: attempt_terminalizations, then exam_schedules, then exam_events, then exam_entities, then users. It never touches exam_versions.
- Every seed flow creates versions: seedBuilderExam (Create plus SaveDraft gives at least 1 version per builder exam, main.go lines 438-462), seedStudent (draft plus publish, main.go lines 476-489), seedACT (draft plus publish, main.go lines 580-594). Publish creates a child version whose parent_version_id points at the draft version (service layer writes the lineage; see backend/go/internal/exams/service.go line 974).
- exam_versions.parent_version_id FK has no ON DELETE action (0003_exam_core.sql line 73), therefore NO ACTION: deleting the parent (directly, or via the exam_entities cascade from 0003 line 72) raises Error 1451 as soon as a second seed run cleans up a previously seeded exam. First seed on an empty DB succeeds; every re-run (including every Playwright invocation via global-setup) fails — which is why student-durability is 0/5 and smoke fails at the same global-setup line.
- The production Delete path already knows this: backend/go/internal/exams/service.go lines 712-735 deletes exam_events first (line 717), then detaches lineage with UPDATE exam_versions SET parent_version_id = NULL WHERE exam_id = ? (line 722, comment: 'MySQL checks self-referential foreign keys during the cascade'), then deletes the entity. The seed-cleanup fix mirrors exactly this idiom. Do NOT copy the per-exam loop — the seed cleans four slugs in bulk.

## 6. FK ordering audit (migrations 0003-0010 plus attempt/grade tables; verified by grep over backend/go/migrations/)

Notation: CASCADE = deleted automatically with parent. NO ACTION = no ON DELETE clause, must be deleted or detached BEFORE the referenced row. Plain column = no FK, ignore.

Tables referencing exam_versions:

- exam_versions.parent_version_id (0003 line 73) — NO ACTION — THE BUG. Fix: UPDATE to NULL scoped to seed exams, then DELETE FROM exam_versions.
- exam_events.version_id (0003 line 99) — NO ACTION — keep existing step: delete events BEFORE versions.
- exam_schedules.published_version_id (0005 line 28) — NO ACTION — rows die with the existing schedule-delete step (before versions). No new statement.
- student_attempts.published_version_id (0006 line 42) — NO ACTION — cascade-deleted via schedule_id (0006 line 39 CASCADE) in the schedule step. No new statement.
- grading_sessions.published_version_id (0008 line 26) — NO ACTION — cascade-deleted via schedule_id (0008 line 24 CASCADE). No new statement.
- student_submissions.published_version_id (0008 line 54) — NO ACTION — cascade-deleted via schedule_id / attempt_id (0008 lines 51-52 CASCADE). No new statement.
- assessment_access_links.published_version_id (0034 line 20) — NO ACTION — cascade-deleted via schedule_id (0034 line 21 CASCADE), but seed-adjacent; add defensive DELETE scoped to seed exam_ids before versions (cheap, idempotent).
- sat_workbook_imports.checkpoint/imported_version_id (0040 lines 18-19) — NO ACTION — exam-level row, NO schedule FK, survives schedule delete and would pin versions. Seed never creates these, but add defensive DELETE scoped to seed exam_ids before versions.
- grading_schedule_objective_grading_source.version_id (0028 line 13) — ON DELETE SET NULL — safe, no action.
- assessment_sections.exam_version_id (0032 lines 73 and 251 pattern) — ON DELETE CASCADE — safe, die with versions, no action.

Tables referencing exam_entities — all ON DELETE CASCADE (0003 line 47 memberships, 0003 line 72 versions, 0003 line 98 events, 0005 line 27 schedules, 0005 line 107 runtimes, 0005 line 149 control events, 0006 line 41 attempts, 0008 lines 25/53 grading, 0034 line 19 links, 0040 line 17 imports): no new statements once versions are explicitly handled.

Tables referencing exam_schedules — all ON DELETE CASCADE (0005 lines 55/79/106/147, 0006 lines 39/67/90, 0007 lines 13/31/49/67/84, 0008 lines 24/52, 0010 line 123, 0027, 0028 line 12, 0034 line 21) EXCEPT attempt_terminalizations (0043 lines 59-61, no ON DELETE, therefore NO ACTION): the existing first step (delete terminalizations before schedules) is correct and stays first.

Tables referencing student_attempts — all ON DELETE CASCADE (0006 lines 66/89, 0007 line 14, 0010 line 124, 0015, 0016, 0032 line 271, 0033 line 174, 0044 line 85, 0049 lines 193/230/263, 0057 line 155) except attempt_terminalizations.attempt_id (0043 line 59, NO ACTION — covered by step 1) and session_audit_logs.target_student_id (0007 line 50, ON DELETE SET NULL — safe).

Considered and excluded (no FK to seed rows, seed creates none): media_assets, shared_cache_entries, idempotency_keys, outbox_events (0009), exam_memberships (dies with entity cascade). student_results.previous_version_id is SET NULL (0008 line 167) — safe.

Rejected alternatives (do not implement):

- (i) DELETE FROM exam_versions in child-before-parent order via ORDER BY version_number DESC: fragile — relies on version_number strictly following the parent chain and on InnoDB row-by-row check order; the NULL-detach is deterministic and mirrors prod service.go line 722.
- (ii) New migration adding ON DELETE CASCADE to the self-FK: FORBIDDEN — overall-plan out-of-scope ('any new deps / schema migration') and standing rules ('Backend prod logic stays out'; schema is prod).

## 7. Step-by-step implementation

All edits in backend/go/cmd/e2e_seed/main.go, function cleanup() (lines 297-334) ONLY.

Step 1 — Reproduce Error 1451 (before touching code).

Run the seed twice against the local DB (first run succeeds on or around existing seed rows; second run exercises cleanup over previously seeded exams and must fail with Error 1451 on parent_version_id). Commands in section 9.2. Save the 1451 output — it is the before-evidence. If the DB has no seed rows at all, the first run seeds, the second reproduces.

Step 2 — Replace cleanup() with the ordered version below.

Keep: txn begin/commit, the terminalizations-first step (unchanged SQL), the schedules step (unchanged SQL), the entities step (unchanged SQL), the users step (unchanged SQL), error wrapping. Add three statements in the exact positions shown: (a) defensive sat_workbook_imports plus assessment_access_links deletes AFTER schedules, BEFORE events; (b) events delete (existing, now explicitly before versions); (c) lineage detach plus versions delete BEFORE entities. Full replacement function (note: SQL uses backtick raw strings exactly as in the existing file):

    func cleanup(ctx context.Context, db *sql.DB) error {
        txn, err := db.BeginTx(ctx, nil)
        if err != nil {
            return err
        }
        defer func() { _ = txn.Rollback() }()

        // Terminalizations intentionally use NO ACTION FKs so a schedule cannot be
        // removed while its durable finalization record is still present.
        if _, err := txn.ExecContext(ctx, DELETE_FROM_attempt_terminalizations_WHERE_schedule_id_IN_seed_schedules, builderSlug, builderDurabilitySlug, studentSlug, actStudentSlug); err != nil {
            return err
        }
        if _, err := txn.ExecContext(ctx, DELETE_FROM_exam_schedules_WHERE_exam_id_IN_seed_entities, builderSlug, builderDurabilitySlug, studentSlug, actStudentSlug); err != nil {
            return err
        }
        // Exam-level rows whose exam_versions FKs are NO ACTION (no ON DELETE
        // clause) and therefore survive the schedule cascade as version pins.
        // The seed never creates these; the deletes are defensive and idempotent.
        if _, err := txn.ExecContext(ctx, DELETE_FROM_sat_workbook_imports_WHERE_exam_id_IN_seed_entities, builderSlug, builderDurabilitySlug, studentSlug, actStudentSlug); err != nil {
            return err
        }
        if _, err := txn.ExecContext(ctx, DELETE_FROM_assessment_access_links_WHERE_exam_id_IN_seed_entities, builderSlug, builderDurabilitySlug, studentSlug, actStudentSlug); err != nil {
            return err
        }
        // exam_events.version_id is NO ACTION (0003), so events must go before versions.
        if _, err := txn.ExecContext(ctx, DELETE_FROM_exam_events_WHERE_exam_id_IN_seed_entities, builderSlug, builderDurabilitySlug, studentSlug, actStudentSlug); err != nil {
            return err
        }
        // exam_versions.parent_version_id is a self-FK with NO ACTION (0003 line 73,
        // Error 1451). Detach the lineage first — mirrors the production Delete
        // path (internal/exams/service.go line 722) — then delete the versions.
        if _, err := txn.ExecContext(ctx, UPDATE_exam_versions_SET_parent_version_id_NULL_WHERE_exam_id_IN_seed_entities, builderSlug, builderDurabilitySlug, studentSlug, actStudentSlug); err != nil {
            return err
        }
        if _, err := txn.ExecContext(ctx, DELETE_FROM_exam_versions_WHERE_exam_id_IN_seed_entities, builderSlug, builderDurabilitySlug, studentSlug, actStudentSlug); err != nil {
            return err
        }
        if _, err := txn.ExecContext(ctx, "DELETE FROM exam_entities WHERE slug IN (?, ?, ?, ?)", builderSlug, builderDurabilitySlug, studentSlug, actStudentSlug); err != nil {
            return err
        }
        if _, err := txn.ExecContext(ctx, "DELETE FROM users WHERE email IN (?, ?, ?, ?, ?)", builderEmail, studentEmail, unregisteredEmail, adminOperatorEmail, lifecycleAdminEmail); err != nil {
            return err
        }
        return txn.Commit()
    }

Exact SQL for each placeholder (copy verbatim; each uses the existing slug-parameter style, no new imports):

- DELETE_FROM_attempt_terminalizations_WHERE_schedule_id_IN_seed_schedules: DELETE FROM attempt_terminalizations WHERE schedule_id IN ( SELECT id FROM exam_schedules WHERE exam_id IN ( SELECT id FROM exam_entities WHERE slug IN (?, ?, ?, ?) ) ) — unchanged from current code.
- DELETE_FROM_exam_schedules_WHERE_exam_id_IN_seed_entities: DELETE FROM exam_schedules WHERE exam_id IN (SELECT id FROM exam_entities WHERE slug IN (?, ?, ?, ?)) — unchanged from current code.
- DELETE_FROM_sat_workbook_imports_WHERE_exam_id_IN_seed_entities: DELETE FROM sat_workbook_imports WHERE exam_id IN (SELECT id FROM exam_entities WHERE slug IN (?, ?, ?, ?)) — new defensive statement.
- DELETE_FROM_assessment_access_links_WHERE_exam_id_IN_seed_entities: DELETE FROM assessment_access_links WHERE exam_id IN (SELECT id FROM exam_entities WHERE slug IN (?, ?, ?, ?)) — new defensive statement.
- DELETE_FROM_exam_events_WHERE_exam_id_IN_seed_entities: DELETE FROM exam_events WHERE exam_id IN (SELECT id FROM exam_entities WHERE slug IN (?, ?, ?, ?)) — unchanged from current code, position now pinned before versions.
- UPDATE_exam_versions_SET_parent_version_id_NULL_WHERE_exam_id_IN_seed_entities: UPDATE exam_versions SET parent_version_id = NULL WHERE exam_id IN (SELECT id FROM exam_entities WHERE slug IN (?, ?, ?, ?)) — new, mirrors service.go line 722.
- DELETE_FROM_exam_versions_WHERE_exam_id_IN_seed_entities: DELETE FROM exam_versions WHERE exam_id IN (SELECT id FROM exam_entities WHERE slug IN (?, ?, ?, ?)) — new.
- Entities and users statements: byte-identical to current code.

Key code notes: subselects reuse the existing slug-parameter style (no new imports, no helper refactor — keeps the diff reviewable); every statement is scoped to the four seed slugs / five seed emails, so the whole function stays idempotent (re-running on an empty DB deletes zero rows, updates zero rows, commits cleanly); single transaction = all-or-nothing, so a failure still aborts before any fixture creation (run() calls cleanup at line 173 before createUser at line 177 onward).

Step 3 — Verify WITHOUT a live DB (compile gate).

go vet plus go build of the seed package from section 9.1. Must exit 0. No DB needed; proves the edit at least compiles and passes vet.

Step 4 — Verify WITH DB: migrate plus seed plus re-seed (idempotence proof).

Run migrate, then the seed TWICE in a row with the backend env forced (section 9.2): first run seeds, second run exercises the fixed cleanup over live seed rows and must also exit 0 with fresh IDs. Confirm the manifest plus four storage states were regenerated (timestamps / generatedAt rotated). The second consecutive green run is the direct proof the 1451 is gone (a single run is not — the first run after a manual wipe would pass even with the old code).

Step 5 — Playwright re-run: durability 5/5, then smoke control.

With the backend env exported so root .env cannot shadow (section 9.3), run e2e/student-durability.spec.ts on --project=chromium ONLY (default config otherwise fans out to 7 projects: chromium, mobile-chromium, mobile-webkit, tablet-x2, firefox, webkit — playwright.config.ts lines 55-87). Then run e2e/smoke.spec.ts on chromium as the control. Estimated runtime: durability under 5 min (spec budget, student-durability.spec.ts line 27; per-test timeout 120 s at line 299), smoke about 1-3 min, plus one-off webServer boot (API plus worker plus Vite, 120-180 s timeouts at playwright.config.ts lines 88-114). Record full terminal output for both runs.

Step 6 — Repair-locally check (standing rule).

If the same failure appears twice (1451 persists, or a spec fails identically pre/post fix), STOP re-patching: escalate with the pasted error, the failing SQL statement, and schema_migrations head state. Do not blindly reorder statements.

## 8. Edge cases

- E1 — Partial-cleanup reruns / idempotency. All statements are slug/email-scoped DELETE/UPDATE; running cleanup on an empty DB affects 0 rows and commits. The single transaction makes each run atomic; run() aborts before creating fixtures if cleanup errors. Rerun-after-failed-seed is safe: same slugs/emails are cleaned. Note users are recreated with NEW uuids each run — cleanup keys on email, and the student_profiles.student_id UNIQUE on alice / W250334 is satisfied because profiles cascade-delete with users per 0010.
- E2 — Pre-existing non-seed data. Cleanup touches ONLY the 4 slugs plus 5 e2e-address emails; any other rows (other exams, real users, outbox/idempotency rows) are untouched. Conversely the fix assumes nothing else references seed exams: slugs are UNIQUE (0003 line 12) and seed-namespaced, so no foreign workflow can pin them. NEVER run the seed against staging/prod — the tool has no environment guard; local ielts_go_fresh only.
- E3 — Manifest regeneration invalidates older artifacts. New run means new exam/schedule/version UUIDs. Old test-results/ traces/videos/screenshots and any previously recorded schedule IDs are stale: clear or move aside test-results/ plus playwright-report/ before the green runs so evidence cannot be mixed with pre-fix artifacts. e2e/.generated files are overwritten in place by the seed (no manual cleanup needed, but verify generatedAt rotated).
- E4 — Stale DB without migration 0051. 0043 creates BEFORE DELETE immutability triggers on attempt_terminalizations (0043 lines 187-195); 0051 drops them. On a fully migrated DB (global-setup always migrates first) the cleanup delete is fine; against a pre-0051 DB the FIRST cleanup statement fails with 'attempt_terminalizations is immutable' — that is a stale-DB signal, not a code bug: run 'go run ./cmd/migrate' to head and retry. Do not work around it in the seed.
- E5 — Root .env DATABASE_URL shadowing. playwright.config.ts lines 5-9 and e2e/global-setup.ts lines 44-46 load root .env FIRST with override false, so the root DATABASE_URL (mysql URI form pointing at ielts_prod_clone, root .env line 4) wins over backend/.env line 12 (root:root at tcp 127.0.0.1:3306, database ielts_go_fresh) unless the backend values are already in the process environment. Fix is environmental, not code: export backend env into the shell before any Go/Playwright invocation (sections 9.2-9.3). Symptoms of shadowing: API boots against the wrong DB, auth failures, 'manifest schedule row absent' second-layer symptoms from overall-plan B1.
- E6 — No live DB available. Steps 1/4/5 require MySQL. If none is reachable, complete Step 3 (vet/build) and report 'green-without-DB only, live verification blocked on <concrete reason>' — never claim green without pasted output (standing rule).
- E7 — Flaky spec versus harness failure. Distinguish: global-setup/seed errors (harness, this phase) versus in-spec assertion failures AFTER a green seed (product signal — escalate, do not 'fix' by editing specs or src/).

Note N1 — why no new unit test: cleanup() is a seed-only integration routine whose only meaningful assertion is a live two-run sequence against MySQL (Step 4); a sqlmock unit test would re-assert statement order without proving the FK behavior, and the phase owns exactly one file with a verify-only gate in Phase 04. The double-seed run IS the test; its pasted output is the artifact.

## 9. Verification (exact commands plus expected outputs)

All commands from the repo root unless noted. Precondition: local MySQL up and ielts_go_fresh database exists (migrator does not create databases).

### 9.1 Without a live DB — compile gate (no DB needed)

    cd backend/go
    go vet ./cmd/e2e_seed/
    go build -o /tmp/e2e_seed ./cmd/e2e_seed/

Expected: both exit 0, no output from vet; 'ls -la /tmp/e2e_seed' shows a fresh binary. Record exit codes. Note: go vet and go build read go.mod only — root .env shadowing does not apply.

### 9.2 With DB — migrate plus seed plus re-seed (the 1451 proof)

Backend env MUST win over root .env — export it into the process environment first (this both documents the 'DB-env prefix' requirement and defeats dotenv first-wins shadowing, since override false never overwrites existing vars):

    set -a
    source backend/.env
    set +a
    cd backend/go
    go run ./cmd/migrate

Expected: migrate exits 0 (applies any pending files including 0051 on a stale DB; no-op when at head).

    go run ./cmd/e2e_seed --manifest ../../e2e/.generated/backend-e2e-manifest.json --builder-storage ../../e2e/.generated/builder.storage-state.json --student-storage ../../e2e/.generated/student.storage-state.json --unregistered-student-storage ../../e2e/.generated/unregistered-student.storage-state.json --admin-storage ../../e2e/.generated/admin.storage-state.json --frontend-origin http://localhost:3000

Expected (run twice consecutively): BOTH runs exit 0 with stdout 'Seeded backend E2E fixtures: builder exam <uuid>, student schedule <uuid>' and DIFFERENT uuids on the second run. Pre-fix, the second run fails with 'e2e_seed: cleanup: Error 1451: Cannot delete or update a parent row' — capture that as before-evidence in Step 1. Post-fix double-green is the proof. Also verify 'cat e2e/.generated/backend-e2e-manifest.json' shows a fresh generatedAt and the five sections from section 4.

One-shot inline-prefix alternative (same effect, no shell export; single line):

    DATABASE_URL='root:root@tcp(127.0.0.1:3306)/ielts_go_fresh?parseTime=true&multiStatements=true' DATABASE_DIRECT_URL='root:root@tcp(127.0.0.1:3306)/ielts_go_fresh?parseTime=true&multiStatements=true' DATABASE_MIGRATOR_URL='root:root@tcp(127.0.0.1:3306)/ielts_go_fresh?parseTime=true&multiStatements=true' DATABASE_WORKER_URL='root:root@tcp(127.0.0.1:3306)/ielts_go_fresh?parseTime=true&multiStatements=true' go run ./cmd/e2e_seed --manifest <same flags as above>

### 9.3 Playwright — durability then smoke control (chromium only)

    set -a
    source backend/.env
    set +a
    npx playwright test --project=chromium e2e/student-durability.spec.ts
    npx playwright test --project=chromium e2e/smoke.spec.ts

Expected: '5 passed' for durability (scenarios (a)-(e), total under 5 min) and all 10 passed for smoke (smoke.spec.ts holds 10 tests: login, password-reset, student exam a11y, unknown-route, admin dashboard, builder, proctor, API health, registration, routing). Paste FULL terminal output (including the 'Running N tests using 1 worker' header per playwright.config.ts line 115 and any webServer boot lines) into the completion report. On failure, also attach test-results/ trace plus the failing assertion text; per E7, classify harness versus product before any further action.

### 9.4 Regression guard (must stay green, no output changes expected)

'git status --porcelain' / lane diff-check shows changes ONLY under backend/go/cmd/e2e_seed/ (plus regenerated e2e/.generated outputs).

## 10. Definition of done

- Before-evidence: second consecutive pre-fix seed run fails with Error 1451 (output saved).
- go vet ./cmd/e2e_seed/ and go build ./cmd/e2e_seed/ exit 0 (section 9.1 outputs pasted).
- Migrate at head plus TWO consecutive e2e_seed runs green with rotated IDs (section 9.2 outputs pasted).
- npx playwright test --project=chromium e2e/student-durability.spec.ts gives 5 passed (output pasted).
- npx playwright test --project=chromium e2e/smoke.spec.ts gives all passed (output pasted).
- git status shows zero source changes outside backend/go/cmd/e2e_seed/ (regenerated e2e/.generated excepted).
- Completion report handed to Phase 04: pasted outputs, fresh manifest generatedAt, commit hash of the final tree.

## 11. Implementation agent MUST NOT touch

- src/ — engine, providers, mapper, spec product contract (the durability engine is frozen; a spec failure after green seed is evidence, not an invitation to edit).
- Backend prod: backend/go/internal/... (especially exams/service.go, submit/types paths), backend/go/cmd/api/..., backend/go/cmd/worker/..., backend/go/migrations/... (NO schema change — section 6 rejected alternative ii), backend/.env, root .env.
- e2e/ (specs, support/..., global-setup.ts), playwright.config.ts, docs/, k6/, plans/.
- Never run k6 against prod; never claim green without pasted output (standing rules).
