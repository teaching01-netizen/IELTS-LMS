# Schema / Migration Reconciliation Plan (real DBs, two lineages)

> Purpose: a runbook to (1) audit which lineage a live MySQL/TiDB actually ran, (2) resolve the `0032` migration-number collision, and (3) re-emit every CHECK constraint and trigger in the rewrite’s migration stack — so the rewritten backend can attach to *whatever* a real environment holds.

> Current Go status (2026-09-04): the historical two-lineage analysis below is
> retained as migration provenance. The canonical runtime directory is
> `backend/go/migrations/0001..0053`. `0050` widens ACT support, `0051` drops
> the trigger-era terminalization hooks, `0052` widens provider identity, and
> `0053` backfills `student_attempts.user_id`. The Go application owns
> terminalization and the Go migrator skips trigger statements on TiDB.
> Sources (verified 2026-09-04): migration trees of **epic** = local `main` `9b4414a` (`backend/migrations/` on disk) and **fork** = `origin/main` `6671ad1` (`git show origin/main:backend/migrations/…`); migration runner `backend/crates/infrastructure/src/migrations.rs` (712 lines); trigger DDL `0043_attempt_terminalizations.sql`.
> Companion: `docs/backend-rewrite-map.md` (§1 topology, §9 DB-owned logic, §13 schema-contract), `docs/frontend-rewrite-map.md`.

---

## 0. Lineage facts (why this plan exists)

| | Shared history | Epic-only (`9b4414a`) | Fork-only (`origin/main`) |
|---|---|---|---|
| Migrations | `0001_roles.sql` … `0031_grading_export_profiles.sql` (byte-identical both sides) | `0032_provider_neutral_sat.sql` … `0049_response_durability_v2.sql` (18 files: SAT content model, adaptive runtime, terminalizations, v2 durability, …) | `0032_act_science_support.sql` (ACT exam type + `science` section CHECK widening) |
| Content | IELTS-proctoring schema (roles, exams/versions, schedules, delivery, proctoring, grading, auth, …) | SAT tables (`assessment_*`), timing models, `attempt_terminalizations` + triggers, v2 tables (`attempt_*_v2`) | no SAT, no v2; classic builder schema + ACT/Science widening |
| Schema state if applied | base tables + CHECKs | + all SAT/v2 tables, columns, triggers, checks | + ACT/Science CHECK widening only |

**The collision is exactly the number `0032`** with two different filenames and contents:
- `0032_provider_neutral_sat.sql` (epic) — creates the SAT content model (`assessment_sections`, `assessment_modules`, `assessment_exam_questions`, `assessment_question_revisions`, …).
- `0032_act_science_support.sql` (fork) — drops-and-recreates four CHECK constraints to add `exam_type='ACT'` and section key `'science'`.

The runner records applied migrations by **filename** (see §1), so both could in principle be recorded; but no real DB can have *run* both unless someone mixed migration directories — treat that as the hybrid case (§3). Migration **content** is disjoint (SAT tables vs CHECK widening), so a unified sequence is achievable without data surgery.

---

## 1. How the current runner tracks state (must be understood before auditing)

Facts from `backend/crates/infrastructure/src/migrations.rs`:

- Tracking table: `schema_migrations (filename varchar(255) PRIMARY KEY, applied_at timestamp default current_timestamp)` — **keyed by filename, not by version number**.
- Ordering: `load_migrations` sorts **lexicographically by filename** and runs each unapplied file once (`0001` is force-recorded as a no-op).
- Concurrency: `GET_LOCK('ielts_backend_startup_migrations_lock', 300)` around startup runs (`run_startup_migrations`); called by the `migrate` binary and on API boot.
- Bootstrap safety: if `schema_migrations` is empty but tables exist, the runner refuses to backfill (`maybe_backfill_schema_migrations`); behavior controlled by `MIGRATION_HISTORY_GUARD_MODE` (`fail`/`warn`, default fail; env). Index checks controlled by `REQUIRED_INDEX_GUARD_MODE`.
- After each run it verifies `REQUIRED_COLUMNS` (19 epic-era column/table pairs), `REQUIRED_INDEXES` (9 names), and a mutation-uniqueness guard (`verify_mutation_uniqueness_guard`). `verify_runtime_schema(pool)` (same file, line 247) is the API-boot variant.
- **Consequence for the audit:** the epic runner *asserts* epic-only schema (e.g., `student_attempts.protocol_version`, `attempt_mutations_v2` indexes). A fork-migrated DB will fail those verifications until the epic migration set is applied — a useful, built-in probe, and a warning not to run the epic binary against an audited-ACT DB before deciding the migration order.

