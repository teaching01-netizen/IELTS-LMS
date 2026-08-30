ALTER TABLE exam_session_runtimes
    DROP CHECK chk_exam_session_runtime_timing_model;

ALTER TABLE exam_session_runtimes
    ADD CONSTRAINT chk_exam_session_runtime_timing_model
        CHECK (timing_model IN ('legacy_section_v1', 'cohort_stage_v2', 'cohort_section_v3'));
