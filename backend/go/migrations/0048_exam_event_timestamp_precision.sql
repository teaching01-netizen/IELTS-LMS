-- Preserve event order when authoring operations occur within one second.
ALTER TABLE exam_events
    MODIFY created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);