Runner post-run verify lists (embed in the audit, §4):

| REQUIRED_COLUMNS (table → column) | REQUIRED_INDEXES (table → index name) |
|---|---|
| `student_attempts.active_client_session_id`, `answer_revision`, `protocol_version`, `delivery_status`, `lease_epoch`, `control_epoch`, `response_revision`, `deadline_at`, `closing_grace_until`, `final_response_digest`; `attempt_terminalizations.terminalization_id`; `assessment_results.attempt_id`, `outcome_status`; `assessment_question_revisions.updated_by`; `exam_session_runtimes.timing_model`; `websocket_connection_leases.lease_token`; `users.organization_id`; `student_heartbeat_events.mutation_id`; `assessment_question_responses.client_write_id` | `student_attempt_mutations.idx_student_attempt_mutations_attempt_mutation_id`; `student_attempts.idx_student_attempts_schedule_submitted_id`; `attempt_terminalizations.idx_attempt_terminalizations_schedule_recorded`; `assessment_results.uq_assessment_result_attempt_provider`; `assessment_module_attempts.module_attempt_identity`; `student_heartbeat_events.heartbeat_mutation`; `attempt_mutations_v2.uq_attempt_mutations_v2_write_id`, `uq_attempt_mutations_v2_version`; `attempt_submissions_v2.uq_attempt_submissions_v2_submission` |

---

## 2. Step 1 — Audit: which lineage did this database run?

### 2.1 Signature probes (fast, read-only)

```sql
-- A. Migration history tail
SELECT filename, applied_at FROM schema_migrations
ORDER BY filename DESC LIMIT 12;

-- B. Lineage-defining objects
SELECT 'epic-sat'      AS sig, COUNT(*) FROM information_schema.tables  WHERE table_schema=DATABASE() AND table_name='assessment_modules'
UNION ALL SELECT 'epic-sat-quest', COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='assessment_exam_questions'
UNION ALL SELECT 'epic-v2', COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='attempt_mutations_v2'
UNION ALL SELECT 'epic-triggers', COUNT(*) FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name LIKE 'attempt_terminalizations_%'
UNION ALL SELECT 'epic-0049-col', COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='student_attempts' AND column_name='protocol_version'
UNION ALL SELECT 'fork-act-type', COUNT(*) FROM information_schema.check_constraints cc JOIN information_schema.table_constraints tc USING(constraint_schema,constraint_name) WHERE tc.table_schema=DATABASE() AND tc.table_name='exam_entities' AND cc.check_clause LIKE '%''ACT''%'
UNION ALL SELECT 'fork-science', COUNT(*) FROM information_schema.check_constraints cc JOIN information_schema.table_constraints tc USING(constraint_schema,constraint_name) WHERE tc.table_schema=DATABASE() AND tc.table_name='section_submissions' AND cc.check_clause LIKE '%''science''%';
```

### 2.2 Interpretation matrix

| Probe result | Conclusion | Rewrite implication |
|---|---|---|
| No `schema_migrations` / empty DB | Fresh | Build from canonical union sequence (§5). |
| History ends `…0031` only | Pre-split base | Apply canonical union (epic set + ACT file) — nothing to reconcile. |
| History includes `0032_provider_neutral_sat.sql` … `0049_response_durability_v2.sql` | **Epic lineage** (SAT/V2). ACT probes = 0. | Canonical add-on is just the ACT widening (renumbered, §5). Content lives in `assessment_*`, `student_attempts` (protocol_version, v2 cols), `attempt_*_v2`, triggers present. |
| History ends `0032_act_science_support.sql`; no `assessment_modules`, no `protocol_version` | **Fork lineage** (ACT/Science). | Must apply epic `0032…0049` **before** ACT file in canonical order; runner verify lists (§1) will then pass. ACT exam rows already present under classic builder schema. |
| Both `0032_*` filenames present in `schema_migrations` | Hybrid (someone merged dirs) | Rare. Verify order actually executed; SAT tables must exist *and* ACT checks present. Re-derive canonical state via full drift audit (§4), not assumptions. |
| Tables exist but `schema_migrations` empty | Bootstrap-blocked | `MIGRATION_HISTORY_GUARD_MODE=warn` + backfill only after manual inventory; or snapshot baseline (see §5.3). |

### 2.3 Lineage truth per environment (product decision, not code)

Before any migration work, record for **each** environment (dev/preview/staging/prod) which lineage it ran and which product data it holds (IELTS attempts? SAT practice runs? ACT Science exams/scores?). The rewrite must read all of them, so the plan below assumes you keep every environment’s data and converge schema, not data.

