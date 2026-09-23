Yes. Based on the current repo, I would implement this as a **SAT release scope**, not as “ignore the other subject’s errors.”

Right now your backend already has the simplified SAT publish validator in `backend/go/internal/satpublish/validator.go`, and it checks the four rules you wanted: question text, four filled choices, module question count, and correct answer. The problem is that `ValidateDraft()` currently validates **every SAT section**, and `exams.Service.Publish()` then seals the **entire draft version**.

So the clean model should be:

**Publish scope**

* `Full SAT`
* `Reading & Writing only` — your “SAT Verbal”
* `Math only`

I would **not** allow publishing only `rw-m1` or `math-m1`. A Reading & Writing release still needs its Module 1 + both adaptive Module 2 branches; same for Math. Otherwise adaptive routing becomes invalid.

## Target behavior

Imagine the draft is:

```text
SAT Mock 08

Reading & Writing
  Module 1        ✅ complete
  Module 2 Lower  ✅ complete
  Module 2 Higher ✅ complete

Math
  Module 1        ❌ only 10/22
  Module 2 Lower  ❌ empty
  Module 2 Higher ❌ empty
```

Staff chooses:

```text
Publish content

( ) Full SAT
(●) Reading & Writing only
( ) Math only
```

Publish checks become:

```text
Reading & Writing

✓ Question text
✓ Answer choices
✓ Module question counts
✓ Correct answers

Math
Not included in this release
```

Then:

```text
Ready to publish
Reading & Writing only

[Math issues are ignored because Math will not be delivered.]
```

Publishing succeeds.

A student taking that published release receives:

```text
Reading & Writing
  Module 1
  Module 2 based on routing
Finish
```

They must **never reach Math**.

Also, the normal 10-minute SAT break between Reading & Writing and Math should disappear for a Reading & Writing-only release because there is no next section.

---

# Implementation plan

### 1. Introduce one canonical publish-scope contract

Use one enum everywhere:

```ts
export type SatPublishScope =
  | "full"
  | "reading-writing"
  | "math";
```

Go equivalent:

```go
type SATPublishScope string

const (
    SATPublishFull           SATPublishScope = "full"
    SATPublishReadingWriting SATPublishScope = "reading-writing"
    SATPublishMath           SATPublishScope = "math"
)
```

Missing scope must default to `full` for backward compatibility.

Do **not** make the UI independently decide which sections count. Put helpers around the canonical scope:

```text
full              -> reading-writing + math
reading-writing   -> reading-writing
math              -> math
```

---

### 2. Make the SAT validator scope-aware

Current:

```go
satpublish.ValidateDraft(ctx, q, versionID)
```

Refactor to:

```go
satpublish.ValidateDraftForScope(
    ctx,
    q,
    versionID,
    scope,
)
```

Keep the existing wrapper if useful:

```go
func ValidateDraft(...) {
    return ValidateDraftForScope(..., ScopeFull)
}
```

The SQL in `validator.go` currently reads all modules:

```sql
WHERE s.exam_version_id = ?
```

For scoped publishing, filter the modules by the selected section.

The important rule is:

> **Do not weaken the four validation rules. Change only which section they apply to.**

So:

```text
Full SAT
  validate RW
  validate Math

RW only
  validate RW
  completely ignore Math

Math only
  completely ignore RW
  validate Math
```

No domain, skill, rationale, accessibility, metadata, pretest, etc. should suddenly become blockers.

Your current four-rule SAT publish contract remains intact.

---

### 3. Scope the readiness endpoint too

This part is important.

Currently the frontend does:

```ts
validateExam(examId)
```

and:

```text
POST /v1/assessment-authoring/exams/:examId/validate
```

The selected publish scope needs to reach this endpoint:

```json
{
  "publishScope": "reading-writing"
}
```

No body / omitted scope:

```json
{
  "publishScope": "full"
}
```

Extend the readiness response:

