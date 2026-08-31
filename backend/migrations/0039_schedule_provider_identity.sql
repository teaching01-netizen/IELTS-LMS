ALTER TABLE exam_schedules
    ADD COLUMN provider_key VARCHAR(32) NULL AFTER exam_id;

UPDATE exam_schedules schedules
JOIN exam_entities exams ON exams.id = schedules.exam_id
SET schedules.provider_key = exams.provider_key
WHERE schedules.provider_key IS NULL;

ALTER TABLE exam_schedules
    MODIFY provider_key VARCHAR(32) NOT NULL,
    ADD CONSTRAINT chk_exam_schedules_provider_key CHECK (provider_key IN ('ielts', 'sat'));

CREATE INDEX idx_exam_schedules_provider_status_start
    ON exam_schedules(provider_key, status, start_time ASC);

ALTER TABLE exam_session_runtimes
    ADD COLUMN provider_key VARCHAR(32) NULL AFTER exam_id;

UPDATE exam_session_runtimes runtimes
JOIN exam_entities exams ON exams.id = runtimes.exam_id
SET runtimes.provider_key = exams.provider_key
WHERE runtimes.provider_key IS NULL;

ALTER TABLE exam_session_runtimes
    MODIFY provider_key VARCHAR(32) NOT NULL,
    ADD CONSTRAINT chk_exam_session_runtimes_provider_key CHECK (provider_key IN ('ielts', 'sat'));

CREATE INDEX idx_exam_session_runtimes_provider_status
    ON exam_session_runtimes(provider_key, status);
