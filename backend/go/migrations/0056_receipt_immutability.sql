-- 0056_receipt_immutability.sql
-- WS-07 receipt immutability: re-creates EXACTLY the two immutability
-- triggers on attempt_terminalizations dropped by 0051:7-10 (exact
-- definitions from 0043:187-192). The two legacy-projection triggers also
-- dropped by 0051 stay dropped (their removal was intended — the Go
-- application owns terminalization and legacy projection writes
-- transactionally).
--
-- Crash-retry safety: DROP TRIGGER IF EXISTS + CREATE TRIGGER, so a retry
-- after a crash mid-file converges. On TiDB the migrator skips trigger
-- statements (no trigger support) and, in production, refuses outright via
-- the engine gate in cmd/migrate/main.go (MySQL 8.4 is the supported prod
-- engine) — the application transaction paths remain the single owner of
-- the terminalization invariant there.

DROP TRIGGER IF EXISTS attempt_terminalizations_immutable_update;
DROP TRIGGER IF EXISTS attempt_terminalizations_immutable_delete;

CREATE TRIGGER attempt_terminalizations_immutable_update
BEFORE UPDATE ON attempt_terminalizations
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'attempt_terminalizations is immutable';

CREATE TRIGGER attempt_terminalizations_immutable_delete
BEFORE DELETE ON attempt_terminalizations
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'attempt_terminalizations is immutable';
