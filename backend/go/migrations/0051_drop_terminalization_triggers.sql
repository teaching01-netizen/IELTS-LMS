-- 0051_drop_terminalization_triggers.sql
-- The Go application now owns terminalization and legacy projection writes
-- transactionally. MySQL removes the temporary rolling-deploy triggers from
-- 0043; the Go migrator skips this file's trigger statements on TiDB, whose
-- trigger-less deployment uses the same application invariant.

DROP TRIGGER IF EXISTS attempt_terminalizations_legacy_projection;
DROP TRIGGER IF EXISTS attempt_terminalizations_legacy_insert;
DROP TRIGGER IF EXISTS attempt_terminalizations_immutable_update;
DROP TRIGGER IF EXISTS attempt_terminalizations_immutable_delete;
