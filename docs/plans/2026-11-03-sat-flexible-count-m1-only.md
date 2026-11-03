# SAT Flexible Count + M1-only — Low-Level E2E Plan (plan only, no code yet)

> Status: PLAN ONLY. No source edits made. This file is the shared-understanding + execution contract from grill rounds Q1–Q17 (all approved 2026-11-03).
> Next trigger: `go build` starts Step 0. `go plan` ends here.

## Part A — E2EDD

### A1. Requirement summary

- **Goal:** Let staff create Classroom-only SAT exams with (a) flexible question count `1..max` per included module (RW max 27, Math max 22) and (b) Module-1-only shape, for homework / quick checks without authoring a full ~147Q SAT.
- **Users:** Staff (builder/admin) create; students sit Classroom rooms; staff monitor + read raw results.
- **Constraints (locked):**
  - No new top-level exam type. Extend `Custom modules` with `m1_only` shape + `flexibleQuestionCount` toggle; they compose.
  - Full SAT untouched: strict `len == target` gates, Practice + Classroom, converter supported.
  - New flags: Classroom-only, raw-scores-only v1, builder-only authoring (no flexible workbook import, no converter upload for these).
  - M1-only = base alone, no M2, no `minimumCorrectForHigher` gate.
  - Timing defaults stay full-length (RW 32 / Math 35); teacher lowers manually. Hard floor 1, soft warning < 5.
  - Denominator = authored N. Students see normal `Module 1` chrome; flexible/M1-only wording is staff-only.
  - `sectionScope + shape plan + flexible` locked at creation; change = clone. Existing exams untouched, zero backfill.
- **Success criteria:** Flexible/M1-only draft publishes with `1<=N<=max`; creates Classroom rooms; sits M1 (and M2 when shape includes it); completes without "waiting for Module 2"; shows raw `correct/total` with no route badge and no scaled score. Full SAT behavior byte-identical.
- **Non-goals (v1 outs):** Proportional auto-timing, flexible workbook import, converter tables for flexible N, Practice rooms, migration, student-chrome rebrand.

### A2. E2E scenarios (behavior is source of truth)

Notation: `Given / When / Then`. All scenarios run against real DB + real API + real UI (Playwright + API integration + DB verification per E2EDD; no mock-heavy or trivial unit tests in this plan).

#### Happy paths

```text
E2E-H1: Create flexible M1-only RW exam
Given staff on /sat/exams with Classroom creation enabled
When they create Custom exam: sections=[reading-writing], shape rw=m1_only, flexible=on, M1 minutes=32
Then exam opens at /sat/exams/:id, shell shows rw-m1 target 27 with 0 authored, readiness shows flexible note (non-blocking)

E2E-H2: Author 10Q + publish + room + sit + complete raw
Given H1 exam
When staff authors 10 MCQ in rw-m1 (builder), publishes, creates Classroom room, student joins and submits M1 (6/10 correct)
Then publish succeeds with 10/27; room creates; delivery serves only rw-m1; completion succeeds with no M2; result shows 6 / 10 raw, no Higher/Lower badge, no scaled score

E2E-H3: Flexible full-sequence (M1+M2) still routes
Given Custom exam: sections=[math], shape=full, flexible=on, 10Q in each of math-m1/m2-lower/m2-higher
When student scores above threshold in M1
Then M2 served is the routed branch; completion requires M1 + decided M2; raw total = authored N per module

E2E-H4: Standard SAT unchanged (regression)
Given Full SAT exam with 27/22 per module
When staff publishes, creates Practice + Classroom rooms, students sit full adaptive
Then all existing gates, routing, scaled scores behave exactly as before
```

#### Failure / validation / auth / race / network cases

