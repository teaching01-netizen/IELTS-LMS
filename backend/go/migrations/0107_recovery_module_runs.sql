-- 0107_recovery_module_runs.sql
-- Module run generations for staff-assisted recovery
-- (docs/superpowers/plans/2026-10-28-staff-assisted-exam-recovery.md §3.3).
--
-- Reopening a module keeps its module attempt id and every answer identity;
-- the row advances run_generation instead of inserting a second identity.
-- Boundaries, close intents, resolution receipts and evidence frontiers are
-- per-run artifacts, so their identities include the generation:
--
--   assessment_module_boundaries          (module_attempt_id, run_generation)
--   assessment_module_close_intents       (module_attempt_id, run_generation)
--   assessment_module_boundary_resolutions(module_attempt_id, run_generation,
--                                          resolution_id)
--   assessment_late_evidence_frontiers    (module_attempt_id, run_generation,
--                                          question_id)
--
-- History is never rewritten: existing rows become generation 0, and a
-- version-0 request remains valid only for an untouched run. Late answer
-- evidence keeps one immutable origin generation; the derived frontier is
-- composite so a reopened run cannot overwrite the prior run's review risk.
--
-- IELTS timelines gain an explicit completion_reason plus run_generation so a
-- timeout transition is provable instead of inferred from finished_at.

-- ---------------------------------------------------------------------------
-- assessment_module_attempts
-- ---------------------------------------------------------------------------
SET @ma_run_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_attempts'
      AND column_name = 'run_generation'
);
SET @ma_run_sql := IF(
    @ma_run_exists = 0,
    'ALTER TABLE assessment_module_attempts ADD COLUMN run_generation BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE ma_run_stmt FROM @ma_run_sql;
EXECUTE ma_run_stmt;
DEALLOCATE PREPARE ma_run_stmt;

-- ---------------------------------------------------------------------------
-- assessment_module_boundaries
-- ---------------------------------------------------------------------------
SET @amb_run_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_boundaries'
      AND column_name = 'run_generation'
);
SET @amb_run_sql := IF(
    @amb_run_exists = 0,
    'ALTER TABLE assessment_module_boundaries ADD COLUMN run_generation BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE amb_run_stmt FROM @amb_run_sql;
EXECUTE amb_run_stmt;
DEALLOCATE PREPARE amb_run_stmt;

SET @amb_pk_has_run := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_boundaries'
      AND index_name = 'PRIMARY'
      AND column_name = 'run_generation'
);
SET @amb_pk_sql := IF(
    @amb_pk_has_run = 0,
    'ALTER TABLE assessment_module_boundaries DROP PRIMARY KEY, ADD PRIMARY KEY (module_attempt_id, run_generation)',
    'SELECT 1'
);
PREPARE amb_pk_stmt FROM @amb_pk_sql;
EXECUTE amb_pk_stmt;
DEALLOCATE PREPARE amb_pk_stmt;

-- ---------------------------------------------------------------------------
-- assessment_module_close_intents
-- ---------------------------------------------------------------------------
SET @amc_run_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_close_intents'
      AND column_name = 'run_generation'
);
SET @amc_run_sql := IF(
    @amc_run_exists = 0,
    'ALTER TABLE assessment_module_close_intents ADD COLUMN run_generation BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE amc_run_stmt FROM @amc_run_sql;
EXECUTE amc_run_stmt;
DEALLOCATE PREPARE amc_run_stmt;

SET @amc_pk_has_run := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_close_intents'
      AND index_name = 'PRIMARY'
      AND column_name = 'run_generation'
);
SET @amc_pk_sql := IF(
    @amc_pk_has_run = 0,
    'ALTER TABLE assessment_module_close_intents DROP PRIMARY KEY, ADD PRIMARY KEY (module_attempt_id, run_generation)',
    'SELECT 1'
);
PREPARE amc_pk_stmt FROM @amc_pk_sql;
EXECUTE amc_pk_stmt;
DEALLOCATE PREPARE amc_pk_stmt;

