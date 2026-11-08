-- Module 1 only permits the base attempt. Keep the existing route-decision
-- fence, which rejects every Module 2 decision for this shape.
DROP TRIGGER IF EXISTS assessment_module_attempts_classroom_plan_fence;

CREATE TRIGGER assessment_module_attempts_classroom_plan_fence
BEFORE INSERT ON assessment_module_attempts
FOR EACH ROW
SET NEW.module_id = IF(
    COALESCE((
        SELECT CASE COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.sat_classroom_plan, CONCAT('$."', s.section_key, '"'))), 'full_adaptive')
            WHEN 'full_adaptive' THEN FALSE
            WHEN 'm1_only' THEN m.adaptive_role <> 'base'
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
