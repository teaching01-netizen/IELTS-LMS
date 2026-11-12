-- ============================================================================
-- ROLLBACK: 0121_sat_exam_library_folders.sql
--
-- Reverses the DB side of commit 2090398f2b02951a3635360802341a9a0af04d10
-- ("feat(sat): persist nested exam library folders"), which was part of the
-- commits dropped when main was rolled back to:
--     aa7b719052372d95539896b8653d0dcaf3922252
--
-- 0121 was PURELY ADDITIVE: it created three new tables plus four indexes
-- and never ALTERed, UPDATEd, INSERTed into, or DELETEd from any pre-existing
-- table. Reverting it therefore destroys only folder organisation data
-- (folders + exam -> folder assignments). Authored exam content, exams,
-- attempts, sessions, submissions, results and grades are untouched.
--
-- NOT part of the migration runner: this file lives in a subdirectory, and
-- loadMigrations() in backend/go/cmd/migrate/main.go skips directories, so it
-- is never executed as a forward migration. Apply it manually.
--
-- Usage:
--   mysql -h HOST -P 3306 -u USER -p DBNAME \
--     < backend/go/migrations/rollback/0121_sat_exam_library_folders.down.sql
--
-- ORDERING: redeploy the API + worker binaries built from aa7b7190 BEFORE (or
-- at the same time as) running this script. A binary built from 2090398f or
-- later boots against a runtime schema guard that REQUIRES exam_folders /
-- exam_folder_entries / exam_library_scopes, so it will refuse to start once
-- they are dropped.
--
-- ---------------------------------------------------------------------------
-- EXECUTION MODE A: mysql CLI / psql-style pipe (whole file, one session)
--   Run this file as-is:
--     mysql -h HOST -P 3306 -u USER -p DBNAME < <this file>
--   One connection = one session, so the session variables and the prepared
--   statement in STEP 4 work normally.
--
-- EXECUTION MODE B: web SQL console (ONE STATEMENT PER "Run" click)
--   A console that does not enable CLIENT_MULTI_STATEMENTS sends the whole
--   pasted block as ONE statement and the server rejects it with:
--     ERROR 1064 ... right syntax to use near 'DROP TABLE IF EXISTS exam_folders; ...' at line 2
--   NOTHING executes in that case (verified against MySQL 8.4.9). Use the
--   single-statement sequence in the "MODE B" block at the END of this file.
--   IMPORTANT: in MODE B every "Run" is a NEW session, so user variables
--   (@name) and prepared statements do NOT survive between queries. Run the
--   plain DELETE for schema_migration_versions instead of the prepared one.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 (pre-flight, read-only): confirm what is actually present.
-- ---------------------------------------------------------------------------
SELECT 'pre-flight: 0121 objects' AS step;

SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = DATABASE()
   AND table_name IN ('exam_library_scopes', 'exam_folders', 'exam_folder_entries')
 ORDER BY table_name;

SELECT 'ledger: schema_migrations' AS step;
SELECT filename, applied_at
  FROM schema_migrations
 WHERE filename = '0121_sat_exam_library_folders.sql';


-- ---------------------------------------------------------------------------
-- STEP 2 (OPTIONAL, recommended): snapshot folder data before dropping.
--
-- Uncomment this block if you want the folder hierarchy recoverable. It
-- mirrors the repo's backup-table policy (backend/go/cmd/migrate/
-- MIGRATION_POLICY.md section 1) so a DROP here stays reversible. The
-- backup tables are intentionally NOT dropped by this script.
-- ---------------------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS backup_0121_exam_library_scopes
--     AS SELECT * FROM exam_library_scopes;
-- CREATE TABLE IF NOT EXISTS backup_0121_exam_folders
--     AS SELECT * FROM exam_folders;
-- CREATE TABLE IF NOT EXISTS backup_0121_exam_folder_entries
--     AS SELECT * FROM exam_folder_entries;
--
-- SELECT 'backup row counts' AS step;
-- SELECT 'exam_library_scopes'  AS tbl, COUNT(*) AS rows_kept FROM backup_0121_exam_library_scopes
-- UNION ALL
-- SELECT 'exam_folders',               COUNT(*) FROM backup_0121_exam_folders
-- UNION ALL
-- SELECT 'exam_folder_entries',        COUNT(*) FROM backup_0121_exam_folder_entries;


-- ---------------------------------------------------------------------------
-- STEP 3: drop the three tables created by 0121.
--
-- Drop order follows the FK graph:
--   exam_folder_entries.exam_id   -> exam_entities(id)      (ON DELETE CASCADE)
--   exam_folder_entries.folder_id -> exam_folders(id)       (ON DELETE RESTRICT)
--   exam_folders.parent_id        -> exam_folders(id)       (self FK, RESTRICT)
--   exam_folders.scope_key        -> exam_library_scopes(scope_key)
--
-- Dropping a table also removes the FK constraints it owns, so
-- exam_entities is left structurally unchanged.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS exam_folder_entries;
DROP TABLE IF EXISTS exam_folders;
DROP TABLE IF EXISTS exam_library_scopes;


