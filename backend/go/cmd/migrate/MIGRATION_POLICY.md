# Migration authoring policy (WS-12)

Additive rule: a migration may only ADD schema/rows or dedup ahead of a UNIQUE
it builds. Destructive DELETEs of live data and broad data rewrites are
forbidden unless they follow the backup-table + row-count-guard pattern below
and are justified as dedup-then-UNIQUE. Crash-retry safety is mandatory: the
runner records a file only after ALL its statements succeed, so any statement
can run twice after a mid-file crash. Guard every statement.

## 0. Terminology: UNIQUE vs unique INDEX (read before authoring)

MySQL treats these spellings as the same index object, but the guards that
detect them live in DIFFERENT information_schema tables:

- `ADD CONSTRAINT <name> UNIQUE ...` and `ADD UNIQUE KEY <name> ...`
  create an index AND a table_constraints row (constraint_type = 'UNIQUE').
- `CREATE UNIQUE INDEX <name> ...` inside a guarded dynamic-SQL string
  (0017 idiom) also creates a table_constraints UNIQUE row at runtime — the
  plan-time file text just does not contain the word CONSTRAINT.

Guard-table rule:

- Guarding `CREATE [UNIQUE] INDEX` (plain or dynamic-SQL): query
  `information_schema.statistics` by `index_name` (0017/0018 idiom).
- Guarding `ADD CONSTRAINT <name> UNIQUE` / `ADD UNIQUE KEY <name>`:
  query `information_schema.table_constraints` by `constraint_name`
  (0044/0045 idiom).
- Never probe `table_constraints` for a name that was created with
  `CREATE UNIQUE INDEX`, and never probe `statistics` for the
  `ADD CONSTRAINT` spelling — the probe will never match and every retry
  will re-execute the DDL.

Precedent: 0057 checks `statistics` for the 0015/0016/0017
`CREATE UNIQUE INDEX` names, and `table_constraints` for the 0044
`uq_assessment_result_attempt_provider` /`uq_student_heartbeat_mutation`
constraints. The 0047 rename (`uq_student_heartbeat_mutation` ->
`heartbeat_mutation`) left the constraint row under the NEW name on renamed
databases, so 0057 accepts either name with an `IN` probe.

## 1. Backup-table + row-count-guard pattern (required for future destructive DELETEs)

Any migration whose DELETE can remove more than dedup-ahead-of-UNIQUE rows
MUST:

1. Copy doomed rows first: `CREATE TABLE backup_<migration>_<table> AS SELECT ...`
   with the exact DELETE predicate, so the operation is reversible.
2. Assert the blast radius BEFORE deleting: `SELECT COUNT(*)` into a variable
   and `SIGNAL SQLSTATE '45000'` when the count exceeds the justified bound.
3. Keep the backup table (do not DROP it in the same file); retention/cleanup
   is a separate, explicitly reviewed migration.

Example skeleton:

```sql
CREATE TABLE IF NOT EXISTS backup_00xx_results AS
SELECT * FROM student_results WHERE provider_key = 'sat';

SET @doomed := (SELECT COUNT(*) FROM student_results WHERE provider_key = 'sat');
SET @guard_sql := IF(@doomed > 100000,
    'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''backup_00xx_results exceeds justified bound''',
    'SELECT 1');
PREPARE guard_stmt FROM @guard_sql;
EXECUTE guard_stmt;
DEALLOCATE PREPARE guard_stmt;

DELETE results FROM student_results results WHERE results.provider_key = 'sat';
```

Counter-example (what NOT to copy): 0044's unguarded
`DELETE grading_sessions ... WHERE e.provider_key = 'sat'` /
`DELETE results ... WHERE submissions.provider_key = 'sat'` have no backup
and no bound. Future migrations MUST NOT imitate that shape; 0057 deliberately
does not retro-apply a backup to 0044 (history is already applied downstream).

## 2. Heuristic-heal rule (0054-class)

