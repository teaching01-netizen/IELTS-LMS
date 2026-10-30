-- Provider-neutral evidence for drafts a browser could not save before an
-- answer window closed (docs/plans/2026-10-29-exam-session-continuity.md FR7).
-- Evidence never changes responses or scores. Provenance columns are written
-- once; only the one-time staff review columns may change afterwards. A claimed
-- client time is evidence, not proof of timely completion.
CREATE TABLE IF NOT EXISTS attempt_draft_evidence (
  id CHAR(36) NOT NULL,
  attempt_id VARCHAR(36) NOT NULL,
  schedule_id VARCHAR(36) NOT NULL,
  write_id VARCHAR(128) NOT NULL,
  question_id VARCHAR(255) NOT NULL,
  response JSON NOT NULL,
  response_hash CHAR(64) NOT NULL,
  origin_lease_epoch BIGINT UNSIGNED NULL,
  client_version BIGINT UNSIGNED NULL,
  claimed_client_at DATETIME(6) NULL,
  received_at DATETIME(6) NOT NULL,
  received_token_id VARCHAR(64) NOT NULL,
  reason VARCHAR(64) NOT NULL,
  disposition VARCHAR(16) NOT NULL DEFAULT 'pending',
  reviewed_by VARCHAR(36) NULL,
  reviewed_at DATETIME(6) NULL,
  review_note VARCHAR(1000) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_draft_evidence_attempt_write (attempt_id, write_id),
  KEY idx_draft_evidence_review (schedule_id, disposition, received_at),
  CONSTRAINT chk_draft_evidence_disposition CHECK (disposition IN ('pending', 'relevant', 'not_relevant')),
  CONSTRAINT chk_draft_evidence_review CHECK ((disposition = 'pending') = (reviewed_at IS NULL))
);
