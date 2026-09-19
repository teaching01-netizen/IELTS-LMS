-- 0065_sat_section_candidate_duration.sql
-- Repair the stored length of adaptive (SAT/ACT) sections.
--
-- A section's duration_seconds is the candidate-facing section time: the base
-- module plus the LONGER of the two adaptive branches. A candidate sits Module
-- 1 and then exactly ONE Module 2, so summing every authored module overstates
-- the longest real sitting by a whole branch.
--
-- The delivery-settings save path (authoring.UpdateDeliverySettings) summed
-- every module in the request, so any section whose timings were edited carried
-- M1 + lower + higher — Math 105 min and Reading & Writing 96 min instead of the
-- correct 70 and 64. The SAT runtime clocks a section from this column
-- (schedules.runtimePlanIn -> exam_session_runtime_sections
-- .planned_duration_minutes -> the student's countdown), so the inflated value
-- was what a student saw on the exam clock. New writes go through
-- exams.CandidateSectionSeconds.
--
-- Scope: only sections that are structurally complete — a base plus at least
-- one branch, which is exactly the shape a delivery-settings save requires —
-- are touched. IELTS/ACT sections have no adaptive roles at all, and a
-- half-authored draft that has not grown its branches yet is left alone rather
-- than being shortened to its base module. The predicate makes the file
-- re-runnable: a second pass matches zero rows.

UPDATE assessment_sections s
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
SET s.duration_seconds = plan.base_seconds + plan.branch_seconds
WHERE s.duration_seconds <> plan.base_seconds + plan.branch_seconds;
