-- Database-owned, immutable terminal fact for every student attempt.
-- This is the authoritative exam completion/termination record. The legacy
-- submitted_at/final_submission columns remain compatibility projections.

ALTER TABLE student_attempts
    MODIFY COLUMN submitted_at TIMESTAMP(6) NULL,
    ADD COLUMN answer_revision INT NOT NULL DEFAULT 0 AFTER revision;

CREATE INDEX idx_student_attempts_schedule_answer_revision
    ON student_attempts(schedule_id, answer_revision, id);

CREATE TABLE attempt_terminalizations (
    attempt_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(255),
    terminalization_id VARCHAR(36) NOT NULL,
    schedule_id VARCHAR(36) NOT NULL,
    outcome VARCHAR(16) NOT NULL,
    reason VARCHAR(64) NOT NULL,
    actor_kind VARCHAR(16) NOT NULL,
    actor_id VARCHAR(255),
    effective_at TIMESTAMP(6) NOT NULL,
    recorded_at TIMESTAMP(6) NOT NULL,
    answer_revision INT NOT NULL,
    final_snapshot JSON NOT NULL,
    schedule_transition_id VARCHAR(36),
    request_id VARCHAR(36) NOT NULL,
    PRIMARY KEY (attempt_id),
    UNIQUE KEY uq_attempt_terminalizations_id (terminalization_id),
    CONSTRAINT chk_attempt_terminalizations_outcome
        CHECK (outcome IN ('submitted', 'terminated')),
    CONSTRAINT chk_attempt_terminalizations_reason
        CHECK (reason IN (
            'student_submit',
            'sat_complete',
            'time_expired',
            'auto_stop',
            'proctor_complete',
            'proctor_end',
            'proctor_force_submit',
            'proctor_terminate',
            'legacy_unknown'
        )),
    CONSTRAINT chk_attempt_terminalizations_actor_kind
        CHECK (actor_kind IN ('student', 'proctor', 'system')),
    CONSTRAINT fk_attempt_terminalizations_attempt
        FOREIGN KEY (attempt_id) REFERENCES student_attempts(id),
    CONSTRAINT fk_attempt_terminalizations_schedule
        FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id)
);

CREATE INDEX idx_attempt_terminalizations_schedule_recorded
    ON attempt_terminalizations(schedule_id, recorded_at, attempt_id);

-- During rolling deployment, old application versions may still write the
-- compatibility projection directly. Materialize a conservative receipt for
-- those writes so terminal state never exists without a matching receipt.
CREATE TRIGGER attempt_terminalizations_legacy_projection
AFTER UPDATE ON student_attempts
FOR EACH ROW
INSERT IGNORE INTO attempt_terminalizations (
    attempt_id,
    organization_id,
    terminalization_id,
    schedule_id,
    outcome,
    reason,
    actor_kind,
    actor_id,
    effective_at,
    recorded_at,
    answer_revision,
    final_snapshot,
    request_id
)
SELECT
    NEW.id,
    NEW.organization_id,
    UUID(),
    NEW.schedule_id,
    IF(NEW.proctor_status = 'terminated', 'terminated', 'submitted'),
    'legacy_unknown',
    'system',
    NULL,
    COALESCE(NEW.submitted_at, UTC_TIMESTAMP(6)),
    UTC_TIMESTAMP(6),
    NEW.answer_revision,
    JSON_OBJECT(
        'attemptId', NEW.id,
        'scheduleId', NEW.schedule_id,
        'organizationId', NEW.organization_id,
        'examId', NEW.exam_id,
        'publishedVersionId', NEW.published_version_id,
        'providerKey', 'legacy',
        'answerRevision', NEW.answer_revision,
        'answers', NEW.answers,
        'writingAnswers', NEW.writing_answers,
        'flags', NEW.flags
    ),
    UUID()
FROM DUAL
WHERE OLD.submitted_at IS NULL
  AND NEW.submitted_at IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM attempt_terminalizations existing
      WHERE existing.attempt_id = NEW.id
  );

CREATE TRIGGER attempt_terminalizations_legacy_insert
AFTER INSERT ON student_attempts
FOR EACH ROW
INSERT IGNORE INTO attempt_terminalizations (
    attempt_id,
    organization_id,
    terminalization_id,
    schedule_id,
    outcome,
    reason,
    actor_kind,
    actor_id,
    effective_at,
    recorded_at,
    answer_revision,
    final_snapshot,
    request_id
)
SELECT
    NEW.id,
    NEW.organization_id,
    UUID(),
    NEW.schedule_id,
    IF(NEW.proctor_status = 'terminated', 'terminated', 'submitted'),
    'legacy_unknown',
    'system',
    NULL,
    COALESCE(NEW.submitted_at, UTC_TIMESTAMP(6)),
    UTC_TIMESTAMP(6),
    NEW.answer_revision,
    JSON_OBJECT(
        'attemptId', NEW.id,
        'scheduleId', NEW.schedule_id,
        'organizationId', NEW.organization_id,
        'examId', NEW.exam_id,
        'publishedVersionId', NEW.published_version_id,
        'providerKey', 'legacy',
        'answerRevision', NEW.answer_revision,
        'answers', NEW.answers,
        'writingAnswers', NEW.writing_answers,
        'flags', NEW.flags
    ),
    UUID()
FROM DUAL
WHERE NEW.submitted_at IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM attempt_terminalizations existing
      WHERE existing.attempt_id = NEW.id
  );

-- No application path may mutate or delete an authoritative terminal fact.
CREATE TRIGGER attempt_terminalizations_immutable_update
BEFORE UPDATE ON attempt_terminalizations
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'attempt_terminalizations is immutable';

CREATE TRIGGER attempt_terminalizations_immutable_delete
BEFORE DELETE ON attempt_terminalizations
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'attempt_terminalizations is immutable';

-- Backfill existing terminal attempts. Historical submitted_at is preserved;
-- actor and reason remain explicitly unknown rather than being invented.
INSERT IGNORE INTO attempt_terminalizations (
    attempt_id,
    organization_id,
    terminalization_id,
    schedule_id,
    outcome,
    reason,
    actor_kind,
    actor_id,
    effective_at,
    recorded_at,
    answer_revision,
    final_snapshot,
    request_id
)
SELECT
    a.id,
    a.organization_id,
    UUID(),
    a.schedule_id,
    IF(a.proctor_status = 'terminated', 'terminated', 'submitted'),
    'legacy_unknown',
    'system',
    NULL,
    COALESCE(a.submitted_at, a.updated_at),
    UTC_TIMESTAMP(6),
    a.answer_revision,
    JSON_OBJECT(
        'attemptId', a.id,
        'scheduleId', a.schedule_id,
        'organizationId', a.organization_id,
        'examId', a.exam_id,
        'publishedVersionId', a.published_version_id,
        'providerKey', 'legacy',
        'answerRevision', a.answer_revision,
        'answers', a.answers,
        'writingAnswers', a.writing_answers,
        'flags', a.flags
    ),
    UUID()
FROM student_attempts a
WHERE a.submitted_at IS NOT NULL;
