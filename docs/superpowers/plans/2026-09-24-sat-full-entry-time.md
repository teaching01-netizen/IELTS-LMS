# SAT Full Entry Time Implementation Plan

> **For agentic workers:** Implement the checked tasks in order. Preserve the existing `cohort_section_v3` path for sessions already running under it.

**Goal:** A student sees and receives the full authored duration on the first active frame of each SAT module and scheduled break, including after a slow transition or reload.

**Architecture:** New SAT schedules use an attempt-owned timing model (`sat_personal_v1`). The proctor runtime authorizes and pauses the exam, while module and break deadlines belong to each attempt. An idempotent, server-issued future start lets the browser load the next surface before its clock begins; a missed start is rearmed before the surface becomes active.

**Tech Stack:** Go, MySQL migrations, React, TypeScript, Bun/Vitest, Playwright.

---

## Timing contract and decisions

- **Entry:** The authored module/break time begins at a server-issued `startsAt` in the future. The UI stays on `Starting…` until that instant, then presents `2:00` for a two-minute stage. The server's `deadlineAt` is exactly `startsAt + authoredSeconds`, adjusted only by authorized pause/extension rules.
- **Slow or hidden browser:** If the offer or its confirmation arrives too late to paint the active frame during the first displayed second, or the page is hidden before entry, the client requests a new offer. Rearming is allowed only while no active frame has been acknowledged and no response was accepted. Once entered, reloads resume the original deadline; they never reset it.
- **Break:** After the last module of a section is finalized, the attempt enters a pending break. Its duration is not consumed during server reconciliation, network delivery, or page rendering. A zero-length break moves directly to the next module.
- **Late-student timeline:** Every admitted student progresses independently. If Student B enters five minutes after Student A, B receives the full Module 1 time, then B's full scheduled break begins after B completes the preceding section, and B enters the next subject only after B's own break ends. B also receives the full authored time in that subject. A's section, break, and subject transitions never advance or shorten B's stages. Reconciliation and handoff latency may delay B's next start, but cannot consume B's configured stage time.
- **Room controls:** Start authorizes attempts to enter. Pause/resume freezes every active attempt module and break. End/terminate can still close them. The room's section plan remains useful as an authored run sheet, but it is not an expiry deadline for personal attempts.
- **Completion:** `exam_schedules.end_time` closes new admission; it does not cut short an admitted student's timer. A personal SAT runtime completes when admission has closed and all admitted attempts are terminal, or an authorized proctor ends it. The room can therefore remain live beyond its scheduled end.
- **Rollout:** Store the chosen timing model on each schedule. Existing schedules with no choice remain `cohort_section_v3`; newly created SAT schedules select `sat_personal_v1`. Never reinterpret an in-progress attempt's timing model.
- **Display guarantee:** The active frame must start at the full integer duration. A transition screen may last longer on a slow connection; it must not silently consume exam or break time. Clock correction uses one accepted `(serverNow, receivedAt)` pair for all student countdowns.

## Ownership and files

| Owner | Files |
| --- | --- |
| Timing model and persistence | `backend/go/internal/runtime/timingmodel.go`, `backend/go/migrations/0069_sat_personal_timing.sql`, `backend/go/internal/schedules/service.go`, `backend/go/internal/runtime/service.go` |
| Attempt transition and expiry | `backend/go/internal/delivery/start_submit.go`, `backend/go/internal/delivery/service.go`, `backend/go/internal/delivery/reconcile.go`, `backend/go/internal/attempts/service.go` |
| Proctor lifecycle and projection | `backend/go/internal/proctor/reconcile.go`, `backend/go/internal/proctor/service.go`, `backend/go/internal/proctor/sessions.go` |
| HTTP and client contract | `backend/go/cmd/api/handlers_delivery.go`, `backend/go/cmd/api/main.go`, `src/features/student-delivery/api/assessmentDeliveryApi.ts`, `src/features/student-delivery/contracts/assessmentDelivery.ts`, `src/types/domain.ts` |
| Student flow | `src/features/student-delivery/hooks/useSatExamController.ts`, `src/features/student-delivery/hooks/useSatModuleEntry.ts`, `src/features/student-delivery/application/satTimingPolicy.ts`, `src/features/student-delivery/domain/satTiming.ts`, `src/features/student-delivery/routes/SatStudentSessionRoute.tsx` |
| Staff display | `src/products/sat/ui/sessionRunSheet.ts`, `src/products/sat/ui/SatSessionRoomStudents.tsx` |

