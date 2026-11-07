-- A move authorizes delayed answers only from the exact writer era that staff
-- interrupted, bounded by its pre-move server revision.
CREATE TABLE IF NOT EXISTS assessment_staff_move_sources (
 attempt_id VARCHAR(36) NOT NULL,
 module_id VARCHAR(36) NOT NULL,
 control_epoch BIGINT UNSIGNED NOT NULL,
 lease_epoch BIGINT UNSIGNED NOT NULL,
 response_revision BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(attempt_id,module_id,control_epoch),
 FOREIGN KEY(attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE,
 FOREIGN KEY(module_id) REFERENCES assessment_modules(id)
);
