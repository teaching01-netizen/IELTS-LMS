ALTER TABLE exam_session_runtimes
    ADD COLUMN timing_model VARCHAR(32) NOT NULL DEFAULT 'legacy_section_v1' AFTER plan_snapshot,
    ADD CONSTRAINT chk_exam_session_runtime_timing_model
        CHECK (timing_model IN ('legacy_section_v1', 'cohort_stage_v2'));
