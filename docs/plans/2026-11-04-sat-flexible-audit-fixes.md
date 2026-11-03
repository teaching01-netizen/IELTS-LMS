# SAT Flexible/M1-only Audit Fixes — Low-Level Implementation Plan (plan only, no code yet)

> Source: business-logic edge-case audit of working tree vs `HEAD 974526f3` (4 CONFIRMED bugs, 2 defensive gaps, 3 spec gaps).
> Status: PLAN ONLY. No source edits made. Trigger `go build-audit-fixes` to execute.
> Non-goals: no architecture changes (flag + shape model is sound); no new tables, queues, caches, or services; no threshold-semantics redesign beyond the gates below (GAP-3 decision recorded, not implemented).

## 0. Change boundary & repository evidence

**Current behavior → desired behavior.**
- BUG-001 (S1): flexible full-shape exams can publish with routing threshold above authored M1 N (both validators bound the threshold by blueprint max); the first adaptive M1 close then hard-fails in `chooseAdaptiveRoute` and rolls back, leaving a whole room stuck at the M1 boundary with no mid-exam recovery (delivery reads immutable published rows; draft threshold edits can't reach live attempts). Desired: unreachable thresholds are refused at publish/Settings time, before any room exists.
- BUG-002 (S2): flexible-without-plan versions pass the Practice gate (`PersistSATSession` checks plan rows only) and the creation UI presents them as Practice-compatible. Desired: flexible implies Classroom-only everywhere plan-bearing does.
- BUG-003 (S2): `clonePublishedSATToDraftTx` copies `sat_classroom_plan` but not `sat_flexible_count`; v2 drafts of flexible exams flip to strict gates and become unpublishable. Desired: flag survives cloning.
- BUG-004 (S3): `UpdateDeliverySettings` recomputes section duration as base+longer-branch even for m1_only (init writes base-only); first timing save inflates the stored row 2×. Student countdown is safe (`runtimePlanIn` classroom override sums `Roles()`), but the stored row diverges. Desired: one plan-aware rule at both writers.
- D-1 (P3): `SetScoreConverter` has no flexible/plan guard while creation does → m1_only + converter is a silent no-op (converter publishes, never converts). Desired: mirror guard.
- D-2 (P3): `AwaitingStaffRouteTx` has no plan filter; unreachable today via room-create refusals. Desired: pinning test, no logic change.

**Verified files/symbols** (all read this session): `delivery/start_submit.go` (`finalizeModuleWithBasisTx:1166`, `nextModuleTx:1602`, `chooseAdaptiveRoute:1856`), `authoring/delivery_settings.go` (`sectionCandidateSeconds:19`, `UpdateDeliverySettings:34`), `authoring/score_converter.go` (`SetScoreConverter:35`), `authoring/classroom_plan.go` (`SetClassroomPlan:50`), `authoring/shell_open.go` (`clonePublishedSATToDraftTx:158`, INSERT `:173`), `exams/sat_config.go` (creation `Validate`, threshold vs max), `exams/sat_initialization.go` (m1_only base-only `:168-169`, raw-only materialization `:206-226`), `exams/sat_route_policy.go` (`PersistSATSession:105`), `exams/section_time.go` (single-owner rule), `schedules/service.go` (`runtimePlanIn:836`, `plannedSectionSecondsByKey:1011`, `Roles()` sum `:1042-1056`), `satpublish/plan.go` (`LoadFlexibleFlag:152`), `satpublish/validator.go` (`ValidateModuleFlexible:119`, flag load `:199`, branch `:287`), `attempts/sat_modules.go` (`satExpectedSequence`, `AwaitingStaffRouteTx:260`), frontend `CreateSatExamSheet.tsx:317,444`, `SectionDeliveryEditor.tsx:162,189,211`, `releaseSelectors.ts:136` (`flexibleNoteForSection`), `ExamSettingsPage.tsx` (unconditional `ScoreConverterPanel`).

**Assumptions/Inferred:** none material — every fix below names an inspected enforcement point. **Unknown:** none blocking; one first-task verification (run-sheet duration source) is sequenced in Fix 4.

## 1. Requirements & invariants

```text
FR-1: Publish refuses flexible M1-based sections whose threshold exceeds authored base N.
FR-2: Settings threshold bound follows authored N for flexible drafts (max stays for strict drafts).
FR-3: Practice scheduling refuses flexible versions with or without plan rows.
FR-4: Draft clone preserves flexible flag + plan together.
FR-5: Settings section-duration write is plan-aware (m1_only → base only).
FR-6: Settings converter attach refuses flexible/m1_only drafts (mirror of creation rule).
RULE-1: Publish is the atomic commit boundary for FR-1 (locked draft tx; fail-closed, no partial publish).
RULE-2: Delivery close behavior UNCHANGED (chooseAdaptiveRoute keeps Rust parity; no relaxations).
ERR-1: threshold > authored N at publish → 409/422 validation naming section + both numbers; draft unchanged.
ERR-2: practice schedule on flexible version → 409 validation; no schedule row mutated.
ERR-3: converter attach on flagged draft → 422 raw-only message (creation's exact string); policy row unchanged.
INV-003 (repair): every M1 close yields a route or clean end — enforced at authoring (publish+settings+room gates) instead of at close.
INV-002 (repair): flexible bounds survive version lifecycle — enforced at clone.
INV-004 (repair): stored section duration == candidate-length rule — enforced at both writers.
INV-005 (repair): flexible ⇒ classroom — enforced at schedule gate, not just plan presence.
INV-006 (repair): raw-only for flags — enforced at every converter write path.
SCOPE: P0–P3 fixes below. OUT: GAP decisions (plan-lock enforcement, converter-with-matching-tables policy,
  threshold-semantics doc), threshold auto-scaling, workbook-flexible, migration (none needed — logic only).
```

Acceptance per fix: the `Then` lines in §7 + the regression tests in §7.

## 2. Entities, ownership & relationships

| Owner (verified) | Responsibility | State (auth vs derived) | Change |
|---|---|---|---|
| `satpublish.ValidateDraftForScope` (`validator.go`) | Publish gate incl. FR-1 | Reads draft questions + routing rows + plan + flag | Add threshold-vs-actual check |
| `authoring.UpdateDeliverySettings` (`delivery_settings.go`) | Timing/threshold writes incl. FR-2/FR-5 | Draft rows under `FOR UPDATE` + revision CAS | Authored-N bound; plan-aware duration |
| `exams.PersistSATSession` (`sat_route_policy.go`) | Venue gate incl. FR-3 | Reads plan + flag of pinned version | Add flag check in practice branch |
| `authoring.clonePublishedSATToDraftTx` (`shell_open.go`) | Version cloning incl. FR-4 | Copies rows published→draft | Copy flag column |
| `authoring.SetScoreConverter` (`score_converter.go`) | Converter writes incl. FR-6 | Draft scoring-policy row in tx | Add flag/plan guard |
| `delivery.nextModuleTx` / `chooseAdaptiveRoute` | Close routing | Live published rows | UNTOUCHED (parity) |
| `schedules.runtimePlanIn` | Live clock | Derived override | UNTOUCHED (already correct) |

Orchestrators unchanged (publish tx, settings tx, schedule create, clone tx). No new source of truth: flag stays `exam_versions.sat_flexible_count`; plan stays `sat_classroom_plan`.

State transitions touched:

| Current state | Event/guard | Next state | Owner | Side effect |
|---|---|---|---|---|
| Flexible draft, threshold > authored N | Publish / Settings save | REJECTED (was: accepted) | validator / settings | No mutation; named error |
| Flexible version, practice schedule request | Room create | REJECTED (was: scheduled) | PersistSATSession | No schedule row |
| Published flexible release | Continue editing | Draft flexible=1 (was: 0) | clone tx | Flag + plan copied |
| m1_only section, timing save | Settings save | Row stays base-only (was: inflated) | settings | Correct duration row |
| Flagged draft, converter attach | Settings save | REJECTED (was: stored) | score_converter | Policy row unchanged |

## 3. Exact function-level design

```text
Location: backend/go/internal/satpublish/validator.go — ValidateDraftForScope (Verified)
Owns: FR-1. Reads: draft module/question rows (existing) + routing thresholds (NEW read) + plan + flag (existing).
Writes: none (issue list). New branch: for each section with flexible==true and plan.ShapeFor(section)
  M1-based (EntryRole()==base: full/m1_easy/m1_hard) AND attempted delivery includes M1 routing
  (conservative: all three shapes), read assessment_routing_policies.minimumCorrectForHigher for the
  section, compare against ACTUAL base-module question count already loaded; if threshold > actual →
  blocking issue code `sat.threshold.unreachable` (NEW code string), path `<section>.minimumCorrectForHigher`,
  message naming section, threshold, and authored N. Non-flexible sections: untouched.
  m2-only shapes: skipped (no M1, no threshold use). m1_only: threshold row still exists (init writes
  default) but unused at close; SKIP m1_only (no close path consumes it) to avoid false refusals —
  document why in comment.
Preconditions: locked draft tx (existing caller). Postconditions: issue list; commit iff no blocking.
Error contract: validation issue (publish 409/422 path, existing mapping). Callers: release readiness +
  publish tx + room-create readiness — all inherit the gate with zero caller changes.
Invariant enforcement: same tx that seals the release (RULE-1).
```

```text
Location: backend/go/internal/authoring/delivery_settings.go — UpdateDeliverySettings (Verified)
Owns: FR-2 + FR-5. Two surgical edits:
 (a) Threshold upper bound: replace `operational = targetCount` (lines ~140-143) with
     `operational = targetCount; if flexibleThisVersion { operational = max(1, authoredBaseCount) }`
     where flexibleThisVersion = LoadFlexibleFlag(draftID) (needs satpublish import — check import cycle:
     delivery_settings.go already imports examdomain; classroom_plan.go (same package) imports satpublish,
     so no cycle — Verified safe) and authoredBaseCount = COUNT(eq) for baseID in this tx.
     Non-flexible path byte-identical.
 (b) Section duration: load plan via satpublish.LoadPlan in-tx (draftID already locked); compute
     `sectionDuration`; if plan.ShapeFor(sectionKey)=="m1_only" → sectionDuration = durations[baseID].
     Needs sectionKey: add `SELECT section_key` (section row already locked; one extra column in existing
     SELECT at line ~46) or reuse mods scan. Writes: same three UPDATEs, corrected values.
     Threshold policy_config write unchanged (default threshold still stored for m1_only; unused at close).
Preconditions: draft-only (existing), revision CAS (existing). Postconditions: same rows, corrected bounds/values.
Callers: SectionDeliveryEditor save — UNCHANGED request shape (frontend already sends all 3 timings +
  default threshold; backend now interprets them correctly).
```

```text
Location: backend/go/internal/exams/sat_route_policy.go — PersistSATSession practice branch (Verified)
Owns: FR-3. Edit inside `if !session.Classroom` after the plan loop (~line 121):
  flex, err := satpublish.LoadFlexibleFlag(ctx, q, versionID); if err → return err;
  if flex → CodeValidation "This exam version allows flexible question counts; schedule it as a Classroom session."
  (mirrors the plan message one branch above). Interface check: RoutePolicyExecer satisfies
  satpublish.Queryer (QueryContext) — PROVEN by existing LoadPlan call on the same q. No signature change.
```

```text
Location: backend/go/internal/authoring/shell_open.go — clonePublishedSATToDraftTx (Verified)
Owns: FR-4. Edits: SELECT at :162 += `sat_flexible_count` (scan into int/bool); INSERT at :173 +=
  column + value. One line each. No behavior change for flag=0 rows (default inserted explicitly).
```

```text
Location: backend/go/internal/authoring/score_converter.go — SetScoreConverter (Verified)
Owns: FR-6. Edit inside tx after draftID lock: LoadPlan(draftID) + LoadFlexibleFlag(draftID);
  if converter non-null AND (flex || any plan shape==m1Only) → validationError with creation's exact
  string ("Score converter is not supported for flexible or M1-only SAT exams; ...").
  Null/clear path unchanged. Same-package satpublish import already exists pattern (classroom_plan.go) — no cycle.
```

```text
Location: frontend — CreateSatExamSheet.tsx:444 copy (Verified) + room-mode gating (Proposed; verify)
Owns: FR-3 display half. Exact: extend the !hasCustomPlan Practice-compatible copy condition with
  `&& !isFlexible` (isFlexible exists at :317). Deeper room-mode gating (where practice rooms are
  offered for plan-less exams) is backend-covered by FR-3; frontend follow-up = copy only, plus a
  verify task: grep practice-offer logic in AccessLinkEditorSheet/room flows for a flag check.
Location: frontend — SectionDeliveryEditor threshold hint (Verified lines 189,343-346)
Owns: FR-2 display half. Exact: operationalCount used in save guard + hint already blueprint-based;
  change to authored base length when flexible (shell section.modules[].questions.length for the base
  module — AssessmentModuleShell.questions Verified in contracts/assessment.ts). Non-flexible: untouched.
Location: frontend — ScoreConverterPanel gating (Proposed; verify in ExamSettingsPage/ScoreConverterPanel:
  hide upload + show raw-only note when exam flexible/m1_only; needs exam flag in the settings query —
  confirm shell/query carries it, else add field).
```

## 4. Algorithm / control flow

Happy path (publish gate, flexible 10Q RW, threshold default 13):

```text
1. POST publish {revision} → lock draft version (existing).
2. LoadPlan + LoadFlexibleFlag (existing) → flexible=true.
3. Per-module counts (existing) → rw-m1 actual=10 → flexible_note (non-blocking, existing).
4. NEW: section rw, flexible, shape full (M1-based) → read routing threshold=13 → 13 > 10 →
   push blocking `sat.threshold.unreachable` → publish refused 409/422, zero mutations.
5. Staff lowers threshold to ≤10 in Settings (FR-2 bound now permits exactly 1..10) → republish →
   gate passes → release sealed → rooms servable; every future close satisfies
   threshold ≤ operationalCount by construction (counts only shrink... see edge: questions DELETED
   post-publish? releases immutable — draft deletions re-gate at next publish. Existing rooms pin R1. Safe.)
```

Failure branches: threshold==N → pass (boundary inclusive); non-flexible → gate skipped (byte-identical); m1_only → skipped with comment; m2-only → skipped; threshold row missing → existing "policy missing" validation (unchanged); stale revision → existing CAS conflict (unchanged); old binary/new plan → ParsePlan rejects (unchanged, fail-closed).

Transaction/order notes: FR-1 read added inside the existing locked publish tx (no new lock ordering); FR-2/FR-5 inside existing settings tx (draft lock → section lock → module locks → routing lock: ordering preserved, plan/flag reads are SELECTs under the same tx); FR-4 inside existing clone tx; FR-3/FR-6 single-row reads/writes in existing txs. No new locks, no new ordering, multi-instance safe via existing fencing.

## 5. Concrete implementation sequence (dependency order, reversible slices)

1. FR-4 clone flag (2 lines, zero blast radius) + clone-parity test. Verify: existing clone tests green.
2. FR-3 practice refusal (5 lines) + schedule test (flexible-no-plan practice → 409; flexible+classroom → ok; strict full+practice → ok). Verify: `go test ./internal/exams`.
3. FR-1 publish gate (new check + code string + test: threshold>N refused, ==N passes, non-flexible untouched, m1_only skipped). Verify: `go test ./internal/satpublish`.
4. FR-2 settings bound + FR-5 duration branch (one file, one tx) + settings tests (flexible bound follows authored N; m1_only duration stable across save; strict paths byte-identical). Verify: `go test ./internal/authoring`.
5. FR-6 converter guard + test (flagged draft attach → 422; clear → ok; strict draft attach → ok). Same package tests.
6. Frontend: sheet copy (1 condition), editor hint/bound (authored-N count), panel gating (after confirming query field). Verify: `bun run typecheck`, targeted vitest, Playwright authoring spec extension (publish-refusal copy; practice-unavailable copy).
7. Docs: update `docs/plans/2026-11-03-sat-flexible-count-m1-only.md` gate descriptions (threshold gate, practice rule, clone parity) — keeps spec and code from re-drifting.

Compatibility: no schema change (migration-free); no API shape change (new issue code string only — clients render unknown codes generically; confirm `satIssueRoute`/readiness UI has a generic fallback — verify task); old clients unaffected (they can't set the flag); rollout needs no gating (all changes fail-closed).

## 6. Worked trace (adversarial: publish race + threshold edit)

```text
Initial: flexible draft V rev=42, rw-m1=10Q, threshold=13, no rooms.
1. Staff A POST publish {rev:42} → lock V → counts(10) + NEW threshold check (13>10) → 422
   `sat.threshold.unreachable`; zero mutations; V stays rev=42.
2. Staff B POST settings {threshold:9, rev:42} → bound check 9 ≤ max(1,authored=10) → pass →
   policy_config=9, rev=43.
3. Staff A retries publish {rev:42} → CAS conflict (rev moved) → refresh; republishes {rev:43} →
   threshold 9 ≤ 10 → sealed release R1. Final: R1 publishable AND closable (9 ≤ 10 at every future close).
Invariant checks: INV-003 holds for R1 by construction; INV-002 untouched; no partial release at any step.
```

Concurrency trace (clone vs publish): clone tx holds published-source `FOR UPDATE`; publish tx locks draft — different rows, no deadlock (existing pattern, unchanged).

## 7. Verification (maps every FR/ERR to a test; bold = new)

| Class | Test | Command |
|---|---|---|
| Unit (new) | Threshold gate matrix: N=10 × thr∈{1,10,11,13,27} → pass,pass,refuse,refuse,refuse; m1_only skipped; strict skipped | `go test ./internal/satpublish -run 'Threshold|Flexible' -count=1` |
| Unit (new) | Settings bound: flexible draft 10Q accepts thr≤10, rejects 11; strict draft accepts ≤27 | `go test ./internal/authoring -run 'DeliverySettings|Threshold' -count=1` |
| Unit (new) | Clone parity: flag+plan survive together; flag=0 rows unchanged | existing clone test file + case |
| Unit (new) | Practice refusal: flexible-no-plan → 409; plan-bearing → 409 (existing); strict → ok | `go test ./internal/exams -run 'SATSession|Classroom' -count=1` |
| Unit (new) | Converter guard: flagged attach → 422; clear → ok; strict attach → ok | `go test ./internal/authoring -run 'ScoreConverter' -count=1` |
| Unit (new) | Duration: m1_only save×2 → row stable base-only; full save → base+branch (existing parity) | `go test ./internal/authoring -run 'SectionDuration|DeliverySettings' -count=1` |
| Integration | MySQL: full H2 publish→room→sit→complete→raw on fixed release (threshold 9, N=10) incl. adaptive route lower branch taken | `TEST_MYSQL_DSN=... go test ./cmd/api -run 'FlexibleM1|SATFlexible' -count=1` |
| Contract | New `sat.threshold.unreachable` code renders in release UI generic path (confirm fallback) + room-flow error copy | vitest release/publish suites |
| E2E | Playwright authoring: create flexible 10Q → publish refused with threshold copy → lower → publish ok → Classroom room → M1 sit → complete raw | `bunx playwright test --config playwright.sat-authoring.config.ts` |
| Regression | Full existing gates green (no new refusals on strict drafts) | `go test ./internal/...` + sat-authoring/sat-classroom suites |
| Recovery | Abandoned-room guidance note for any pre-fix flexible release with threshold>N (releases immutable — document recreate path) | docs only |

Distinguish executed vs proposed: all above are PROPOSED until `go build-audit-fixes`; sqlmock suites run locally, MySQL + Playwright need infra (same constraint as the feature lane).

## 8. Extensibility & remaining risks

- Realistic probe (threshold auto-scale): if product later wants thresholds proportional to N, the FR-1 check site (`ValidateDraftForScope`, owning counts + policy + plan in one tx) is the single modification point — no delivery/close change needed. Current fix stays simple on purpose.
- D-2 (AwaitingStaffRouteTx plan filter): add a pinning integration test (staff_selects + shaped plan stays refused at room create); no logic change.
- Rollout: logic-only, fail-closed, no migration; deploy order irrelevant (old binaries reject unknown `m1_only` plan shapes AND unknown issue codes render generically — verify the generic-code fallback during implementation).
- Residual risk: pre-fix flexible releases already published with threshold>N are unclosable AND unfixable in place (immutable rows) — ship the recreate guidance with the fix; consider a CI audit query listing flexible releases where threshold > base counts.
- Self-review answers: owning functions + all callers inspected (§0); contracts preserved (one additive issue code; verified generic fallback as a task); state+behavior co-owned per row; rules server-side; duplicate/stale/parallel traces in §4/§6; no new abstractions (one code string, two conditionals, one column copy); tests target enforcement (sqlmock + MySQL + E2E, not mocks of outcomes); Verified vs Proposed labeled throughout (§3 locations, §7 executed-vs-proposed).

## Appendix — audit finding → fix slice map

```text
BUG-001 S1 → Fix FR-1 (+FR-2 Settings bound) ............ P0 slice 3+4
BUG-002 S2 → Fix FR-3 (+ sheet copy) .................... P1 slice 2+6
BUG-003 S2 → Fix FR-4 ................................... P1 slice 1
BUG-004 S3 → Fix FR-5 ................................... P2 slice 4
D-1 P3 ... → Fix FR-6 ................................... P3 slice 5
D-2 P3 ... → pinning test ............................... P3 slice 7-docs/tests
GAP-1/2/3 → decisions recorded in SCOPE, not implemented
```
