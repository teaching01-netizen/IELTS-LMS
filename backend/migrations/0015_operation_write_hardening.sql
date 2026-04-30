CREATE TABLE IF NOT EXISTS student_attempt_answer_slots (
    attempt_id VARCHAR(36) NOT NULL,
    question_id VARCHAR(255) NOT NULL,
    slot_index INT NOT NULL,
    value_text TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (attempt_id, question_id, slot_index),
    CONSTRAINT student_attempt_answer_slots_attempt_fk
        FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE
);

SET @idx_slots_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'student_attempt_answer_slots'
      AND index_name = 'idx_student_attempt_answer_slots_attempt_question'
);
SET @idx_slots_sql := IF(
    @idx_slots_exists = 0,
    'CREATE INDEX idx_student_attempt_answer_slots_attempt_question ON student_attempt_answer_slots(attempt_id, question_id, slot_index)',
    'SELECT 1'
);
PREPARE idx_slots_stmt FROM @idx_slots_sql;
EXECUTE idx_slots_stmt;
DEALLOCATE PREPARE idx_slots_stmt;

-- Normalize legacy duplicate mutation rows before enforcing uniqueness.
DELETE m1
FROM student_attempt_mutations m1
JOIN student_attempt_mutations m2
  ON m1.attempt_id = m2.attempt_id
 AND m1.client_session_id = m2.client_session_id
 AND m1.client_mutation_id = m2.client_mutation_id
 AND (
      m1.server_received_at > m2.server_received_at
   OR (m1.server_received_at = m2.server_received_at AND m1.id > m2.id)
 );

SET @idx_session_mut_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'student_attempt_mutations'
      AND index_name = 'idx_student_attempt_mutations_attempt_session_mutation_id'
);
SET @idx_session_mut_sql := IF(
    @idx_session_mut_exists = 0,
    'CREATE UNIQUE INDEX idx_student_attempt_mutations_attempt_session_mutation_id ON student_attempt_mutations(attempt_id, client_session_id, client_mutation_id)',
    'SELECT 1'
);
PREPARE idx_session_mut_stmt FROM @idx_session_mut_sql;
EXECUTE idx_session_mut_stmt;
DEALLOCATE PREPARE idx_session_mut_stmt;