-- ---------------------------------------------------------------------------
-- STEP 4: un-record 0121 from the migration ledger.
--
-- schema_migrations is the canonical applied-migration ledger (see
-- backend/go/migrations/README.md "Ledger truth"). Leaving the 0121 row in
-- place would claim a migration is applied that no longer exists in the
-- tree, hiding the drift from `migrate --validate-only`.
--
-- The other three commits being rolled back (33f5c896, 0e77dfbf and the
-- local-only 68c82cf4 / 006c133b) added NO migration files -- 0121 was the
-- only one -- so this single DELETE fully reverts the ledger.
-- ---------------------------------------------------------------------------
DELETE FROM schema_migrations WHERE filename = '0121_sat_exam_library_folders.sql';

-- Optional checksum ledger. The runner never creates this table, so guard
-- the DELETE with an information_schema probe (repo 0017/0045 idiom).
SET @smv_exists := (
    SELECT COUNT(*)
      FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = 'schema_migration_versions'
);
SET @smv_sql := IF(
    @smv_exists = 1,
    'DELETE FROM schema_migration_versions WHERE version = ''0121_sat_exam_library_folders.sql''',
    'SELECT 1'
);
PREPARE smv_stmt FROM @smv_sql;
EXECUTE smv_stmt;
DEALLOCATE PREPARE smv_stmt;


-- ---------------------------------------------------------------------------
-- STEP 5 (verify): every check below must return 0 rows / empty.
-- ---------------------------------------------------------------------------
SELECT 'verify: 0121 tables must be gone' AS step;
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = DATABASE()
   AND table_name IN ('exam_library_scopes', 'exam_folders', 'exam_folder_entries');

SELECT 'verify: ledger must not list 0121' AS step;
SELECT filename FROM schema_migrations
 WHERE filename = '0121_sat_exam_library_folders.sql';

SELECT 'verify: ledger tail (newest applied migration)' AS step;
SELECT filename, applied_at
  FROM schema_migrations
 ORDER BY filename DESC
 LIMIT 5;

SELECT 'verify: no dangling FK to the dropped tables' AS step;
SELECT rc.CONSTRAINT_NAME, rc.TABLE_NAME, rc.REFERENCED_TABLE_NAME
  FROM information_schema.REFERENTIAL_CONSTRAINTS rc
 WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
   AND rc.REFERENCED_TABLE_NAME IN ('exam_library_scopes', 'exam_folders', 'exam_folder_entries');

SELECT 'verify: exam_entities untouched by the rollback' AS step;
SELECT TABLE_NAME, TABLE_ROWS
  FROM information_schema.tables
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME = 'exam_entities';


-- ============================================================================
-- MODE B: single-statement sequence for web SQL consoles
--
-- Run each block below as its OWN "Run" click (one statement per query).
-- Do NOT paste them together -- the console will reject the whole batch.
--
--   -- B1) existence pre-check (read-only). Note which rows come back 1.
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = DATABASE()
--      AND table_name IN ('schema_migrations', 'schema_migration_versions',
--                         'exam_library_scopes', 'exam_folders',
--                         'exam_folder_entries')
--    ORDER BY table_name;
--
--   -- B2) drop the three tables (ONE statement, comma-separated list).
--   --     MySQL drops the FK constraints between them in the same statement,
--   --     so the parent/child order does not matter here.
--   DROP TABLE IF EXISTS exam_folder_entries, exam_folders, exam_library_scopes;
--
--   -- B3) un-record 0121 from the canonical ledger.
--   --     Run only if B1 listed 'schema_migrations'.
--   DELETE FROM schema_migrations WHERE filename = '0121_sat_exam_library_folders.sql';
--
--   -- B4) optional checksum ledger.
--   --     Run only if B1 listed 'schema_migration_versions'.
--   --     (Do NOT use the prepared-statement form here: a prepared statement
--   --      does not survive between console queries.)
--   DELETE FROM schema_migration_versions WHERE version = '0121_sat_exam_library_folders.sql';
--
--   -- B5) verify: expect 0.
--   SELECT COUNT(*) AS leftover_folder_tables
--     FROM information_schema.tables
--    WHERE table_schema = DATABASE()
--      AND table_name IN ('exam_library_scopes', 'exam_folders', 'exam_folder_entries');
--
--   -- B6) verify: expect 0 rows.
--   SELECT filename, applied_at FROM schema_migrations
--    WHERE filename = '0121_sat_exam_library_folders.sql';
--
--   -- B7) verify: exam_entities must still be present with its data.
--   SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.tables
--    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_entities';
-- ============================================================================
