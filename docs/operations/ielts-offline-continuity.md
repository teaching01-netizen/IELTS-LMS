# IELTS shared clock and offline continuity — operations

> Scope: rooms created with `ielts_shared_schedule_v1` (plan
> `docs/superpowers/plans/2026-10-30-ielts-shared-clock-offline-continuity.md`).
> Existing IELTS and SAT/ACT rooms are unchanged.

## What the room promises

- One committed room timetable (`exam_session_runtimes.ielts_shared_schedule`)
  gives every ordinary candidate identical absolute section windows. Readiness,
  heartbeats, uploads and reconnects never move it (FR-1, FR-2, INV-1).
- A prepared device can cross each committed boundary with no network and
  survives a same-browser hard reload: pinned shell, pinned content version,
  verified media and durable drafts restore without restarting a deadline
  (FR-3, FR-4).
- Answers stay durable offline. Writes the server refuses after the window or
  a control change are retained as unscored evidence, never silently dropped
  or silently scored (FR-5, FR-6).
- Local completion reads “saved on this device · pending sync”, never
  “submitted”. Only a server receipt says submitted (FR-7).
- A known pause/end/transfer received on reconnect outranks cached permission;
  an offline device may temporarily continue on its last revision (FR-8).
- Proctors see per-device offline preparation and pending evidence, plus a
  warning that disconnected students may still follow the previous timetable.
  These are diagnostic and never block a command or a room transition (FR-9).

## Download failures are silent (2026-10-31)

The offline package is a cache-like capability. A failed download is a cache
miss for that device, never an exam event, and it has no student-facing
surface (plan
`docs/superpowers/plans/2026-10-31-ielts-offline-download-silent-failure.md`,
which supersedes the manual retry in the 2026-10-30 plan).

- **Nothing is shown and nothing is announced.** No text, button, modal, toast
  or live-region message reports a preparation failure. Real offline/save
  status ("You're offline…", "Saved on this device…", clock-estimate wording)
  is still shown because it is not a download error.
- **Bounded automatic retry.** One initial attempt plus three retries for the
  same package identity, at roughly 5s, 20s and 60s with ±20% jitter. Retries
  happen only while `navigator.onLine` is true; a reconnect resumes
  immediately. A new package identity (attempt, version, browser session,
  lease, recovery run or content digest) resets the budget.
- **Only transient reasons retry:** `shell_unavailable`, `media_failed` and
  `storage_failed`. `quota`, `audio_unavailable`, `identity_mismatch`,
  `manifest_invalid`, `cancelled` and `unexpected` stop immediately for that
  identity.
- **Retries are cheap.** Verified Cache Storage bytes are reused; a retry only
  downloads what is missing. Media downloads are `priority: 'low'` with a
  two-request cap so an answer save, heartbeat or runtime poll never queues
  behind a package.
- **No exam effect.** A failure or retry never changes the projected runtime,
  the committed timetable, answer durability or navigation.
- **Terminal room state stops everything.** No attempt starts (and any timer is
  cleared) once the attempt is submitted or the runtime is completed or
  cancelled, or when the page unmounts.

Operators see this only through telemetry. Per-room, compare
`ielts_offline_preparation` coverage with the roster's offline-ready count: a
device that never prepares is online-only and reloads from the network. Accept
that state per the product decision; do not add a student-facing retry without
revisiting the plan.

## Deliberate limits (must be explained to operators and candidates)

1. **Future content is on the device.** Caching lets a device hold sections
   before their UI opens. Only enable this model for exams whose content
   exposure policy allows it, or on managed devices.
2. **A disconnected device can lag a control change.** Pause/end/transfer is
   enforced immediately on the server and on reconnect, but a device that is
   fully offline cannot learn it live. Conflicting work becomes evidence.
3. **Only durable writes survive.** A crash before the local transaction
   completes, cleared site data, private-mode eviction, disk failure or moving
   to another computer cannot be repaired from browser storage.
4. **Offline time is provisional.** Native clocks are not trusted grading
   evidence. After a full offline restart the browser uses a persisted wall
   anchor, marks the run clock-unverified and reconciles on reconnect. No crash
   or disconnect time is automatically credited; use the existing staff
   recovery controls for a deliberate award.
5. **There is no offline admission or device transfer.** New students and staff
   recovery follow the existing authenticated flows.

## Rollout

1. Deploy the additive migration (`0114_ielts_shared_schedule.sql`) and the new
   server readers with `IELTS_SHARED_SCHEDULE` unset. Old rooms keep their
   stored timing model.
2. Deploy the client bundle and service worker. Confirm the offline shell
   installs and a prepared package appears in a rehearsal room.
3. Enable `IELTS_SHARED_SCHEDULE=true` only for the environment that creates
   rehearsal rooms. `IELTS_PERSONAL_TIMING` must be off for that environment;
   both flags on returns `IELTS_TIMING_FLAGS_CONFLICT` and refuses to create a
   room.
4. Create a new IELTS room (do not convert a running room), start it, prepare
   two browsers, and run the acceptance checks below. Confirm evidence review
   staffing and the future-content policy before expanding.
