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
- New Go ledger table (created by the runner before applying files):
  `schema_migration_versions(version PK, name, checksum, applied_at)`.
  The legacy Rust ledger `schema_migrations(filename PK)` is imported:
  every legacy filename already recorded is inserted into the new ledger so
  history is preserved and files are never re-applied.

## Lineage audit probes

Run these against a migrated database to verify the union:

```sql
-- Union completeness: 50 files applied in order.
SELECT COUNT(*), MIN(version), MAX(version) FROM schema_migration_versions;
-- Expect: COUNT 50, MIN '0001', MAX '0050'.

-- Verbatim lineage: shared + epic checksums match the source tree.
SELECT version, name FROM schema_migration_versions ORDER BY version;

-- Legacy import preserved.
SELECT COUNT(*) FROM schema_migrations;          -- legacy ledger intact
SELECT COUNT(*) FROM schema_migration_versions   -- >= legacy count
WHERE version <= '0049';

-- ACT lineage applied last.
SELECT checksum FROM schema_migration_versions WHERE version = '0050';

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
