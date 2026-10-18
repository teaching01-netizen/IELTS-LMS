-- A section clock opens only after every admitted, nonterminal candidate is ready.
CREATE TABLE IF NOT EXISTS ielts_section_readiness (
  runtime_id VARCHAR(36) NOT NULL,
  section_key VARCHAR(64) NOT NULL,
  attempt_id VARCHAR(36) NOT NULL,
  round_trip_ms INT NOT NULL,
  ready_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (runtime_id, section_key, attempt_id)
);
