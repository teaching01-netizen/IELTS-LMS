Implement the following IELTS exam behavior.

This specification defines product behavior and acceptance criteria. Choose the implementation approach that fits the existing application.

**Objective**

Support 200–500 concurrent IELTS students with automatic preparation recovery, reliable saving, fair section timing, and verified submission.

Students who are ready should start together. A student delayed during preparation should automatically receive their own full section time without delaying others or requiring an individual proctor action.

**Scope**

Apply this behavior to IELTS Listening, Reading, and Writing, respecting the exam’s enabled sections, configured order, durations, and authorised accommodations.

Preserve normal session admission, room start, and existing authorised pause, cancellation, and termination controls.

Do not change SAT or ACT behavior.

**1. Shared start, individual section timelines**

The room owns one shared section release schedule. Each student attempt has its
own authoritative preparation state, section start, and deadline.

- Ready students begin together when the room opens the section.
- A student who becomes ready later begins automatically within the permitted preparation window.
- Every started section receives its full configured working time.
- A student cannot enter a later section before the room opens it.
- If the room advances while a delayed student still has time in the current section, that student keeps the section open until their own deadline.
- Their next section starts only after both their own prior section deadline and the room’s release time; the room finishing normally does not cancel a still-valid personal timeline.
- All countdowns, answer cutoffs, transitions, and submission decisions must agree with that student’s authoritative timeline.
- Refreshing, reconnecting, reopening the exam, or changing devices must resume the existing timeline.
- A repeated readiness or start request must never restart a section or grant more time.
- No student may access a section before they are eligible for it.

For example, with a configured 60-minute Reading section:

- A student starting at 09:00:00 finishes at 10:00:00.
- A student delayed until 09:00:40 finishes at 10:00:40.
- The delayed student’s Listening deadline is 10:00:40. Reading remains unavailable until the room opens it; after that, it begins when both the student’s Listening timeline and the room release permit it. The student receives the full configured Reading time even if the room is already on Writing.

**2. Automatic preparation and recovery**

Readiness must reflect whether the student can begin the section, including:

- Required content is available.
- Local answer storage is usable.
- Required audio is available and playback can be initiated where applicable.

A missed heartbeat or network disconnect alone must not establish that a student is unable to work.

Use a configurable preparation allowance, defaulting to 120 seconds per section.

- For the first section, measure the allowance from the room’s scheduled start.
- For later sections, measure it from the expected start on that student’s own timeline.
- Repeated retries, refreshes, and reconnects must not renew the allowance.
- Existing authorised pauses must not consume working time or preparation allowance.
- If readiness succeeds within the allowance, start automatically and record the assigned start and deadline.
- If the allowance expires, stop automatic attempts to start that section and show “Could not start.”
- Do not classify an unstarted section as successfully submitted or silently score the technical failure as an unanswered completed section.
- Preserve previously completed sections, accepted answers, and the incident record.

Routine recovery must not require the proctor to approve, exclude, extend, or manually resume an individual student.

**3. Interruptions after a section starts**

Automatic delayed starts must not become automatic time compensation for every connection loss.

- A brief disconnect must allow continued work within an already available section while local storage remains usable.
- The existing deadline continues during an ordinary network interruption.
- Reconnection restores the same remaining time; it does not reset the timer.
- Browser-reported offline duration must not independently grant additional time.
- If local answer storage becomes unavailable, clearly report the problem and prevent further unprotected answer entry.
- Preserve existing answers through interruption and recovery.
- Existing authorised pauses and termination controls remain effective.

**4. Shared room transitions with personal timing recovery**

A student’s active section ends according to their own authoritative deadline. The shared room schedule controls when each subsequent section becomes available.

- Students may review answers within the current section until its deadline.
- Reviewing or finishing answers early must not open the next section early.
- At the deadline, stop further editing and capture the latest visible answers, including focused inputs and uncommitted Writing text.
- Preserve outgoing work before replacing the section interface.
- Activate the next section automatically when the room has opened it, the student’s previous personal section has ended, and preparation succeeds.
- Preparation and transition delays must not consume the next section’s allocated working time.
- An unresolved answer-delivery problem must not produce an endless transition spinner.
- Late acknowledgements from an older section must not overwrite newer work or change the active section incorrectly.

