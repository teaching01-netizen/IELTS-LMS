# SAT Student Link Section Toggles — Implementation Plan

> Goal: a Student Access link can be scoped to **Reading & Writing only**, **Math only**, or
> **both** (today's behaviour). A student entering a verbal-only link takes Reading & Writing;
> when that section ends, the exam ends. Scoping is configured per publish link in
> **Student Access**, per link.

Status: implemented (Go, SQL, React). See "Implementation notes" at the end for the
verification record and the one open question that was deliberately left.
Decisions below are agreed with the product owner.

---

## 1. Agreed decisions

| Decision | Choice |
| --- | --- |
| Result for a one-section attempt | **Section score only (200–800), `totalScore` = `null`** |
| When section selection can be edited | **Until the first student participates** (`hasParticipation` gates it) |
| Model breadth | **SAT-only** (hardcode `reading-writing` / `math`), SAT-only UI |
| Link can widen a section the version disabled | No — link selection may only **narrow** what the version/config allows |

## 2. Why this is mostly one seam

### What already works

- A Student Link is **1:1 with a backing schedule**
  (`assessment_access_links_schedule_unique`, migration `0034`) and pinned to an immutable
  `published_version_id`.
- One authoritative place decides "which sections does this run have":
  `backend/go/internal/schedules/service.go` → `runtimePlanIn()` → rows inserted into
  `exam_session_runtime_sections` by `internal/runtime/service.go`. It **already drops**
  sections disabled in `exam_versions.config_snapshot` (`configuredRuntimeSections`).
- **End-of-exam already works**: `internal/proctor/reconcile.go` emits `stepCompleteRuntime`
  when there is no successor section; `completeRuntimeEffect` queues auto-submit for every
  attempt. A run whose plan only contains Reading & Writing therefore ends after Reading &
  Writing with **no new end-of-exam logic**.
- `runtime.Start` plans from `StartSchedule` **which already carries `ID`**
  (`internal/runtime/service.go` ~line 213), so the seam can look up the link by schedule id
  without changing any signature.
- Frontend runner renders `data.sections` + `attempt.moduleAttempts`; `SatCompleteScreen`
  already tolerates `totalScore === null`.

### What blocks a one-section run today (all fail closed)

| # | Location | Problem |
| --- | --- | --- |
| 1 | `internal/attempts/sat_modules.go` → `SATModuleTopology.Validate()` | Requires module attempts in **both** `reading-writing` and `math` |
| 2 | `internal/sat/service.go` → scoring (~line 574–611) | Requires exactly 2 sections, each with an adaptive route; `totalScore()` sums non-nil halves and `TotalScore: &total` is set **unconditionally** (line 734) — a verbal-only student would get a real-looking 400–800 "total"; `section_statuses` is hardcoded to both sections |
| 3 | `internal/delivery/start_submit.go` → `nextModuleTx` (~line 718) | Next-section lookup is `display_order > ?` across **all** version sections — after RW it opens Math |
| 4 | `internal/delivery/service.go` → `ensureBaseModuleAttempt` / `assembleBootstrap` | Seeds the first section's base module regardless of scoping, and `Bootstrap` returns **all** sections of the version — a verbal-only student would still be shipped Math content to the browser |

### Verified current-state facts the plan relies on

- `AssessmentAccessLink` / `PublicAssessmentAccessLink` contracts:
  `src/features/exam-authoring/contracts/accessLinks.ts`,
  `src/features/student/contracts/access-link/PublicStudentAccessLink.ts`.
- Editor sheet autosaves silently at 700ms via coedit `updateShared` +
  `buildUpdateRequest` — any new field must be wired into **both** `submit()` and the
  silent path, plus `editorSnapshot` (dirty tracking) and the coedit hydrate effect.
- `Update` is revision-fenced (`lockLinkTx` holds `SELECT … FOR UPDATE`); the participation
  gate can live inside the same lock by extending that query.

---

## 3. Backend plan

### 3.1 Migration `0066_access_link_enabled_sections.sql`

- Add `assessment_access_links.enabled_sections JSON NULL`.
- `NULL` = all sections → **every existing link keeps today's behaviour**, no backfill.
- Follow the guarded `information_schema` pattern used by neighbouring migrations
  (see `0050_act_science_support.sql`, `0033_sat_runtime_authoring_hardening.sql`).

### 3.2 `internal/accesslinks/service.go`

- `EnabledSections []string` on `AccessLink` and `PublicAccessLink` (JSON shape:
  `["reading-writing"]`, `["math"]`, or `null`).
- `CreateRequest`: `EnabledSections []string` (nil = all).
- `UpdateRequest`: `EnabledSections *[]string` — pointer, mirroring `SelectedStudents`, so
  "omitted" ≠ "cleared".
- Validator: non-empty, deduped, subset of `{reading-writing, math}`; same `badRequest`
  style as the existing `Parse*` functions.
- `linkSelectSQL()` / `scanAccessLink()`: read the column.
- `insertLinkTx()`: write it; `Duplicate` copies it.
- `Update`: **reject a section change when the link already has participation.** Extend
  `lockLinkTx` so the participation check happens under the same `FOR UPDATE` lock.
- `PublicLink` + `ResolveEntry` carry `enabledSections` for the entry page copy.

### 3.3 The seam — `internal/schedules/service.go`

- `runtimePlanIn()` intersects the candidate plan with the link's enabled sections, looked
  up by `sch.ID` via `assessment_access_links_schedule_unique`.
- **Also filter the fallbacks**: `configuredRuntimePlan()` and `fallbackRuntimePlan()`.
  Missing these means a narrowed SAT link with an unusable config silently regains Math —
  the easiest bug to ship here.
- Everything downstream is inherited for free: `exam_session_runtime_sections`, proctor
  section advance, `stepCompleteRuntime`, auto-submit, `syncV2Timing`.

### 3.4 `internal/delivery` content gates

- `ensureBaseModuleAttempt()` — seed the first base module of the first **enabled**
  section.
- `nextModuleTx()` — skip sections that the run's plan did not include (otherwise RW
  hands off to Math).