```text
E2E-F1: Flexible blocks empty module
Given flexible exam with 0Q in an included module
When staff attempts publish or room create
Then publish/room is refused with "at least 1 question per included module"; draft unchanged (DB row counts verified)

E2E-F2: Flexible caps at blueprint max
Given flexible rw-m1 with 27Q
When staff attempts to add 28th question via builder
Then request is rejected with target-ceiling error; count stays 27 (verified via shell read + DB count)

E2E-F3: Non-flexible still requires exact counts
Given Full SAT draft with 26/27 in rw-m1
When staff attempts publish
Then blocked by sat.module.incomplete "has 26 of 27"; unchanged behavior

E2E-F4: Converter upload refused for flexible/M1-only v1
Given flexible or m1_only draft
When staff attaches converter JSON at creation or Settings
Then creation/update is rejected with raw-only message; scoring policy stays practice/raw

E2E-F5: Unauthorized create
Given non-builder/non-admin session
When POST provider-exams with flexible flag
Then 403; no exam row, no version row created (DB verified)

E2E-F6: M1-only completion does not wait for M2
Given M1-only Classroom attempt with terminal M1 and no route decision
When student/complete fires
Then completion succeeds; AwaitingStaffRoute=false; no "waiting for staff to assign Module 2"

E2E-F7: Concurrent publish vs authoring edit (race)
Given flexible draft at 10Q with two staff sessions
When A publishes while B adds Q11 (revision bump) in the same window
Then exactly one outcome: publish validates the locked revision; loser gets version-conflict with refresh copy; no partial publish (DB: single published version)

E2E-F8: Retry with same operationKey replays safely
Given create-provider-exam with operationKey K
When client retries POST with identical body + K after timeout
Then single exam row returned (idempotent replay); different body + same K returns 409

E2E-F9: Offline/timeout during M1 submit then retry
Given active M1 attempt, submit times out client-side
When client retries submit with same response set
Then exactly one terminal M1 row; answers = accepted write set; no duplicate module rows

E2E-F10: Workbook exact-count rule preserved
Given flexible exam
When staff previews workbook with 10/27 rows for rw-m1
Then preview is not commit-ready for flexible ("use builder for flexible counts"); full exams keep exact-count behavior
```

### A3. Implementation plan (vertical slice order)

Implement smallest working vertical slice per scenario, in dependency order (E2EDD §3):

1. Contracts + migration (types, DB flag) → unblocks all.
2. Creation UI (picker + fields + sheet) → enables H1.
3. Publish gates (validator + converter rule) → enables H2 publish.
4. Delivery + completion (entry/sequence/topology) → enables H2 sit/complete.
5. Results (raw M1 view + export) → enables H2 read.
6. Readiness copy + creation-lock → polishes F1/F3.

See Part B §6 for file-by-file edits. No placeholder logic; each slice must pass its E2E before the next starts.

### A4. Code

> Not implemented — plan only. No source edits made in this turn. Concrete diffs are specified in Part B §4–§6 for `go build` to execute.

### A5. E2E tests (to add, Playwright + API integration + DB checks)

- `e2e/sat-flexible-m1-only.spec.ts` (new, extends `playwright.sat-authoring.config.ts` harness): covers H1, H2, F1, F6 + regression H4 smoke.
- `backend/go/cmd/api/sat_flexible_m1only_mysql_test.go` (new MySQL integration): covers H2 publish→room→sit→complete→raw, F2 ceiling, F7 revision race, F8 idempotency, F9 submit retry.
- Extend `sat_publish_mysql_test.go` + `sat_classroom_mysql_test.go` fixtures with `m1_only + flexible` rows (do not fork suites).
- DB verification in every test: `assessment_exam_questions` counts, `exam_versions.sat_flexible_count + sat_classroom_plan`, `assessment_module_attempts` terminal set, `assessment_scoring_policies.policy_key='practice'`.

Explicitly deferred per E2EDD: no new trivial unit tests, no snapshots, no mock-heavy tests.

### A6. Run results

> Not run — plan only. On `go build`, required evidence:
> `bun run typecheck`, `bunx vitest run src/features/exam-authoring/ui/create-exam src/products/sat/ui/__tests__/sessionRunSheet.test.ts`, `go test ./internal/satpublish ./internal/exams ./internal/attempts ./internal/delivery -count=1`, MySQL integration above, `e2e/sat-flexible-m1-only.spec.ts`, plus existing `sat-authoring` + `sat-classroom` suites green.

