# Student Exam Briefing and Waiting Room Design

## Goal

Replace the student-facing system-check screen with an exam briefing, then keep every student in a proctor-controlled waiting room until the authoritative runtime starts the exam.

## Student flow

1. After the student submits the check-in form, take them straight into the waiting room. There is no intermediate briefing screen and no "continue"/"next" button.
2. Run the existing compatibility checks silently on arrival and persist the pre-check payload and audit record in the background, retrying idempotently until it succeeds. No student action is required.
3. The waiting room shows the exam title, candidate, enabled sections, configured section durations, total configured duration, and the essential timer/recovery guidance, with **Waiting for proctor** and no student start control.
4. Transition automatically when the server runtime becomes live. The server deadline remains authoritative for elapsed and remaining time.

## Content contract

The briefing says:

- After you continue, you will enter the waiting room.
- Your exam timer will not begin while you are waiting.
- The timer will begin when the proctor starts the exam.
- Your answers will be saved automatically.
- If your connection is interrupted, return using the same device and browser.
- Refreshing or leaving the page will not pause the timer after the exam begins.

The waiting state says:

- **Waiting for the exam to start**
- You are ready. Please keep this page open. The exam will begin automatically when the proctor starts it.
- **Waiting for proctor**

## Invariants

- Durations come only from enabled `ExamConfig.sections` and are never hard-coded.
- Background pre-check persistence, retry behavior, idempotency, and audit events remain intact.
- Students never start a production exam or author timer state.
- No exam workspace is exposed before the proctor-controlled runtime is live.
- Reload and reconnect preserve authoritative runtime timing.

## Non-runtime exception

Builder/developer preview is not a production student exam. It may retain a separately identified preview-start path if required, but production student UI must not expose **Start Exam**.

