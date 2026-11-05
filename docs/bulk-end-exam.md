# Bulk end exam (SAT Rooms + proctor overview)

Bulk selection for ending several exams at once, because closing room after room
was the slowest part of wrapping up a test cycle.

## Behaviour

**SAT Rooms** (`/sat/sessions`, Live and Upcoming tabs) and **IELTS/ACT proctor
overview** (`/proctor`, Active tab) both offer a `Select rooms` toggle. In selection mode a
room row / cohort card toggles instead of opening, a bulk bar shows
`N selected` with `Select all`, `Clear`, and a destructive `End exam`, and one
confirmation dialog (`End exam in N rooms?`) closes every selected room.

Rules shared by both surfaces:

- Every room that has **not finished** is selectable: not started, running, or
  paused. A room that never started can still be ended (the server completes its
  runtime with no attempts to auto-submit); finished/cancelled rooms are already
  terminal and are ignored by `Select all`.
- Selection lives only on the tab where ending is possible. Changing tab, search,
  or opening a room clears it; a stale id can never end a room that left the list.
- One `POST /v1/proctor/sessions/:scheduleId/control/complete-exam` per room, in
  batches of five with `allSettled` semantics: a refused room never cancels the
  others, and the result names the failures (`2 ended, 1 failed: <room>.`).
- The confirmation copy states the students move to the post-exam phase and the
  action cannot be undone.

## Code

| Surface | UI | Command |
| --- | --- | --- |
| SAT Rooms | `src/products/sat/routes/SatSessionsRoute.tsx` | `proctorMutations.completeRuntime(id, 'Proctor')` |
| Proctor overview | `src/components/proctor/ProctorDashboard.tsx`, `ExamGroupCard.tsx` | `onCompleteExam(id)` (same command pipeline as the room controls) |

## E2E

Acceptance is browser-level, mocked at the network boundary so no Go backend or
database is required:

```bash
bun run e2e:bulk-end   # playwright.bulk-end.config.ts, starts the Vite dev server
```

Scenarios:

- `e2e/sat-staff-bulk-end-ux.spec.ts`
  - S1 select two live rooms → one confirm → two commands, "2 rooms ended.".
  - S2 one refused room → both commands attempted, notice names the refused room.
  - S3 unstarted rooms offer the entry point; finished rooms never do.
  - S4 cancelling the confirmation sends nothing and keeps the selection.
  - S5 changing bucket abandons the selection.
  - S6 selection state has no serious axe violations.
  - S7 bulk-ends a room that never started from the Upcoming tab.
- `e2e/proctor-bulk-end-ux.spec.ts`
  - P1 happy path on the proctor overview (toast + list reconciliation).
  - P2 partial failure: other rooms still end, toast names the failed cohort.
  - P3 Past tab exposes no selection controls.
  - P4 not-started cohorts are selectable.
  - P5 bulk-ends a cohort that never started.

## Risks / limits

- Ending a not-started room uses the same `complete-exam` control as a live one:
  the runtime completes and any Eva SIM form closes first. There is no separate
  "cancel room" command.
- Both rooms' end commands remain per-room HTTP calls; there is no backend batch
  endpoint. Large selections are limited by batching (5 concurrent) rather than a
  server transaction, so a mid-run failure is visible but not atomic.
- "Ended" means the command was accepted and the room list refetched; the
  per-room reconciliation is the same one the single-room End exam uses.
- The mocked E2E suites prove client behaviour; the Go-backed suite
  (`playwright.config.ts`) still needs a running backend to exercise real
  authorization and persistence.
