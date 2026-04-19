-- Grading, submissions, and released results

CREATE TABLE IF NOT EXISTS grading_sessions (
    id VARCHAR(36) PRIMARY KEY,
    schedule_id VARCHAR(36) NOT NULL UNIQUE,
    exam_id VARCHAR(36) NOT NULL,
    exam_title VARCHAR(255) NOT NULL,
    published_version_id VARCHAR(36) NOT NULL,
    cohort_name VARCHAR(255) NOT NULL,
    institution VARCHAR(255),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('scheduled', 'live', 'in_progress', 'completed', 'cancelled')),
    total_students INT NOT NULL DEFAULT 0,
    submitted_count INT NOT NULL DEFAULT 0,
    pending_manual_reviews INT NOT NULL DEFAULT 0,
    in_progress_reviews INT NOT NULL DEFAULT 0,
    finalized_reviews INT NOT NULL DEFAULT 0,
    overdue_reviews INT NOT NULL DEFAULT 0,
    assigned_teachers JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE,
    FOREIGN KEY (published_version_id) REFERENCES exam_versions(id)
);

CREATE TABLE IF NOT EXISTS student_submissions (
    id VARCHAR(36) PRIMARY KEY,
    attempt_id VARCHAR(36) NOT NULL UNIQUE,
    schedule_id VARCHAR(36) NOT NULL,
    exam_id VARCHAR(36) NOT NULL,
    published_version_id VARCHAR(36) NOT NULL,
    student_id VARCHAR(255) NOT NULL,
    student_name VARCHAR(255) NOT NULL,
    student_email VARCHAR(255),
    cohort_name VARCHAR(255) NOT NULL,
    submitted_at TIMESTAMP NOT NULL,
    time_spent_seconds INT NOT NULL DEFAULT 0,
    grading_status VARCHAR(50) NOT NULL CHECK (grading_status IN ('not_submitted', 'submitted', 'in_progress', 'grading_complete', 'ready_to_release', 'released', 'reopened')),
    assigned_teacher_id VARCHAR(255),
    assigned_teacher_name VARCHAR(255),
    is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    flag_reason TEXT,
    is_overdue BOOLEAN NOT NULL DEFAULT FALSE,
    due_date TIMESTAMP,
    section_statuses JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE,
    FOREIGN KEY (published_version_id) REFERENCES exam_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_student_submissions_schedule_submitted
    ON student_submissions(schedule_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_submissions_status_updated
    ON student_submissions(grading_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS section_submissions (
    id VARCHAR(36) PRIMARY KEY,
    submission_id VARCHAR(36) NOT NULL,
    section VARCHAR(50) NOT NULL CHECK (section IN ('listening', 'reading', 'writing', 'speaking')),
    answers JSON NOT NULL,
    auto_grading_results JSON,
    grading_status VARCHAR(50) NOT NULL CHECK (grading_status IN ('pending', 'auto_graded', 'needs_review', 'in_review', 'finalized', 'reopened')),
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP,
    finalized_by VARCHAR(255),
    finalized_at TIMESTAMP,
    submitted_at TIMESTAMP NOT NULL,
    CONSTRAINT section_submissions_submission_section UNIQUE (submission_id, section),
    FOREIGN KEY (submission_id) REFERENCES student_submissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS writing_task_submissions (
    id VARCHAR(36) PRIMARY KEY,
    section_submission_id VARCHAR(36) NOT NULL,
    submission_id VARCHAR(36) NOT NULL,
    task_id VARCHAR(255) NOT NULL,
    task_label VARCHAR(255) NOT NULL,
    prompt TEXT NOT NULL,
    student_text TEXT NOT NULL,
    word_count INT NOT NULL DEFAULT 0,
    rubric_assessment JSON,
    annotations JSON NOT NULL,
    overall_feedback TEXT,
    student_visible_notes TEXT,
    grading_status VARCHAR(50) NOT NULL CHECK (grading_status IN ('pending', 'auto_graded', 'needs_review', 'in_review', 'finalized', 'reopened')),
    submitted_at TIMESTAMP NOT NULL,
    graded_by VARCHAR(255),
    graded_at TIMESTAMP,
    finalized_by VARCHAR(255),
    finalized_at TIMESTAMP,
    CONSTRAINT writing_task_submissions_task_unique UNIQUE (section_submission_id, task_id),
    FOREIGN KEY (section_submission_id) REFERENCES section_submissions(id) ON DELETE CASCADE,
    FOREIGN KEY (submission_id) REFERENCES student_submissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_drafts (
    id VARCHAR(36) PRIMARY KEY,
    submission_id VARCHAR(36) NOT NULL UNIQUE,
    student_id VARCHAR(255) NOT NULL,
    teacher_id VARCHAR(255) NOT NULL,
    release_status VARCHAR(50) NOT NULL CHECK (release_status IN ('draft', 'grading_complete', 'ready_to_release', 'released', 'reopened')),
    section_drafts JSON NOT NULL,
    annotations JSON NOT NULL,
    drawings JSON NOT NULL,
    overall_feedback TEXT,
    student_visible_notes TEXT,
    internal_notes TEXT,
    teacher_summary JSON NOT NULL,
    checklist JSON NOT NULL,
    has_unsaved_changes BOOLEAN NOT NULL DEFAULT FALSE,
    last_auto_save_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    revision INT NOT NULL DEFAULT 0,
    FOREIGN KEY (submission_id) REFERENCES student_submissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_events (
    id VARCHAR(36) PRIMARY KEY,
    submission_id VARCHAR(36) NOT NULL,
    teacher_id VARCHAR(255) NOT NULL,
    teacher_name VARCHAR(255) NOT NULL,
    action VARCHAR(255) NOT NULL CHECK (action IN ('review_started', 'review_assigned', 'draft_saved', 'comment_added', 'comment_updated', 'rubric_updated', 'review_finalized', 'review_reopened', 'score_override', 'feedback_updated', 'release_now', 'mark_ready_to_release')),
    section VARCHAR(50),
    task_id VARCHAR(255),
    annotation_id VARCHAR(255),
    question_id VARCHAR(255),
    from_status VARCHAR(50),
    to_status VARCHAR(50),
    payload JSON,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (submission_id) REFERENCES student_submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_review_events_submission_created
    ON review_events(submission_id, created_at DESC);

CREATE TABLE IF NOT EXISTS student_results (
    id VARCHAR(36) PRIMARY KEY,
    submission_id VARCHAR(36) NOT NULL,
    student_id VARCHAR(255) NOT NULL,
    student_name VARCHAR(255) NOT NULL,
    release_status VARCHAR(50) NOT NULL CHECK (release_status IN ('draft', 'grading_complete', 'ready_to_release', 'released', 'reopened')),
    released_at TIMESTAMP,
    released_by VARCHAR(255),
    scheduled_release_date TIMESTAMP,
    overall_band DOUBLE NOT NULL DEFAULT 0,
    section_bands JSON NOT NULL,
    listening_result JSON,
    reading_result JSON,
    writing_results JSON NOT NULL,
    speaking_result JSON,
    teacher_summary JSON NOT NULL,
    version INT NOT NULL DEFAULT 1,
    previous_version_id VARCHAR(36),
    revision_reason TEXT,
    authorized_actor_id VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (submission_id) REFERENCES student_submissions(id) ON DELETE CASCADE,
    FOREIGN KEY (previous_version_id) REFERENCES student_results(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_student_results_submission_updated
    ON student_results(submission_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_results_release_status_updated
    ON student_results(release_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS release_events (
    id VARCHAR(36) PRIMARY KEY,
    result_id VARCHAR(36) NOT NULL,
    submission_id VARCHAR(36) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    action VARCHAR(255) NOT NULL,
    payload JSON,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (result_id) REFERENCES student_results(id) ON DELETE CASCADE,
    FOREIGN KEY (submission_id) REFERENCES student_submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_release_events_result_created
    ON release_events(result_id, created_at DESC);

-- Note: GRANT statements removed - using MySQL user management instead
-- Note: Triggers for updated_at removed - using ON UPDATE CURRENT_TIMESTAMP instead
