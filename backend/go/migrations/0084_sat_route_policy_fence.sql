-- 0084_sat_route_policy_fence.sql
-- SAT Practice Classroom: database fence for the session route policy.
--
-- A binary that predates 0083 routes every Module 1 close adaptively. On a
-- mixed-version fleet it could commit a route decision for a staff_selects
-- attempt (no staff choice) or the wrong branch for a forced attempt. This
-- trigger rejects such a decision for every writer, whatever its version:
--
--   staff_selects -> route_basis must be 'staff_selected'
--   force_lower   -> selected_route must be 'lower'
--   force_higher  -> selected_route must be 'higher'
--
-- The migration splitter cuts on ';', so the body is one statement: a policy
-- violation rewrites selected_route to 'policy_fence', which the existing
-- chk_route_decision_route CHECK (evaluated after BEFORE triggers) rejects.
-- The whole closing transaction rolls back; a current binary finalizes later.
--
-- Crash-retry safety: DROP TRIGGER IF EXISTS + CREATE TRIGGER. TiDB skips
-- trigger statements (see cmd/migrate); production refuses TiDB outright.

DROP TRIGGER IF EXISTS assessment_route_decisions_policy_fence;

CREATE TRIGGER assessment_route_decisions_policy_fence
BEFORE INSERT ON assessment_route_decisions
FOR EACH ROW
SET NEW.selected_route = IF(
    COALESCE((
        SELECT CASE sch.sat_route_policy
            WHEN 'staff_selects' THEN COALESCE(NEW.route_basis, '') <> 'staff_selected'
            WHEN 'force_lower' THEN NEW.selected_route <> 'lower'
            WHEN 'force_higher' THEN NEW.selected_route <> 'higher'
            ELSE FALSE
        END
        FROM student_attempts sa
        JOIN exam_schedules sch ON sch.id = sa.schedule_id
        WHERE sa.id = NEW.attempt_id
    ), FALSE),
    'policy_fence',
    NEW.selected_route
);
