# Live results and guaranteed visibility of saved answers

## Objective

For every started student attempt, authorized staff can open **Results & Analytics** and see the answers that the server has accepted, even if the student closes the browser, loses connectivity, is removed by a proctor, or never returns. Objective performance may be shown while the exam is running, but must be labeled **provisional**. At the applicable exam deadline or explicit staff action, the server seals the attempt and produces the normal provider result without requiring a browser request.

The guarantee is **every server-acknowledged answer is visible and retained**. An answer that exists only on a disconnected or destroyed device cannot be recovered by the server. The student UI must continue to distinguish saved from pending/unsaved work.

## Current state and gaps

- Protocol V2 saves responses in `attempt_responses_v2`, keyed by `(attempt_id, question_id)`, and advances `student_attempts.response_revision` in the same transaction (`backend/go/migrations/0049_response_durability_v2.sql`, `backend/go/internal/attempts/service.go`). The student uses `DurableResponseEngine` and a local durability mirror (`src/shared/durability/DurableResponseEngine.ts`, `src/components/student/providers/StudentAttemptProvider.tsx`).
- The server has timeout and runtime reconciliation, outbox auto-submit, and an immutable terminal receipt (`backend/go/internal/delivery/reconcile.go`, `backend/go/internal/proctor/reconcile.go`, `backend/go/cmd/worker/main.go`, `backend/go/internal/terminalization/service.go`). These paths already support a disconnected candidate, but coverage of every schedule policy and repair failure must be verified.
- `GET /v1/results/dashboard` currently reads `student_results` for IELTS and `assessment_results` for SAT/ACT. Both are post-submission result sources; an active attempt with saved answers is absent (`backend/go/internal/results/service.go`).
- The IELTS grading projection selects `student_attempts` only where `submitted_at IS NOT NULL`; it does not expose live work (`backend/go/internal/maintenance/jobs.go`). This should remain a terminal projection rather than being made mutable.
- The admin result detail currently depends on an IELTS submission ID or a provider result (`src/components/admin/AdminResults.tsx`, `src/features/results/api/ieltsResultDetail.ts`). Active attempts need an attempt-ID-based detail read.
- The React Query dashboard uses a 15-second `staleTime` but does not itself poll (`src/features/results/api/resultsQueries.ts`). Staff need an active refresh mechanism.

## Product and data rules

1. A started attempt gets exactly one row on the Results page, whether active or terminal. The row's stable identity is `attemptId`; replacing an active row with a terminal result must not create a duplicate.
2. Lifecycle is explicit: `in_progress`, `interrupted`, `needs_staff_action`, `finalizing`, or `finalized`. `interrupted` means presence was lost; it does **not** authorize early sealing. Paused schedules and approved extensions obey their server deadlines.
3. Saved-answer count, last server save time, and `responseRevision` come from the server. `0` is a valid count. An empty attempt still appears and can be terminalized.
4. Active results are staff-only and marked `provisional`. They are never released to students, included in released-result counts, or represented as IELTS bands or SAT scaled scores. A null score means unavailable/pending, not zero.
5. Show every administered question and its saved response, including unanswered items. Hide answer keys from any role that cannot already see them through the existing grading/result permissions. Writing and speaking stay `pending_review`; malformed or keyless objective items have a null verdict.
6. A final result reads the immutable seal snapshot. Once sealed, later browser writes cannot alter it. The terminal outcome and reason remain visible even when scoring is invalidated or pending.
7. A retry, worker restart, duplicate event, or projection replay cannot create a second terminal receipt or duplicate dashboard row.

## Implementation sequence

### 1. Confirm the finalization policy and close server-only gaps

**Owners:** `backend/go/internal/proctor/reconcile.go`, `backend/go/internal/delivery/reconcile.go`, `backend/go/cmd/worker/main.go`, `backend/go/internal/terminalization/service.go`.

- Trace every provider and schedule timing model from its server-owned deadline to sealing. Confirm that the worker handles an attempt that has had no requests since its last answer. Include normal completion, timeout, proctor termination, force submit, pause/extension, cancellation, and auto-submit-disabled schedules.
- Use the existing `terminalization.Service` for all new sealing paths. Reuse the immutable `attempt_terminalizations` receipt and its answer revision/final snapshot; do not add a second finalization writer.
- Do **not** interpret tab close, a missed heartbeat, or temporary network loss as a final submission. Keep the attempt open until its authoritative deadline or an explicit authorized staff action. If a schedule intentionally disables auto-submit or remains paused indefinitely, surface `needs_staff_action` and provide a staff workflow; do not silently invent a deadline.
- Add or tighten a bounded server reconciliation sweep for attempts that are past their applicable deadline but lack a terminal receipt. Query by indexed deadline/status in pages, invoke the existing seal path, and continue after individual failures. Recheck under lock because student submit and worker seal may race. Reuse the existing outbox retry/DLQ behavior for failed fan-out.
- Verify provider materialization/repair for sealed attempts: SAT and ACT `assessment_results`, and IELTS `student_submissions` plus sections. A missing projection must be retried without changing the seal snapshot. An IELTS `student_results` release snapshot remains controlled by the grading/release workflow.