```ts
interface AssessmentValidationReport {
  examId: string;
  versionId: string;
  versionRevision: number;

  publishScope: SatPublishScope;

  valid: boolean;
  errors: AssessmentValidationIssue[];
  warnings: AssessmentValidationIssue[];
}
```

This prevents this bug:

```text
1. Run checks for RW
2. RW passes
3. Change selector to Full SAT
4. Old RW readiness still says "Ready"
5. Publish full SAT incorrectly
```

Freshness must therefore be:

```text
versionId
+ versionRevision
+ publishScope
```

not just:

```text
versionId
+ versionRevision
```

And the React Query key should become something like:

```ts
assessmentKeys.readiness(
  examId,
  versionId,
  versionRevision,
  publishScope
)
```

---

### 4. Add scope to the publish command

Current:

```ts
interface PublishAssessmentRequest {
  revision: number;
  expectedDraftVersionId: string;
  expectedDraftRevision: number;
  publishNotes?: string;
  operationKey?: string;
}
```

Change to:

```ts
interface PublishAssessmentRequest {
  revision: number;
  expectedDraftVersionId: string;
  expectedDraftRevision: number;

  publishScope: SatPublishScope;

  publishNotes?: string;
  operationKey?: string;
}
```

And Go:

```go
type PublishRequest struct {
    PublishNotes           *string
    Revision               int
    ExpectedDraftVersionID *string
    ExpectedDraftRevision  *int

    PublishScope           SATPublishScope

    OperationKey string
}
```

Then inside `exams.Service.Publish()` replace:

```go
satpublish.ValidateDraft(ctx, q, draftID)
```

with:

```go
satpublish.ValidateDraftForScope(
    ctx,
    q,
    draftID,
    req.PublishScope,
)
```

### Critical idempotency fix

Your publish fingerprint currently contains:

```go
exam
rev
draft
draftRev
notes
```

It must also contain:

```go
scope
```

Otherwise:

```text
operation key X + RW publish
```

and:

```text
operation key X + Math publish
```

could be considered the same command.

---

# 5. Persist the scope on the immutable published version

This is the most important backend safety requirement.

Do **not** merely skip Math validation and then publish an unrestricted version containing Math.

I would add something like:

```sql
ALTER TABLE exam_versions
ADD COLUMN sat_publish_scope
ENUM('full', 'reading-writing', 'math')
NULL;
```

Interpret:

```text
NULL on legacy SAT version -> full
```

When publishing:

```text
sat_publish_scope = reading-writing
```

or:

```text
sat_publish_scope = math
```

or:

```text
sat_publish_scope = full
```

That makes the release itself authoritative about what students may receive.

This also gives you an immutable audit trail:

```text
Version 7
Published Sep 23
Scope: Reading & Writing only
```

rather than scope being a transient frontend setting.

---

# 6. Enforce scope in runtime, not only authoring

You already have a very useful foundation:

`backend/go/internal/exams/section_scope.go`

and Student Access Links already support:

```text
reading-writing
math
```

with `enabled_sections`.

Also, `internal/schedules/service.go` and `internal/delivery/service.go` already filter runtime sections using that access-link scope.

Reuse the same concept, but keep **published scope** separate from **link scope**.

Effective runtime scope should be:

```text
published-version scope
        ∩
student-link scope
```

Example:

```text
Published version = RW only
Link = all
Result = RW
```

```text
Published version = Full
Link = Math
Result = Math
```

```text
Published version = RW only
Link tries Math
Result = nothing / reject configuration
```

The link must never be able to widen what the published release allows.

---

# 7. Protect admin-created SAT sessions

This is especially important in your current code.

`SatSessionsRoute.tsx` can create a schedule directly from:

```text
currentPublishedVersionId
```

without a Student Access Link.

Today a schedule with no link means:

```text
no narrowing
```

So merely relying on `enabled_sections` is insufficient.

`schedules.runtimePlanIn()` needs to read the version's `sat_publish_scope` and apply it even when:

```text
linkSections == nil
```

Conceptually:

