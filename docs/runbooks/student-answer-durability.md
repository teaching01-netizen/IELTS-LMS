# Runbook: student-answer durability (repair plan WP9)

Scope: staged rollout, monitoring, rollback, and incident triage for the
WP1–WP5 durability repair. Backend contract unchanged
(`backend/go/internal/attempts/service.go` fencing, version uniqueness,
writeId idempotency, monotonic projection, superseded acks) — pinned by
`backend/go/internal/attempts/durability_contract_test.go`, not changed.
Rollback is a client-bundle redeploy; no migration exists to reverse.

## 1. Staged rollout

No backend migration ships with this change (contract unchanged), so every
stage deploys the same API with a new client bundle. New browser storage keys
are namespaced (`response-checkpoint:v2:*`, `v2_attempt_*`,
`v2_quarantine:*`) so old cached bundles ignore them; old cached clients
keep working against the unchanged backend contract.

| Stage | Cohort | Entry criteria | Exit criteria (all must hold) |
|---|---|---|---|
| 1. Dogfood | Internal staff / synthetic attempts | Focused suites green (engine/provider tests, `go test ./internal/attempts ./internal/runtime`); redaction test green | Zero confirmed loss/rollback events; no archive-fault spike; no submit-gate anomaly; no new support reports of "answer disappeared" |
| 2. Pilot | One small live cohort (single schedule) | Dogfood exit met; dashboards in §3 live; on-call briefed on §4 | Same as dogfood, sustained over the pilot window, plus baseline parity on `version_collision` / `control_epoch_blocked` (timing-only reconcile noise, not loss) |
| 3. Full | All schedules | Pilot exit met; rollback bundle staged (§5) | Sustained parity for one full exam window; any rollback trigger (§5) pulls the rollout back immediately |

Do not skip stages. A stage that hits any rollback trigger returns to the
previous client bundle per §5; re-entry restarts at stage 1.

## 2. Rollback

Triggers — any ONE rolls back:

1. A confirmed new loss event: a visibly accepted answer/flag/elimination/
   annotation is replaced, dropped, or relabeled "saved" without a server
   ack (invariant I4 violated).
2. An archive-fault spike: sustained rise in `quarantine_archive_failed`
   or `durability_fault` above the dogfood baseline.
3. A submit-gate anomaly: blocked/quarantined drafts silently excluded from
   submit, or the gate refuses to engage when blocked drafts exist.

Action: redeploy the previous client bundle. No migration to reverse, no
data backfill, no server flag flip. Old and new bundles interoperate against
the same API. After rollback, preserve the incident evidence in §4 before
any storage clearing, then re-enter at stage 1 with a fix.

## 3. Monitoring

Reason-coded counters only — never answer text or student PII in telemetry
(WP7; `emitAnswerMutationDebugLog` redacts by field name under a default-deny
+ allowlist sanitizer in `src/components/student/answerMutationDebug.ts`,
proven by `src/components/student/__tests__/answerMutationDebug.redaction.test.ts`).
The debug log is gated at runtime by the `student.answerMutationDebug`
storage flag (`localStorage` OR `sessionStorage` set to `1`/`true`/`on`);
the flag is settable in prod, so prod safety rests on the sanitizer
(default-deny + allowlist, IDs-only contract), not on a build gate.
Watch the following series, sliced by reason code where applicable:

- `intent_queued_during_recovery` — input accepted while recovery is
  unseeded (expected during slow snapshots; a flat zero during recovery
  windows is suspicious, a runaway rise means recovery never seeds).
- `version_collision` (`VERSION_COLLISION` / outcome `version_collision`) —
  reused client version under a different writeId. Occasional hits are the
  fence working; a spike from a single client build means version seeding
  regressed (see exam-day load watch for single-client collision spikes).
- `control_epoch_blocked` (`CONTROL_EPOCH_STALE` / outcome
  `control_epoch_stale`) — batches fenced by a pause/resume boundary.
  Expected around proctor actions; reconcile (§4) should follow.
- `reconcile_succeeded` / `reconcile_failed` — per-question reconcile
  after a timing-only control change (fresh snapshot → fresh version under
  the new epoch, new writeId). Failed > 0 sustained needs triage.
- `quarantine_archived` / `quarantine_failed` (`quarantine_archive_failed`) —
  archive-before-delete outcomes for rejected writes. Any sustained
  `quarantine_failed` is a rollback-trigger candidate (§2).
