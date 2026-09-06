-- 0053_backfill_attempt_user_ids.sql
-- V2 attempt authorization binds the attempt to the authenticated user. Older
-- registrations already carry that identity, so repair migrated rows before
-- the Go V2 write path starts minting or accepting new credentials.

UPDATE student_attempts a
JOIN schedule_registrations r ON r.id = a.registration_id
SET a.user_id = r.user_id
WHERE a.user_id IS NULL
  AND r.user_id IS NOT NULL;