### A7. Remaining risks (E2EDD)

- Section-duration for m1_only (base-only vs base+branch clock) needs runtime confirmation; plan assumes base-only (see B8 Unknown U1).
- Run-sheet tiling with single module + accumulated pause/extension untested until E2E.
- Staff copy for `N of max (flexible)` may need UX pass after first screenshots.

### E2EDD Definition of Done + checklist

Done only when: E2E-H1..H4 + F1..F10 pass; existing sat-authoring/sat-classroom E2E green; no regressions; meaningful logs/errors; docs updated (this file + staff copy).

```text
[ ] Requirements understood and confirmed (Q1–Q17 yes, this file)
[ ] E2E scenarios written (H1–H4 + F1–F10 above)
[ ] Vertical slice implemented (B6 order, pending go build)
[ ] E2E tests pass (A6 commands, pending)
[ ] Refactored with behavior unchanged (after green)
[ ] No regressions (H4 + existing suites green)
```

---

## Part B — Low-Level Design

### B0. Change boundary & repository evidence

**Current behavior (Verified by read):**
- Creation: `CreateSatExamSheet.tsx:324-353` offers Full vs Custom; `sectionScope` fixed at creation (`:361`).
- Shapes: `satExamConfig.ts:34-50` (`full/m1_easy/m1_hard/m2_easy/m2_hard`), `SHAPE_MODULE_ROLES`; `ModuleSetPicker.tsx:4-10` renders 5 radios; `SatExamConfigFields.tsx:65-85` resets hidden timings, `:94-96` hides M2/threshold per role, `ROUTING_COPY:31-37` keeps threshold for m1_easy/m1_hard.
- Blueprint: `sat_initialization.go:34-55` RW 27 / Math 22 per module; `target_question_count` written per module (`:171`); thresholds from `satDefaultThreshold` (`sat_config.go:112-115`).
- Publish: `satpublish/validator.go:82` `len != target → sat.module.incomplete`; `:192-194` skips undeliverable modules via `plan.Uses`; `:289-301` converter topologies; `plan.go:14-19` 4 shapes, `Roles/EntryRole/ForcedBranch`.
- Completion: `attempts/sat_modules.go:216-252` requires M1+decided-M2 for base-entry, exactly 1 for standalone M2; `AwaitingStaffRouteTx:260-272`.
- Results: `SatResultDetailRoute.tsx:82-95` expects base+branch for combined estimate.
- Readiness: `releaseSelectors.ts:523-559` blueprint ceiling + `operationalCountForSection`; `ClassroomPlanField.tsx` reuses picker.

**Desired behavior:** As A1. Only `(plan == m1_only || flexible == true)` paths change.

**Non-goals:** As A1. No schema change beyond one flag column; no new service; no Practice change.

**Assumptions (labeled):**
- Verified: all paths above (read this session).
- Inferred: `exam_versions.sat_classroom_plan` is the plan store (`plan.go:LoadPlan`, `sat_modules.go:120`); `assessment_routing_policies.policy_config` holds `minimumCorrectForHigher` (`sat_initialization.go:183`); room create seals release (existing one-action flow, not re-verified here).
- Unknown U1: section `duration_seconds` recomputation for m1_only at runtime vs creation — smallest check: read `CandidateSectionSeconds` + room run-sheet projection during Step 3.

### B1. Requirements & invariants