5. Observe per-room: preparation failures by reason, offline restore outcomes,
   clock uncertainty, transition lag, evidence backlog and server refusals.
   Compare with an online control room using the same authored durations.

Rollback: stop selecting the model for new rooms. Keep the column, server
readers and client support until every active shared room has finished. Never
rewrite an active room to a legacy/personal clock, drop the schedule column or
delete cached drafts.

## Required acceptance evidence

| Scenario | How to run | Pass condition |
| --- | --- | --- |
| Shared windows identical, boundaries exact | `go test ./internal/runtime` | start/deadline/save-only/gap/final vectors and malformed schedules pass |
| Missing readiness or device does not delay the room | runtime + real-MySQL shared schedule tests | committed windows served without waiting for another device |
| Stale projection still gates answers correctly | `go test ./internal/attempts ./cmd/api` | committed schedule wins at transaction time |
| Prepared device crosses a boundary offline | `bunx playwright test e2e/ielts-shared-offline.spec.ts --config playwright.ielts-offline.config.ts` | Reading opens with network disabled, no new duration, no `/ready` dependency |
| Hard offline reload | same browser profile | pinned shell/content, durable draft and provisional clock restore |
| Missing/corrupt/partial media | package/media unit tests | device defers silently with no student-visible text, room unaffected, no unverified audio plays |
| Evidence, replay and dupes | durability suite | exact ack clears only its write; old/late writes stay evidence |
| Auth denial with a cached package | route/security tests | no cached admission; no staff-route access |
| New deployment during an active exam | rehearsal with a second build | active pinned build and drafts retained |

The production-preview suite requires an isolated `TEST_DATABASE_URL` and the
seeded `ieltsSharedScheduleId` fixture (`backend/go/cmd/e2e_seed`). It builds
the bundle and serves it with `vite preview`; a Vite dev server cannot exercise
the service worker. A skipped suite is not acceptance evidence.

## Per-device and proctor states

- **Offline ready**: the browser verified content, required media, shell and
  answer storage for the named section. Shown on the roster from the readiness
  row; it may be older than the current timetable revision.
- **Needs review**: retained, unscored drafts are in the evidence ledger.
  Review them at the existing staff evidence endpoint (`attempt_draft_evidence`).
  Review never applies an answer or changes a score.
- **Saved on this device**: durable locally, not server-acknowledged.
- **Saved to server**: the server acknowledged the listed writes; this is not
  an exam submission receipt.
- **Submitted**: a server submission receipt exists.

## Cleanup and recovery

- After a server submission receipt with nothing pending and every evidence
  batch acknowledged, the client removes its offline package, attempt-scoped
  media cache and pinned shell build. Answers and quarantined drafts live in
  the durability store and are not touched.
- Pending drafts/evidence are never purged by age, room completion or logout.
  Logout blocks access to old packages but leaves unsent work for the existing
  authenticated/staff recovery path.
- One student can be recovered without pausing the room: use the existing
  attempt recovery and device-transfer controls; the shared timetable does not
  grant a new duration on reconnect.

## Telemetry

Client (redacted, low-cardinality): `ielts_offline_preparation` (reason,
attempt, latency), `ielts_offline_preparation_exhausted` (reason, attempt),
`ielts_offline_prepared_report`, `ielts_offline_restore` (reason),
`ielts_clock_uncertain` (confidence), `ielts_section_preparation`,
`ielts_section_boundary_save`, `ielts_boundary_checkpoint_failed`.
No answer content, candidate names, signed URLs or credentials are emitted.
Server: `ielts_section_activation_delay_seconds`,
`ielts_shared_projection_lag_total` (a timetable read whose materialized
section row is behind) and existing runtime/worker metrics. A delayed
projection is diagnostic: reads and write gates resolve from the committed
schedule, not from the stale row.

## Implementation evidence (2026-10-30)

- `go test ./internal/runtime ./internal/schedules ./internal/proctor ./internal/attempts ./internal/delivery ./cmd/api` passed.
- Real MySQL 9.6, fresh migrated schema: `TestIELTSSharedSchedule*`,
  `TestIELTSSharedTransition*` and `TestIELTSFastTransition*` passed, including
  the no-readiness advance, start/pause/resume and boundary race cases.
- `go test ./cmd/migrate` passed on real MySQL with scratch-schema privileges.
- `bun run typecheck`, architecture guards (37 tests), the full frontend suite
  (7,463 passed / 2 skipped) and `bun run test:student-bundle` passed.
- `bunx playwright test e2e/ielts-shared-offline.spec.ts --config
  playwright.ielts-offline.config.ts` passed against `vite preview` with the
  service worker enabled: a real Listening→Reading boundary crossed with the
  network disabled after a hard reload, the acknowledged answer restored, and
  the clock did not restart.

Use a fresh isolated schema per MySQL run. Running every Go package in
parallel against one shared schema can let SAT fixture tests delete each
other's global routing policy; that is test isolation, not a product failure.
