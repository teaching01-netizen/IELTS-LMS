# Publish-Once Clone-Candidate Policy

## Decision
- In-place republish is allowed by publishing the latest draft into a new immutable published version on the same exam.
- Republish must not rewrite any existing schedules’ `publishedVersionId` (even if their start time is in the future).
- If operators need a separate exam artifact (e.g., for branching content), they can still use `clone -> review -> publish`.

## Rationale
- Improve operator confidence in high-stakes workflows.
- Preserve immutable published artifacts and reduce accidental live-content changes.
- Keep scheduling operationally flexible without mutating published content.

## Rules
- Published exam content is immutable in-place.
- Scheduling changes remain allowed on a published exam and are audited separately.
- Clone-from-published must not copy schedules.
- Clone-from-published follows publish permission boundaries.
- Republish must not rewrite existing schedules (schedules are pinned to immutable published versions).

## UI Requirements
- If published draft diverges from published content, show `Republish`.
- UI copy must clarify: existing schedules won’t change; only new schedules created after republish will use the new version.
- If clone is offered/used, on clone success navigate to the new exam `Review & Publish` and show:
  - original exam unchanged
  - no schedules copied

## Service Requirements
- `republishVersion(...)` publishes the latest draft into a new immutable published version and must not rewrite schedules.
