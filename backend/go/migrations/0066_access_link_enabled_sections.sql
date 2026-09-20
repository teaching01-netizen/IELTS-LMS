-- 0066_access_link_enabled_sections.sql
-- Scope a Student Access link to a subset of the exam's sections.
--
-- A Student Link is 1:1 with a backing exam_schedules row and pinned to an
-- immutable published version. Until now every link exposed every section the
-- version enabled: a verbal-only class could not be given a Reading & Writing
-- only sitting without publishing a second version. enabled_sections records
-- the sections the operator picked in Student Access; schedules.runtimePlanIn
-- intersects the version plan with it, so the run's runtime sections — and
-- therefore section advance, end-of-exam and auto-submit — follow the link.
--
-- NULL means "all sections", so every existing link keeps exactly today's
-- behaviour and no backfill is required. Values are the same section keys the
-- runtime plan uses (a JSON array: ["reading-writing"], ["math"], or both).
--
-- A link may only NARROW what the version enables: the runtime seam intersects
-- the config-enabled plan with this column rather than replacing it, so a
-- link can never re-enable a section the author turned off.

SET @link_enabled_sections_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_access_links'
      AND column_name = 'enabled_sections'
);
SET @link_enabled_sections_sql := IF(
    @link_enabled_sections_exists = 0,
    'ALTER TABLE assessment_access_links ADD COLUMN enabled_sections JSON NULL AFTER name',
    'SELECT 1'
);
PREPARE link_enabled_sections_stmt FROM @link_enabled_sections_sql;
EXECUTE link_enabled_sections_stmt;
DEALLOCATE PREPARE link_enabled_sections_stmt;
