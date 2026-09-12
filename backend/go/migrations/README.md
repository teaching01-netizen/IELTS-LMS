# Go migrations — union order + lineage

The Go runner applies `backend/go/migrations/*.sql` in filename order. This is the single canonical migration tree (the former `backend/migrations/` copy was removed):

- `0001..0031` — shared baseline (roles through grading export profiles).
- `0032..0049` — epic migrations (provider-neutral SAT, runtime/authoring hardening,
  access links, durability V2, terminalizations, leases, result outcomes, ...).
- `0050_act_science_support.sql` — Go-union-only renumbering of the ACT science
  support migration. Body extracted from
  `origin/main:backend/migrations/0032_act_science_support.sql`
  (commit `8214dbf` "feat: add ACT exam workflow"); only the header comment was
  adjusted to document the 0050 lineage. It widens ExamType to include ACT and
  section keys to include science (exam_entities, runtime sections, attempts,
  section_submissions CHECK constraints). Existing IELTS rows are unchanged.
- `0051_drop_terminalization_triggers.sql` — drops the rolling-deploy triggers
  from 0043 once the Go application owns terminalization transactionally.
- `0052_act_provider_identity.sql` — widens the 0039 provider identity CHECKs
  (exam_schedules, exam_session_runtimes) to admit `act`.
- `0053_backfill_attempt_user_ids.sql` — binds pre-V2 attempts to the
  authenticated user via schedule_registrations (data backfill, no DDL).
- `0054_heal_legacy_act_provider_key.sql` — promotes legacy ACT rows
  (`exam_type='ACT'`, `provider_key='ielts'`) to `provider_key='act'`.
- `0055_outbox_dlq.sql` — WS-09 dead-letter quarantine (`outbox_dead_letters`
  + open-letters index; terminal park + DLQ evidence commit atomically).
- `0056_receipt_immutability.sql` — WS-07 receipt immutability: re-creates
  exactly the two `attempt_terminalizations` immutability triggers dropped by
  0051 (legacy-projection triggers stay dropped, as intended).
- `0057_migration_repair_guard.sql` — WS-12 repair/guard: existence-guarded
  rebuild of UNIQUEs that 0015/0016 conditionally skip on non-empty tables and
  that 0044 adds without dedup, with 0019-style keep-earliest dedup DELETEs
  ahead of each UNIQUE build, plus guarded repair of the remaining
  0013/0017/0018/0045/0047 UNIQUE and claim-lease indexes and of the unguarded
  0014/0019 DDL. Re-runnable; see `backend/go/cmd/migrate/MIGRATION_POLICY.md`.
- `0058_authoring_operation_keys.sql` — retry-safe authoring mutations:
  additive `authoring_operation_keys(actor_id, scope, operation_key)` ledger
  for create/duplicate/batch/bulk/workbook-commit/publish. 7-day TTL swept by
  `maintenance.RunRetention` (authoringOpKeyRows). Re-runnable.

## Ledger truth

`schema_migrations(filename PK)` is the canonical applied-migration ledger:
the runner (`backend/go/cmd/migrate/main.go` `applyMigrations`) creates it,
records one row per fully applied file, refuses unsafe bootstraps when it is
empty but other tables exist (fail closed, see `MIGRATION_POLICY.md`), and
uses it for pending-file detection. The package comment's checksum note
describes an OPTIONAL gate only: `verifyChecksums` runs exclusively when the
`schema_migration_versions(version, checksum)` table already exists. The
runner NEVER creates that table, and no code path backfills it — a database
may legitimately never have it, in which case the migrate log records
`schema_migration_versions absent, using legacy schema_migrations history`.
Do not promise a `schema_migration_versions` backfill in future migrations;
filing one would require changing the apply path, which WS-12 forbids.

(History note: an earlier revision of this README described
`schema_migration_versions(version PK, name, checksum, applied_at)` as the
new Go ledger with a legacy import from `schema_migrations`. That table was
never created by the runner and no import code exists; the paragraph above
supersedes that description.)

## Lineage audit probes

Run these against a migrated database to verify the union:

```sql
-- Union completeness: files applied in order (canonical ledger).
SELECT COUNT(*), MIN(filename), MAX(filename) FROM schema_migrations;
-- Expect: COUNT 58, MIN '0001_roles.sql', MAX '0058_authoring_operation_keys.sql'.

-- Verbatim lineage: every file recorded exactly once.
SELECT filename FROM schema_migrations ORDER BY filename;

-- ACT lineage applied.
SELECT filename FROM schema_migrations
WHERE filename IN ('0050_act_science_support.sql', '0052_act_provider_identity.sql');

-- ACT widening effective.
SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
WHERE TABLE_NAME = 'exam_entities' AND CONSTRAINT_TYPE = 'CHECK';
```

Verbatim check from the repo root:

```bash
for f in backend/migrations/0001*.sql backend/migrations/0049*.sql; do
  diff -q "$f" "backend/go/migrations/$(basename "$f")" || echo "DRIFT: $f";
done
git show origin/main:backend/migrations/0032_act_science_support.sql | \
  diff - <(tail -n +7 backend/go/migrations/0050_act_science_support.sql) && echo BODY_MATCH
```

## Version floor

MySQL >= 8.0.16 is required. CHECK constraints (0021, 0022 inline CHECKs,
0049 V2 ledger CHECKs, 0044/0046/0050/0052 named CHECKs) are parsed but silently
IGNORED on MySQL < 8.0.16, so those invariants would not be enforced. The
runner does not gate on server version yet (see `MIGRATION_POLICY.md` for the
<=15-line snippet the owning lane can drop into
`backend/go/cmd/migrate/main.go`); until that gate lands, verify
`SELECT VERSION()` before migrating. MariaDB is not supported (CHECK and
information_schema behavior differ).
