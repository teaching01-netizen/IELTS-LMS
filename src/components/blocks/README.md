# Question Block Authoring Invariants

## Matching Features

Matching-feature option values are persisted grading keys. Builder mutations must therefore preserve these rules:

- Renaming a non-empty option must update every `features[].correctMatch` reference to that option in the same state update.
- A referenced option cannot be deleted until its features are reassigned.
- A saved `correctMatch` outside `options[]` must be shown explicitly as invalid; a select must never visually fall back to another option.
- Backend publish validation is authoritative and must reject blank options and `correctMatch` values outside the option set.

These guards prevent the builder from displaying one key while grading reads a different persisted key. Existing published versions and submitted answers are immutable; correcting historical grading requires an explicit reviewed regrade or override rather than silent snapshot mutation.

## Sentence Completion Shared Answer Keys

Shared answer-key mode is question-level, defaults off when absent, and changes only how the sentence's blank keys are authored and graded:

- Toggling shared mode preserves each blank's existing answer keys so disabling the mode restores the previous per-blank behavior.
- Enabling shared mode seeds the pool from each blank's primary and accepted keys, preserving case variants for authoring visibility while removing only equivalent formatting duplicates.
- The student submission remains one answer per blank in the existing array-backed question answer shape.
- Shared grading still matches case-insensitively and consumes each normalized key at most once per sentence, so case variants do not create extra credit capacity.
- A shared pool with fewer unique keys than blanks is a warning, not a publish blocker.
