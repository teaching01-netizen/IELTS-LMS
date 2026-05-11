# Publish-Once Clone-Candidate Policy

## Decision
- In-place republish is disabled.
- After first publish, content updates must use `clone -> review -> publish` on a new exam artifact.

## Rationale
- Improve operator confidence in high-stakes workflows.
- Preserve immutable published artifacts and reduce accidental live-content changes.
- Keep scheduling operationally flexible without mutating published content.

## Rules
- Published exam content is immutable in-place.
- Scheduling changes remain allowed on a published exam and are audited separately.
- Clone-from-published must not copy schedules.
- Clone-from-published follows publish permission boundaries.

## UI Requirements
- `Review & Publish` must not show republish actions.
- If published draft diverges from published content, show `Create New Exam Copy`.
- On clone success, navigate to new exam `Review & Publish` and show:
  - original published exam unchanged
  - no schedules copied
- On clone failure, show safe-state message and retry path.

## Service Requirements
- `republishVersion(...)` returns a policy error and must not mutate state.
