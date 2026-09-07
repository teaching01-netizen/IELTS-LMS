# Scenario Matrix

Every Wave 1/2 task maps to rows here. Correctness scenarios must pass for both IELTS and SAT unless a row states otherwise.

## Correctness (zero-tolerance rows)

1. Local persistence fails mid-writing: status shows Needs attention, never false saved; work preserved per policy.
2. Server commits an answer but the response is lost: retry with the same identity converges without duplicates.
3. Old response arrives after a newer edit: stale update rejected, newer edit intact.
4. Reload with pending mutations: pending work rehydrates and delivers exactly once.
5. Auth expires during writing: reauth returns to the same attempt, queued work preserved.
6. Device sleeps through the deadline: server deadline governs; D1 policy decides late edits.
7. Pause and submission race: exactly one outcome via the machine + server atomic finalize.
8. Reconnect storm (cohort-wide): jittered reconnect, bounded buffering, no lost pause/advance events.
9. Old tab resumes after takeover: fenced, cannot overwrite; work preserved for review.
10. Deployment removes/changes assets mid-attempt: attempt completes incl. section transitions; chunk-load failure never auto-reloads the exam.
11. Exam draft changes after an attempt begins: grading still resolves the pinned version (invariant 1).
12. Export filename collision / interrupted generation: deterministic unique names, resumable or cleanly restartable.

## Interaction / accessibility rows

- Keyboard-only completion of representative IELTS + SAT exams (incl. writing, review grid, break/directions screens).
- Zoom, reduced motion, visible focus, contrast, screen-reader announcements for save status + time warnings.
- 44px minimum / 48px preferred exam control targets (project choice; WCAG 2.2 AA minimum is 24px with exceptions).
- Overlay behavior: label, initial focus, containment, background inertness, focus restoration; blocking states explain recovery without relying on Escape.

## Layer mapping

| Layer            | Proof                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain tests     | transition + answer invariants (Vitest)                                                                                                      |
| Contract tests   | dedup, acks, revisions, submission (Vitest + Go)                                                                                             |
| Component tests  | focus, writing, keyboard ops                                                                                                                 |
| Browser tests    | reload, offline recovery, auth, multi-tab (Playwright student-* incl. input-durability, recovery, multi-device, network, submit-flow, timer) |
| Load tests       | join, autosave, reconnect, section advance, submit storm (k6 + live-runner); data correctness, not just HTTP 200                             |
| Deployment tests | old client + pending outbox survive a new release                                                                                            |