A migration that UPDATEs rows based on a heuristic (e.g. "legacy rows look
like X") MUST name the explicit legacy value AND run a pre-update audit:

- `WHERE` must match the literal legacy marker (0054: `exam_type = 'ACT' AND
  provider_key <> 'act'`), never a bare `provider_key <> '...'` promotion
  that would also catch future/unknown values. A bare ` <>` predicate turns
  every later-introduced value into a silent heal target.
- Before the UPDATE, `SELECT` the affected keys into the migrate log (or a
  backup table per section 1) so the heal set is auditable.

## 3. CHECK-swap rule (0050-class)

Widening/narrowing a CHECK MUST drop by looked-up exact name and re-ADD behind
an existence guard (0046 is the reference; 0057 section 2 companions copy it):

```sql
SET @chk := (SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON cc.constraint_schema = tc.constraint_schema
     AND cc.constraint_name = tc.constraint_name
    WHERE tc.table_schema = DATABASE() AND tc.table_name = 'users'
      AND tc.constraint_type = 'CHECK' AND cc.check_clause LIKE '%role%'
    LIMIT 1);
SET @drop_sql := IF(@chk IS NULL OR @chk = 'chk_users_role', 'SELECT 1',
    CONCAT('ALTER TABLE users DROP CHECK `', @chk, '`'));
PREPARE drop_stmt FROM @drop_sql;
EXECUTE drop_stmt;
DEALLOCATE PREPARE drop_stmt;

SET @named_exists := (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'users'
      AND constraint_name = 'chk_users_role');
SET @add_sql := IF(@named_exists = 0,
    'ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK (role IN (''admin'', ''student''))',
    'SELECT 1');
PREPARE add_stmt FROM @add_sql;
EXECUTE add_stmt;
DEALLOCATE PREPARE add_stmt;
```

Rules: never `DROP CHECK` a hardcoded anonymous name (MySQL mints
`<table>_chk_1`; TiDB/partial shapes differ — a mismatch aborts the deploy,
see 0046 header). Never ADD the replacement without the named-existence guard
(retry would fail on duplicate constraint). 0050's dynamic-name DROP is
grandfathered; 0052's fixed-name ADD is grandfathered — new code follows 0046.

## 4. Big-ALTER policy for exam-day tables

Tables on the exam-day hot path (`student_attempts`, `student_attempt_mutations`,
`student_heartbeat_events`, `outbox_events`, `attempt_responses_v2`,
`attempt_mutations_v2`) MUST NOT take a blocking full-table ALTER during the
exam window:

- Schedule big ALTERs off-peak; prefer `ALGORITHM=INPLACE, LOCK=NONE`
  (verify with `EXPLAIN ALTER` semantics on a replica first — MySQL may still
  copy for column-type changes).
- Chunked backfill: UPDATE in bounded PK-ordered batches with sleeps instead
  of one multi-million-row statement; each chunk must be independently
  re-runnable (predicate on the not-yet-migrated state, cf. 0049's
  `delivery_status` repair predicate and 0053's `WHERE user_id IS NULL`).
- New secondary indexes on these tables default to the online
  information_schema-guarded `CREATE INDEX` (0017 idiom), never to a
  table-copying `ALTER TABLE ... ADD INDEX` without an ALGORITHM clause.

## 5. MySQL version floor (>= 8.0.16)

CHECK constraints are parsed but silently IGNORED below MySQL 8.0.16. The
0021 finalization CHECK, the 0022 ledger inline CHECKs, the 0049 V2 ledger
CHECKs, and every 0044/0046/0050/0052 named CHECK depend on enforcement. Until
the runner gates on server version, verify `SELECT VERSION()` before
migrating. The owning lane can drop this <=15-line gate into
`backend/go/cmd/migrate/main.go` (READ-ONLY for lane E — snippet only):

```go
// requireMySQL80_16 aborts migration on servers whose CHECKs are ignored.
func requireMySQL80_16(ctx context.Context, conn *sql.Conn) error {
    var v string
    if err := conn.QueryRowContext(ctx, "SELECT VERSION()").Scan(&v); err != nil {
        return err
    }
    var major, minor, patch int
    if _, err := fmt.Sscanf(strings.SplitN(v, "-", 2)[0], "%d.%d.%d", &major, &minor, &patch); err != nil {
        return fmt.Errorf("parse db version %q: %w", v, err)
    }
    if major < 8 || (major == 8 && (minor > 0 || patch < 16)) && major == 8 && minor == 0 {
        return fmt.Errorf("mysql >= 8.0.16 required (CHECKs ignored below), got %s", v)
    }
    return nil
}
```

NOTE to the owning lane: the minor/patch comparison above is illustrative —
collapse it to a proper semver tuple compare and unit-test the matrix
(8.0.15 reject, 8.0.16 accept, 8.1 accept, 5.7 reject, mariadb reject)
before merging.

## 6. Guard idioms (copy these)

Existence-guarded ADD COLUMN (0045/0049):

```sql
SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'users'
      AND column_name = 'organization_id');
SET @col_sql := IF(@col_exists = 0,
    'ALTER TABLE users ADD COLUMN organization_id VARCHAR(255) NULL AFTER role',
    'SELECT 1');
PREPARE col_stmt FROM @col_sql;
EXECUTE col_stmt;
DEALLOCATE PREPARE col_stmt;
```

Existence-guarded CREATE INDEX (0017/0018):

```sql
SET @sql = (SELECT IF(COUNT(*) = 0,
    'CREATE INDEX idx_live_update_events_created ON live_update_events(created_at)',
    'SELECT 1')
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'live_update_events'
      AND INDEX_NAME = 'idx_live_update_events_created');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
```

Keep-earliest dedup DELETE before a UNIQUE (0019, reused by 0057):

```sql
DELETE sve1 FROM student_violation_events sve1
JOIN student_violation_events sve2
  ON sve1.attempt_id = sve2.attempt_id
 AND sve1.violation_id = sve2.violation_id
 AND (sve1.created_at > sve2.created_at
   OR (sve1.created_at = sve2.created_at AND sve1.id > sve2.id));
-- then: CREATE UNIQUE INDEX ... (guarded per above)
```

## 7. Crash-retry + dirty-data tests (required for repair migrations)

Every repair/guard migration ships two tests (0057 is the reference):

- Static guard audit (no DB): the test reads the `.sql` file, splits it with
  the migrator's own `splitStatements`, and asserts every `ALTER`/`CREATE
  [UNIQUE] INDEX`/`ADD CONSTRAINT` is information_schema-guarded and every
  `DELETE` carries a keep-earliest self-join (see `repair_0057_test.go`
  `TestRepair0057StatementsGuarded`).
- DSN-gated crash-retry + dirty-data (real MySQL only, skip-cleanly without
  `TEST_MYSQL_DSN`): apply the file twice against an isolated schema
  (second run must change nothing), and seed duplicate rows, run the dedup,
  then build the UNIQUE (see `TestRepair0057CrashRetry` /
  `TestRepair0057DirtyDataDedup`).
