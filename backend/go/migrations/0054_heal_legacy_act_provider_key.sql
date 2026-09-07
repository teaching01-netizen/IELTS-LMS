-- 0054_heal_legacy_act_provider_key.sql
-- ACT exams created through the legacy IELTS path carry provider_key='ielts'
-- with exam_type='ACT' (and provider_exam_type='ACT'). The runtime planner,
-- publish validation, and section allowlists key off provider_key, so those
-- rows silently lost the science section (plan fell back to a single reading
-- entry). Promote them to provider_key='act' so stored identity matches the
-- authored ACT content. IELTS rows are untouched (exam_type != 'ACT').

UPDATE exam_entities
SET provider_key = 'act', updated_at = NOW()
WHERE exam_type = 'ACT'
  AND provider_key <> 'act';
