# Fix SAT break timing and transitions

## Summary

Give students the full configured break after Verbal Module 2, with automatic transitions and no `0:00` flash. Show brief preparation text while the next state is loading.

Confirmed: the live timer provider bypasses the screen’s expired-countdown handling. The server also starts the break before the browser receives it.

## Implementation

- Create personal SAT breaks as pending when Verbal finishes. Reuse the existing authenticated break-entry protocol to coordinate a server-issued start once the break screen is ready.
- Keep the full duration anchored to the confirmed server start. Retry missed, unconfirmed offers within existing limits; recover an already confirmed break without restarting it.
- Set Math’s availability from the actual break deadline. Preserve section forms, required module confirmation, and proctor pause behavior.
- Use one shared break-time calculation for the controller and live UI, including the same server-time/receipt-time pair.
- Extend the break presentation with preparing and ending states. Show “Preparing your break…” before activation and “Preparing Math…” while automatic entry completes.
- Render a countdown only when it is positive. Reserve its layout space when hidden, and announce state changes once through the existing accessible status region.

## Verification

- Add regression tests using the real temporal provider; the current 28 relevant tests pass but miss this rendering path.
- Test Verbal expiry with 2- and 5-second transition delays: the break first displays its full configured duration and counts down normally.
- Test break expiry with delayed Math state: no visible or announced `0:00`, with no premature question access.
- Cover reloads, duplicate requests, lost responses, missed offers, pause/resume, and zero-duration breaks.
- Run targeted frontend and Go tests, typecheck, and the SAT transition browser suite against a test database.

## Defaults and compatibility

- Apply the new start policy to attempt-owned SAT breaks. Shared cohort schedules retain their timing and receive the display correction.
- Reloading an active break resumes its existing deadline.
- Reuse existing break states, fields, and endpoints; deploy the frontend and backend changes together between exam sessions.




# SAT break timing: low-level implementation plan

## 1. Requirements and verified boundary

Preserve the selected behavior: automatic break entry, the full configured countdown, and brief preparation text instead of `0:00`.

**Verified findings:**

- `openFollowUpModuleTx` currently creates an active break before its screen reaches the browser.
- `SatScheduledBreakScreen` renders live-provider `0` even when its supplied countdown is `null`.
- The existing break-entry protocol uses a three-second future start, which can expire during the reported delay.
- `SatTemporalRuntime` currently interprets an active break with a future start as an ended break.
- The expired Verbal timer can remain visible while module closure finishes.

**Invariants:**

- Only the server grants or changes break time.
- A confirmed break keeps its original deadline across retries and reloads.
- Preparing, running, and awaiting completion all block Math entry.
- Existing answer finalization, section forms, proctor controls, and required `Begin module` actions remain enforced.

## 2. Contracts and ownership

Keep existing database fields and HTTP endpoints. Add these narrowly scoped contracts:

| Unit | Responsibility |
|---|---|
| Existing delivery service | Own pending → armed → active → completed transitions under the attempt transaction lock. |
| Proposed `AssessmentBreakStartRequest` | Optional `controlEpoch` and integer `leadSeconds`; preserve the three-second default when omitted. |
| Proposed `SatBreakWindow` | Derived phase, nullable positive countdown, and `blocksEntry`; no separately stored browser deadline. |
| Proposed `useSatBreakEntry` hook | Own readiness, sequential entry requests, retries, and recovery from uncertain responses. |

Extend `SatBreakPhase` to `waiting | preparing | active | ending`. Waiting and active phases expose positive seconds; preparing and ending expose `null`.

## 3. Backend changes

Implement in dependency order:

1. In [start_submit.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/start_submit.go), change all personal cross-section break paths in `openFollowUpModuleTx` to reuse `createPersonalBreakTx`. Insert the following module with `available_at = NULL`; its recovery entry deadline must also remain unset.

2. In [personal_break.go](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/personal_break.go), extend `StartBreak` to accept the start-request options. Validate supplied lead time as 3–12 seconds before mutation. Retain writer authorization, control-epoch fencing, admission limits, generation checks, and the existing four-offer budget.

