-- Schedule answer-key overrides for slot questions ("blk-…:lbl-…") were keyed
-- by the still-escaped path segment ("blk-…%3Albl-…"), so grading never
-- applied them. Re-key them to the real question id; a decoded row written
-- after the API fix wins over its escaped twin. The literal legacy marker is
-- "%3A"; every touched row is backed up first (MIGRATION_POLICY §1/§2).

CREATE TABLE IF NOT EXISTS backup_0115_schedule_question_overrides AS
SELECT * FROM grading_schedule_question_overrides WHERE question_id LIKE '%\%3A%';

SET @escaped_overrides := (
    SELECT COUNT(*) FROM grading_schedule_question_overrides WHERE question_id LIKE '%\%3A%'
);
SET @escaped_guard_sql := IF(@escaped_overrides > 10000,
    'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''0115 escaped override rows exceed justified bound''',
    'SELECT 1');
PREPARE escaped_guard_stmt FROM @escaped_guard_sql;
EXECUTE escaped_guard_stmt;
DEALLOCATE PREPARE escaped_guard_stmt;

DELETE stale FROM grading_schedule_question_overrides stale
JOIN grading_schedule_question_overrides decoded
  ON decoded.schedule_id = stale.schedule_id
 AND decoded.question_id = REPLACE(stale.question_id, '%3A', ':')
WHERE stale.question_id LIKE '%\%3A%';

UPDATE grading_schedule_question_overrides
SET question_id = REPLACE(question_id, '%3A', ':')
WHERE question_id LIKE '%\%3A%';
