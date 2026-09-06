-- Improve ordering stability for release events created within the same second.
-- Without fractional seconds, ORDER BY created_at DESC can produce nondeterministic ordering
-- when multiple events share the same timestamp.

ALTER TABLE release_events
    MODIFY created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);

