# SAT results UX/UI spec and delivery plan

Date: 7 October 2026. Status: proposed design; application code unchanged.

## 1. Executive summary

Help staff find the right SAT sitting by its date and time, scan progress across aligned rows, and open a student's answers without losing their place. Keep the existing Results → Exam → Student Access → Attempt hierarchy. Make chronology and outcome explicit at every level.

## 2. Assumptions and scope

- Primary users are administrators and teachers reviewing attempts, rather than students viewing personal score histories. This follows the current staff routes.
- A Student Access group can contain attempts from several dates. An exam can contain several access groups. Neither is inherently one test sitting.
- Users often remember the day and approximate start time better than an access-link name. This is supplied by the request; task frequency and traffic volumes are unknown.
- Preserve saved-answer review and the current export scope. This project’s current completion flow does not generate SAT scaled scores; this redesign adds no scoring engine.
- This spec covers the results index, exam sub-page, access-group sub-page, and both scored-result and saved-answer detail routes.

## 3. User profile and goal

Staff need to find a test sitting, identify a student, understand what happened, and review/export accepted answers. Assume familiarity with exams but no knowledge of internal module keys or response revisions. Success means opening the correct attempt quickly and distinguishing completed, running, and ended attempts reliably.

## 4. Current user path and evidence

| Stage | Current behavior | Friction | Proposed behavior |
| --- | --- | --- | --- |
| Find exam | Search exam name in Results | Date is tertiary text; no time | Aligned exam rows with prominent latest test date/time |
| Find access group | Open exam; search Student Access | Access rows omit date/time | Show latest actual test start and cohort alongside counts |
| Find student | Open access group; search name/ID/cohort | Several metadata lines; no aligned date column | Student attempt table with start time and explicit outcome |
| Review answers | Open result or saved-answer route | Different headers and timestamp conventions | Shared identity/time hierarchy, section/module navigation |
| Return/export | Back navigation or group XLSX export | Search, page, and scroll can be lost | Restore list state; clarify export scope |

Source inspection: `SatResultsRoute.tsx` owns the three list levels. `SatExamGroupSection.tsx` renders stacked metadata in 10–13 px text and formats submission dates without time. Exam/access groups already sort by latest submission. Backend attempt pagination sorts by submission, falling back to creation time. Nested pages reuse the global summary strip. `recencyLineFor` calculates cohort counts from attempt arrays that are empty in access-summary groups, so that count is not trustworthy in this flow.

## 5. Problem definition

Users spend extra effort identifying a sitting because temporal information is missing or visually subordinate and comparable values do not align. Group-level and student-level dates also mean different things. The workaround is drilling into pages and reading metadata. Main risks are reviewing the wrong attempt and mistaking saved/submitted time for test start. Frequency, baseline time, and business impact require measurement.

## 6. Design opportunity

Help staff recognize when a test was taken and compare attempts with less reading while keeping timestamps, status, and answer availability truthful.

## 7. Approaches considered

| Approach | Benefit | Trade-off |
| --- | --- | --- |
| **Aligned tables within the existing hierarchy — recommended** | Fast scanning; preserves established grouping and routes | Still requires opening exam and access group |
| Date-grouped timeline | Strong recognition of days/sittings | Mixed cohorts and reused links are harder to compare |
| One flat attempt list | Direct student lookup across exams | Needs new cross-exam queries, filters, and pagination |

Use tables for the first delivery. Consider a flat cross-exam search only if usability testing shows hierarchy is the main remaining delay.

## 8. Recommended experience

### A. Results index — `/sat/results`

Title: **SAT results**. Description: **Find a test and review student attempts.**

Toolbar: Search exams · Test date range · Newest tests first.

| Latest test | Exam | Student Access groups | Attempts | Outcomes | Action |
| --- | --- | --- | --- | --- | --- |
| Wed, 7 Oct 2026 / 09:00 | SAT Practice 04 / v3 | 3 | 48 | 42 completed · 4 running · 2 ended | View exam |

Example content is illustrative. The date is the latest known actual start across the exam’s attempts, not the exam creation date. Show the scope in the header: exams and attempts in the current date range. Do not label a mixed exam “Completed” merely because one student completed it. Display counts instead.

### B. Exam sub-page — `/sat/results?exam=…`

Breadcrumb: SAT results → Exam name. Header identifies the exam and available versions. Summary counts cover this exam and selected date range only.

| Latest test | Student Access | Cohort | Version | Attempts | Outcomes | Action |
| --- | --- | --- | --- | --- | --- | --- |
| Wed, 7 Oct 2026 / 09:00 | Wednesday morning | Class A | v3 | 24 | 21 completed · 2 running · 1 ended | View attempts |

