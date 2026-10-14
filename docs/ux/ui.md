# SAT Student Score Report — Final Detailed Implementation Plan

Repository: [teaching01-netizen/IELTS-LMS](https://github.com/teaching01-netizen/IELTS-LMS)

Scope: Student-facing SAT results shown after exam completion, when the score report is enabled.

Objective: Create a modern, minimal, professional score report inspired by College Board, with a clear information hierarchy and excellent usability across full SAT, Math-only, Reading & Writing-only, and individual-module sittings.

This is a frontend-focused implementation. Preserve the existing scoring, adaptive routing, score conversion, authorization, and answered-exam PDF logic.

## 1. Core UX principles

The score report should answer four questions in this order:

1. What was my result? Show the most meaningful score actually available.
2. How did I perform in each section? Show relevant section scores and raw correctness.
3. Which skills need more attention? Show domain performance based on real scored questions.
4. How can I review my work? Provide module details and the answered-exam PDF.

The interface should adapt automatically to the exam that the student actually completed.

Students should never have to choose between Full SAT, Math, or Reading & Writing on the results page. The delivered result determines the layout.

### Important design decisions

- Use SAT-style scaled scores as the primary result only when the server provides a valid conversion.
- For Math-only and Reading & Writing-only exams, make the individual section score the primary result.
- Never show an empty second section or an unavailable total-score card simply because the student completed one subject.
- Keep raw correctness available and clearly labeled.
- Hide technical details until requested.
- Keep the interface calm, readable, and free of unnecessary decoration.

## 2. Review of the current implementation

The main components are:

| File                                                                                | Responsibility                                              |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/features/student-delivery/ui/transitions/SatCompleteScreen.tsx`                | Completion screen and report visibility                     |
| `src/features/student-delivery/ui/transitions/SatScoreReport.tsx`                   | Score summary, sections, modules, skills, and PDF           |
| `src/features/student-delivery/routes/SatStudentSessionRoute.tsx`                   | Provides authoritative result and answered-exam source      |
| `src/features/student-delivery/contracts/assessmentDelivery.ts`                     | Assessment result contracts                                 |
| `src/features/exam-authoring/ui/release/ScoreReportSettingPanel.tsx`                | Controls whether Classroom results are released to students |
| `src/features/student-delivery/ui/transitions/__tests__/SatCompleteScreen.test.tsx` | Existing completion, scoring and PDF regression tests       |

### Problems to address

Problem 1 — A detailed report is embedded inside a completion message.

`SatCompleteScreen.tsx` currently renders a centered confirmation layout with `max-w-2xl`. This is appropriate for a simple completion screen but not for detailed performance analysis.

Solution: Render a separate report page when a released score report exists. Keep the existing simple completion screen when no report is authorized.

Problem 2 — Score hierarchy is unclear.

`SatScoreReport.tsx` displays estimated total, raw total, and section cards with similar visual weight.

Solution: Use one primary score area, section performance below, and progressively disclosed details.

Problem 3 — One-subject exams can display irrelevant information.

The current report can show an estimated total as "Unavailable" merely because there is a converter, even when the student only completed Math.

Solution: Determine the report layout from the sections present. Do not render a total-score component for a single-subject sitting.

Problem 4 — Technical information is too prominent.

Raw operational counts, module keys, conversion version, and module-routing details can confuse students.

Solution: Use student-friendly labels. Keep detailed information available under expandable sections.

Problem 5 — Domain performance needs better organization.

The current knowledge-and-skills list mixes domains from different SAT sections.

Solution: Group domains under their actual subject and make the meaning of the bars explicit.

## 3. Required behavior for every exam configuration

This is the most important part of the implementation.

### 3.1 Full SAT — Both subjects with converted scores

When the report includes Reading & Writing and Math, and the server provides a converted total:

Display:

Primary result

- Estimated total SAT score: e.g. `1210`
- Score scale: `400–1600`
- Short explanation that this is a classroom estimate, not an official SAT score

Section performance

- Reading & Writing: estimated score, e.g. `580`
- Math: estimated score, e.g. `630`
- Raw correct/total for each section

Additional details

- Module 1 and Module 2 breakdowns
- Knowledge and skills for each subject
- Download answered exam as PDF

The total score should be displayed prominently, followed immediately by the two section scores.

Do not show a separate large raw-total card alongside the scaled total.

### 3.2 Math-only exam

When only `math` is present:

Primary result

- Title: `Your Math results`
- Estimated Math score: e.g. `620`
- Score scale: `200–800`
- Correct answers: e.g. `34 of 44 scored questions`

Additional details

- Math module breakdown
- Math knowledge and skills
- Download answered exam

Do not display:

- Total SAT score
- 400–1600 scale
- Reading & Writing placeholder
- "Estimated total unavailable"
- A message suggesting the student failed to complete Reading & Writing

The fact that only Math was delivered is normal and should not be treated as an incomplete exam.

### 3.3 Reading & Writing-only exam

Exactly the same layout policy as Math-only.

Primary result

- Title: `Your Reading & Writing results`
- Estimated Reading & Writing score
- Score scale: `200–800`
- Correct answers for that section

Additional details

- Reading & Writing module breakdown
- Its actual knowledge-and-skills domains
- Download answered exam

Do not display Math cards or total SAT score placeholders.

### 3.4 One subject with no converted score

Example: Math-only classroom exam, but no valid score-conversion table is available.

Show:

- Title: `Your Math results`
- Primary result: `18 of 22 correct`
- Label: `Scored practice questions`
- Explanation: `An estimated SAT score is not available for this sitting.`
- Module performance, if available
- Math domain accuracy, if available

Do not:

- Display `0` as the estimated score
- Convert raw accuracy into a SAT score
- Show "Failed" or "Incomplete"
- Show a visually dominant empty estimated-score card

Raw correctness is still a meaningful result.

### 3.5 Only Module 2 was administered

Your Classroom functionality supports special sittings that may administer only the easier or harder Module 2.

The report must not assume every section has exactly two completed modules.

For example, a Math-only Module 2 sitting should display:

- `Your Math results`
- Raw correct out of the scored questions actually administered
- Available knowledge-and-skills results
- `Module 2` under the module breakdown, with no fabricated Module 1

If the converter cannot produce a valid estimate for that topology, display raw results instead.

Do not show Module 1 as:

- `0 correct`
- `Missing`
- `Not attempted`
- `Incomplete`

It was not part of the administered sitting.

Also avoid using the words "Easy" or "Hard" as a judgment about the student's ability. Branch metadata should not become a performance label.

### 3.6 Partial conversion

A full SAT report might contain a valid Math estimate but no valid Reading & Writing estimate.

In this situation:

- Show the Math estimate.
- Show Reading & Writing raw correctness.
- Do not calculate a total yourself.
- Explain briefly that an estimated combined score is unavailable.

A total score must come from the authoritative `totalScaled` payload and be applicable to the actual completed sections.

### 3.7 No authorized score report

When the backend does not release `classroomRaw`, keep the existing completion-only screen:

- `SAT Complete`
- `All responses submitted.`
- `Back to dashboard`

No scores, inferred results, domain details, or answered-exam download should appear.

Standard Practice mode should continue following its existing no-report behavior.

## 4. Create a dedicated score-report view model

New file:

`src/features/student-delivery/ui/transitions/score-report/scoreReportViewModel.ts`

Do not place all conditional rendering rules directly in JSX.

Create a pure function that transforms the existing `ClassroomReport` into a reliable presentation model.

### Proposed structure

```
type SatSubject = "reading-writing" | "math";

type ScoreDisplay =
  | {
      kind: "estimated";
      low: number;
      high: number;
    }
  | {
      kind: "raw";
      correct: number;
      total: number;
    }
  | {
      kind: "unavailable";
      reason: string;
    };

type ReportLayout =
  | "full-sat"
  | "single-subject"
  | "partial-results"
  | "unavailable";

interface SubjectReportView {
  key: SatSubject;
  label: string;
  score: ScoreDisplay;
  rawCorrect: number;
  rawTotal: number;
  modules: ModuleReportView[];
  domains: DomainReportView[];
}

interface StudentScoreReportView {
  layout: ReportLayout;
  title: string;
  primaryScore: ScoreDisplay | null;
  subjects: SubjectReportView[];
  showCombinedScore: boolean;
  methodology: {
    isEstimated: boolean;
    converterVersion: string | null;
  };
}
```

These types describe the UI, not a replacement for the backend score contract.

### Layout resolver

Implement `buildStudentScoreReportView(report: ClassroomReport)`.

Decision sequence:

1. Validate and normalize the available section entries.
2. Identify whether the report contains Math, Reading & Writing, or both.
3. For each section, use `scaled` only when `conversionStatus === "converted"` and the score is valid.
4. If both recognized subjects are present and the authoritative total is applicable and available, use the full SAT layout.
5. If exactly one recognized subject is present, use the single-subject layout regardless of whether `totalScaled` is populated.
6. If both subjects exist but a valid total is unavailable, use the partial-results layout.
7. If score data is insufficient, show a safe unavailable state, without invented values.

Do not independently determine whether a given module route qualifies for score conversion. That remains the server's responsibility.

### Validation requirements

Before displaying scores:

- Require finite numeric values.
- Reject negative raw counts and totals.
- Ensure raw correct does not exceed raw total.
- Ensure scaled ranges satisfy `low <= high`.
- Verify the score lies within the relevant SAT-style section or total scale.
- Handle duplicate or unknown section keys safely.
- Never show `NaN`, `Infinity`, negative percentages, or fabricated zeros.

Invalid data should not crash the report. Use an appropriate unavailable state and report the issue through existing error logging without exposing student information.

## 5. React component architecture

Refactor `SatScoreReport.tsx` into smaller presentation components.

Recommended structure:

```
src/features/student-delivery/ui/transitions/
│
├── SatCompleteScreen.tsx
├── SatScoreReport.tsx
│
└── score-report/
    ├── scoreReportViewModel.ts
    ├── SatReportHeader.tsx
    ├── SatScoreOverview.tsx
    ├── SatSubjectPerformance.tsx
    ├── SatModuleBreakdown.tsx
    ├── SatKnowledgeSkills.tsx
    ├── SatReportActions.tsx
    └── SatReportMethodology.tsx
```

Keep `useAnsweredExamPrint`, `AnsweredExamPaper`, and the score-release parser in their existing locations initially. Move them only if doing so provides a clear benefit without changing their behavior.

### Component responsibilities

| Component               | Responsibility                                  |
| ----------------------- | ----------------------------------------------- |
| `SatCompleteScreen`     | Choose completion-only or report layout         |
| `SatScoreReport`        | Compose the student report                      |
| `SatReportHeader`       | Completion confirmation and report title        |
| `SatScoreOverview`      | Display the single primary score                |
| `SatSubjectPerformance` | Display Math and/or Reading & Writing results   |
| `SatModuleBreakdown`    | Expandable administered-module details          |
| `SatKnowledgeSkills`    | Domain-level scored-question accuracy           |
| `SatReportActions`      | PDF action, loading/error state, dashboard exit |
| `SatReportMethodology`  | Explain score estimates and raw correctness     |
| `scoreReportViewModel`  | Convert authorized data into UI states          |

Avoid creating generic abstractions for components that are used only once. These components should remain lightweight and focused on presentation.

## 6. Detailed component implementation

### 6.1 `SatCompleteScreen.tsx`

Separate the two screen types.

Current:

```
<main>
  <CompletionMessage />
  {report && <SatScoreReport />}
  <BackButton />
</main>
```

Target structure:

```
export function SatCompleteScreen(props: SatCompleteScreenProps) {
  const report = classroomReport(props.result);

  if (!report) {
    return <SatCompletionOnly onExit={props.onExit} />;
  }

  return (
    <SatScoreReport
      report={report}
      answered={props.answered ?? null}
      onExit={props.onExit}
    />
  );
}
```

Keep the existing public component contract and callback behavior.

For the report layout:

- Replace centered `place-items-center` presentation with normal page scrolling.
- Use `min-h-dvh`.
- Set `max-w-[920px]` on the report content.
- Use responsive padding (`px-4 sm:px-6`).
- Do not impose fixed heights on score sections.
- Respect existing device safe-area insets.
- Ensure the report can scroll normally on mobile.

The completion-only screen can retain its current centered design.

### 6.2 `SatReportHeader.tsx`

The header should contain:

Primary heading: `Your SAT practice results`, or a subject-specific title when only one subject was delivered.

Secondary confirmation: `Exam completed · Answers submitted`

Do not repeat `SAT Complete` as a separate large heading above the report.

The header should communicate completion without consuming excessive vertical space.

### 6.3 `SatScoreOverview.tsx`

Render exactly one primary summary.

Display policy:

| Report type                      | Primary label                     |
| -------------------------------- | --------------------------------- |
| Full converted SAT               | Estimated total SAT score         |
| Math-only converted              | Estimated Math score              |
| Reading & Writing-only converted | Estimated Reading & Writing score |
| Single-subject raw only          | Correct answers                   |
| Full SAT raw only                | Total correct answers             |
| Partial conversion               | Section results                   |

Use a 48–56px primary score on desktop, approximately 40–44px on mobile.

For a returned score range, show the exact interval.

Do not average the range, round it into a single number, or display a decorative position on the score scale unless it faithfully represents the supplied value.

Keep the explanation directly below the score:

`Estimated using a classroom score conversion table. Not an official SAT score.`

### 6.4 `SatSubjectPerformance.tsx`

Render only actual delivered subjects.

For Full SAT, use two subject sections in a responsive grid.

For a one-subject result, use one full-width section. Do not leave an empty column.

Each subject section should contain:

- Subject name
- Estimated section score when available
- Raw correctness
- Optional Module breakdown disclosure

For raw correctness, use student-friendly language:

`20 of 27 scored questions correct`

Avoid developer-facing terminology such as `operationalQuestionCount` in the visible UI.

If the section has no converted score, show a brief explanation rather than empty dashes.

### 6.5 `SatModuleBreakdown.tsx`

Use a simple expandable disclosure.

For example:

`Module breakdown` with a downward chevron.

Expanded details could show:

- Module 1 — 13/22 correct
- Module 2 — 15/22 correct

But only for modules actually present in the scored report.

Implementation rules:

- Use a semantic button with `aria-expanded` and `aria-controls`, or a native `<details>` element.
- Do not infer module ordering from array position alone.
- Resolve names from the delivered assessment when available.
- Fall back to readable module labels when metadata is missing.
- Do not imply a missing module was skipped by mistake.
- Don't create a new API request just to expand a breakdown already present in the payload.

The disclosure should be collapsed initially to prioritize the main score.

### 6.6 `SatKnowledgeSkills.tsx`

Group `report.domains` by `sectionKey`.

When both subjects are present, show two sections:

Reading & Writing

- Information and Ideas
- Craft and Structure
- Expression of Ideas
- Standard English Conventions

Math

- Algebra
- Advanced Math
- Problem-Solving and Data Analysis
- Geometry and Trigonometry

Only show domain data actually returned by the server. Do not create empty standard-domain rows when no results exist.

For each domain:

- Show its name.
- Show correct/total.
- Optionally show a percentage.
- Use a thin horizontal progress bar as a visual aid.

Calculate accuracy only when `total > 0`.

If total is zero, show `No scored questions` and omit the percentage/progress bar.

Important: Domain accuracy is not an official College Board knowledge-and-skills performance band.

Do not invent labels such as `Excellent`, `Weak`, `Mastered`, or `Needs improvement` from a small number of scored questions.

For Math-only exams, render only Math domains. The same applies to Reading & Writing-only exams.

### 6.7 `SatReportMethodology.tsx`

Use a disclosure titled `About your score`.

Explain:

- Estimated scores come from the assigned classroom conversion table.
- Raw correctness counts scored operational questions.
- Pretest questions do not contribute to raw correctness.
- SAT-style estimates are not official College Board scores.
- Some partial or one-module sittings may not support scaled conversion.

Show the converter version inside this disclosure only when present.

Students should not see `Converter classroom-v1` immediately next to their score.

### 6.8 `SatReportActions.tsx`

Provide two main actions:

Save answered exam as PDF

Use the current print workflow. This should not be described as downloading the score report itself.

Back to dashboard

Keep the existing exit callback.

Recommended behavior:

- The PDF action is secondary, but clearly visible near the report header or summary.
- Explain that the student can select Save as PDF in the browser print dialog.
- Show `Preparing answered exam…` while loading.
- Disable repeat action while a print is being prepared.
- On failure, keep the report visible and allow retry.
- If the authorized PDF projection is unavailable, do not offer a nonfunctional download action.

Do not change the existing rule that PDF generation must wait until all administered questions and required images are ready.

Correct answers should not be added to the answered-exam PDF merely as part of this UI redesign.

## 7. Visual design specification

Use the existing student SAT design tokens rather than the internal staff theme.

The score report can be more polished than the exam-taking interface, while retaining consistent typography and colors.

| Element                    | Specification                              |
| -------------------------- | ------------------------------------------ |
| Page background            | Existing `--sat-background`                |
| Main content width         | 920px maximum                              |
| Desktop horizontal spacing | 24px                                       |
| Mobile horizontal spacing  | 16px                                       |
| Page title                 | 28–32px semibold                           |
| Main score                 | 48–56px semibold                           |
| Subject scores             | 28–36px semibold                           |
| Section headings           | 18–20px semibold                           |
| Body text                  | 14–16px                                    |
| Supporting text            | 13–14px                                    |
| Surface radius             | 14–16px                                    |
| Main section spacing       | 24–32px                                    |
| Borders                    | Existing muted divider tokens              |
| Buttons                    | Minimum 44px touch target                  |
| Motion                     | Subtle transitions; reduced-motion support |

Prefer subtle borders and typography over numerous decorative cards and shadows.

Avoid:

- Bright red/green score judgments
- Score animations
- Confetti and excessive completion effects
- Large icons competing with the primary score
- Unnecessary progress gauges
- Decorative graphs that imply more precision than the data supports

## 8. Responsive behavior

The score report should be mobile-first.

| Viewport              | Required behavior                                       |
| --------------------- | ------------------------------------------------------- |
| 320–390px             | One column; scores wrap or scale without clipping       |
| 640px                 | Comfortable single-column layout                        |
| 768px                 | Two subject columns only when both subjects are present |
| 1024px+               | Centered report; no excessive content stretching        |
| 200% zoom             | No horizontal overflow or hidden result content         |
| Short mobile viewport | All content scrollable, actions remain reachable        |

For full SAT, the section cards may switch to two columns on wider screens.

For one-subject exams, keep the subject section full-width instead of creating unnecessary whitespace.

Use `tabular-nums` for scores and question counts. For long score ranges, allow responsive font scaling rather than truncation.

## 9. Backend and security boundaries

This redesign should not require a new score-calculation endpoint.

Use the existing:

```
classroomReport(result)
```

which reads:

```
result.scorePayload?.["classroomRaw"]
```

only when:

```
result.releaseStatus === "released"
```

Keep these rules intact.

The backend currently controls student score-report visibility, and the setting can affect previously completed attempts.

Therefore:

- Never infer visibility from `result.totalScore`.
- Never show hidden values from `result.sections`.
- Never cache an authorization decision in local storage.
- Never create fallback scaled scores.
- Never reuse a previous student's report when the attempt identity changes.
- Continue fetching the authorized answered-exam projection at download time.

The UI can normalize and validate data for rendering, but must not become a second scoring authority.

## 10. Comprehensive regression tests

Extend:

`src/features/student-delivery/ui/transitions/__tests__/SatCompleteScreen.test.tsx`

Add pure tests for `scoreReportViewModel.ts`.

### Score and layout cases

| ID  | Test case                                       | Expected result                                           |
| --- | ----------------------------------------------- | --------------------------------------------------------- |
| R01 | Full SAT, both sections converted               | Total and two section scores displayed                    |
| R02 | Math-only, converted                            | Math section score is primary; no total                   |
| R03 | Reading & Writing-only, converted               | Reading & Writing score is primary; no Math               |
| R04 | Math-only, no converter                         | Raw Math correctness is primary                           |
| R05 | Reading & Writing-only, no converter            | Raw Reading & Writing correctness is primary              |
| R06 | Full SAT, only Math converted                   | Math estimate, Reading & Writing raw; no fabricated total |
| R07 | Full SAT, neither section converted             | Raw results only                                          |
| R08 | Only Math Module 2 administered                 | Only administered module shown; no Module 1 placeholder   |
| R09 | Only Reading & Writing Module 2 administered    | Same behavior for R&W                                     |
| R10 | Scaled result is a range                        | Exact interval displayed                                  |
| R11 | Missing section conversion                      | No fake `0` score                                         |
| R12 | Unexpected total value in single-subject result | Total hidden; section remains primary                     |
| R13 | Duplicate/invalid section data                  | Safe unavailable state                                    |
| R14 | Domain total equals zero                        | No false 0% accuracy                                      |
| R15 | One-question domain                             | Exact raw result; no mastery claim                        |
| R16 | No released classroom report                    | Completion-only UI                                        |
| R17 | Standard Practice result                        | No report                                                 |
| R18 | Score-report permission changes                 | No unauthorized score or PDF                              |
| R19 | PDF media fails                                 | No incomplete PDF; recoverable error                      |
| R20 | Duplicate PDF clicks                            | Only one print operation                                  |
| R21 | Student/attempt changes                         | Previous report data does not leak                        |
| R22 | 320px width and 200% zoom                       | Readable, no horizontal overflow                          |

### Existing tests to preserve

Do not remove coverage verifying that:

- The PDF contains the student's recorded choices circled.
- Student-produced responses are boxed.
- Unanswered questions are labeled.
- Skipped modules are not included.
- The PDF uses the authoritative answered-exam projection.
- Printing is blocked when an administered module or image is missing.
- Duplicate print requests are prevented.
- Score-report-disabled attempts reveal no scores.

### Test commands

```
npm run typecheck
npm run lint
npm run test:run

npx vitest run \
  src/features/student-delivery/ui/transitions/__tests__/SatCompleteScreen.test.tsx

npm run build
```

Add Playwright screenshot cases for full SAT, Math-only, Reading & Writing-only, raw-only, and narrow-screen layouts.

## 11. Implementation order

| PR | Work                                                        | Acceptance criteria                                             |
| -- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| 1  | Create the report view model and unit tests                 | Correct layout chosen for all supported subject combinations    |
| 2  | Refactor `SatCompleteScreen` and main report layout         | Separate completion-only and released-report experiences        |
| 3  | Implement score overview and section performance            | Correct primary score for full and single-subject exams         |
| 4  | Implement module disclosures and grouped domain performance | No invented modules, domains, accuracy or score interpretations |
| 5  | Improve methodology and PDF actions                         | Existing print safeguards and visibility rules preserved        |
| 6  | Responsive polish, accessibility and visual regression      | Works at mobile widths, 200% zoom and keyboard navigation       |

## 12. Final definition of done

The implementation is complete when:

1. A student completing a full SAT sees a clear estimated total when available, followed by Reading & Writing and Math results.
2. A student completing Math-only sees a Math score report, with no unnecessary full-SAT fields.
3. A student completing Reading & Writing-only sees only the relevant subject results.
4. A student completing only Module 2 sees only the administered module and valid available scores.
5. Raw-only reports remain informative without suggesting an unavailable conversion means failure.
6. The report never invents a score, a module, a percentage, a percentile or a proficiency classification.
7. Detailed module and domain information is readable but does not overwhelm the score summary.
8. The answered-exam PDF retains all existing correctness and safety guarantees.
9. Score-report visibility remains completely backend-authorized.
10. All existing and new regression tests pass.

Recommended priority: Implement the subject-aware view model first. It solves the most important UX problem—making the report genuinely appropriate for Full SAT, Math-only, Reading & Writing-only, and partial-module classroom exams. Once that is correct, the visual refactor becomes straightforward and much safer.