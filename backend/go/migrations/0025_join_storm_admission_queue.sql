CREATE TABLE student_admission_queue (
    id VARCHAR(36) PRIMARY KEY,
    schedule_id VARCHAR(36) NOT NULL,
    wcode VARCHAR(32) NOT NULL,
    student_email VARCHAR(255) NOT NULL,
    student_name VARCHAR(255) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'queued',
    queue_key VARCHAR(128) NOT NULL,
    enqueue_attempts INT NOT NULL DEFAULT 1,
    admitted_at TIMESTAMP NULL,
    last_seen_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_student_admission_queue_status
        CHECK (status IN ('queued', 'admitted', 'consumed', 'cancelled')),
    UNIQUE KEY uq_student_admission_queue_schedule_wcode (schedule_id, wcode),
    INDEX idx_student_admission_queue_schedule_status_created (schedule_id, status, created_at, id),
    INDEX idx_student_admission_queue_queue_key (queue_key)
);
