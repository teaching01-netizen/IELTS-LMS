# Production test plan

## Database

No schema change is required. Migration `0131_sat_room_retakes_and_answer_keys.sql`
already defines `sat_activity_policies`, `sat_attempt_learning`,
`sat_practice_students`, and `sat_practice_start_receipts`; it adds
`unlimited_retakes`, `pause_on_leave`, `sat_learning_defaults`, and
`sat_student_paused_at`. `0132` and `0133` are preserved unchanged.

Release lineage: `0117`–`0120`, then `0131`–`0133`. The local unpublished
`0128`–`0130` were not imported; this branch has no new migration.

Upgrade rehearsal (already run on disposable MySQL 9.6.0):

```bash
mysql -e 'CREATE DATABASE ielts_sat_live2 ...'
DATABASE_URL='root@unix(/path/mysql.sock)/ielts_sat_live2?...' \
  go run ./cmd/migrate
DATABASE_URL='...' go run ./cmd/migrate --validate-only
```

Before a release claim, repeat on a production-shaped schema with applied-history
metadata and seeded policy/attempt rows, and compare the Railway migration
ledger. This is still **unverified** for Railway.

## Go

```bash
cd backend/go
TEST_MYSQL_DSN='user:pass@tcp(host:3306)/disposable?parseTime=true&multiStatements=true&loc=UTC' \
go test -count=1 ./internal/satlearning ./internal/exams ./internal/schedules \
  ./internal/accesslinks ./internal/delivery ./internal/results ./internal/terminalization \
  ./cmd/api ./cmd/migrate
```

Required cases beyond the current suite:

1. Barrier-driven exam save vs. room creation and vs. room PUT: exactly one
   order wins, and the room ends with either the old or the new defaults, never
   a torn mix.
2. Two API processes: commit on A, observe on B within the poll interval.
3. Pause revocation with a running personal timer: deny a new pause, allow a
   paused student to resume, and preserve flush/timer accounting.
4. Submit while results are off, turn results on, run `RepairClassroomResults`,
   and assert the pending report is released with the room predicate.
5. Lost ACK after commit and a stale retry with the original revision: one
   change, one conflict; reload then edit succeeds.
6. Lock timeout/rollback after the first room write: no durable room change.

## Bun

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test:run
bun run build
```

## Browser

```bash
DATABASE_URL='...' TEST_DATABASE_URL='...' \
SAT_LIVE_SETTINGS_E2E_DISPOSABLE=1 \
bunx playwright test --config playwright.sat-live-settings.config.ts \
  --project=chromium --workers=1
```

The current spec covers exam-save fan-out to two rooms, live results
revocation/re-enable on a connected completion screen, room-only scope, and
pause on/off with resume. Add before release:

1. Two staff contexts: edit a **published** exam while its room runs; verify
   the room dialog reports room-only scope, a stale room save shows the
   conflict recovery, and reapplying the draft succeeds.
2. Shared-timer room: turning retakes on does not grant a timed retake.
3. A student who submitted while results were off: after enablement, the report
   appears after the repair pass.
4. A previously prepared keyed PDF: revoke the key, download the old link, and
   assert the server withholds it (the client link may still exist until the
   next poll; the serve-time gate is the guarantee).
5. Keyboard dismissal of both dialogs restores focus.
6. Hold an older result response, commit a revocation, accept the new revision,
   release the old response: no score or key returns. Repeat after reconnect and
   with two API instances.
7. Record commit-to-observation p50/p95/p99 and DB lock waits at the maximum
   rooms-per-exam in the test profile.

## Production-like

Exercise at least two API processes with production-equivalent DB isolation,
read routing, and cache configuration. Record deployment version compatibility,
foreground poll load, policy-save latency, lock waits, and recovery after
dropped responses. Confirm the Railway migration head and running revision
before any release claim.