```text
FR-1: Staff creates Custom exam with shape m1_only per section and/or flexible flag. (Who: builder/admin; Op: POST provider-exams)
FR-2: Staff authors 1..max Q per included module via builder; >max rejected.
FR-3: Flexible/M1-only draft publishes with N>=1 per included module; Full still requires N==target.
FR-4: Classroom room creates from flexible/M1-only release; Practice refused for these.
FR-5: Student sits only admitted modules (M1-only: base alone; flexible full: M1 + routed M2); M1-only completes with single terminal M1.
FR-6: Results show raw correct/total (denominator=authored N), no route badge, no scaled score for new flags.
RULE-1: Publish/room/complete permitted iff topology matches (plan, flexible) and all rows terminal.
RULE-2: flexible/scope/plan immutable post-creation; timing/break/report mutable via revision-fenced Settings.
ERR-1: N==0 included module → publish/room 409, state unchanged.
ERR-2: N>max add → 409 ceiling, count unchanged.
ERR-3: Converter non-null with new flags → 422 raw-only, policy unchanged.
ERR-4: Stale revision publish → 409/412 refresh, no partial publish.
ERR-5: Non-builder create → 403, no rows.
INV-1 (owner: satpublish validator): Full exams always len==target; flexible always 1<=len<=target. Enforced at locked publish tx.
INV-2 (owner: delivery + attempts gate): Attempt holds exactly the admitted sequence; M1-only never holds M2, never awaits staff route.
INV-3 (owner: exams init): One flag source: exam_versions.sat_flexible_count; plan source: sat_classroom_plan. No duplicate mutable copies.
INV-4 (owner: scoring/results): Raw denominator == authored operational count; never blueprint max for flexible.
SCOPE: In A1. Out: workbook-flexible, auto-timing, Practice, migration, rebrand.
```

Acceptance = E2E-H/F in A2/A5.

### B2. Entities, ownership & relationships

| Owner (verified location) | Responsibility (one reason to change) | State (authoritative vs derived) | Lifecycle / mutability |
|---|---|---|---|
| `satpublish.Plan/Shape` (`backend/go/internal/satpublish/plan.go`) | Admits roles per section | `exam_versions.sat_classroom_plan` (auth); `Roles/Entry/Forced` (derived) | Immutable post-creation; change = new exam |
| `exams.SATExamConfig` (`backend/go/internal/exams/sat_config.go`) | Validates creation config | `FlexibleQuestionCount` (input) → `exam_versions.sat_flexible_count` (auth) | Set once at create |
| `initializeSATDraftTx` (`sat_initialization.go:121`) | Materializes blueprint + plan + flag atomically | Writes version/section/module/policy rows | Create tx only |
| `satpublish.ValidateDraftForScope` (`validator.go:137`) | Publish gate | Reads draft + plan + flag; emits issues | Read-only; locked tx |
| `delivery start/submit` (`start_submit.go`, `service.go:1075`) | Serves next admitted module | `assessment_module_attempts` + `route_decisions` | Active → submitted/locked |
| `attempts.satExpectedSequence` (`sat_modules.go:181`) | Completion topology | Derives from rows + plan | Terminal check only |
| `SatExamConfigFields/ModuleSetPicker/CreateSatExamSheet` (frontend) | Staff intent capture | Local form state → POST body | Creation wizard only |
| `releaseSelectors/SectionDeliveryEditor/ClassroomPlanField` | Readiness + Settings display | Derived from shell | Read-only except timing/break |
| `SatResultDetail/scoreReportViewModel/rawdata_export` | Raw display | Derived from attempts + modules | Read-only |

Orchestrator: creation → `initializeSATDraftTx`; publish → `ValidateDraftForScope` inside locked tx; sitting → delivery; finishing → `ensureSATModuleTopologyTx + satExpectedSequence`. No new orchestrator.

State transition (M1-only Classroom section):

| Current | Event/guard | Next | Owner | Side effect |
|---|---|---|---|---|
| — | Create with m1_only | Draft with base/lower/higher rows, plan=m1_only | init tx | Flag + plan stored |
| Draft | Author 1..max in base | Draft ready (flexible note) | mutation tx | Revision bump |
| Draft | Publish (N>=1 base) | Published release | publish tx | Immutable capture |
| — | Start section | Active M1 | delivery | M1 clock starts |
| Active M1 | Submit M1 | Terminal M1, no next | delivery | raw_correct/operational=N |
| Terminal M1 | Complete (no route) | Sealed attempt | attempts gate | Raw result materialized |