---

## 3. Step 2 — Resolve the `0032` collision (canonical union sequence)

Rules derived from the runner: filenames are the only ordering key and must stay unique; never reuse a number prefix for two files.

**Target: one canonical migration directory that (a) reproduces the union and (b) is additive to any audited DB.**

1. Keep `0001_roles.sql … 0031_grading_export_profiles.sql` verbatim (shared).
2. Keep the epic set verbatim: `0032_provider_neutral_sat.sql … 0049_response_durability_v2.sql`.
3. **Renumber the ACT widening** to the next free slot and rename:
   `0032_act_science_support.sql` → `0050_act_science_support.sql`
   - Content unchanged (drop-and-recreate of the four CHECKs). It is *content-disjoint* from every epic migration, so it applies cleanly on top of an epic DB.
   - Before enabling it on any environment, run the §4 drift audit on the four affected constraints (`exam_entities.exam_type`, `exam_session_runtime_sections.section_key`, `student_attempts.current_module`, `section_submissions.section`) to confirm no epic migration altered them after `0031` (none does today — verified by grep of `0032…0049` — but never assume on prod).
   - Do **not** edit the old fork filename in place if any environment recorded it: the runner keys by filename, so renaming history files breaks re-runs. New environments get the canonical set; existing environments converge via additive files.
4. Fresh installs: apply the full canonical directory in lexical order (0001…0053). Existing fork DBs: apply epic `0032…0049` then the Go-side `0050…0053`. Existing epic DBs: apply `0050…0053`. Hybrid/unknown: full drift audit first (§4).
5. In the rewrite (Go/Bun), adopt a real versioned migrator (integer `version`, checksummed, transactional). Map old files → canonical integer sequence (0001…0049 → 1…49; ACT widening → 50). Record the mapping table in the new repo’s migration docs; if adopting the old DB, import `schema_migrations.filename` set into the new tracking table (`INSERT … SELECT`) so nothing re-runs.

---

## 4. Step 3 — Full drift audit (before and after any change)

Run read-only; expected-zero diffs post-convergence.

```sql
-- A. Migration history vs expected file set (fill the expected list from the canonical dir)
SELECT s.filename FROM schema_migrations s
LEFT JOIN (VALUES -- expected filenames (MySQL 8)
  ROW('0001_roles.sql'), ROW('0032_provider_neutral_sat.sql'), ROW('0049_response_durability_v2.sql'),
  ROW('0050_act_science_support.sql'), ROW('0051_drop_terminalization_triggers.sql'),
  ROW('0052_act_provider_identity.sql'), ROW('0053_backfill_attempt_user_ids.sql')
) AS e(filename) ON e.filename = s.filename
WHERE e.filename IS NULL;
-- (reverse join needs the file list materialized; simplest: dump `ls backend/migrations` and diff against the SELECT below)
SELECT filename FROM schema_migrations ORDER BY filename;

-- B. Triggers present
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers WHERE trigger_schema = DATABASE()
ORDER BY event_object_table, trigger_name;
  -- Historical trigger-era expectation only. Current Go state intentionally
  -- has zero terminalization triggers after 0051:
--   attempt_terminalizations_legacy_projection (AFTER UPDATE on student_attempts)
--   attempt_terminalizations_legacy_insert      (AFTER INSERT on student_attempts)
--   attempt_terminalizations_immutable_update   (BEFORE UPDATE on attempt_terminalizations)
--   attempt_terminalizations_immutable_delete   (BEFORE DELETE on attempt_terminalizations)
-- Nothing else (0011_outbox_notify_trigger is a documented no-op; no notify triggers exist).

-- C. CHECK constraints (MySQL 8: check_clause is visible; TiDB: information_schema coverage differs — see §7)
SELECT tc.table_name, cc.constraint_name, cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc
  ON cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name
WHERE tc.table_schema = DATABASE() AND tc.constraint_type = 'CHECK'
ORDER BY tc.table_name, cc.constraint_name;

-- D. The four ACT-affected constraints specifically
SELECT tc.table_name, cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc
  ON cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name
WHERE tc.table_schema = DATABASE() AND tc.table_name IN
  ('exam_entities','exam_session_runtime_sections','student_attempts','section_submissions')
ORDER BY tc.table_name;

-- E. Uniqueness keys that carry behavior (spot list; full inventory in migration files)
SELECT table_name, index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND index_name IN
  ('uq_student_attempt_schedule_student','uq_schedule_registration','uq_student_attempt_mutation_write',
   'uq_violation_business_id','uq_attempt_mutations_v2_write_id','uq_attempt_mutations_v2_version',
   'uq_attempt_submissions_v2_submission','heartbeat_mutation','module_attempt_identity')
GROUP BY table_name, index_name ORDER BY table_name;

-- F. REQUIRED_COLUMNS probe (epic runner §1) — informational
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = DATABASE() AND (
  (table_name='student_attempts' AND column_name IN ('protocol_version','lease_epoch','control_epoch','response_revision','deadline_at','closing_grace_until','final_response_digest','delivery_status'))
  OR (table_name='attempt_terminalizations' AND column_name='terminalization_id')
  OR (table_name='assessment_results' AND column_name='outcome_status'));
```

