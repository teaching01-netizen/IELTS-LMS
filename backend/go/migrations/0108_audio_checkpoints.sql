-- 0108_audio_checkpoints.sql
-- Durable audio position checkpoints for protected IELTS listening parts
-- (docs/superpowers/plans/2026-10-28-staff-assisted-exam-recovery.md §3.4).
--
-- A checkpoint is keyed by the pinned part identity plus its media revision,
-- never by a transient signed URL. One stream exists per part. The server
-- accepts a newer client_sequence from the current authorized lease/run; a
-- legitimate backwards seek may lower position_ms, so position is never a
-- monotonic authority. run_generation scopes a continuation to the run that
-- wrote it, and lease_epoch fences a superseded browser.

CREATE TABLE IF NOT EXISTS attempt_audio_checkpoints (
    attempt_id VARCHAR(36) NOT NULL,
    section_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    part_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    media_revision VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    position_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
    client_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
    lease_epoch BIGINT UNSIGNED NOT NULL,
    run_generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (attempt_id, section_key, part_id, media_revision),
    CONSTRAINT fk_attempt_audio_checkpoints_attempt
        FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE
);
