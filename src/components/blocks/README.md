# Question Block Authoring Invariants

## Matching Features

Matching-feature option values are persisted grading keys. Builder mutations must therefore preserve these rules:

- Renaming a non-empty option must update every `features[].correctMatch` reference to that option in the same state update.
- A referenced option cannot be deleted until its features are reassigned.
- A saved `correctMatch` outside `options[]` must be shown explicitly as invalid; a select must never visually fall back to another option.
- Backend publish validation is authoritative and must reject blank options and `correctMatch` values outside the option set.

These guards prevent the builder from displaying one key while grading reads a different persisted key. Existing published versions and submitted answers are immutable; correcting historical grading requires an explicit reviewed regrade or override rather than silent snapshot mutation.