- `assembleBootstrap()` — return only enabled sections (also stops shipping unwanted
  content to the browser).

### 3.5 Completion + scoring

- `attempts.SATModuleTopology.Validate()` — take the required section set as input
  instead of the hardcoded pair (keep the existing fail-closed shapes for unresolved /
  unfinished rows).
- `sat.scoreAndPersist`:
  - Drop the "exactly 2 sections / both required" checks; score the sections the run
    declared.
  - When only one section ran: `TotalScore = nil`, JSON `totalScore: null`. Keep the
    section score (200–800) intact.
  - Derive `section_statuses` from the actual sections instead of the hardcoded pair.
- Audit `cmd/worker` section-reconcile fan-out (`sectionreconcile_fanout`) for the same
  two-section assumption.

### 3.6 Explicit non-goals

- No new end-of-exam logic — inherited from `stepCompleteRuntime`.
- No publish-readiness changes — the version still contains both sections; readiness is
  untouched.
- No version pinning or lifecycle changes.

---

## 4. Frontend plan

### 4.1 Contracts + API layer

- `src/features/exam-authoring/contracts/accessLinks.ts`: `enabledSections` on
  `AssessmentAccessLink`, `CreateAssessmentAccessLinkRequest` (optional),
  `UpdateAssessmentAccessLinkRequest` (optional), `PublicAssessmentAccessLink`.
- `src/features/student/contracts/access-link/PublicStudentAccessLink.ts`:
  `enabledSections: readonly string[] | null`.
- Gateway mapping for the public link (check `studentAccessLinkGateway` passes the field
  through).

### 4.2 Admin UI — Student Access

