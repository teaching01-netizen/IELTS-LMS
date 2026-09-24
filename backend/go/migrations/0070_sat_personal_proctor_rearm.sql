-- 0070_sat_personal_proctor_rearm.sql
-- A proctor-authorized fresh entry window for one attempt-owned stage.
--
-- sat_personal_v1 bounds automatic rearming by schedule admission closure and a
-- small server-enforced retry budget. That bound is what makes a candidate who
-- keeps missing the offer lead (slow device, hidden tab) or who loses an offer
-- after exam_schedules.end_time has passed unrecoverable: the room is still live,
-- but no offer can be armed any more.
--
-- entry_proctor_rearm_at records that an authorized proctor granted the stage a
-- fresh window. While it is set:
--   - the arm path does not refuse an offer for admission closure, so the
--     candidate can still be given their authored time after admission closed;
--   - entry_generation is reset to 0, so the retry budget starts over.
-- It is ignored once the stage is entered (the clock belongs to the candidate
-- from the moment they have seen it) and a finalized stage is refused outright,
-- so this can never hand out time a candidate already spent.

SET @module_rearm_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_attempts'
      AND column_name = 'entry_proctor_rearm_at'
);
SET @module_rearm_sql := IF(
    @module_rearm_exists = 0,
    'ALTER TABLE assessment_module_attempts ADD COLUMN entry_proctor_rearm_at TIMESTAMP(6) NULL AFTER entry_generation',
    'SELECT 1'
);
PREPARE module_rearm_stmt FROM @module_rearm_sql;
EXECUTE module_rearm_stmt;
DEALLOCATE PREPARE module_rearm_stmt;

SET @break_rearm_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_attempt_breaks'
      AND column_name = 'entry_proctor_rearm_at'
);
SET @break_rearm_sql := IF(
    @break_rearm_exists = 0,
    'ALTER TABLE assessment_attempt_breaks ADD COLUMN entry_proctor_rearm_at TIMESTAMP(6) NULL AFTER entry_generation',
    'SELECT 1'
);
PREPARE break_rearm_stmt FROM @break_rearm_sql;
EXECUTE break_rearm_stmt;
DEALLOCATE PREPARE break_rearm_stmt;