### B3. Exact function-level design

```text
Location: backend/go/internal/satpublish/plan.go (Verified)
Owns: ShapeM1Only admission
Signature: const ShapeM1Only Shape = "m1_only"; func (s Shape) Roles() []string // += [base] for M1Only
Reads: plan JSON. Writes: none. Errors: ParsePlan unknown-shape on old binaries (deploy note: mixed-version window rejects m1_only until rollout completes).
Invariant: EntryRole(m1_only)=base; ForcedBranch(m1_only)="".
Callers: validator, delivery, attempts — all switch on Roles/Entry, no per-shape if-chains outside topologiesFor.

Location: backend/go/internal/exams/sat_config.go SATExamConfig.Validate (Verified)
Owns: RULE-2 + ERR-3. New field FlexibleQuestionCount *bool.
Pre: scope/plan/sections valid; converter null when flexible/m1_only.
Post: valid or validationError naming exact field.
Callers: create handler + defaults payload. Compatible: omitted flag = false (old clients unaffected).

Location: backend/go/internal/exams/sat_initialization.go initializeSATDraftTx (Verified)
Owns: atomic materialization (INV-3).
Writes: exam_versions (plan + sat_flexible_count), sections/modules (target=max preserved), routing policy, scoring policy_key='practice' when new flags.
Transaction: single tx.Tx; failure rolls back all rows.

Location: backend/go/internal/satpublish/validator.go ValidateModule + ValidateDraftForScope (Verified)
Owns: INV-1.
New: func ValidateModuleFlexible(m Module, flexible bool) []Issue // 1<=len<=target → sat.module.empty when 0 (blocking), sat.module.flexible_note when 1<=len<target (non-blocking)
Reads: LoadPlan + LoadFlexibleFlag(versionID).
Post: Full path identical issue set; flexible path replaces incomplete-blocking with note.
Converter: topologiesFor(m1_only) = {M1Only:[base]}; validateConverter returns nil when policy_key=='practice' (raw-only), so no table needed.

Location: backend/go/internal/attempts/sat_modules.go satExpectedSequence (Verified)
Owns: INV-2 (completion).
New branch BEFORE M1-based check:
  if plan.ShapeFor(section)=="m1_only" {
    if len(rows)!=1 || rows[0].role!=base || rows[0].selected!="" { return unexpected }
    continue
  }
Reads: rows + plan. Writes: none. Errors: conflict on violation; ParsePlan error bubbles.

Location: backend/go/internal/delivery/start_submit.go nextModule/decideRoute (Verified entry points at :1641, :1747)
Owns: FR-5 serving.
Behavior: ForcedBranch(m1_only)="" so no forced override; after M1 submit, nextModuleTx returns nil (no M2) when shape==m1_only; EntryRole!=base guard (:1751) unaffected (m1_only entry is base).
Transaction: existing attempt-lock ordering preserved; no new locks.

Location: src/.../satExamConfig.ts + ModuleSetPicker.tsx + SatExamConfigFields.tsx + CreateSatExamSheet.tsx (Verified)
Owns: FR-1 capture.
New: SHAPE_LABELS/ROLES m1_only; picker 6th radio; fields hide M2+threshold for m1_only (extend :92-96 filter), reset hidden M2 to defaults in setShape (:65-85); sheet adds flexible checkbox + hides converter-upload + shows <5Q hint + flexible planSummary.
Reads: defaults/limits. Writes: POST body only. Compatible: Full path props unchanged.

Location: releaseSelectors.ts + SectionDeliveryEditor.tsx + ClassroomPlanField.tsx + SatResultDetailRoute.tsx + rawdata_export.go (Verified)
Owns: FR-6 display + RULE-1 copy.
New: flexibleNoteForSection (non-blocking); threshold editor hidden for m1_only; result detail exempts m1_only from base+branch check; rawdata denominator=authored count.
```

### B4. Algorithm / control flow

Happy path (publish, flexible M1-only RW, 10Q):

