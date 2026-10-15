-- 0090_exam_purge_terminalization_fence.sql
-- Permanent exam delete removes the exam's rooms, attempts and results. Their
-- attempt_terminalizations receipts must go with them, but 0056 rejects every
-- DELETE on that table. This narrows the delete guard: a receipt may be deleted
-- only while the deleting session has set @exam_purge_id to the exam that owns
-- the receipt's attempt (exams.Service.Delete does this inside its
-- transaction). Every other DELETE, and every UPDATE (0056), is still rejected.
--
-- The migration splitter treats each CREATE TRIGGER as one statement, so the
-- conditional rejection writes the decision into a one-row fence table whose
-- CHECK constraint fails when the delete is not allowed (as in 0084/0086/0087).
-- The upsert also fails closed if the fence row is ever removed. The id is
-- compared as binary: a user variable carries the connection's collation,
-- which need not match the column's.
--
-- Crash-retry safety: CREATE TABLE IF NOT EXISTS, INSERT IGNORE, DROP TRIGGER
-- IF EXISTS + CREATE TRIGGER. TiDB skips trigger statements (see 0056).

CREATE TABLE IF NOT EXISTS attempt_terminalization_delete_fence (
    id TINYINT NOT NULL,
    delete_allowed TINYINT NOT NULL DEFAULT 1,
    PRIMARY KEY (id),
    CONSTRAINT chk_attempt_terminalizations_immutable CHECK (id = 1 AND delete_allowed = 1)
);

INSERT IGNORE INTO attempt_terminalization_delete_fence (id, delete_allowed) VALUES (1, 1);

DROP TRIGGER IF EXISTS attempt_terminalizations_immutable_delete;

CREATE TRIGGER attempt_terminalizations_immutable_delete
BEFORE DELETE ON attempt_terminalizations
FOR EACH ROW
INSERT INTO attempt_terminalization_delete_fence (id, delete_allowed)
VALUES (1, COALESCE(@exam_purge_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM student_attempts a
    WHERE a.id = OLD.attempt_id AND a.exam_id = CAST(@exam_purge_id AS BINARY)
), 0)) AS fence
ON DUPLICATE KEY UPDATE delete_allowed = fence.delete_allowed;
