-- 0067_sat_runtime_section_candidate_duration.sql
-- Repair the section clock of runtimes whose sections have not started yet.
--
-- A section's runtime clock is exam_session_runtime_sections
-- .planned_duration_minutes, snapshotted from assessment_sections.duration_seconds
-- when the proctor starts the session (schedules.runtimePlanIn -> runtime.Start).
-- 0065 repaired the assessment_sections row itself and
-- exams.CandidateSectionSeconds now owns every new write, but a session started
-- before that repair keeps the old value in its runtime snapshot: the section
-- then clocks Module 1 + BOTH adaptive branches (Math 105 instead of 70 minutes,
-- Reading & Writing 96 instead of 64), and a candidate who finishes Module 2 at
-- the true end of the section waits out the branch nobody sat before the
-- between-sections window opens.
--
-- Scope: only sections that have NOT started (status = 'locked'). A live or
-- paused section's deadline is already running, so shortening it could close a
-- candidate's section early; those sessions keep the clock they started with and
-- pick the corrected value up on their next start. A future full repair would
-- have to re-derive each runtime's plan from the version it was actually planned
-- against — unavailable here (the runtime stores no version id), which is the
-- second reason this migration deliberately stops at the not-started rows.
--
-- Re-runnable and crash-retry safe (MIGRATION_POLICY.md): the predicate matches
-- only rows that still disagree with base + longer branch, so a second pass or a
-- retry after a mid-file crash writes zero rows and cannot compound.
--
-- plan_snapshot is deliberately left alone: it is the record of what the plan
-- said at Start, no clock reads it, and new starts plan the corrected value.

UPDATE exam_session_runtime_sections rs
JOIN exam_session_runtimes r ON r.id = rs.runtime_id
JOIN exam_schedules sch ON sch.id = r.schedule_id
JOIN assessment_sections s
  ON s.exam_version_id = sch.published_version_id
 AND s.section_key = rs.section_key
JOIN (
    SELECT
        m.section_id,
        MAX(CASE WHEN m.adaptive_role = 'base' THEN m.duration_seconds ELSE 0 END) AS base_seconds,
        GREATEST(
            MAX(CASE WHEN m.adaptive_role = 'lower_branch' THEN m.duration_seconds ELSE 0 END),
            MAX(CASE WHEN m.adaptive_role = 'higher_branch' THEN m.duration_seconds ELSE 0 END)
        ) AS branch_seconds
    FROM assessment_modules m
    WHERE m.adaptive_role IN ('base', 'lower_branch', 'higher_branch')
    GROUP BY m.section_id
    HAVING base_seconds > 0 AND branch_seconds > 0
) plan ON plan.section_id = s.id
SET rs.planned_duration_minutes = (plan.base_seconds + plan.branch_seconds + 59) DIV 60
WHERE rs.status = 'locked'
  AND rs.planned_duration_minutes <> (plan.base_seconds + plan.branch_seconds + 59) DIV 60;