The main room advancing or finishing its normal timeline must not close a delayed student’s still-valid section. A delayed student must not block the other candidates from following the shared room schedule.

Distinguish normal room completion from an explicit authorised cancellation or termination.

**5. Listening behavior**

Individual Listening timing must include individual audio progression.

- Each student receives the correct audio for their own active section.
- A delayed student must not lose the beginning of the recording because other students have already started.
- Recovery must not silently restart completed audio or grant additional playback opportunities.
- Audio failures must be distinguishable from answer-saving failures.
- Do not claim individual Listening recovery works when delivery depends exclusively on one shared room recording.

**6. Answer saving and recovery**

Protect the latest student intent independently of network acknowledgement.

- Capture answer changes promptly, including continuous typing.
- Preserve Writing tasks, answer clears, review flags, and other supported answer state.
- Avoid unnecessary server writes while maintaining a bounded save delay.
- Question navigation must remain responsive during normal network delays.
- Older acknowledgements or snapshots must never replace newer local answers.
- Duplicate delivery must not apply the same answer change twice.
- Retries must recover automatically without uncontrolled request bursts.

Distinguish these conditions accurately:

- Saved on this device.
- Awaiting server confirmation.
- Confirmed by the server.
- Unable to save locally.
- Requires recovery.

Use a defined post-deadline delivery window for eligible frozen work. That window must not extend editing time.

Eligibility must follow authoritative timing and write rules. A client timestamp alone must not extend acceptance.

Answers that cannot be accepted must remain recoverable and visibly unconfirmed. Never silently discard them or claim that they were included in a successful submission.

**7. Submission and completion**

Final submission must follow the student’s own final section.

- Initiate submission automatically when that section ends.
- Capture the final visible answer state before submission.
- Confirm that the captured work is accounted for; an empty pending queue alone is insufficient proof.
- Repeated submission attempts must return the same committed outcome.
- If the server accepted submission but its response was lost, reconnecting must recover that outcome without submitting twice.
- Refreshing during submission must resume verification or retry.
- Do not show “Submitted,” “Answers recorded,” or permission to close the page while the relevant work remains unconfirmed.
- Keep unresolved work and recovery information visible.

Separate answer receipt from result generation.

Once the server confirms the answers are recorded, a scoring or results-processing failure must not reopen the exam or ask the student to submit those answers again.

**8. Proctor visibility and student feedback**

The proctor dashboard should show students who are preparing, active, delayed, reconnecting, submitting, completed, or unable to start.

Record automatic timing exceptions and recovery outcomes without requiring routine proctor intervention.

Student messages must explain the current state and any available recovery action. Keep normal saving quiet, make persistent failures clear, and provide accessible status feedback without repeatedly stealing focus.

**9. Acceptance criteria**

Verify the following scenarios:

1. At 500 concurrent students, one delayed student does not prevent the other 499 from starting.
2. A student ready 40 seconds late receives the full configured section duration.
3. That student’s later sections retain their full duration when the main room advances, while remaining unavailable until the room has released them.
4. Repeated readiness requests, reloads, and reconnects never create a second start or extend the deadline.
5. Preparation timeout produces “Could not start,” preserving previous work without false completion.
6. A brief mid-section disconnect preserves answers and the original deadline.
7. Local storage failure never produces a false saved state.
8. The final keystroke or Writing correction at a transition is captured correctly.
9. Old acknowledgements cannot overwrite newer answers.
10. Lost submission responses recover the committed receipt without duplicate submission.
11. Delayed students continue when the main room’s normal timeline ends.
12. Listening timing and audio remain consistent for delayed students.
13. Authorised pauses, cancellation, termination, and device ownership restrictions remain effective.
14. Confirmed answer receipt remains successful if result generation subsequently fails.

Validate realistic simultaneous starts, transitions, reconnects, and final submissions at the target concurrency. Report observed timing and reliability results rather than assuming capacity.

Introduce the timing policy on new sessions through a controlled rollout. Existing sessions must retain the policy under which they started. Any lost accepted answer, unintended timer reset, shortened working time, or premature submission must block wider rollout.
