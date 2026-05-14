# In-Place Republish Using Latest Draft (No Schedule Rewrites)

Date: 2026-05-14

## Context
Today the system enforces a “publish-once then clone for changes” policy:
- Published exam content is immutable in-place.
- If a draft diverges from the published version, the UI requires `clone -> review -> publish` via “Create New Exam Copy”.

User request: allow an admin/builder to “republish” an exam without creating a new exam entity, by publishing the latest draft into a new published version on the same exam.

## Ownership / Boundaries
- UI: `src/features/builder/components/PublishActions.tsx` owns the “Review & Publish” action surface and status messaging.
- Application (frontend service layer): `src/services/examLifecycleService.ts` owns lifecycle transitions and invariants around publish/republish.
- Scheduling: schedules reference a specific published version via `publishedVersionId` and must be treated as the source of truth for what a cohort will see.

## Non-Negotiable Invariants
- **Submitted exam answers are immutable.**
- **Audit events are append-only and traceable.**
- **Student-visible “saved/verified” state must match persisted reality.**
- **Schedule-to-content binding is immutable:** once a schedule is created, its `publishedVersionId` must never be rewritten by republish.

## Decision
Implement **in-place republish** as “publish a new immutable version on the same exam”, and advance `currentPublishedVersionId`, while **never** rewriting existing schedules.

### Definition of “future schedules”
“Future schedules” means: schedules **created after** republish.  
Already-created schedules (even if their `startTime` is in the future) remain pinned to their existing `publishedVersionId`.

## User-Facing Behavior
When an exam is already published and the draft has changes:
- UI shows a `Republish` action (replacing “Create New Exam Copy”).
- Copy clarifies: “Existing schedules won’t change. Only new schedules created after republish will use this version.”

## Functional Requirements
### Republish
Add/enable `republishVersion(examId, actor, publishNotes?)` to:
1. Validate the current draft with the same readiness checks as publish (technical validation + required prerequisites).
2. Create a new `ExamVersion` snapshot from the current draft:
   - `isDraft=false`, `isPublished=true`
   - immutable snapshots (deep-copied)
3. Update the exam:
   - set `currentPublishedVersionId` to the new version id
   - preserve `currentDraftVersionId` (draft remains editable)
   - keep status `published`
4. Append an audit event:
   - action: `republished` (or equivalent)
   - payload includes previous published version id/number and new published version id/number

### Scheduling
- Schedule creation continues to bind to the exam’s **current published version at creation time**.
- Schedule update endpoints must not automatically swap `publishedVersionId` when an exam is republished.

## Safety / Risk Controls
- Republish must be permission-gated the same as publish.
- Republish must be blocked if the exam has no valid draft to publish.
- Republish must not mutate any existing published version records.
- Republish must not delete/prune versions referenced by any schedule.

## Migration / Compatibility
- No data migration required.
- Existing schedules keep their `publishedVersionId`.
- Existing published versions remain valid and viewable in history.

## Test / Memory Artifacts (Required)
Add characterization/regression coverage for:
1. Republish creates a new published version and advances `currentPublishedVersionId`.
2. Republish does **not** change any existing schedules’ `publishedVersionId`, including schedules whose `startTime` is in the future.
3. New schedules created after republish bind to the latest `currentPublishedVersionId`.

## Out of Scope
- Auto-upgrading already-created schedules to a newer published version.
- “Release channels” or schedule-to-release indirection.
- Any change that would allow students to bypass timer fairness or rewrite audit history.