**CHECK re-emission inventory** (source = migration files; full DDL must be re-created from these files, never retyped):
- Base (shared 0001–0031): `exam_entities.exam_type` (Academic/General Training; ACT widening → `0050`), `exam_entities.status/visibility` (0003); difficulty (0004); delivery_mode/recurrence (0005); `student_attempts.phase/current_module/proctor_status` (0006); alert/severity/category (0007); schedule/grading statuses, `section_submissions.section` keys (0008); upload_status (0009); roles/state (0010); wcode `REGEXP` (0012, relaxed 0026); finalization consistency (0021); submission_source/canonical_revision (0022); admission status (0025); overrides (0027); grading source (0028).
- Epic (0032–0049): SAT content states (0032/0033 `selected_route`); access-link audience/mode/availability (0034); timing models (0037/0038); `provider_key IN ('ielts','sat')` (0039); terminalization checks (0043); v2 durability checks + 3 uniques (0049).
- Fork: the four widened checks above (→ `0050`).

---

## 5. Step 4 — Re-emit triggers & constraints in the new stack

Two viable strategies — decide per environment class:

### 5.1 Strategy A: keep DB-side DDL (MySQL prod)
Re-create verbatim from `0043_attempt_terminalizations.sql` (trigger definitions at lines 57/109/161/166 of the epic file; after renumbering, the canonical home is an explicit `0050_…` + `0051_triggers_reemit.sql` or the rewrite’s first release migration):
- `attempt_terminalizations_legacy_projection` (AFTER UPDATE on `student_attempts`): when `submitted_at` flips NULL→non-NULL and no terminalization row exists, `INSERT IGNORE` a conservative receipt (reason `legacy_unknown`, actor `system`, snapshot from the JSON columns). V2 SAT submit deliberately avoids setting `submitted_at` to keep this trigger from firing early (backend map §9.2).
- `attempt_terminalizations_legacy_insert` (AFTER INSERT): same guard for rows inserted already-submitted.
- `attempt_terminalizations_immutable_update` / `_delete` (BEFORE UPDATE/DELETE on `attempt_terminalizations`): `SIGNAL SQLSTATE '45000'` — terminal facts are immutable.
- 0011 outbox/live notify: **no trigger** (removed; polling-based bus) — do not re-create.
Verification after re-emission (run on a scratch copy):
```sql
SHOW TRIGGERS LIKE 'attempt_terminalizations';
SHOW TRIGGERS LIKE 'student_attempts';
-- immutability proof:
--   UPDATE attempt_terminalizations SET outcome=outcome LIMIT 1;  -- must raise 45000
--   DELETE FROM attempt_terminalizations LIMIT 1;                  -- must raise 45000
-- legacy projection proof: UPDATE a student_attempts row without a terminalization
--   SET submitted_at=NOW() WHERE phase<>'post-exam' LIMIT 1;      -- expect INSERT IGNORE receipt w/ legacy_unknown
```
(The fork ships `backend/tests/integration/startup_migrations_smoke.rs` — port it to the new stack as the boot-time gate; the epic’s runner verify fns in §1 are the equivalent.)

### 5.2 Strategy B: app-enforced (needed for TiDB / some managed MySQL)
TiDB does not support triggers, and CHECK enforcement semantics differ from MySQL 8. If any environment runs TiDB, replicate both behaviors **transactionally in the service layer** and prove them in migration/integration tests:
- terminalization immutability → enforce by lock + existence check (the epic already does this in `seal_attempt_in_tx`: replay-or-conflict under the attempt row lock — backend map §9.1);
- legacy projection on `submitted_at` → keep the INSERT of the receipt inside the same transaction that flips `submitted_at` (this is exactly what v2 SAT avoids, and what seal does for everything else).
Do not run a mixed strategy per table; pick per deployment target and assert the choice in CI.