## Tasks

### 1. Pin the acceptance contract before changing timing

- [ ] Add failing Go tests beside `backend/go/internal/delivery/cohort_module_window_test.go` for a two-minute Module 1 entered five seconds after room Start, Module 2 opened after timeout reconciliation, a two-minute break entered after a delayed projection, and a reload mid-module. Add two attempts whose starts differ by five minutes; assert each receives its own full modules and break and that A's advancement never changes B's deadline. Assert the **new model** grants 120 seconds at its actual start, while the old cohort model retains its current 115-second clamp.
- [ ] Add a browser timing test in `e2e/sat-timing-contract.spec.ts`: delay the Start Module and break transition responses by five seconds, observe the transition surface, and assert the first active timer reads `2:00`, followed by `1:59` after one second. Assert a reload after 30 seconds reads about `1:30`, never `2:00` again.
- [ ] Run the focused tests and confirm they fail for the missing personal timing behavior before implementation.

### 2. Persist the timing model and attempt-owned break

- [ ] Add `exam_schedules.sat_timing_model` as nullable; null means the deployed cohort model. Add `assessment_attempt_breaks` with `attempt_id`, `after_section_id`, authored `duration_seconds`, `state` (`pending`, `armed`, `active`, `completed`), `starts_at`, `deadline_at`, `entered_at`, `paused_at`, `accumulated_paused_seconds`, and `revision`. Add a unique key on `(attempt_id, after_section_id)` and an index supporting active-break reconciliation. Use `TIMESTAMP(6)` throughout.
- [ ] Add `sat_personal_v1` to `runtime/timingmodel.go` and `src/types/domain.ts`. Make `schedules/service.go` persist that choice for newly created SAT schedules and make `runtime/service.go` read the schedule's choice when starting. Update pre-start projections in `proctor/sessions.go` and delivery bootstrap to read the schedule choice rather than infer all SAT schedules are cohort-timed. Keep the old model for null schedules and existing runtime rows.
- [ ] Add migration and schedule/runtime tests for old-row compatibility, new-row selection, and no in-flight model rewrite. Run `go test ./internal/runtime ./internal/schedules -count=1`.

### 3. Introduce a future-start offer for modules

- [ ] Extend module-attempt persistence with `entry_starts_at`, `entry_confirmed_at`, `entry_entered_at`, and `entry_generation`. The existing `started_at` remains null while an offer is only armed; `entry_entered_at` records the first active frame acknowledgment.
- [ ] Make `StartModule` under `sat_personal_v1` idempotently arm the selected unstarted attempt at database time plus a short lead (initially three seconds), return the offer generation and `startsAt`, and leave the authored `allocated_seconds` unchanged. On a request with the current generation that has missed its start, rearm only if `entry_entered_at IS NULL` and no accepted response exists. Bound rearming by schedule admission closure and a small server-enforced retry budget; exhaustion shows a recoverable proctor-action state without starting a clock. Use the existing writer-session and control-epoch fences; stale offers must fail with a conflict.
- [ ] Add an `enterModule` command called **before** `startsAt`. It atomically verifies the offer generation, selected module, room authorization, and DB time still before `startsAt`; it records `entry_confirmed_at`, sets `started_at = entry_starts_at`, and returns the immutable deadline. The UI must receive this confirmation while enough lead remains to paint the active frame. If the response arrives too late, rearm by generation while `entry_entered_at IS NULL` and no response exists. Add a `markStageVisible` acknowledgment after the first active paint; it records `entry_entered_at` idempotently. Save gates require a confirmed generation and DB time at/after `started_at`, and reject expired writes.
- [ ] Update `ReconcileAttemptTimeout` so an unconfirmed or unentered offer cannot expire a module; a missed offer stays rearmable. The first accepted response also marks entry, so an acknowledgment race cannot yield unlimited resets. Once entry is marked, expire at the attempt deadline plus the existing three-second save-only grace. Preserve adaptive branch creation in the same finalization transaction.
- [ ] Test concurrent start/enter/rearm requests, late responses, stale generations, takeover, pause while armed, and no second allocation on reload. Run `go test ./internal/delivery ./internal/attempts -count=1`.

### 4. Give breaks the same attempt-owned entry boundary

