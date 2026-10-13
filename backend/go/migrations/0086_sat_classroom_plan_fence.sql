-- SAT Practice Classroom: database fence for immutable per-section plans.
--
-- A pre-0083 binary does not read exam_versions.sat_classroom_plan. Under a
-- mixed-version deployment it could therefore choose the wrong M2 for an
-- m1_easy/m1_hard section, or seed M1 for a standalone m2_easy/m2_hard
-- section. These triggers make the published plan authoritative even when an
-- old API binary reaches the write boundary.
--
-- The migration splitter treats each CREATE TRIGGER as one statement. The
-- sentinel values are rejected by existing CHECK/FK constraints after the
-- BEFORE trigger runs.

DROP TRIGGER IF EXISTS assessment_route_decisions_classroom_plan_fence;

CREATE TRIGGER assessment_route_decisions_classroom_plan_fence
BEFORE INSERT ON assessment_route_decisions
FOR EACH ROW
SET NEW.selected_route = IF(
    COALESCE((
        SELECT CASE COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.sat_classroom_plan, CONCAT('$."', s.section_key, '"'))), 'full_adaptive')
            WHEN 'full_adaptive' THEN FALSE
            WHEN 'm1_easy' THEN NEW.selected_route <> 'lower' OR NOT EXISTS (
                SELECT 1 FROM assessment_modules m
                WHERE m.id = NEW.selected_module_id AND m.section_id = NEW.section_id AND m.adaptive_role = 'lower_branch'
            )
            WHEN 'm1_hard' THEN NEW.selected_route <> 'higher' OR NOT EXISTS (
                SELECT 1 FROM assessment_modules m
                WHERE m.id = NEW.selected_module_id AND m.section_id = NEW.section_id AND m.adaptive_role = 'higher_branch'
            )
            WHEN 'm2_easy' THEN TRUE
            WHEN 'm2_hard' THEN TRUE
            ELSE TRUE
        END
        FROM student_attempts a
        JOIN assessment_sections s ON s.id = NEW.section_id
        JOIN exam_versions v ON v.id = s.exam_version_id AND v.id = a.published_version_id
        WHERE a.id = NEW.attempt_id
    ), TRUE),
    'policy_fence',
    NEW.selected_route
);

DROP TRIGGER IF EXISTS assessment_module_attempts_classroom_plan_fence;

CREATE TRIGGER assessment_module_attempts_classroom_plan_fence
BEFORE INSERT ON assessment_module_attempts
FOR EACH ROW
SET NEW.module_id = IF(
    COALESCE((
        SELECT CASE COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.sat_classroom_plan, CONCAT('$."', s.section_key, '"'))), 'full_adaptive')
            WHEN 'full_adaptive' THEN FALSE
            WHEN 'm1_easy' THEN
                m.adaptive_role NOT IN ('base', 'lower_branch') OR
                (m.adaptive_role = 'lower_branch' AND NOT EXISTS (
                    SELECT 1 FROM assessment_route_decisions d
                    WHERE d.attempt_id = NEW.attempt_id AND d.section_id = s.id
                      AND d.selected_module_id = NEW.module_id AND d.selected_route = 'lower'
                ))
            WHEN 'm1_hard' THEN
                m.adaptive_role NOT IN ('base', 'higher_branch') OR
                (m.adaptive_role = 'higher_branch' AND NOT EXISTS (
                    SELECT 1 FROM assessment_route_decisions d
                    WHERE d.attempt_id = NEW.attempt_id AND d.section_id = s.id
                      AND d.selected_module_id = NEW.module_id AND d.selected_route = 'higher'
                ))
            WHEN 'm2_easy' THEN m.adaptive_role <> 'lower_branch'
            WHEN 'm2_hard' THEN m.adaptive_role <> 'higher_branch'
            ELSE TRUE
        END
        FROM assessment_modules m
        JOIN assessment_sections s ON s.id = m.section_id
        JOIN exam_versions v ON v.id = s.exam_version_id
        JOIN student_attempts a ON a.id = NEW.attempt_id AND a.published_version_id = v.id
        WHERE m.id = NEW.module_id
    ), TRUE),
    '00000000-0000-0000-0000-000000000000',
    NEW.module_id
);
