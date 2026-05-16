---
title: Objective Text Grading Ignores Word Limits
date: 2026-05-16
status: approved
---

# Goal

Make objective text grading consistent with staff-entered answer keys that use `|` variants, even when legacy content/scoring rules indicate `ONE_WORD`/`TWO_WORDS`/`THREE_WORDS`.

Specifically:
- Treat `|` as logical OR: student answer is correct if it matches any variant.
- Ignore word-limit scoring rules for correctness (word limits are authoring/UI hints only).
- Ensure regrading/backfill updates old submissions using the same logic.

# Scope

Backend objective auto-grading for `TextAnyOf` answers in Reading/Listening.

Out of scope:
- MCQ / set-based scoring (ExactSet) behavior changes.
- Case-insensitive matching or punctuation normalization.

# Semantics

- Text matching is exact and case-sensitive.
- Leading/trailing whitespace is ignored for matching (`trim`), to avoid invisible formatting mismatches.
- Internal whitespace and punctuation are preserved (no normalization beyond trimming).
- `ONE_WORD`/`TWO_WORDS`/`THREE_WORDS` are not enforced during grading.

# Rollout / Backfill

- New grading applies immediately after deployment.
- To apply to existing submissions, use the existing “Regrade objective sections (latest draft)” flow, which backfills stored `autoGradingResults`.

# Regression Protection

- Backend unit tests cover:
  - `ONE_WORD` + key `crowd | crowd noise` accepts student `crowd noise`
  - `ONE_WORD` + key `NOT GIVEN` accepts student `NOT GIVEN`

