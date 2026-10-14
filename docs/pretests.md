# Implementation plan: Remove SAT pretest questions

## 0. Context and current behavior

**Goal:** Remove pretest designation from new SAT authoring, Excel import, and publish validation. Count every question in new releases for raw scoring and conversion.

**Verified in the repository:**

- The publish validator requires exactly two pretests per module. The same validator serves readiness checks and the locked publish transaction, so this affects both [validator.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/satpublish/validator.go:80) and [exams/service.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/exams/service.go:929).
- Pretest flags also affect scoring denominators, adaptive threshold limits, authoring controls, sample exams, and Excel parsing/import.
- The two score controls you described already exist: [ScoreConverterPanel.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/exam-authoring/ui/release/ScoreConverterPanel.tsx) lets staff upload or remove a converter (no converter means raw scores); [ScoreReportSettingPanel.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/exam-authoring/ui/release/ScoreReportSettingPanel.tsx) controls whether Classroom candidates see a report at the end. The report switch is stored on the exam and applies to past attempts too.
- Published question rows store `is_pretest`; result paths still use it to interpret existing exams.

**Scope:** Remove the pretest concept from new authoring and import flows, make all questions count in new releases, and keep the existing conversion and report-display controls.

**Compatibility decision:** Keep the database column and legacy result handling for already-published versions. Dropping the column or clearing old published flags could change historical scores and question-level results.

## 1. Requirements

| ID | Behavior | Acceptance criterion |
|---|---|---|
| FR-1 [P0] | Staff author SAT exams without pretest controls. | No pretest toggle, bulk action, count, or requirement in the new authoring UI/API. |
| FR-2 [P0] | Staff import SAT Excel workbooks without pretest data. | A workbook with no Pretest column imports; an old workbook with that column is accepted and the column is ignored. |
| FR-3 [P0] | Publish new versions with all questions scored. | Complete modules publish without pretest designations; each question contributes to the operational count. |
| FR-4 [P0] | Conversion and report display remain independently configurable. | Converter present → converted score; absent → raw score. Report switch controls end-of-exam report visibility. |
| FR-5 [P0] | Existing published results retain their meaning. | Legacy published versions with pretest flags keep their previous scoring and detail behavior. |

## 2. Core entities and invariants

- **Exam question:** New draft rows must be scored questions. Any legacy `is_pretest` values remain meaningful only for already-published versions.
- **Published exam version:** Its score-conversion policy remains pinned to that version.
- **Exam entity:** Its existing score-report switch remains independent of score conversion.

Invariants:

- For a newly published module, operational question count equals its authored question count: 27 for Reading & Writing, 22 for Math.
- Raw correct count never exceeds operational question count.
- A configured converter must cover the actual operational counts and routes; without a converter, results remain raw.
- Publishing or editing a new version does not rewrite the scoring interpretation of an old published version.

## 3. API and interface changes

Remove pretest fields and actions from **authoring** contracts, workspace collaboration events, editor controls, and Excel import payloads. Keep legacy pretest data available to result paths that serve old published versions.

No new score settings API or UI is needed. The existing converter control already enables conversion through a supplied table and disables it by removing the table. The existing report switch already controls score-report visibility. Keep their current behavior, including the report switch’s effect on past attempts.

## 4. Critical data flow

1. Authoring and import create questions without a pretest field; new database rows use `is_pretest = false`.
2. Readiness and publish validation treat all questions as operational. Publish normalizes any remaining pretest flags on the locked draft before sealing it.
3. Module close scores all questions in the new version; conversion uses those totals when configured.
4. At completion, the existing report switch determines whether the candidate sees a score report. Legacy published versions continue using their stored flags.

## 5. Recommended design

Use the shared SAT publish validator as the authoritative boundary: remove its exact-pretest-count rule and calculate operational counts from all module questions. Make readiness, converter checks, and adaptive-threshold bounds use that same all-question count.

Remove the authoring and import pretest affordances, but retain the database column for published legacy versions. Ensure draft creation, cloning, duplication, import, and publish normalization all leave new versions with flags set to false. Remove the Pretest column from generated workbooks; ignore that column when older workbooks are uploaded.