```go
releaseScope := publishedVersionScope(versionID)
linkScope := linkEnabledSections(scheduleID)

effectiveScope := IntersectSectionScopes(
    releaseScope,
    linkScope,
)
```

Then build the run plan only from `effectiveScope`.

---

# 8. Delivery must independently enforce the same scope

Don't trust only the schedule projection.

`internal/delivery/service.go` currently does:

```go
sections := cachedSections(versionID)
scope := linkSectionScope(scheduleID)

deliverySectionsForScope(sections, scope)
```

Change that conceptually to:

```go
releaseScope := publishedVersionScope(versionID)
linkScope := linkSectionScope(scheduleID)

effectiveScope :=
    IntersectSectionScopes(releaseScope, linkScope)

deliverySectionsForScope(
    sections,
    effectiveScope,
)
```

This gives defense in depth.

Even if somebody creates a malformed schedule directly in the DB/API, delivery still won't return excluded Math content.

---

# 9. Fix the break behavior

There is a subtle issue with Reading & Writing-only.

Your SAT blueprint says:

```text
Reading & Writing
breakAfterSeconds = 600

Math
breakAfterSeconds = 0
```

That 10-minute break exists because normally Math follows Reading & Writing.

For:

```text
Reading & Writing only
```

the effective run should be:

```text
RW Module 1
RW Module 2
Finish
```

not:

```text
RW Module 1
RW Module 2
10 minute break
Finish
```

So after applying the effective runtime scope:

```go
plan[len(plan)-1].GapAfterMinutes = 0
```

The **last delivered section never needs a cross-section break**.

Do this after all release/link filtering, not before.

---

# 10. Release-page UX

On `SatDeliveryReleasePage.tsx`, put this near the top of Release, before readiness:

```text
Content to publish

┌─────────────────────────────────────────────┐
│  Full SAT       Reading & Writing       Math │
└─────────────────────────────────────────────┘
```

Your existing `SegmentedControl` can likely be reused.

Labels should be staff-friendly:

```text
Full SAT
Reading & Writing
Math
```

I wouldn't label it simply `Verbal` in persisted/domain code. The official internal section key you already use is:

```text
reading-writing
```

You can optionally display:

```text
Reading & Writing (Verbal)
```

if Warwick staff commonly says Verbal.

When selected:

```text
Reading & Writing

Only Reading & Writing will be included in this release.
Math content and Math publish issues will be ignored.
```

Keep that copy small and contextual rather than adding another confirmation screen.

---

# 11. Readiness UI should visually remove the excluded section

Do not show:

```text
Math
❌ 66 questions missing
❌ ...
```

and then tell people to ignore it.

That's cognitively noisy.

Instead:

```text
Publish checks

Reading & Writing
✓ Question text
✓ Answer choices
✓ Module question counts
✓ Correct answers

Math
Not included in this release
```

Or omit Math entirely and have a small release-scope badge:

```text
READING & WRITING ONLY
```

The second approach is cleaner.

---

# 12. Publish confirmation

Update `PublishAssessmentDialog.tsx`.

For scoped release:

```text
Publish Reading & Writing only?

SAT Mock #12

Included
✓ Reading & Writing
  54 questions per candidate path
  64 min

Not included
Math

Students using this release will only receive
Reading & Writing.
```

Primary button:

```text
Publish Reading & Writing
```

For Math:

```text
Publish Math
```

For Full:

```text
Publish Full SAT
```

This makes a potentially consequential action self-explanatory without another warning dialog.

---

# 13. Published surfaces should show the scope

After publication, don't just say:

```text
Published
Version 4
```

Show:

```text
Published
Version 4 · Reading & Writing only
```

I would carry this into:

* SAT Exam Library
* Delivery & Release
* Student Links
* session creation
* session room / run sheet
* result detail where relevant

Especially the session room:

```text
SAT Mock #12
Reading & Writing only
```

A proctor should immediately understand why Math isn't on the run sheet.

---

# 14. Do not mutate the other subject

