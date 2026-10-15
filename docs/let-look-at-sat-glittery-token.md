# Plan: Guided "Create exam" — modules, Classroom use, and Results & scoring in one flow

## Context

Today a SAT exam's Classroom behavior is spread across three places that staff only discover later:

| Concept | Where it lives today | Level |
|---|---|---|
| Timing / break / routing threshold | Create dialog → "Customize settings" (`SatExamConfigFields`), later Settings | Exam |
| **Classroom modules** (which modules students receive per section) | Only Settings → each section card, bottom (`ClassroomPlanField`, saves on change) | Exam (draft) |
| **Score report after the exam** | Create dialog checkbox + Settings → Results & scoring (`ScoreReportSettingPanel`) | Exam (live) |
| **Estimated score converter** (JSON) | Only Settings → Results & scoring (`ScoreConverterPanel`) | Exam (draft) |
| **Classroom mode** (Practice vs Classroom + Module 2 routing) | Room sheet (`AccessLinkEditorSheet` → `sessionTypeField`) | Room |

Hidden coupling staff currently hit as server errors (all Verified):
- A module plan makes the exam **Classroom-only**: Practice rooms are rejected (`backend/go/internal/exams/sat_route_policy.go` `PersistSATSession`: "This exam version has a classroom module plan; schedule it as a Classroom session.").
- A planned section rejects "Teacher picks Module 2" rooms, and a single-branch plan silently overrides "everyone gets easier/harder" (`start_submit.go:1385`).
- Classroom rooms require the server gate `classroomCreationEnabled` (`SatConfigDefaults`); with it off, a plan-bearing exam could never get a room at all.
- The plan changes which modules need questions (publish validation) — the authoring workspace never shows this.

**Goal:** "Create exam" in the Exam library becomes a short, guided sheet that asks the questions in the order staff think about them — *what is this exam for → what do students sit → what do they see at the end* — and saves everything in **one atomic create**. Settings and the room sheet then speak the same language, so nothing contradicts what was chosen at creation.