Search access names and cohorts. An inactive/expired access link is a secondary **Access closed** label, separate from attempt outcomes. If attempts span days, show **Multiple test dates** below the latest start; the access detail header shows the full known start-date range. Do not imply the link was used only on the latest day.

### C. Access-group sub-page — `/sat/results?exam=…&access=…`

Breadcrumb: SAT results → Exam → Student Access. Header: access name, exam/version, cohort, known test-date range. Summary: attempts, completed, in progress, ended. Counts cover the selected access group and active date/status filters, never other exams.

Toolbar: Search name or student ID · Test date range · Status · Newest tests first. Search continues to include cohort where useful. Status options: All, Completed, In progress, Ended, Other/unknown. Search/filter the whole dataset before pagination, not only visible rows.

| Test started | Student | Cohort | Submitted | Outcome | Action |
| --- | --- | --- | --- | --- | --- |
| Wed, 7 Oct 2026 / 09:03 | Mina Chen / ST-1042 | Class A | 11:18 | Completed | View answers |
| Wed, 7 Oct 2026 / 09:01 | Arun Lee / ST-1043 | Class A | Not submitted | In progress | View saved answers |

One row per attempt, including repeat attempts by the same student. Use the immutable attempt ID as identity; do not merge by student ID or invent an attempt number. Show exam/version in the page header, repeating in a row only if it actually differs.

Keep the existing 50-row pagination. Label accurately: **1–50 of 124 matching attempts**. Export label: **Export all group answers (.xlsx)**. Helper text: **Includes all attempts in this Student Access group; filters do not affect export.** Preserve the existing whole-group export behavior and do not silently change it to filtered export.

### D. Attempt detail — existing result and saved-answer routes

Use the same header layout for both routes:

1. Breadcrumbs identifying exam and Student Access when authorized data is available.
2. Student name; student ID and cohort immediately below.
3. Prominent **Test started: Wed, 7 Oct 2026 · 09:03** and explicit timezone.
4. Separate **Submitted: 11:18**, **Outcome: Completed**, and **Last answer saved: 11:17** where those events are recorded. Use full dates if events cross midnight.
5. Answered/unanswered totals based only on questions actually administered. Do not use saved-record count as answered-question count without checking response content.

Place Reading & Writing / Math navigation above the answer rows, then Module 1 / administered Module 2. Display friendly names; keep internal module/question IDs in secondary details. Do not display unadministered branches as unanswered or scored zero.

Question columns: **Question · Module · Student answer · Correct answer · Outcome** for scored results; **Question · Module · Saved answer · Review flag** for saved-answer-only review. Retain the existing raw response display. Hide unsupported score/override controls on SAT rather than implying those capabilities exist. Offer All/Unanswered/Marked for review filters on both modes; Incorrect only when verdicts exist. Question ordering follows delivery order, not date order.

Show **Score unavailable** when appropriate. Distinguish unanswered, pretest/excluded, and no scoring verdict; a null verdict is never Incorrect. Show SAT practice scores only when returned with valid score semantics and permission; never infer scores from raw correctness.

Preserve the existing visible-page 15-second saved-answer refresh. Keep stale answers visible with a warning on refresh failure, show last successful check, and keep **Check now** available after failure. Move response revision/protocol diagnostics into secondary technical details.

## 9. Functional requirements and timestamp contract

**Date definition:** “Test started” means the first authoritative recorded test start for the attempt. Verify the existing delivery record semantics; use the earliest genuine started module/section event across administered records if that is the canonical source. Do not substitute availability, schedule, attempt creation, submission, or last-save time.

Current result DTOs expose submission time, and the saved-answer DTO exposes last-save time; neither currently exposes an actual test start. Delivery code contains module `started_at` records, but their completeness and SAT v1/v2 semantics must be verified before using them as the source.

Proposed additions at the existing results boundary:

- Attempt lists and both detail payloads: nullable `testStartedAt` and explicit existing/needed `submittedAt`; access identity/name for detail breadcrumbs subject to existing authorization.
- Access summaries: nullable `latestTestStartedAt`, `earliestTestStartedAt`, and truthful completed/running/ended/other counts based on delivery state. Summary date range includes only known starts.
- Scoring state remains separate from delivery state. Map submitted to Completed, running to In progress, terminated to Ended by proctor, known timeout to Time expired. Use Not started for verified pre-start states; unknown states show Status unavailable. Do not infer timeout from a generic locked state.