- `AccessLinkEditorSheet.tsx`: new **"Sections"** field with Reading & Writing / Math
  toggles; ≥1 required; per-field error in the existing `Field` pattern.
  - Wire into `editorSnapshot` (dirty tracking), `updateShared` (coedit live sync), the
    **700ms silent autosave path**, `buildUpdateRequest`, and `submit()`.
  - Render only for SAT (`providerKey === 'sat'`).
  - Disable toggles once the link has participation (mirror how revoked links are
    disabled), with a short hint why.
- Badge (`AccessLinkRow`, `AccessLinkDetail` overview/settings, `AccessLinkShareSheet`):
  "Verbal only" / "Math only" — nobody should share a verbal-only link with a math class
  by accident.
- `LinksToolbar`/filters: no changes required.

### 4.3 Student experience

- `StudentAccessLinkEntryRoute.tsx`: state the scope on the entry card —
  "You'll take Reading & Writing only" — from the public payload.
- Runner: **no new end-of-exam logic**. Verify any "Section 1 of 2"-style copy reads from
  delivered sections rather than a hardcoded 2.
- `SatCompleteScreen`: already handles `totalScore === null`; verify the result page and
  review pages don't divide by a missing section.

### 4.4 Proctor / staff surfaces (audit pass)

- `SatSessionRoomRoute`, `ProctorDashboard` render from runtime sections — expected to be
  fine, but the Joined/Started/Submitted funnel and results/exports deserve an audit for
  two-section assumptions.

---

## 5. Tests to write first (red before green)

### Go

- `accesslinks`: validator (empty set, unknown key, dedupe); `Duplicate` copies sections;
  update of sections **rejected after participation**; update of sections allowed before
  participation; `PublicLink` projection includes it.
- `schedules.runtimePlanIn`: intersection with link sections; fallbacks also filtered;
  no-link schedule unaffected.
- `delivery`: `nextModuleTx` skips disabled section; `ensureBaseModuleAttempt` seeds from
  first enabled section; bootstrap returns only enabled sections.
- `attempts`: `SATModuleTopology` accepts a one-section terminal topology, still rejects
  missing rows/unresolved.
- `sat`: scoring accepts a one-section attempt → section score present,
  `TotalScore == nil`; `section_statuses` matches the declared sections.

### TypeScript

- `AccessLinkEditorSheet`: toggles render for SAT only; ≥1 validation error; dirty
  tracking + silent autosave include sections; participation disables toggles.
- `AccessLinkRow` / `AccessLinkShareSheet`: badge copy.
- `StudentAccessLinkEntryRoute`: scope copy from public payload.
- `satRunnerReducer` / commit routing already drive off `moduleAttempts`; add one
  one-section fixture proving completion after the single section.

---

## 6. Risks / open questions to resolve during implementation

1. **Window vs duration**: `validateWindowForExistingScheduleTx` requires the link window
   ≥ backing schedule `planned_duration_minutes`. Verbal-only is shorter than the full
   plan; today's check **over-requires** (safe but wrong). Decide whether to shrink
   `planned_duration_minutes` for narrowed links or relax the check.
2. **Two levels of section on/off**: version-level `config_snapshot.sections[key].enabled`
   still exists. Rule: the link can only **narrow**, never re-enable a section the version
   disabled (enforced in the seam by intersecting, not replacing).
3. **Running exams**: runtime sections freeze at proctor start, so editing a link mid-run
   cannot shrink a live exam — but verify and document it.
4. **Results/exports**: SAT result detail and any composite-score export assume both
   sections; needs an audit pass after scoring changes.
5. **Coedit**: the access-link editor shares values through the Yjs room
   (`access/<id>`); a malformed section value from another tab must hydrate safely
   (follow the existing `typeof`-guarded pattern).

---

## 7. Suggested order of work

