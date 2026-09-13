# ACT Phase 01 contract fixtures

Phase 01 contract inputs only; no product behavior is defined here.

- `nested_science_content.json` — canonical authoring shape `{stimuli[]}` with
  nested blocks/questions/options plus one durable stimulus image reference.
- `compact_scoring_projection.json` — sealed scoring projection
  `{questions:[{questionId, correctAnswer}]}`.
- `alias_variant_content.json` — read-alias spellings (`question_id` /
  `correct_answer` / `answer`, `id`) that must normalize to the same key.
- `options_only_content.json` — isCorrect-derived key material plus one
  keyless draft question (no correct option) that must stay keyless.
- `answers_canonical.json` / `answers_nested.json` — canonical and legacy
  nested answer maps with trim/case and null-unanswered coverage.
- `answers_edge.json` — blank/whitespace/null plus an unknown question ID
  (audit-only, never scored).
- `result_sealed.json` / `result_keyless.json` — sealed result payloads for
  ordered detail, answered/unanswered verdicts, and legacy keyless rows.
- `image_reference.json` — durable asset reference (never a data URL).