## Decisions (defaults — adjust at review)
- **Multi-step sheet, not a long form.** 4 short steps, each fits one screen; "Use standard SAT" fast path creates in 1 step (today's behavior preserved).
- **"Classroom" at exam level = a module plan.** Session type stays a room choice (it must — one exam serves many rooms). The exam step only decides whether the exam is a *full adaptive SAT* (works in Practice and Classroom rooms) or a *custom module set* (Classroom rooms only).
- **Converter is optional in the flow and saved atomically with the create** (no "exam created but converter failed" half-state).
- No sub-agents; no new services/tables. One new optional field pair on the existing create payload.

## Requirements

| ID | Behavior | Acceptance |
|---|---|---|
| FR-1 P0 | Library → Create exam opens a stepped sheet: **Basics → Modules & timing → Results → Review**. | Step indicator "Step n of 4"; Back keeps entered values; Esc/close on a dirty sheet asks to discard (existing `SatConfirmDialog`). |
| FR-2 P0 | Basics: name + "How will students take this exam?" — **Full SAT** (default) or **Custom modules**. "Create with standard settings" submits from step 1. | Fast path sends only `{title}` (current test `creates a SAT directly…` keeps passing). |
| FR-3 P0 | Modules & timing: per section, choose module set (Custom only); only the timing fields that the chosen set uses are shown; routing threshold only for full adaptive. | Hidden fields reset to server defaults so they never block validation; live "Students sit: Module 1 · 32 min → Easy Module 2 · 32 min" line. |
| FR-4 P0 | Custom modules is disabled with a reason when `classroomCreationEnabled` is false. | Option rendered `aria-disabled`, helper text explains; never sent. |
| FR-5 P0 | Results: score-report switch + optional converter JSON ("Raw scores only" default). | Invalid JSON blocked client-side; server-invalid converter shows the server sentence on the Results step, exam not created. |
| FR-6 P0 | Review shows a plain-language summary with Edit links per step; Create sends name + config + plan + converter in one request. | Exactly one POST; on success navigate to `/sat/exams/:id` (unchanged). |
| FR-7 P0 | Room sheet respects the plan (mirrors `PersistSATSession`): if any in-scope section is planned → preselect Classroom, disable Practice, hide "Teacher picks"; hide "Everyone gets the easier/harder Module 2" when a planned section's shape doesn't use that branch (`plan.Uses`); show "Module 2 is set by the exam" for planned sections. | No path in the room sheet produces the three plan-related server rejections (practice-with-plan, staff-selects, forced-route conflict). |
| FR-8 P1 | Settings mirrors the flow: per section, **Module set** first, then only the relevant timing fields; Results & scoring unchanged in content, copy aligned. | Same picker component as create. |
| FR-9 P1 | Authoring workspace marks modules outside the plan "Not used — this exam's module set skips it". | Badge on module nav/heading; no question gating change. |

Non-goals: library row badges, changing session-type semantics, converter authoring UI (still JSON upload), IELTS/ACT.

| NFR | Target | Verification |
|---|---|---|
| Atomicity | Create writes entity, draft, plan, converter, report flag in one tx or nothing | Go test: invalid converter → no `exam_entities` row |
| Server authority | Client never hardcodes limits/shapes; server re-validates plan (`satpublish.ParsePlan`) and converter (`satconvert.Parse`) | Go validation tests |
| Accessibility | Keyboard-only completion; step change moves focus to step heading; radio-card groups are `role="radiogroup"`; errors `role="alert"` + `aria-describedby`; 44px targets; reduced-motion respected | RTL tests + manual VoiceOver pass |
| Compatibility | Old clients (no new fields) behave exactly as today | Existing library + Go create tests pass unchanged |

## Invariants
- **INV-1** A created exam's plan is either absent or valid per `satpublish.ParsePlan`; never partially written.
- **INV-2** The UI never offers a room choice the server would reject for plan reasons (Practice with plan; staff-selects on a planned section).
- **INV-3** A plan is only creatable when `classroomCreationEnabled` is true (UI); server still accepts plans regardless (draft is editable, gate applies at room creation — unchanged).
- **INV-4** Fields hidden by the chosen module set hold server defaults at submit.

## Interface changes

**Backend — `POST` create exam (`backend/go/cmd/api/handlers_admin.go` → `exams.CreateForActor`)**
Extend `exams.SATExamConfig` (`backend/go/internal/exams/sat_config.go`):
```go
ClassroomPlan  map[string]string `json:"classroomPlan,omitempty"`   // section -> m1_easy|m1_hard|m2_easy|m2_hard
ScoreConverter json.RawMessage   `json:"scoreConverter,omitempty"`  // null/absent = raw scores only
```
- `Validate()`: plan → `satpublish.ParsePlan` (exams already imports satpublish in `sat_route_policy.go`); converter → `satconvert.Parse`. Errors become validation errors with the parser's sentence (same text Settings shows today).
- `initializeSATDraftTx` (`sat_initialization.go`): after the version insert, `UPDATE exam_versions SET sat_classroom_plan = ?` when plan non-empty; insert scoring policy with `policy_key = satconvert.ScoreType, policy_config = converter` instead of the default `'practice'` row when a converter is given (mirror `authoring.SetScoreConverter`).
- Additive JSON; absent fields = today's behavior.

**Frontend contracts**
- `src/features/exam-authoring/contracts/satExamConfig.ts`: add `classroomPlan?: SatClassroomPlan; scoreConverter?: unknown` to `SatExamConfig`; update `satExamConfigDiffers` to count a non-empty plan / converter as a difference.
- New helper (same file): `SHAPE_MODULE_ROLES: Record<SatClassroomShape | "full", Array<"module1"|"lower"|"higher">>` — single source for "which timing fields are visible" (mirrors Go `Shape.Roles()`).

## Recommended design

### Components (reuse first)
| New / changed | Path | Notes |
|---|---|---|
| **`CreateSatExamSheet`** (new) | `src/features/exam-authoring/ui/create-exam/CreateSatExamSheet.tsx` | Owns step state + draft; lifted out of `SatExamLibraryRoute.tsx` (lines 87–178, 347–382 move here). Library keeps only `open/close`. |
| **`ModuleSetPicker`** (new, controlled, no persistence) | `ui/create-exam/ModuleSetPicker.tsx` | Radio cards per section using `SHAPE_LABELS` (moved from `ClassroomPlanField.tsx` into contracts). Used by create **and** `ClassroomPlanField` (FR-8). |
| `SatExamConfigFields` | existing | Add `visibleFields` per section derived from shape; drop the score-report checkbox (moves to Results step). |
| `SatFormDialog` | `src/products/sat/ui/ConfirmDialog.tsx` | Add `size?: "default" \| "wide"` (wide = `max-w-[640px]`); add optional `footer` slot so Back/Next stay pinned. |
| Room sheet | `SatCreateRoomFlow.tsx` → `AccessLinkEditorSheet.tsx` | `SatCreateRoomFlow` reads `useClassroomPlan(examId)`, passes `classroomPlan` prop; `sessionTypeField` filters `CLASSROOM_ROUTING` and locks Practice (FR-7). |
| Settings | `SectionDeliveryEditor.tsx`, `ClassroomPlanField.tsx` | Move plan picker to top of each section card; dim/hide timing fields the set does not use (FR-8). |
| Workspace | module nav in `AuthoringWorkspace.tsx` | "Not used" badge from `useClassroomPlan` (FR-9). |

### Step-by-step UX (Apple-style: one decision per screen, generous whitespace, system blue for the single primary action, quiet secondary buttons)

```
┌ Digital SAT ─────────────────────────── Step 1 of 4 ─ ✕ ┐
│ New exam                                                   │
│                                                            │
│ Exam name                                                  │
│ [ Practice Test 06                                    ]    │
│                                                            │
│ How will students take it?                                 │
│ ┌────────────────────────┐ ┌────────────────────────┐      │
│ │ ◉ Full SAT             │ │ ○ Custom modules       │      │
│ │ Both sections, adaptive│ │ Pick which modules     │      │
│ │ Module 2. Works in     │ │ students sit. For      │      │
│ │ Practice and Classroom │ │ Classroom rooms only.  │      │
│ │ rooms.                 │ │                        │      │
│ └────────────────────────┘ └────────────────────────┘      │
├────────────────────────────────────────────────────────────┤
│ Create with standard settings          [ Continue ]        │
└────────────────────────────────────────────────────────────┘
```
Step 2 — Modules & timing (per section card; Custom shows the picker, Full shows only timing):
```
 Reading & Writing
  Module set   (◉ Full adaptive  ○ Module 1 + Easy  ○ Module 1 + Hard
                ○ Easy Module 2 only  ○ Hard Module 2 only)
  Module 1 [32] min   Easy Module 2 [32] min        Break after [10] min
  Students sit: Module 1 · 32 min → Easy Module 2 · 32 min
```
Step 3 — Results: switch "Show score report when a Classroom sitting ends"; "Estimated scores" segmented: **Raw scores only** | **Upload converter**. Step 4 — Review: grouped list rows (label left, value right, "Edit" link) then **Create exam**.

Motion: 180ms cross-fade + 8px slide between steps, disabled under `prefers-reduced-motion`. Focus moves to the step heading (`tabIndex=-1`) on each step change; step indicator is `aria-live="polite"` text, not dots only.

### Copy deck (sentence case, verbs on buttons, no jargon on first read)
| Place | Copy |
|---|---|
| Sheet title | New exam |
| Step names | Basics · Modules & timing · Results · Review |
| Full SAT card | **Full SAT** — Both sections with an adaptive Module 2. Works in Practice and Classroom rooms. |
| Custom card | **Custom modules** — Choose which modules students sit, like one module for homework. Classroom rooms only. |
| Custom disabled | Classroom rooms aren't turned on for your organization yet, so custom modules aren't available. |
| Fast path | Create with standard settings |
| Module set options | Full adaptive · Module 1, then Easy Module 2 · Module 1, then Hard Module 2 · Easy Module 2 only · Hard Module 2 only |
| Threshold label | Harder Module 2 at — help: "Students with at least this many correct in Module 1 get the harder Module 2." |
| Path summary | Students sit: {Module} · {n} min → {Module} · {n} min |
| Both full in Custom | Both sections use the full adaptive test, so this exam also works in Practice rooms. |
| Score report switch | Show score report when a Classroom sitting ends — "Students see their scores and can download their answers. Practice rooms never show a report. You can change this anytime." |
| Converter | Estimated scores: Raw scores only / Upload converter — "An approved table that turns raw scores into 200–800 estimates. Add it now or later in Settings." |
| Review CTA / pending | Create exam / Creating… |
| Room sheet lock | This exam uses custom modules, so it runs in Classroom rooms only. |
| Forced branch note | Module 2 is set by the exam: {Easy/Hard} Module 2. |
| Workspace badge | Not used — this exam's module set skips it |

## Failure modes
| Risk | Consequence | Protection / location | Test |
|---|---|---|---|
| Invalid converter/plan after entity insert | Half-configured exam | Validate before tx + write inside `initializeSATDraftTx` tx | Go: bad converter → 422, zero rows |
| Hidden invalid timing field | Can't submit, invisible error | Reset hidden fields to defaults on shape change (INV-4) | RTL |
| Double click Create | Two exams | Existing `creating` guard; button `pending` | RTL (existing) |
| Gate flips off after create | Plan exam can't get a room | Existing room-sheet unavailable message; accepted residual risk | — |
| Old server, new client | Server ignores unknown fields → plan silently dropped | Deploy backend first (see rollout) | — |

## Implementation phases
| # | Files | Change | Covers | Done when |
|---|---|---|---|---|
| 1 | `exams/sat_config.go`, `sat_initialization.go`, `service.go` | Add `ClassroomPlan`, `ScoreConverter`; validate; write in create tx | FR-6, INV-1 | Go tests below pass |
| 2 | `contracts/satExamConfig.ts`, `contracts/assessment.ts` | Types, `SHAPE_LABELS` + `SHAPE_MODULE_ROLES`, `satExamConfigDiffers` | FR-3 | typecheck |
| 3 | `ui/create-exam/ModuleSetPicker.tsx`, `SatExamConfigFields.tsx`, `ConfirmDialog.tsx` | Picker, visible-field filtering, dialog `size`/`footer` | FR-3, FR-8 base | Storybook/RTL renders |
| 4 | `ui/create-exam/CreateSatExamSheet.tsx`, `SatExamLibraryRoute.tsx` | Stepped sheet, Results step w/ converter file read, Review, single submit | FR-1,2,4,5,6 | Library tests green + new ones |
| 5 | `SatCreateRoomFlow.tsx`, `AccessLinkEditorSheet.tsx` | Plan-aware session type & routing | FR-7, INV-2 | RTL |
| 6 | `SectionDeliveryEditor.tsx`, `ClassroomPlanField.tsx`, `AuthoringWorkspace.tsx` | Settings order + relevant fields; workspace badge | FR-8, FR-9 | RTL |

## Test matrix (planned)
| Case | Stimulus | Expected | Level |
|---|---|---|---|
| T1 | Create with `classroomPlan:{math:"m2_hard"}` | Draft `sat_classroom_plan` = that JSON | Go integration |
| T2 | `classroomPlan:{math:"bogus"}` | 422, no exam row | Go |
| T3 | Valid converter in create | scoring policy `policy_key = estimated_sat` | Go |
| T4 | Invalid converter | 422 with parser message, no exam row | Go |
| T5 | No new fields | Identical to today (existing tests) | Go + RTL |
| T6 | Fast path from step 1 | POST body `{title}` only, navigates to `/sat/exams/:id` | RTL |
| T7 | Custom → R&W "Easy Module 2 only" | Only Easy Module 2 timing visible; threshold hidden; summary line correct | RTL |
| T8 | Edit Module 1 to invalid, then switch to "Easy Module 2 only" | Submit succeeds; Module 1 sent as default | RTL |
| T9 | `classroomCreationEnabled:false` | Custom card disabled with reason; keyboard can't select | RTL |
| T10 | Non-JSON converter file | Inline error on Results step, no POST | RTL |
| T11 | Server 422 on converter | Sheet returns to Results step, shows server sentence, values kept | RTL |
| T12 | Room sheet, exam with plan | Practice disabled with lock copy; "Teacher picks" absent | RTL |
| T13 | Step change | Focus on new step heading; Esc on dirty asks to discard | RTL |
| T14 | Keyboard-only full flow + VoiceOver smoke | Completes; announcements read step n of 4 | Manual |

Commands: `bunx vitest run src/products/sat src/features/exam-authoring`, `bun run typecheck`, `bun run lint`, `cd backend/go && go test ./internal/exams/... ./internal/authoring/...`. Visual check: `bun run dev` → `/sat/exams` → Create exam, light/dark, 375px width.

## Rollout
- Deploy backend (additive fields) before frontend; old server would ignore new fields and silently drop the plan.
- No migration (columns `sat_classroom_plan`, `assessment_scoring_policies` exist).
- Rollback: frontend revert restores the old dialog; exams created with plans stay valid and editable in Settings.

## Gap review
- Every P0 FR maps to a phase and ≥1 test (FR-1 T13, FR-2 T6, FR-3 T7/T8, FR-4 T9, FR-5 T10/T11, FR-6 T1–T4, FR-7 T12).
- Open: whether the Review step should also offer "Create and add questions from sample" — default **no** (keep landing on the workspace as today).
