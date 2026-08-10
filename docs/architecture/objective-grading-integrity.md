# Objective grading integrity

## Ownership

Objective grading is owned by `backend/crates/application/src/grading/` and the
grading domain types in `backend/crates/domain/src/grading.rs`. The application
module builds the objective projection; the domain audit owns the accounting
invariant; the API exposes the persisted projection; the admin UI only renders
the API result.

Objective audit data is stored inside the existing `section_submissions.auto_grading_results`
JSON payload under `integrity`. This keeps the change backward-compatible with
the current schema. A payload without a valid audit is stale and must not pass
the release gate.

## Invariants

For every objective section:

```text
expectedQuestionCount
  = verifiedCorrectCount
  + verifiedIncorrectCount
  + verifiedUnansweredCount
  + unresolvedCount
```

Only `verified_correct`, `verified_incorrect`, and `verified_unanswered` are
terminal states. A missing answer key, malformed answer, missing/ambiguous
section mapping, unknown answer ID, incomplete submission merge, stale source,
or stale manual override remains unresolved or invalid and is represented in the
audit rather than skipped.

An authoritative blank answer is `verified_unanswered`. An absent answer key or
an absent answer payload is not silently treated as blank. Section status is
derived from the audit: verified objective results become `auto_graded`; every
other integrity status becomes `needs_review`.

## Source and release safety

Each audit carries `gradingSourceVersionId`. Release re-reads both listening and
reading section rows, validates their audits, and checks that their source
revision matches the schedule's active objective source. The immediate and
scheduled release paths perform this check while holding locks on the review
draft, submission, source row, and objective section rows. Failed checks return
conflict and occur before a result version or release event is written.

Released `student_results` rows are history. A later objective regrade reopens
the review state and future release creates a new version linked through
`previous_version_id`; it does not mutate an earlier released row.

## Mapping policy

The answer-to-section map is authoritative. If it cannot be built, answers are
quarantined instead of copied into both sections. Unknown IDs are retained in
`unknownAnswerIds`, known questions continue through the projection, and the
audit remains `needs_recheck` until the mapping/merge problem is resolved.

## Verification commands

```text
cd backend
cargo test -p ielts-backend-domain --features sqlx --lib
cargo test -p ielts-backend-application grading::tests:: --lib
cargo test -p ielts-backend-api --lib

cd ..
npm test -- --run src/components/admin/__tests__/ExamObjectiveOverviewPanel.test.tsx src/components/admin/__tests__/ObjectiveIntegrityOverviewPanel.test.tsx
```
