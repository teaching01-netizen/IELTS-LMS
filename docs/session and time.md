Fixes: cohort-anchored SAT module clocks + per-module time on the staff session page

Root causes (verified)

Bug 1 — late joiners got their own clock. For a rendered SAT session the timing model is cohort_section_v3 (runtime.TimingModelForProvider). StartModule wrote assessment_module_attempts.started_at = gateNow (the student's own arrival, a brand-new window regardless of when the room started its module) and delivery.moduleDeadline/computeModuleTiming derives deadlineAt = started_at + allocated + extension + accumulated. The student UI shows min(personal module window, section clock) (application/satTimingPolicy.ts → satCountdown), so a student joining mid-section read a fresh full module window (32:00) while the room's Module 1 window and the proctor's clock had less.

Bug 2 — staff page named the section, not the module. proctor/sessions.go:attemptRowToSession forces RuntimeCurrentSection = runtime.CurrentSectionKey for cohort SAT, so the roster row and the detail panel's "Current module" render reading-writing / math. The run sheet (sessionRunSheet.ts / SatRunSheet.tsx) showed ICT windows and status, but no live clock per module, and nothing on the page said Module 1 vs Module 2.

Decisions
- A late joiner's timer counts the room's window for that module.
- Arriving after the room's Module 1 window has closed gives 0 Module 1 time — the timeout path finalizes it and the adaptive successor opens with the section's remainder.
- Staff page: live per-module clocks in the run sheet (Start–end ICT windows kept) and "Section n · Module 1/2" + clocks in the stage header, roster rows, student detail and session inspector.

Shipped

Phase 1 — Server: room-anchored cohort module windows (bug 1)
- backend/go/internal/delivery/service.go: moduleTimingGateTx now returns a moduleTimingGateResult {gate, now, roomWindowEnd, roomWindowKnown} and the module query also reads m.duration_seconds. For timingGateCohortSection only, cohortModuleWindowEnd computes the room's boundary — base module: sectionStart + authoredSeconds; branch/roleless module: the section deadline (saveStageDeadline), the section deadline capping either one — and cohortModuleWindowSeconds clamps the new window to min(authored, max(0, boundary − gateNow)).
- backend/go/internal/delivery/start_submit.go: StartModule writes the clamped allocated_seconds in the existing not_started CAS update; SubmitModule/save paths now read the gate's instant from the result struct.
- Everything downstream already derives from started_at + allocated, so moduleDeadline/computeModuleTiming, reconcileCohortSectionExpiredTx, moduleRemainingSeconds, the admission gates and the server projections moved with it. cohort_stage_v2 and legacy_section_v1 are untouched (usesPersonalDeadline() is legacy-only).
- Consequence worth an audit line: allocated_seconds for a late joiner is the truncated window, so time-spent/allotment reports show the time they actually had — truthful, but not the authored length.

Phase 2 — Server: the candidate's module clock in the proctor projection (bug 2)
- backend/go/internal/proctor/sessions.go: studentSessionRow/sessionColumns read sat_module.adaptive_role; satModuleInts + satModuleClock project the module's own clock (deadline + remaining) from the same started_at/allocated/extension/accumulated window the delivery service hands the candidate. StudentSessionSummary gains runtimeModuleRole, runtimeModuleDeadlineAt, runtimeModuleRemainingSeconds (additive; all null outside SAT). A live module publishes a deadline, a paused one publishes its frozen remainder and no deadline, an unstarted one publishes neither. RuntimeCurrentSection semantics are unchanged, so the generic proctor dashboard, StudentCard and useStudentFilters keep working.
- Deviation from the plan sketch: no separate runtimeCurrentModuleKey/Title fields. The role names the slot the room talks in ("Module 1" / "Module 2 — Lower"), and the room falls back to the projection's existing currentSection (the authored module title) when no role is carried — one label rule instead of two.
- api/openapi/openapi.yaml does not document StudentSessionSummary, so there was nothing to mirror.

Phase 3 — Staff UI: section + module + live module clocks (bug 2)
- src/shared/hooks/useAuthoritativeDeadlineClock.ts: new useServerClockNowMs(serverNow) — the shared 1s tick corrected onto the server instant — so a surface with several windows (the run sheet's section, module and break rows) derives them all from one instant.
- src/products/sat/ui/sessionRunSheet.ts: every row carries remainingSeconds (only the row the room is inside has a running one — a finished or upcoming row reports null, never a 0:00 that reads as live); module rows are labelled by slot with the branch detail kept; formatRunSheetRemaining renders mm:ss / h:mm:ss / "—"; satRunSheetCurrentRows(sheet) exposes the current section, module and break rows; satModuleSlotLabel(role) names the slot. A paused section now places the module cursor at the pause instant rather than the wall clock, so a pause during Module 1 no longer marks the unreached Module 2 as the row the room is sitting in.
- src/products/sat/ui/SatRunSheet.tsx: new ticking Remaining column beside Start–end (ICT), the authored title line on module rows, and an optional `sheet` prop so the session room hands in the one projection its header also reads.
- src/products/sat/routes/SatSessionRoomRoute.tsx: the room builds one run sheet on its own ticking clock and passes it down. The stage header reads "Section 1 · Module 1 · module clock 12:00" (the hero figure stays the room's section clock, captioned as such); roster rows read "Reading & Writing · Module 1 · active" with the candidate's module clock as the row's figure and the shared section clock beneath it; the student detail panel separates Current section / Current module / Module clock / Section clock; the inspector gains a Current module row.
- src/products/sat/ui/sat-session-room.css: .sat-room__stage-slot, .sat-room__stage-clock-caption, .sat-room__row-sub.

Phase 4 — Tests
- src/features/student-delivery/hooks/__tests__/satTwoStudentEntry.test.tsx: the fake server now mirrors the clamp (a module window ends at the room's boundary: max(entry, roomBoundary)), and Part B asserts both students read the SAME room window (40/40, then 25/25, 20/20, +300 each) instead of the old entry-skewed 40/52 — keeping the cap, refresh, pause, resume and extension coverage.
- Go: internal/delivery/cohort_module_window_test.go — the boundary rule table (base vs branch vs longer-than-section vs unknown length), the window-clamp table (on-time, late, at/past the boundary, zero allotment), and four StartModule end-to-end cases through sqlmock pinning the written allocated_seconds (late join = 12 min, past boundary = 0, on-time = 32, branch capped by the section clock, branch honouring an extension). delivery timing_gate_dbclock_test.go / start_branch_module_test.go and proctor session_projection_test.go / rosterpage_test.go updated for the new shapes, including the paused-module and unstarted-module projections.
- Staff UI: sessionRunSheet.test.ts (module clocks, pause freeze, extension surplus, current rows, slot labels, formatting), SatRunSheet.test.tsx (Remaining column and the paused clock), SatSessionRoomRoute.test.tsx (section + module + both clocks in header, roster, detail and inspector; and no module clock for a student who has not started one).

Verification
- bun run typecheck; bunx eslint on every touched TS/TSX file: clean.
- bun run test:run: 5702 passing. Two failures are pre-existing on this branch and in files untouched by this work: src/test/architecture/feature-internal-boundary.test.ts (SatExamLibraryRoute.tsx → features/exam-authoring/application/authoringEntryIntent) and src/features/student-delivery/ui/__tests__/bluebookBans.test.ts (SatImageViewer.tsx uses backdrop-blur).
- cd backend/go && go test ./internal/delivery/... ./internal/proctor/...: green. go test ./... also shows three pre-existing failures outside these packages (cmd/worker Dockerfile topology, attempts verify-mode and platform config defaults — environment-dependent).

Phase 5 — Pre-entry half of bug 1: the promise must equal the grant

The earlier note here claimed "needs no server change" because the client has no
section start instant. That was wrong, and it was verified rather than inherited:
the bootstrap published NO window for a not-yet-started module (available_at and
started_at are both NULL, so moduleDeadline anchors nothing and deadlineAt /
remainingSeconds ship as null), and the delivered sections plus TimingSnapshot
carry no section start — only the active stage's deadline and remaining. So the
truth had to come from the server, and it now does.

- delivery.ModuleAttempt gains entryWindowSeconds, the read-side twin of the
  StartModule clamp, written by publishEntryWindows — which calls the SAME
  cohortModuleWindowEnd + cohortModuleWindowSeconds the write path clamps with,
  over the same runtime section rows (stageKey's section: actual_start_at,
  planned/extension/paused for the section deadline). It is published only for a
  not-yet-started module with an allotment in the ACTIVE section of a
  cohort_section runtime; a started module keeps its own deadlineAt, a section
  that has not opened publishes nothing, and a paused room publishes the frozen
  window the pause landed on. loadTiming now hands back the runtime's section
  rows (same sections leg — no extra statement, so the 11-read bootstrap budget
  is unchanged), and both assembly paths (Bootstrap, assembleBootstrap) publish.
- The field is additive: deadlineAt/remainingSeconds semantics for unstarted rows
  are untouched, so nothing already reading attempt timing moves — specifically
  satEntry.moduleAttemptEndedByOwnClock and breakRemainingSeconds, which both key
  off deadlineAt.
- Client, one decision point: satTimingPolicy.satModuleWindow resolves the claim
  to { seconds, source } — `granted` (the server's published window) or
  `authored` (the server said nothing: legacy, no attempt yet, a section that has
  not opened, a module that already started). No surface re-decides it: the
  controller exposes pendingModuleWindow (null only while no module is pending)
  and SatDirectionsScreen only formats what it is handed, so an authored length
  can never borrow the remainder language ("12 minutes left in this module · 27
  questions", or "No time left in this module" when the room has closed it).
- Client, one clock: domain/satTiming.drainSinceSnapshot is the single convention
  for a server-published duration — one real second per second since the payload
  landed, frozen while the clock it belongs to is stopped. The pre-entry window
  and the module's own snapshotRemainingSeconds fallback both go through it, and
  device skew cancels because both instants are read from the same local clock,
  while transit is absorbed because the server computed the number against its
  own instant. The pre-entry promise and the clock the student lands in therefore
  drain at one rate; the absolute-deadline path (serverClockOffsetMs) cannot
  apply pre-entry by construction, since a started module resolves to `authored`.
- Tests: Go — publishEntryWindows table (late/on-time/past-boundary/branch/
  paused/started/other-section/no-runtime-row/legacy/no-allotment) plus a
  wire-level assembleBootstrap test asserting the field reaches the payload;
  loadTiming callers assert the section rows ride back. TS — satTimingPolicy
  entry-window rules, SatDirectionsScreen copy for authored/granted/zero/
  sub-minute/no-window, and three controller tests: a late arrival (45s of a 60s
  fixture module), an already-closed module (0), and an unpublished window (the
  authored 60s, named `authored`) reach the screen instead of the authored
  length, plus the whole late-arrival path — a zero window is still entered, the
  room closes Module 1 on the shared clock, and the candidate lands in the routed
  branch module with no student action — so the fix cannot turn a wrong clock
  into a stranded candidate.
- Wire pin (the field name is a contract in two languages):
  TestModuleAttemptEntryWindowJSONKey marshals delivery.ModuleAttempt and asserts
  the literal key — `"entryWindowSeconds":720`, and `"entryWindowSeconds":null`
  for the unpublished case, never 0 — while satTimingPolicy.test.ts parses a RAW
  JSON payload (deliberately untyped, so tsc cannot catch a rename the wire would
  not) and asserts the same key is what the client reads. Renaming the tag on
  either side now fails a test instead of silently reverting the promise to the
  authored length.

Known boundary of this fix
- The claim is the module's ROOM window, which for Module 1 is the section start
  plus the authored length. It does not attempt to predict the branch a candidate
  will be routed into after Module 1 (that is the server's routing decision).