**Sorting:** Default all list levels to actual test start descending. Exam/access rows use maximum known child start. Valid starts precede unknown starts; same-time rows use immutable IDs as deterministic tie-breakers. Unknown dates form a trailing **Test time unavailable** group, ordered by creation time/ID without displaying creation as start. Student sorting must occur server-side before LIMIT/OFFSET. Keep other sort choices limited to Oldest tests first and Name A–Z.

**Date filtering:** A date range matches attempts whose actual start lies within inclusive calendar days in the selected timezone; implement using a half-open UTC interval. Unknown starts remain visible under All dates and are excluded from a selected range with an explicit excluded count. An exam/access summary for a date range aggregates only matching attempts, including its latest start. Do not filter only by an aggregate’s maximum date, which would hide older matching sittings.

**Timezone:** Use the configured organization timezone consistently, falling back to the viewer timezone only if no setting exists. Display the choice in the toolbar/header. Bangkok example: **Asia/Bangkok (UTC+07:00)**. Store/transport timestamp instants; format date, weekday, and 24-hour time together in the selected zone. Do not rely on ambiguous numeric dates or relative-only labels such as “yesterday.” Seconds belong in secondary detail.

**Counts:** Attempts are not unique students. Never relabel `attemptCount` as students. Use authoritative submitted/delivery state counts rather than scored + pending to estimate completions. Count identities once per attempt; completed/running/ended/other buckets must be disjoint and sum to the scoped total.

**Navigation:** Encode search, date range, status, sort, and page in URL state. Changing a filter resets page one. Restore filters, pagination, scroll, and focus to the opened attempt on return. Refresh/deep links must retain page context; construct detail breadcrumbs from authorized summary data when navigation state is absent.

**Permissions:** Keep existing staff result scope for reads and exports. Do not fetch broader datasets and hide unauthorized rows in the browser. Do not expose answer keys on routes that presently provide saved answers only. No new grading, termination, release, or override actions are part of this change.

## 10. UI and interaction requirements

- Use existing SAT staff color/spacing/radius tokens. Table headers 12–13 px; meaningful row content 14 px; secondary identity/time labels at least 12 px. Body line-height about 1.45. Do not keep essential dates/counts at 10 px.
- Target 64–72 px rows with two lines maximum in identity/date cells. Right-align numeric counts; left-align names, timestamps, and outcomes. Use tabular numerals. Allow long names to wrap; full values must remain available without hover.
- Use a wider staff content container when needed for columns; keep answer details readable. Light separators and a restrained row hover help track across columns. Sticky headers only within the list's scroll context, without covering content or focus.
- Provide native table semantics, a caption, scoped column headers, explicit link actions, visible focus, and sortable header buttons with `aria-sort`. Row-wide pointer activation may supplement the link; it must not replace keyboard access or prevent text selection.
- Convey statuses using text plus optional color. Target 44 px interactive hit areas. Respect reduced motion.
- At narrow widths/200% zoom, wrap each list record into a labeled compact block: date/time, name/ID, outcome/counts, action. Preserve the same reading order and all information; put extra metadata behind an explicit Details disclosure. Wide question response tables may use a labeled, keyboard-scrollable horizontal region.
- Loading: stable column-width skeletons. Empty dataset: explain where attempts will appear. No filter matches: retain filters and offer Clear filters. Initial failure: Retry with breadcrumbs available. Refresh failure: retain data with a visible stale-data message. Export failure: inline error and retry without discarding list state.