3. Preserve `EnterBreak`’s future-start confirmation:
   - Lock and validate the current armed generation.
   - Reject an expired offer without changing the break.
   - Persist `starts_at = entry_starts_at` and `deadline_at = starts_at + duration_seconds`.
   - Check affected rows.
   - Replay an already confirmed generation without changing its deadline.

4. In `ReconcileAttemptTimeout`, complete a due break and establish the following module’s eligibility atomically. Use the completed break’s actual deadline for `available_at`. Initialize its recovery entry allowance only when the existing section-form gate permits it; retain current automatic versus explicit module-entry policy.

5. In `SyncSATPauseInTx`, handle a pause before a confirmed future start: shift that start, its entry timestamp, and its deadline together on resume. Retain existing behavior for pauses during an active countdown.

## 4. Frontend changes and control flow

- Add one pure break-window derivation in the timing policy. Use it from [satTemporalModel.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/timing/satTemporalModel.ts), the controller, stage selection, and break rendering. Use the accepted server-time/receipt-time pair for both countdown arithmetic and boundary wakeups.
- Add `useSatBreakEntry` beside the existing entry hooks. Start preparation after the break surface mounts and the document is visible. Keep one request flight per attempt and break; ignore results after identity changes.
- Initially request the existing three-second offer. Measure request duration. For a replacement offer, request `clamp(ceil(2 × roundTripMs / 1000) + 2, 3, 12)` seconds. If insufficient lead remains for confirmation, stay in preparing and obtain a replacement after expiry.
- Commit every response through `acceptPayloadAndRoute`. After a lost response, read authoritative state first. Resume confirmed state; re-arm only an unconfirmed expired offer. Surface existing terminal refusals instead of retrying indefinitely.
- In [useSatExamController.ts](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/hooks/useSatExamController.ts), replace zero-second entry checks with `breakWindow.blocksEntry`, including the section-form boundary.
- Fire break-end work only for an actually expired break. Key it by attempt, break, generation, and deadline. Refresh immediately, then retry sequentially at the existing two-second cadence for at most eight reads or twenty seconds; afterward retain normal recovery polling and expose retry status.
- Keep one mounted break surface. Show “Preparing your break…” before activation and “Preparing Math…” while automatic entry completes. Hide the countdown accessibly when unavailable or expired, retaining its layout space.
- Replace expired numeric labels in the module and review timers with “Time expired”. Preserve input freezing, answer-saving feedback, threshold announcements, and the underlying expiry value.

**Worked scenario:** Verbal closes → pending break arrives five seconds later → preparation obtains and confirms a viable future start → countdown begins at the configured duration → expiry hides the timer and refreshes state → Math opens through its existing entry policy.

**Failure scenario:** Confirmation commits but its response is lost → recovery reads the active generation → the browser resumes that deadline without granting another break.

## 5. Verification, compatibility, and limits

Add regression coverage for:

- Real temporal-provider rendering at both boundaries: no visible or announced `0:00`.
- Two- and five-second transition delays; first active countdown equals the configured duration.
- Future starts never emitting break-end events.
- Concurrent requests, stale generations, lost responses, and reloads preserving one confirmed deadline.
- Pause/resume before start and during countdown.
- Math remaining blocked throughout preparation and the break.
- Recovery entry allowance beginning at actual eligibility; section forms retaining their gate.
- Zero-duration breaks and shared cohort timing retaining existing progression.

Run targeted Vitest tests, `bun run typecheck`, relevant Go delivery/runtime tests, and `bunx playwright test --config playwright.sat-transition.config.ts --grep 'scheduled break'` against a test database.

**Evidence so far:** the existing 28 frontend tests and targeted Go break tests pass. Database/browser verification remains unexecuted; the current shell has no `TEST_DATABASE_URL`.

Deploy frontend and backend together between exam sessions. Existing active breaks retain their deadlines. After a confirmed start, connection loss does not rewind time. Different configured durations and additional timer consumers must use the same derivation, without adding caller-specific arithmetic.