- `checkpoint_sync_failed` / `durability_fault` — sync intent checkpoint
  or storage write failures. Any sustained rise pages storage triage.

Backend outcome vocabulary for correlation (plan 69): `accepted`,
`exact_replay`, `retried_accepted`, `lease_fenced`,
`control_epoch_stale`, `version_collision`, `write_id_conflict`,
`not_writable`, `rejected`.

Alert posture: dashboard per counter above with dogfood baselines recorded
at stage entry; alert on (a) any confirmed loss event, (b) archive/checkpoint
fault spikes, (c) submit-gate anomaly. Support-ticket watch: any "answer
disappeared / answer changed itself / flagged as saved but lost" report is a
P1 until §4 triage rules out loss.

Alerting note: slice `quarantine_failed` by `reason` (e.g.
`quarantine_archive_failed`) so archive-before-delete faults are
separable from other quarantine outcomes. `durability_fault` is a sync
STATUS (`DurableResponseEngine.getStatus()`), not a counter — alert on
`quarantine_failed` / `checkpoint_sync_failed` counter movement and use
the `durability_fault` status for correlation, not as a thresholded count.

## 4. Incident triage (suspected answer loss)

Preserve evidence FIRST — before clearing anything on the affected machine:

1. Export browser storage keys `response-checkpoint:v2:*`,
   `v2_attempt_*`, `v2_quarantine:*` (plus the quarantine list and the
   mutation ledger / outbox if reachable). Do NOT clear site data first;
   clearing destroys the tombstones and checkpoints that distinguish loss
   from honest blocking.
2. Correlate, in order:
   - Server acks: `VERSION_COLLISION`, `CONTROL_EPOCH_STALE`,
     `LEASE_FENCED`, `superseded` (canonical current in the ack),
     `duplicate` (exact writeId replay, no double-apply).
   - Control events: pause/resume/extend/takeover bumps around the incident
     window (lease vs control epoch tells takeover apart from timing-only).
   - Client mutation ledger: writeId/version/epoch per question vs the
     seeded snapshot versions.
3. Classify:
   - UI rollback (not loss): visible draft replaced by an older local draft
     during recovery — checkpoints show the newer intent was never queued;
     fix is in recovery seeding, not storage.
   - Rejected write (not loss if surfaced): ack is `VERSION_COLLISION` /
     `CONTROL_EPOCH_STALE` / `LEASE_FENCED` and the draft sits visible in
     `blocked_attention` / `conflict` / quarantine. Expected UX is the
     blocked banner + reconcile path, not a resend under the old epoch.
   - Replaced confirmed answer: a server-acked write later shows different
     content — treat as P1; capture the ledger + projection rows.
   - Permanent loss: accepted intent has no checkpoint, no ledger entry, no
     quarantine record, and no server ack. Page immediately; this is the
     only category that meets rollback trigger 1.

Reconcile rule: timing-only control changes reconcile via fresh snapshot +
fresh version as a NEW writeId/version under the new epoch. Never replay
across a lease change or a terminal fence.

## 5. Status vocabulary (what the UI may say)

Fixed vocabulary (both providers via the shared mapper): `saving`,
`saved_locally`, `blocked_attention`, `conflict`, `saved`, `error`.

- `saving` — write in flight, no ack yet.
- `saved_locally` — checkpointed on this device, NOT yet server-acked.
  Never display as "saved".
- `blocked_attention` — needs the student: control-epoch reconcile pending,
  quarantined draft, or storage fault. Draft is visible and non-sendable
  until resolved.
- `conflict` — fenced/terminal/superseded outcome; the canonical server
  state is shown alongside the kept local draft.
- `saved` — server-acknowledged ONLY (I4). Nothing else may use this word.
- `error` — durable failure requiring retry/support (e.g. storage fault
  after archive failure).

Any UI copy claiming "saved" for unacked work is a must-fix defect, not a
wording nit.

## 6. Recovery-panel scope note (this lane)

Providers already expose the recovery surface the panel needs:
`blockedQuestionIds` / `quarantinedCount` / `reconcileBlockedResponse` on
the student attempt provider plus the submit gate that refuses silent
exclusion of blocked/quarantined drafts (§2 trigger 3). Panel UI itself
(recovery-panel buttons/screens) is follow-up work and out of scope for
this lane; wire the existing provider surface when that follow-up lands.
