-- Read-only truth table for satClassroomRawScoreAvailableSQL on the local
-- MySQL server. MySQL JSON is structurally valid but its nested shape is not
-- constrained by the score_payload column.
WITH cases AS (
  SELECT 'valid' AS label, TRUE AS result_exists, 'scored' AS outcome, NULL AS legacy_total,
    CAST('{"classroomRaw":{"rawCorrect":42,"total":54}}' AS JSON) AS score_payload
  UNION ALL SELECT 'json-null', TRUE, 'scored', NULL, CAST('{"classroomRaw":null}' AS JSON)
  UNION ALL SELECT 'missing-total', TRUE, 'scored', NULL, CAST('{"classroomRaw":{"rawCorrect":2}}' AS JSON)
  UNION ALL SELECT 'fractional', TRUE, 'scored', NULL, CAST('{"classroomRaw":{"rawCorrect":1.5,"total":54}}' AS JSON)
  UNION ALL SELECT 'integral-decimal', TRUE, 'scored', NULL, CAST('{"classroomRaw":{"rawCorrect":42.0,"total":54}}' AS JSON)
  UNION ALL SELECT 'string-count', TRUE, 'scored', NULL, CAST('{"classroomRaw":{"rawCorrect":"abc","total":54}}' AS JSON)
  UNION ALL SELECT 'signed-int64-max', TRUE, 'scored', NULL, CAST('{"classroomRaw":{"rawCorrect":9223372036854775807,"total":9223372036854775807}}' AS JSON)
  UNION ALL SELECT 'signed-int64-overflow', TRUE, 'scored', NULL, CAST('{"classroomRaw":{"rawCorrect":9223372036854775808,"total":9223372036854775808}}' AS JSON)
  UNION ALL SELECT 'negative', TRUE, 'scored', NULL, CAST('{"classroomRaw":{"rawCorrect":-1,"total":54}}' AS JSON)
  UNION ALL SELECT 'zero-total', TRUE, 'scored', NULL, CAST('{"classroomRaw":{"rawCorrect":0,"total":0}}' AS JSON)
  UNION ALL SELECT 'over-total', TRUE, 'scored', NULL, CAST('{"classroomRaw":{"rawCorrect":55,"total":54}}' AS JSON)
  UNION ALL SELECT 'legacy-score', TRUE, 'scored', 1200, CAST('{"classroomRaw":null}' AS JSON)
  UNION ALL SELECT 'pending', TRUE, 'pending', NULL, CAST('{"classroomRaw":{"rawCorrect":42,"total":54}}' AS JSON)
  UNION ALL SELECT 'no-result', FALSE, 'unscored', NULL, CAST('{}' AS JSON)
), classified AS (
  SELECT label, result_exists, outcome, legacy_total,
    COALESCE((
      JSON_TYPE(JSON_EXTRACT(score_payload, '$.classroomRaw')) = 'OBJECT'
      AND JSON_TYPE(JSON_EXTRACT(score_payload, '$.classroomRaw.rawCorrect')) IN ('INTEGER', 'UNSIGNED INTEGER')
      AND JSON_TYPE(JSON_EXTRACT(score_payload, '$.classroomRaw.total')) IN ('INTEGER', 'UNSIGNED INTEGER')
      AND JSON_EXTRACT(score_payload, '$.classroomRaw.rawCorrect') >= 0
      AND JSON_EXTRACT(score_payload, '$.classroomRaw.total') > 0
      AND JSON_EXTRACT(score_payload, '$.classroomRaw.rawCorrect') <= 9223372036854775807
      AND JSON_EXTRACT(score_payload, '$.classroomRaw.total') <= 9223372036854775807
      AND JSON_EXTRACT(score_payload, '$.classroomRaw.rawCorrect') <= JSON_EXTRACT(score_payload, '$.classroomRaw.total')
    ), FALSE) AS raw_available
  FROM cases
)
SELECT label,
  (result_exists AND outcome = 'scored' AND (legacy_total IS NOT NULL OR raw_available)) AS available,
  (NOT result_exists OR COALESCE(outcome, '') <> 'scored' OR (legacy_total IS NULL AND NOT raw_available)) AS unavailable,
  (JSON_EXTRACT(CAST('{"classroomRaw":null}' AS JSON), '$.classroomRaw') IS NOT NULL) AS old_json_null_presence
FROM classified
ORDER BY label;

SHOW COUNT(*) WARNINGS;
