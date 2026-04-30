-- Enforce idempotency identity per attempt regardless of client session.
-- This complements application-layer duplicate detection and stale-session guards.
DELETE m1
FROM student_attempt_mutations m1
JOIN student_attempt_mutations m2
  ON m1.attempt_id = m2.attempt_id
 AND m1.client_mutation_id = m2.client_mutation_id
 AND (
      m1.server_received_at > m2.server_received_at
   OR (m1.server_received_at = m2.server_received_at AND m1.id > m2.id)
 );

SET @idx_attempt_mut_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'student_attempt_mutations'
      AND index_name = 'idx_student_attempt_mutations_attempt_mutation_id'
);
SET @idx_attempt_mut_sql := IF(
    @idx_attempt_mut_exists = 0,
    'CREATE UNIQUE INDEX idx_student_attempt_mutations_attempt_mutation_id ON student_attempt_mutations(attempt_id, client_mutation_id)',
    'SELECT 1'
);
PREPARE idx_attempt_mut_stmt FROM @idx_attempt_mut_sql;
EXECUTE idx_attempt_mut_stmt;
DEALLOCATE PREPARE idx_attempt_mut_stmt;