1. Migration + `accesslinks` model/validation (+ Go tests).
2. Seam in `schedules.runtimePlanIn` (+ tests).
3. Delivery gates 3.4 (+ tests).
4. Topology + scoring changes (gate 3.5) with `totalScore: null` (+ tests).
5. Frontend contracts → editor sheet → badges → entry copy.
6. Proctor/results audit pass.
7. E2E: create verbal-only link → student completes RW → exam ends, `totalScore: null`,
   section score rendered.

Each step is independently shippable behind `enabled_sections = NULL` for existing links.

---

## 8. Implementation notes (verified 2026-09-19)

All seven steps above are implemented; every existing link keeps today's behaviour
because `enabled_sections` stays `NULL` for them.

### Audits the plan asked for

- **`cmd/worker` section-reconcile fan-out (3.5)**: no change needed. The family is
  payload-driven — the event carries `scheduleId` + `sectionKey` and the handler
  reconciles the attempt ids it was handed one at a time
  (`executeSectionAttemptReconcileEvent`). No section pair is named anywhere in
  `cmd/worker` or `internal/proctor`.
- **Proctor surfaces (4.4)**: no change needed. The room renders the runtime
  sections the plan produced (`SatSessionRoomRoute` looks up
  `runtime.sections` by `currentSectionKey`), and `internal/proctor/reconcile.go`
  advances by successor section, so a one-section plan ends the exam with no new
  logic — exactly the seam the plan predicted.
- **Results / exports (4.4, risk 4)**: no change needed, and no two-section
  division exists. `satSections()` reads `assessment_section_results` rows (one per
  section that ran); `SatResultDetailRoute` iterates the payload's sections and
  already degrades to raw-correct when `totalScore` is null; the composite JSON total
  is read only by the ACT paths (`internal/act`, `ListACTScience`). One display
  consequence worth knowing: a one-section sitting shows "—" in the SAT results
  *list* (that column is the composite total) while its 200–800 section score renders
  in the detail. Changing that copy was outside this plan.
- **Student runner copy (4.3)**: verified — every section label and "Section …"
  string is built from the delivered sections/section keys. There is no "of 2"
  anywhere in `src/features/student-delivery`.
- **Running exams (risk 3)**: verified and documented in `Update()` — runtime
  sections freeze into `exam_session_runtime_sections` at proctor start, and the
  section-edit gate holds the `FOR UPDATE` lock on the link row, so a scope edit
  cannot race a registration or shrink a live run.
- **Coedit (risk 5)**: the room value hydrates through a `typeof`/`Array.isArray`
  guard, so a malformed or older-client scope falls back to "both sections".

### Verification

- `go build ./...` + `go vet` on the touched packages: clean.
- `go test ./...` (backend/go): green except `cmd/worker`'s
  `TestDockerEntrypointKeepsActivityDrivenWorkerless`, which fails on the committed
  `Dockerfile` and is untouched by this work.
- `npx tsc --noEmit`: clean. `npx eslint src/features/exam-authoring/ui/access-links`:
  0 errors (warnings match the file's pre-existing hook-dependency pattern).
- `npx vitest run`: 5264/5266 passing. The two failures are pre-existing and
  unrelated: `bluebookBans` (`backdrop-blur` in the committed `SatImageViewer.tsx`)
  and the `feature-internal-boundary` architecture rule
  (`SatExamLibraryRoute` -> `exam-authoring/application/authoringEntryIntent`).
  Both come from other work already committed on this branch.

### Still open

- **Window vs duration (risk 1)** — left as the plan left it: `StudentLink`
  Student Link availability must still cover the backing schedule's *full*
  `planned_duration_minutes`, so a narrowed link over-requires the window (safe, but
  stricter than the run it describes). Deciding between shrinking
  `planned_duration_minutes` for a scoped link and relaxing the check is a
  scheduling decision this plan did not make.
- **E2E (step 7)** — not written. It needs the seeded live stack to be meaningful;
  the behaviour it would assert (one-section run completes with `totalScore: null`)
  is pinned by the Go scoring/topology tests and the one-section commit-routing
  fixture instead.