### 5.3 Baseline path for the rewrite’s first release
1. Dump prod (or clone TiDB/MySQL) → restore a scratch instance → run the §4 audit against scratch → apply canonical sequence to scratch → re-run audit (expected-zero) → only then schedule the real change, with backup + rollback notes per environment.
2. If a DB is “bootstrap-blocked” (§2.2), snapshot-baseline it: record current object inventory, then run the canonical sequence with `MIGRATION_HISTORY_GUARD_MODE=warn`, and verify by drift audit instead of history.

---

## 6. Step 5 — Verify & gate (per environment)

1. Post-change drift audit (§4) returns zero unexpected rows.
2. Runner-equivalent verify passes: all REQUIRED_COLUMNS / REQUIRED_INDEXES present (§1 table).
3. Trigger strategy verified per environment: A → `SHOW TRIGGERS` + the 45000/INSERT-Ignore proofs; B → migration tests that exercise seal + legacy projection without DB triggers.
4. Read-model probes: one IELTS, one SAT (epic), one ACT/Science (fork) end-to-end attempt each (author → schedule → run → submit → grade/report) against the converged schema — reuse the union contract suites listed in `docs/backend-rewrite-map.md` §19 and `docs/frontend-rewrite-map.md` §6 as the equivalence gate.
5. Update runbooks: `schema_migrations` expectations, `MIGRATION_HISTORY_GUARD_MODE`/`REQUIRED_INDEX_GUARD_MODE` settings, and the canonical file → integer mapping for the new migrator.

---

## 7. Risks & open items

1. **Constraint-name drift:** MySQL auto-names inline CHECKs from the table name; the ACT widening *finds* names via `information_schema` so it tolerates this, but audit queries that filter by name are fragile — filter by table + `check_clause` content instead.
2. **TiDB differences:** trigger absence + CHECK introspection/enforcement differences. Confirm the target deployment engine(s) before choosing Strategy A vs B (§5.2) — the current dev compose runs TiDB while triggers imply MySQL somewhere; treat the two-lineage repo’s “MySQL or TiDB” support claim as an environment question to resolve per deployment.
3. **Hybrid or hand-migrated DBs:** if any environment mixed directories or applied partial files, history-based reasoning fails; rely on the object-level drift audit and snapshot-baseline (§5.3).
4. **`schema_migrations` is the only history:** no checksums are stored. A corrupted/edited migration file after application is undetectable from history — the new migrator should checksum files and store checksums.
5. **Data truth of ACT (fork) content:** ACT exams/sections/submissions live in the *classic builder* tables under `exam_type='ACT'`/`section='science'`; confirm which environments hold real ACT data before the rewrite’s first cutover so those rows are never dropped by schema tooling.
6. **Epic runner guard consequences:** pointing the epic binary at a fork DB fails its post-run verify (§1) — sequence the epic 0032–0049 application *before* ACT widening on fork environments and don’t treat that failure as schema corruption.

---

*End. Verified against epic `9b4414a` and fork `origin/main` `6671ad1` migration trees and `backend/crates/infrastructure/src/migrations.rs`. Companion: `docs/backend-rewrite-map.md`, `docs/frontend-rewrite-map.md`.*

---

## 8. Addendum — union realized in `backend/go/migrations/` (current Go state)

The §3 proposal is realized and extended on disk: `backend/go/migrations/`
holds the canonical 0001…0053 sequence plus `README.md`. The Go runner
(`backend/go/cmd/migrate/main.go`) resolves to this directory (explicit
`MIGRATIONS_DIR`, then a working-tree `migrations` directory, then the
exe-adjacent directory). It records checksums in `schema_migration_versions`
and uses the same splitter/runner for MySQL and TiDB with trigger statements
skipped on TiDB.

Corrections to §§0/7 from the round-162 audit:
- §0 “two lineages” framing is historical. Fresh installs apply Go `0001…0053` lexically; existing epic/fork databases converge with the remaining Go migrations after an object-level audit.
- §7 item 4 (“no checksums stored”) is TRUE for Rust (filename-only ledger `migrations.rs:170-176`) but FALSE for Go: `hasVersionsTable` + `verifyChecksums` (`main.go:290-326`, sha256 vs `schema_migration_versions`; mismatch is log-and-continue on the apply path `:194-198`, error on validate).
- `0011_outbox_notify_trigger.sql` is comment-only and `0001_roles.sql` is recorded-without-execution. `0051_drop_terminalization_triggers.sql` removes the four 0043 trigger names on MySQL; TiDB skips the original trigger statements as unsupported. Go `validate-only` needs a live DB, and CI now provisions MySQL before applying migrations and running it.
