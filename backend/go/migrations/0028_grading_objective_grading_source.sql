-- Schedule-scoped objective grading source selection.
-- Allows objective auto-grading (reading/listening) to be computed from a specific exam version
-- (e.g. latest draft) instead of always using the published version the student sat.

CREATE TABLE IF NOT EXISTS grading_schedule_objective_grading_source (
    schedule_id VARCHAR(36) NOT NULL PRIMARY KEY,
    source VARCHAR(255) NOT NULL CHECK (source IN ('published_version', 'draft_version')),
    version_id VARCHAR(36) NULL,
    updated_by_actor_id VARCHAR(255) NOT NULL,
    updated_by_actor_name VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (version_id) REFERENCES exam_versions(id) ON DELETE SET NULL
);

CREATE INDEX idx_grading_schedule_objective_grading_source_updated
    ON grading_schedule_objective_grading_source(updated_at DESC);

