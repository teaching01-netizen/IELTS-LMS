---
title: Builder AnswerRule Auto-Upgrade From Accepted Answers
date: 2026-05-16
status: approved
---

# Goal

Prevent inconsistent objective answer keys from entering exam content by automatically aligning text-answer word-limit rules (`ONE_WORD`/`TWO_WORDS`/`THREE_WORDS`) with what staff type in the answer key (including `|` variants).

Example: if staff enters `crowd | crowd noise`, the builder must ensure the question is not saved as `ONE_WORD` because `crowd noise` is a 2-word variant.

# Scope

Applies in the exam builder for text-answer blocks that:
- Use `AcceptedAnswersEditor` and store accepted answers as `correctAnswer` + `acceptedAnswers` variants.
- Use word-limit rules via `AnswerRule` (`ONE_WORD`/`TWO_WORDS`/`THREE_WORDS`).

In scope blocks:
- `CLOZE` (block-level `answerRule`, computed from all question variants)
- `SHORT_ANSWER` (per-question `answerRule`)
- `SENTENCE_COMPLETION` (per-question `answerRule`, computed from all blank variants)
- `NOTE_COMPLETION` (per-question `answerRule`, computed from all blank variants)
- `TABLE_COMPLETION` (block-level `answerRule`, computed from all cell variants)

Out of scope:
- Non-text objective types (MCQ, matching, classification, etc.).
- Automatic downgrades of rules (never reduce allowed words).
- Variants longer than 3 words (builder will not coerce; can be validated separately if desired).

# Semantics

- `|` inside a variant means “OR”: any listed variant is acceptable.
- Word count is computed as: split on whitespace, count non-empty tokens.
- Determine the maximum word count across all variants relevant to the rule’s scope:
  - per-question rules: max across that question’s variants
  - block-level rules: max across all questions/cells in the block

# Behavior

When accepted answers change:
1. Compute `required_words = max_word_count(variants)`.
2. If `required_words` is 2 or 3 and current `answerRule` is lower, auto-upgrade:
   - 2 → `TWO_WORDS`
   - 3 → `THREE_WORDS`
3. Never downgrade.
4. If `required_words` > 3, do not change the rule.

# Regression Protection

- Add unit/integration tests for block editors proving:
  - starting at `ONE_WORD`, entering a 2-word variant upgrades to `TWO_WORDS`
  - entering a 3-word variant upgrades to `THREE_WORDS`
  - removing longer variants does not downgrade

