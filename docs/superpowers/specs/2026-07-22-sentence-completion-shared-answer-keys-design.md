---
title: Sentence Completion Shared Answer Keys
date: 2026-07-22
status: proposed
---

# Goal

Allow an individual sentence in a `SENTENCE_COMPLETION` block to opt into a
shared answer-key pool. When enabled, any answer key configured for that
sentence may match any of its blanks, while each key occurrence can satisfy at
most one blank.

# Scope and ownership

The feature belongs to `SentenceCompletionQuestion`, not the enclosing block.
The builder owns authoring state, the student adapter continues to own one
answer slot per blank, and the grading utility owns effective-key resolution
and matching. Existing submission and autosave contracts remain unchanged.

# Data model

Add optional question-level fields conceptually equivalent to:

- `acceptAnyAnswerKey?: boolean` — absent or `false` preserves current behavior.
- `sharedAcceptedAnswers?: string[]` — the sentence-level pool used only when
  the toggle is enabled.

The existing `blanks[].acceptedAnswers` and `correctAnswer` values are never
overwritten when the toggle changes. Enabling the toggle seeds the shared pool
from each blank’s primary key followed by its accepted variants, preserving
case variants for authoring visibility and removing only equivalent formatting
duplicates, only when no shared pool exists. Disabling the toggle preserves the
shared pool for a later re-enable and returns grading to the untouched
per-blank keys.

# Behavior

With the toggle off, each blank is graded against its own accepted answers.
With it on, the effective accepted set for every blank is the shared pool.
Matching is case-insensitive and uses the repository’s existing answer
normalization. A maximum one-to-one matching across the sentence prevents a
student from repeating one valid answer in every blank. Existing grouped
scoring (including 2-for-1) is applied after slot matches are determined.

The student answer map remains the existing question-keyed array of blank
answers. No submitted answer, immutable exam snapshot, or historical attempt
is rewritten by this feature.

# Validation and warnings

The builder and publish/readiness validation must use the same effective-key
resolver as grading. If the shared pool contains fewer unique normalized keys
than the number of blanks, show a non-blocking warning; publishing remains
allowed. Existing validation remains unchanged for sentences with the toggle
off. The warning must make clear that full credit may be impossible.

# UI direction

Each sentence card gets an inline toggle. Off shows the current per-blank
`AcceptedAnswersEditor` controls. On replaces them with one sentence-level
answer-key editor and explanatory text. Hidden per-blank values remain stored
and are restored visually when the toggle is turned off.

# Regression protection

Tests should cover: legacy payloads defaulting off; reversible toggle changes;
union seeding and editing; normalization/deduplication; one-to-one matching,
including duplicate student answers and alternative spellings; partial pools
and the non-blocking warning; grouped scoring; question cloning/delivery; and
unchanged answer-map shape and autosave behavior.