-- ---------------------------------------------------------------------------
-- assessment_module_boundary_resolutions
-- ---------------------------------------------------------------------------
SET @amr_run_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_boundary_resolutions'
      AND column_name = 'run_generation'
);
SET @amr_run_sql := IF(
    @amr_run_exists = 0,
    'ALTER TABLE assessment_module_boundary_resolutions ADD COLUMN run_generation BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE amr_run_stmt FROM @amr_run_sql;
EXECUTE amr_run_stmt;
DEALLOCATE PREPARE amr_run_stmt;

SET @amr_pk_has_run := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_boundary_resolutions'
      AND index_name = 'PRIMARY'
      AND column_name = 'run_generation'
);
SET @amr_pk_sql := IF(
    @amr_pk_has_run = 0,
    'ALTER TABLE assessment_module_boundary_resolutions DROP PRIMARY KEY, ADD PRIMARY KEY (module_attempt_id, run_generation, resolution_id)',
    'SELECT 1'
);
PREPARE amr_pk_stmt FROM @amr_pk_sql;
EXECUTE amr_pk_stmt;
DEALLOCATE PREPARE amr_pk_stmt;

-- ---------------------------------------------------------------------------
-- assessment_late_answer_evidence (immutable origin generation)
-- ---------------------------------------------------------------------------
SET @ale_run_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_late_answer_evidence'
      AND column_name = 'run_generation'
);
SET @ale_run_sql := IF(
    @ale_run_exists = 0,
    'ALTER TABLE assessment_late_answer_evidence ADD COLUMN run_generation BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE ale_run_stmt FROM @ale_run_sql;
EXECUTE ale_run_stmt;
DEALLOCATE PREPARE ale_run_stmt;

-- ---------------------------------------------------------------------------
-- assessment_late_evidence_frontiers (composite frontier identity)
-- ---------------------------------------------------------------------------
SET @alf_run_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_late_evidence_frontiers'
      AND column_name = 'run_generation'
);
SET @alf_run_sql := IF(
    @alf_run_exists = 0,
    'ALTER TABLE assessment_late_evidence_frontiers ADD COLUMN run_generation BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE alf_run_stmt FROM @alf_run_sql;
EXECUTE alf_run_stmt;
DEALLOCATE PREPARE alf_run_stmt;

SET @alf_pk_has_run := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_late_evidence_frontiers'
      AND index_name = 'PRIMARY'
      AND column_name = 'run_generation'
);
SET @alf_pk_sql := IF(
    @alf_pk_has_run = 0,
    'ALTER TABLE assessment_late_evidence_frontiers DROP PRIMARY KEY, ADD PRIMARY KEY (module_attempt_id, run_generation, question_id)',
    'SELECT 1'
);
PREPARE alf_pk_stmt FROM @alf_pk_sql;
EXECUTE alf_pk_stmt;
DEALLOCATE PREPARE alf_pk_stmt;

-- ---------------------------------------------------------------------------
-- ielts_attempt_section_timelines
-- ---------------------------------------------------------------------------
SET @iat_run_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'ielts_attempt_section_timelines'
      AND column_name = 'run_generation'
);
SET @iat_run_sql := IF(
    @iat_run_exists = 0,
    'ALTER TABLE ielts_attempt_section_timelines ADD COLUMN run_generation BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE iat_run_stmt FROM @iat_run_sql;
EXECUTE iat_run_stmt;
DEALLOCATE PREPARE iat_run_stmt;

SET @iat_reason_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'ielts_attempt_section_timelines'
      AND column_name = 'completion_reason'
);
SET @iat_reason_sql := IF(
    @iat_reason_exists = 0,
    'ALTER TABLE ielts_attempt_section_timelines ADD COLUMN completion_reason VARCHAR(32) NULL',
    'SELECT 1'
);
PREPARE iat_reason_stmt FROM @iat_reason_sql;
EXECUTE iat_reason_stmt;
DEALLOCATE PREPARE iat_reason_stmt;

SET @iat_check_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'ielts_attempt_section_timelines'
      AND constraint_name = 'chk_ielts_timeline_completion_reason'
);
SET @iat_check_sql := IF(
    @iat_check_exists = 0,
    'ALTER TABLE ielts_attempt_section_timelines ADD CONSTRAINT chk_ielts_timeline_completion_reason CHECK (completion_reason IS NULL OR completion_reason IN (''time_expired'', ''student_submit'', ''proctor_end'', ''proctor_force_submit'', ''admin_end'', ''legacy_unknown''))',
    'SELECT 1'
);
PREPARE iat_check_stmt FROM @iat_check_sql;
EXECUTE iat_check_stmt;
DEALLOCATE PREPARE iat_check_stmt;