If publishing RW only:

```text
RW -> validated + delivered
Math -> untouched
```

Don't delete Math.

Don't mark its questions valid.

Don't automatically fix its module counts.

Don't silently change its target counts.

It simply isn't part of this immutable release.

When staff later reopens the exam, the authoring content can still contain both subjects.

---

# Tests I would require

This feature needs tests across the boundary, because frontend-only filtering would be dangerous.

```text
BACKEND VALIDATOR

✓ Full + valid RW + broken Math
  => blocked

✓ RW-only + valid RW + broken Math
  => passes

✓ Math-only + broken RW + valid Math
  => passes

✓ RW-only + broken RW + valid Math
  => blocked

✓ Math-only + valid Math question but missing answer
  => blocked

✓ unknown publishScope
  => request rejected

✓ omitted scope
  => behaves as full


PUBLISH TRANSACTION

✓ RW-only actually stores scope=reading-writing

✓ Math-only actually stores scope=math

✓ Full stores scope=full

✓ backend revalidates chosen scope while draft is locked

✓ stale draftRevision still conflicts

✓ stale exam revision still conflicts

✓ same idempotency key + same scope replays

✓ same idempotency key + different scope conflicts


RUNTIME

Published RW-only + admin schedule
  => run plan contains RW only

Published Math-only + admin schedule
  => run plan contains Math only

Published Full + Math-only Student Link
  => Math only

Published RW-only + unscoped Student Link
  => RW only

Published RW-only + Math link
  => cannot widen release / fails safely

RW-only
  => final RW section gap = 0
  => no 10-minute SAT cross-section break

Delivery bootstrap for RW-only
  => no Math base-module attempt created


FRONTEND

✓ selector defaults to Full SAT

✓ changing Full -> RW changes readiness query identity

✓ RW readiness does not display Math blockers

✓ changing RW -> Full cannot reuse RW readiness

✓ publish request contains publishScope

✓ dialog explicitly says what is included

✓ candidate time uses selected scope only

✓ published state displays scope


E2E

1. Create SAT draft
2. Complete all RW modules
3. Leave Math incomplete
4. Open Release
5. Select Reading & Writing
6. Run checks
7. Checks pass
8. Publish
9. Create admin SAT session
10. Start session
11. Student receives RW M1
12. Student routes to one RW M2
13. After M2 -> finished
14. No Math
15. No 10-minute cross-section break
```

## Files I would expect to touch

Main areas in your current repository:

```text
backend/go/internal/satpublish/validator.go
backend/go/internal/satpublish/validator_test.go

backend/go/internal/exams/service.go
backend/go/internal/exams/section_scope.go

backend/go/internal/schedules/service.go
backend/go/internal/delivery/service.go

backend/go/cmd/api/sat_publish_mysql_test.go

backend/go/migrations/00xx_sat_publish_scope.sql

src/features/exam-authoring/contracts/assessment.ts
src/features/exam-authoring/api/assessmentAuthoringApi.ts
src/features/exam-authoring/api/assessmentQueries.ts

src/features/exam-authoring/routes/SatDeliveryReleaseRoute.tsx

src/features/exam-authoring/ui/SatDeliveryReleasePage.tsx
src/features/exam-authoring/ui/release/PublishAssessmentDialog.tsx
src/features/exam-authoring/ui/release/releaseSelectors.ts

src/features/exam-authoring/ui/__tests__/SatDeliveryReleasePage.test.tsx
src/features/exam-authoring/ui/release/__tests__/*
e2e/sat-authoring-lifecycle.spec.ts
```

The key invariant I'd give the coding agent is:

> **`publishScope` determines both what is validated and what can ever be delivered. Excluded SAT sections may contain any authoring errors and must not block publication, but they must also be impossible for a schedule, access link, runtime plan, or student delivery path to expose. Full SAT remains the backward-compatible default.**

That gives you the behavior you want without turning “ignore Math errors” into a loophole where unfinished Math accidentally reaches students.