**Done when:** an attempt with no subsequent browser activity reaches one terminal receipt and its provider result/projection after the deadline; paused or auto-submit-disabled attempts remain visible with an actionable state.

### 2. Add a staff-scoped live attempt read model

**Owner:** `backend/go/internal/results/service.go`; route wiring in `backend/go/cmd/api/handlers_grading.go`.

- Extend the dashboard response with `lifecycleStatus`, `scoreStatus` (`provisional`, `pending`, `final`), `responseRevision`, `savedAnswerCount`, and `lastSavedAt`. Preserve existing result fields and meanings for terminal rows. Add these fields to `AdminResultRow` in `src/features/results/api/resultsQueries.ts`.
- Query `student_attempts` for attempts that have actually started (using the existing started/runtime state, rather than admission alone) with **no terminal result row**, scoped through the same schedule organization and active staff-assignment predicate used by `resultScope`. Join the pinned exam version and optional presence. Merge with existing terminal result queries on `attemptId`, favoring the terminal record. Apply provider filter, deterministic ordering, and the page limit **after** merging, so active attempts cannot evict newer final results unpredictably. Add cursor pagination if the current 100-row cap prevents staff from finding a student; do not claim “all attempts” with silent truncation.
- Add `GET /v1/results/attempts/{attemptId}/live` (or a route following the repository's established route naming) for staff-only detail. Perform the same scope check **before** loading responses. Return the pinned exam/provider identity, current revision, server save time, administered question metadata, saved canonical response, and question state. For protocol V2 read `attempt_responses_v2`; for supported legacy attempts use the existing authoritative response source. Do not use browser-local state in this API.
- Read attempt revision and answer rows from one consistent database snapshot, or verify the revision before/after and retry once, so counts, answers, and score all describe the same saved revision. Return `asOfRevision` and `asOfServerTime` in the detail. On concurrent sealing, redirect/reload to the terminal detail rather than returning a mixed live/final payload.
- Keep the current result endpoints for sealed details. Do not put full response JSON in every dashboard row; fetch it only when a staff member opens the detail.
- Keep the export contract deliberate: existing final-result exports should continue to export final rows only unless an explicit “include provisional” option and status columns are added. Update `ExportVisible` if extending `ListDashboard` would otherwise change export contents by accident.
- Start without a new answers table. Add an index or a small read-model migration only if query plans on realistic cohort sizes show the existing attempt/schedule and V2 response indexes are insufficient.

**Done when:** a started attempt appears in the admin list and its saved answers can be read through an authorized attempt-ID detail route before submission; an unassigned or cross-tenant actor receives no row/detail.

### 3. Compute provisional objective performance safely

**Owners:** `backend/go/internal/results/` and the existing provider scoring packages.

- Reuse the same question definitions, pinned revisions, exclusions, weights, normalization, and answer comparison rules used by each provider's final scorer. Extract a read-only pure calculation if necessary; do not copy scoring rules into SQL or TypeScript.
- Calculate only values whose meaning is valid before sealing. IELTS: per-question objective verdict/raw progress, with overall band null until the existing grading/release workflow produces one. SAT: administered module raw progress; adaptive route/scaled score null until final routing/scoring is complete. ACT: objective raw progress where the existing scoring rules support it. Writing/speaking and missing-key items remain unscored.
- Label the output `provisional`, attach `asOfRevision`, and return null for unavailable totals. A terminal invalidation must keep the answers visible while the final score follows the existing invalidation policy.
- Keep provisional calculations read-only and bounded to one attempt. If scoring is expensive, cache by `(attemptId, responseRevision, pinnedVersionId)` or compute on detail open; invalidate on revision change. Avoid running a full score calculation in the dashboard list query.

**Done when:** two reads at the same response revision agree, a new acknowledged answer updates the provisional detail, and final scoring remains authoritative after seal.

### 4. Update the Results page

**Owners:** `src/features/results/api/resultsQueries.ts`, `src/components/admin/AdminResults.tsx`, and result detail components.

- Show the lifecycle and score status as separate, readable labels. For a live row show saved-answer count and last saved time; show `Provisional` next to any live numeric performance. A null score displays `Pending`, never `0` or a fabricated band.
- Open live rows by `attemptId` using the new detail query. Keep existing IELTS/SAT/ACT terminal detail paths. Render unanswered questions and saved writing text, and display the server revision/time on the detail so staff know how current it is.
- Refresh the dashboard and an open live detail while visible (start with a modest poll interval, e.g. 5–15 seconds, or reuse the existing authenticated realtime invalidation path). Pause polling while hidden and refetch on focus/reconnect. The UI should say “updated at” rather than claim subsecond realtime unless that latency is measured.
- Preserve filters/search and make active/interrupted/finalized states discoverable. Ensure keyboard access, loading/error states, and a clear distinction between “no saved answer” and “detail failed to load.”
- Keep student-facing result release rules unchanged. Live staff visibility must not expose answer keys, provisional scores, or another candidate's data to students.

**Done when:** staff can find an active or disconnected student, see the last server-saved answers, and watch acknowledged changes appear without manually reloading.

### 5. Repair historical and operational gaps

**Owners:** `backend/go/internal/maintenance/`, `backend/go/cmd/worker/main.go`, telemetry/operations wiring.

- Add a bounded, idempotent audit for: past-deadline open attempts, terminal receipts without provider results, IELTS terminal attempts without submissions/sections, and result rows without a matching terminal receipt. Reuse existing SAT/ACT repairs where they already cover a case; add only missing IELTS/provider cases.
- Make repair progress observable: counts and oldest age for each gap, last successful sweep, retry/DLQ failures, and projection lag. Alert on sustained nonzero past-deadline or missing-result counts. Include the affected attempt IDs in restricted logs, not answer content.
- Backfill existing open and terminal attempts in batches. Dry-run counts first, then execute idempotent repair. Do not rewrite released result snapshots or overwrite teacher grades/overrides.
- Verify worker deployment/flags, especially `GRADING_PROJECTION_ENABLED`, in every production environment. A disabled projection must appear as an operational gap, not a silently empty IELTS Results page.

**Done when:** the repair job reaches zero actionable gaps in a test database and reports failures clearly rather than silently omitting students.

## Verification matrix

| Scenario | Required observation |
| --- | --- |
| Student answers, then closes the tab before exam end | Acknowledged answers appear in live Results; attempt remains open until its server deadline. |
| Student never returns | Server seals at the applicable deadline; one final result/projection replaces the live row. |
| Network drops before a save acknowledgement | Staff see only the last server-accepted revision; student sees pending/unsaved state if the device remains available. |
| Save acknowledgement races tab close | The database revision determines what appears; no answer is inferred from browser events. |
| Student reconnects before deadline | Same attempt and latest server revision resume; no duplicate Results row. |
| Student submit races timeout/proctor action | One terminal receipt and one final dashboard row; outcome follows existing lock and conflict rules. |
| Paused or auto-submit-disabled schedule | No premature seal; staff see the attempt and the required action. |
| Proctor termination or invalidation | Answers remain reviewable; score/outcome follows provider policy. |
| Worker stops between seal and projection | Restart/repair produces the missing result from the immutable snapshot. |
| No answers at all | Attempt is visible and terminalizable; counts show zero and scores remain null where appropriate. |
| Cross-tenant or unassigned staff request | Neither list nor detail exposes the attempt or answers. |

Use Go service/SQL tests for scoping, merge/dedup, consistent revisions, scoring, and repair; integration tests with MySQL for save → disconnect → deadline → seal → projection; and UI tests for live/final status, refresh, and null-score display. Include an end-to-end scenario that kills the browser after the last acknowledged save and verifies Results solely through the server.

## Rollout order and acceptance gate

1. Ship the staff-scoped live read API and UI behind a feature flag; compare its answer count/revision against the authoritative V2 table on test and pilot cohorts.
2. Enable provisional scoring only after parity tests against the provider's final scorer on sealed fixtures. Keep score null where parity cannot be established.
3. Enable any new deadline sweep/repair incrementally, monitor gap age, retries, database load, and duplicate-row rate, then backfill historical gaps.
4. Remove the flag only after the verification matrix passes for IELTS, SAT, and ACT and the production worker has demonstrated unattended finalization.

**Acceptance criteria:** Every started attempt is findable by authorized staff; every acknowledged response is available in its Results detail at the matching server revision; a permanently absent student is finalized by the server under the schedule policy; each attempt has at most one terminal fact and one visible Results row; provisional and released scores are unmistakably distinguished; and any case the worker cannot finalize is visible as an actionable operational gap.