Accessible headers and responsive alternatives follow the [W3C tables tutorial](https://www.w3.org/WAI/tutorials/tables/) and [responsive table guidance](https://www.w3.org/WAI/tutorials/tables/tips/). The aligned layout supports scanning and comparison, as described in [NN/g’s data-table task guidance](https://www.nngroup.com/articles/data-tables/).

## 11. Edge cases

| Case | Required behavior |
| --- | --- |
| Same student tests twice | Two distinct attempt rows with times and IDs |
| Start absent/invalid | Test time unavailable; never invent a date |
| One access link used over several days | Latest start plus Multiple test dates; full range in header |
| Submitted after midnight | Start determines test day; submission includes its own date |
| End before submission | Explicit ended reason if recorded; no fabricated submission time |
| No attempts yet | No tests taken; access schedule metadata remains separately labeled |
| Historical start cannot be recovered | Preserve unknown state; disclose legacy data limitation |
| Concurrent arrivals during pagination | No auto-jumping rows; preserve snapshot position and offer refresh when newer data is known |
| Detail loses permission/is removed | Explain unavailable record; retain safe back navigation |
| Partial or unadministered module | Review only administered questions; no invented denominators |

## 12. Success metrics

Baseline is not measured. Before implementation, record current task times with representative staff. Proposed pilot targets:

- Median time to open the correct attempt from a supplied day/time: at most 10 seconds and at least 30% faster than baseline.
- Correct-attempt identification: at least 95% in test scenarios.
- Completion/score distinction: every participant correctly recognizes that Completed can have no score.
- Return navigation: no loss of filters/page/scroll in tested flows.

Treat these as validation targets, not promised outcomes.

## 13. Validation plan

Use 5–8 representative staff with fixtures covering repeated students, multiple dates per access link, equal timestamps, missing starts, mixed outcomes, and 124+ attempts. Ask them to find Wednesday's morning sitting, open a named student's second attempt, identify an ended attempt, and return/export. Include keyboard-only and narrow-screen tasks.

Automated acceptance scenarios for implementation:

- Newer true starts precede older ones across page boundaries even when submissions occur in the opposite order.
- Equal dates have stable ID ordering; missing dates are last; displayed dates agree across index and detail in the same timezone.
- Date filters include all matching child attempts, enforce timezone day boundaries, and update scoped counts.
- Search finds an attempt originally beyond the first 50 rows. Filters reset pagination and total labels remain accurate.
- Completed attempts without scores show Completed + Score unavailable; unknown verdicts never become Incorrect.
- Back navigation and deep links preserve/derive authorized context. Export still includes the whole selected group.
- Saved-answer refresh failure retains the last successful data; keyboard and mobile views expose every field and action.

## 14. Delivery plan

### Phase 1 — Establish truthful dates and counts

Verify actual-start semantics in SAT delivery for legacy and current protocols. Extend the existing results service and API contract; use database-side aggregations, scoped filtering, deterministic sorting, and existing pagination. Confirm query cost using realistic access groups; add indexes only if query evidence requires them.

Files: `backend/go/internal/results/service.go`, `sat_attempt_answers.go`, their existing tests, `api/openapi/openapi.yaml`, and `src/features/results/api/satResultsQueries.ts`. Keep shared provider contracts backward-compatible; avoid changing IELTS behavior through the generic `ResultSummary` unintentionally.

Exit: source semantics and null behavior are documented and backend tests cover sorting before pagination, filtered aggregate counts, and permission scope.

### Phase 2 — Deliver the three list views

Update `src/products/sat/routes/SatResultsRoute.tsx` and `SatExamGroupSection.tsx`; adapt `src/features/results/domain/satResultsGroups.ts` for actual-start rollups. Reuse SAT staff primitives/tokens, adding only the row/table structure needed. Add date/status/sort controls, URL state, truthful counts, narrow-screen layout, and explicit export scope.

Tests: existing `src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx` and `src/features/results/domain/__tests__/satResultsGroups.test.ts`.

Exit: each level exposes date/time and comparable columns; all totals match its scope; pagination/search and return navigation satisfy the scenarios above.

### Phase 3 — Unify detail and answer review

Update `src/products/sat/routes/SatResultDetailRoute.tsx` and `SatAttemptAnswersRoute.tsx`. Reuse one SAT timestamp formatter rather than duplicating locale logic. Pass SAT-specific visibility/filter options into `src/components/results/QuestionRawTable.tsx` while preserving other callers. Add detail timestamp hierarchy, friendly section/module labels, and only supported filters.

Tests: SAT route tests and `src/components/results/__tests__/resultDetailTables.test.tsx`; verify other result-table callers retain their behavior.

Exit: scored and saved-answer routes use the same identity/date hierarchy, keep answer-mode restrictions, and never imply fabricated scoring.

### Phase 4 — Verify and pilot

Run targeted Go results tests from `backend/go`: `go test ./internal/results`. Run focused frontend tests with `bunx vitest run src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx src/features/results/domain/__tests__/satResultsGroups.test.ts src/components/results/__tests__/resultDetailTables.test.tsx`, then `bun run typecheck` and `bun run build`. Lint changed frontend files with Bun. Exercise the acceptance scenarios in the rendered app, including narrow widths, 200% zoom, keyboard navigation, refresh failures, and existing whole-group export.

These checks are planned, not executed for this documentation-only change. Run the staff pilot, record times/errors, and repair observed friction before release.

### Deferred improvements

Cross-exam student search, saved views, adjustable columns, filtered exports, and score trend charts require demonstrated need or additional data contracts. They are outside this first delivery.