```text
1. POST provider-exams {sections:{rw:{...32...}}, classroomPlan:{rw:m1_only}, flexible:true, opKey} (actor=builder)
2. Validate() → scope ok, plan parses, converter null → pass
3. initializeSATDraftTx: INSERT version (plan, flexible=1) → sections/modules (targets 27/22/22) → policy → scoring practice → COMMIT
4. Author 10× POST question (module=rw-m1) → each tx checks COUNT+additional <= target(27) → pass, revision++
5. POST publish {revision}: LOCK version → LoadPlan=m1_only, LoadFlexible=1 → for rw-m1: len=10 → flexible_note (non-blocking); undeliverable m2-* skipped via Uses → no converter req (practice) → COMMIT published
6. POST room (Classroom): captures release → OK
7. GET bootstrap → delivery serves rw-m1 only (EntryRole base)
8. POST submit M1 (10 answers) → close manifest=10 → raw_correct computed, operational=10
9. POST complete → topology: 1 terminal base, Awaiting=false, satExpectedSequence m1_only pass → sealed, raw 6/10 materialized
```

Failure branches: F1 (len=0 → sat.module.empty blocking, no commit); F2 (COUNT==27 → INSERT rejected 409); F3 (flexible=false → len!=target blocking preserved); F4 (converter!=null + flag → 422); F7 (revision CAS mismatch → 409/412); F8 (opKey replay → single row).

Ordering/concurrency: publish holds version lock during ValidateDraftForScope (existing); question adds serialize on module target check + revision bump (existing); no new locks/caches/queues.

### B5. Concrete implementation sequence (file-by-file, dependency order)

1. `backend/go/migrations/00xx_sat_flexible_count.sql` (new): `ALTER TABLE exam_versions ADD COLUMN sat_flexible_count TINYINT(1) NOT NULL DEFAULT 0;` — backward compatible.
2. `backend/go/internal/satpublish/plan.go` + `plan_test.go`: add `ShapeM1Only`, Roles/Entry/Forced, ParsePlan allowlist.
3. `backend/go/internal/exams/sat_config.go` + `sat_config_test.go`: `FlexibleQuestionCount`, Validate (incl. ERR-3), defaults payload.
4. `backend/go/internal/exams/sat_initialization.go`: persist plan + flag; m1_only section duration = base only (verify CandidateSectionSeconds call site).
5. `src/features/exam-authoring/contracts/assessment.ts` + `satExamConfig.ts`: `m1_only`, labels/roles/path/copy.
6. `src/features/exam-authoring/ui/create-exam/ModuleSetPicker.tsx`, `SatExamConfigFields.tsx`, `CreateSatExamSheet.tsx`: picker + fields + sheet + flexible checkbox + converter gating + warnings.
7. `backend/go/internal/satpublish/validator.go` + `validator_test.go`: flexible module rule, scope loading, topologiesFor, converter bypass for practice.
8. `backend/go/internal/authoring/workbook_binding.go`: keep exact-count; add flexible-specific message (no logic fork).
9. `backend/go/internal/delivery/start_submit.go` + `service.go`: m1_only nextModule=nil (no new policy key).
10. `backend/go/internal/attempts/sat_modules.go` + `submit_sat_module_gate_test.go`: m1_only sequence branch.
11. `src/products/sat/ui/sessionRunSheet.ts` + `sessionRunSheet.test.ts`: single base slot for m1_only.
12. `src/products/sat/routes/SatResultDetailRoute.tsx` + score view model + `results/sat_rawdata_export.go` + `release/service.go`: raw M1 display/export.
13. `src/features/exam-authoring/ui/release/releaseSelectors.ts` + `SectionDeliveryEditor.tsx` + `ClassroomPlanField.tsx` + settings: flexible note, threshold hiding, creation-lock message.
14. `e2e/sat-flexible-m1-only.spec.ts` + `sat_flexible_m1only_mysql_test.go`: A5 tests.

### B6. Worked trace (adversarial: publish race + retry)