The SAT question totals and module timing stay the same. Only scoring counts change.

## 6. Production and failure-mode deep dives

| Risk | Consequence | Protection | Verification |
|---|---|---|---|
| Old draft contains pretest flags | Readiness and publish could disagree about how many questions score. | Treat all questions as operational in both; clear flags within the locked publish transaction before validation and sealing. | Readiness and publish produce the same converter requirements; sealed rows are all false. |
| Legacy results change | Historical raw scores or question-level detail could be reinterpreted. | Keep the column and legacy result handling for published versions; do not run a migration clearing published flags. | Load a pre-change result and verify score and detail remain unchanged. |
| Existing converter has old dimensions | A formerly valid converter may not cover the new operational totals. | Validate against all-question counts and show the existing converter validation issue until staff update or remove the table. | Test converter coverage at the new 27/22 totals and raw-score mode without a converter. |
| Old workbook includes Pretest | Import could keep asking users to maintain a removed field. | Ignore the legacy column and do not validate its values. | Import workbooks with the column absent, valid, and malformed; all treat questions as scored. |

## 7. Ordered implementation phases

| Phase | Components | Change | Done when |
|---|---|---|---|
| 1. Authoring contracts and UI | SAT blueprint, authoring contracts, workspace/realtime code, inspector, question queue, overview, sample exam | Remove pretest fields, toggles, actions, counts, and sample assignments. | Staff can no longer designate pretests in the editor; new authoring payloads omit the field. |
| 2. Excel import | Frontend parser/import sheet; backend workbook preview/template/commit | Remove the field from generated templates and payloads; ignore it in legacy workbooks; write imported questions as scored. | Import succeeds without a Pretest column and does not reject or honor its legacy values. |
| 3. Validation and counts | `satpublish.ValidateModule`, authoring readiness/bulk reads, delivery settings, release selectors, SAT initialization | Remove the count error; use all questions for converter requirements and adaptive-threshold bounds. | Complete modules with zero pretest flags pass; counts and thresholds allow the full 27/22 items. |
| 4. Publish and scoring compatibility | `exams/service.go`, question clone/write paths, delivery scoring, result handling | Normalize draft flags while publishing; preserve legacy scoring for already-published versions. | New releases score every question; old releases retain historical behavior. |
| 5. Existing score controls | Score converter and report-setting panels | Reuse existing settings; update any copy that describes excluded pretest items. | Raw/converted scoring and report show/hide work independently. |

## 8. Test matrix

| Case | Setup / action | Expected outcome | Level |
|---|---|---|---|
| Validator | Full-size modules with zero designated pretests | No pretest-count issue; question-content and target-count checks still apply. | Unit |
| Excel import | Workbook omits Pretest column | Import succeeds and every question is scored. | Frontend/backend integration |
| Excel compatibility | Workbook includes malformed legacy Pretest values | Import ignores that column and succeeds if other data is valid. | Frontend/backend integration |
| Publish normalization | Draft contains legacy true flags | Publish validates all items, seals them as scored, and applies converter validation to full totals. | Database integration |
| Scoring | New 27-question RW and 22-question Math modules | Operational counts equal 27 and 22; all correct responses contribute. | Backend unit/integration |
| Settings | Converter absent/present and report switch off/on | Raw/converted score and report visibility vary independently. | Integration/E2E |
| Historical behavior | Published version contains pretest flags | Existing scores and result details remain unchanged. | Regression integration |

## 9. Rollout and recovery

No schema migration is proposed. Deploy the backend changes before removing the frontend controls, then deploy the frontend after old backend instances are drained. Keep the database column during this change so rollback and legacy result reads remain possible.

A converter sized for the old operational count may need to be replaced before publishing a new all-scored version. Removing a converter remains the existing way to publish with raw scores.

## 10. Open decisions and gap review

Recommended default: preserve historical published versions and remove pretests from all new versions. The current report and conversion settings already match the requested controls, so this plan reuses them rather than adding duplicate settings.

This is a planning pass; no code was changed.