- [ ] In `finalizeModuleTx`, create a pending break when the finalized module is the last module of a section and `break_after_seconds > 0`; do not derive its deadline from cohort `actual_end_at`. The next module exists but cannot be entered until that break completes.
- [ ] Add idempotent `startBreak`/`enterBreak` commands using the same future-start generation, pre-start confirmation, and first-paint acknowledgment rule as modules. Confirmed entry sets `deadline_at = starts_at + duration_seconds`. A missed offer can be rearmed only while not visibly entered; a reload of an entered break returns the original deadline.
- [ ] Reconcile an entered break at its own deadline, mark it completed, then make that attempt's selected next module enterable. Pause/resume shifts its deadline by the actual paused duration. Test two students entering the same break five minutes apart: A can already be in the next subject while B still has B's full break, and B's next subject starts with its full authored time. Also test a delayed response, reload, pause, zero-length break, and duplicate commands.
- [ ] Run `go test ./internal/delivery ./internal/proctor -count=1`.

### 5. Separate personal progress from cohort section expiry

- [ ] Under `sat_personal_v1`, stop using `active_section_key` equality and `cohortModuleWindowSeconds` to restrict module starts. Gate on room status, attempt identity, selected next module, completed prior module, and completed personal break. Keep the old cohort branch unchanged.
- [ ] Exclude personal SAT runtimes from the time-based `ReconcileExpiredSections` section advance and from its automatic attempt terminalization. Add a personal-runtime completion sweep that requires admissions closed plus all admitted attempts terminal; an explicit proctor End still terminates active attempts.
- [ ] Update proctor Pause/Resume/Extend commands and roster projections to operate on the attempt-owned module and break deadlines. Show per-student current stage and remaining time; label the room run sheet as a plan rather than a shared live countdown for this model.
- [ ] Test simultaneous students at different modules/breaks, one offline student, proctor pause/resume, extension, termination, and completion. Run `go test ./internal/proctor ./internal/runtime ./internal/delivery -count=1`.

### 6. Make React enter only on an accepted offer

- [ ] Extend the delivery bootstrap and TypeScript contract with `timingModel`, current personal stage, offer generation, `startsAt`, `deadlineAt`, and `serverNow`. Keep fields additive so old sessions continue to render the cohort path.
- [ ] In `useSatExamController`, use the existing loading/handoff surfaces while an offer is armed. Confirm the offer before `startsAt`; if confirmation arrives with less than one displayed second of lead, or the page is hidden, rearm instead of entering. At `startsAt`, route data plus phase atomically, show the full countdown, and send `markStageVisible` after paint. Keep answer input blocked until pre-start confirmation succeeds; queue local answer drafts while the visibility acknowledgment is in flight.
- [ ] In `satTimingPolicy.ts` and `satTiming.ts`, derive personal module and break countdowns solely from their own deadlines; do not apply the cohort section `min()` cap or `nextSectionStartAt` to the new model. Keep pause behavior and existing cohort behavior intact.
- [ ] Add hook/route tests with fake timers for initial entry, Module 2, break, delayed offer, stale response, hidden tab, reload, pause, and retry. Run `bunx vitest run src/features/student-delivery`.

### 7. Verify the complete chain and rollout

- [ ] Extend `e2e/sat-timing-contract.spec.ts` to exercise MySQL → worker → HTTP/WebSocket → React for two students entering five minutes apart (use controlled server timestamps to keep the test fast). Assert B remains in B's module or break while A advances, and that B then sees the full break and full next-subject module duration. Verify adaptive routes, answer-save cutoff, pause/resume, and reload.
- [ ] Add timing metrics for `offer_created_at`, `offer_received_at`, `entry_entered_at`, `first_active_frame_at`, and `deadline_at`, tagged by stage/model but without candidate PII. Alert if an active frame first renders below the authored duration or if an offer is repeatedly rearmed.
- [ ] Run `go test ./...` from `backend/go`, `bun run typecheck`, `bun run test:run`, and the focused Playwright timing contract with the normal Bun/Node toolchain. Review any existing tests that assume all SAT attempts share one deadline; retain those assertions only for `cohort_section_v3`.
- [ ] Deploy the migration first, then API/worker/client compatibility, then enable `sat_personal_v1` for newly created SAT schedules. Verify one old cohort schedule and one new personal schedule before broad enablement.

## Release gate

Do not ship a timer-only UI change. The release is complete when the server write gate, timeout reconciler, student timer, break gate, proctor controls, and staff projection all agree on the same attempt-owned deadline, and the delayed-response browser test shows `2:00` at the first active frame.