```text
Initial: version V rev=42, rw-m1 10/27, flexible=1, plan={rw:m1_only}
1. Staff A POST publish {rev:42, opKey:A} → LOCK V → LoadPlan/Flag → Validate: flexible_note only → prepares COMMIT
2. Staff B POST add-question {rev:42} → waits on version lock (existing ordering)
3. A COMMITs published@rev42 (10Q release R1) → UNLOCK
4. B proceeds → sees published? → revision CAS fails (draft moved) → 409 "draft changed, refresh" → no silent overwrite
5. A retries POST publish {same body, opKey:A} after timeout → idempotent replay returns R1, no second release
Final: one release R1 (10Q), draft rev=43 (if B re-applies on new draft), INV-1/INV-3 hold
```

### B7. Verification (maps every FR/RULE/ERR/INV to E2E; no trivial unit tests)

| Requirement | E2E proof | Command / suite |
|---|---|---|
| FR-1/2/3, ERR-1/2 | H1,H2,F1,F2 + DB counts | new spec + mysql test + shell read |
| FR-4/5, RULE-1, INV-2, ERR-5 | H2,H3,F5,F6 | mysql + spec (Classroom vs Practice refusal) |
| ERR-3/4, F7/F8/F9 | F4,F7,F8,F9 | mysql concurrency + opKey replay |
| INV-1/3/4, FR-6 | H2 result 6/10, export | spec + rawdata DB check |
| Regression | H4, F3, F10 | existing sat-authoring + sat-classroom + publish suites |

### B8. Extensibility & remaining risks

- Probe (one real change): later "M1-only with scaled estimate" → owner is `topologiesFor + validateConverter + satconvert tables`; current boundary isolates it (add `M1Only` topology + table, no delivery/attempts change). Not implemented now.
- Risks: U1 section-duration recompute (check `CandidateSectionSeconds` during Step 3); old-binary/new-plan deploy window (gate m1_only creates until rollout complete); run-sheet pause/extension tiling for single module (cover in E2E).
- Rollout: ship behind existing `classroomCreationEnabled` gate; no new env in v1; rollback = stop creating flagged exams (old exams unaffected by default-0 column).

### B9. Audit fixes (2026-11-04 — implemented; see `2026-11-04-sat-flexible-audit-fixes.md`)

- Threshold feasibility is a publish/Settings gate, not a close-time surprise: flexible M1-based sections
  (full/m1_easy/m1_hard) publish only when `minimumCorrectForHigher <= authored base N`, else blocking
  `sat.threshold.unreachable`. Settings bounds the threshold by authored N for flexible drafts
  (blueprint max otherwise). `chooseAdaptiveRoute` semantics unchanged (Rust parity).
- Flexible implies Classroom-only with or without plan rows: Practice scheduling refuses flexible
  versions (`PersistSATSession`), and the creation sheet no longer presents flexible-without-plan
  drafts as Practice-compatible.
- Draft clone preserves `sat_flexible_count` alongside `sat_classroom_plan`; v2 drafts stay flexible.
- Settings section-duration writes are plan-aware (m1_only → base only), matching init; the live
  countdown was already correct via the `runtimePlanIn` classroom override.
- Converter attach in Settings mirrors the creation raw-only refusal for flexible/m1_only drafts.
- **Recreate guidance for pre-fix releases:** a flexible release published with threshold > authored N
  can never close its M1 (immutable rows; draft edits can't reach live attempts) and Practice rooms
  created on flexible-no-plan releases serve partial modules. Remedy: abandon the room/release and
  recreate (lower the threshold first, use a Classroom room); there is no in-place repair.

### Self-review (low-level contract)

- Inspected real owners + readers/writers; Full path preserved; one owner per mutation; server-side enforcement; precise pre/post/errors; duplicate/stale/parallel traces in B4/B6; no new abstraction beyond one flag + one shape; tests prove enforcement via E2E/DB (not mocks); Verified/Inferred/Unknown labeled; narrow diff ordered by dependency.
