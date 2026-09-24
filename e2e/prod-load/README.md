# Prod Load E2E (Real Exam Day)

This suite targets a real production environment and is intended for a **dedicated E2E tenant / cohort** only.

## Files

- `e2e/prod-data/prod-target.json` (tracked, **no secrets**): baseURL, scheduleId, examId, 100 students, 10 proctors, 1 editor.
- `e2e/prod-data/prod-creds.json` (untracked, **secrets**): editor + 10 proctor passwords.
  - Copy `e2e/prod-data/prod-creds.example.json` to `e2e/prod-data/prod-creds.json` and fill real values.

## Run (manual / controlled window)

1) Update `e2e/prod-data/prod-target.json` with the real `scheduleId` and `examId`.
2) Create `e2e/prod-data/prod-creds.json` locally (it is gitignored).
3) Start shards close together (within ~1 minute).

Example (6 shards):

```bash
E2E_PROD_RUN_ID=examday-2026-04-20 E2E_PROD_SHARD_COUNT=6 E2E_PROD_WORKERS=1 E2E_PROD_SHARD_INDEX=0 bun run e2e:prod-load
E2E_PROD_RUN_ID=examday-2026-04-20 E2E_PROD_SHARD_COUNT=6 E2E_PROD_WORKERS=1 E2E_PROD_SHARD_INDEX=1 bun run e2e:prod-load
E2E_PROD_RUN_ID=examday-2026-04-20 E2E_PROD_SHARD_COUNT=6 E2E_PROD_WORKERS=1 E2E_PROD_SHARD_INDEX=2 bun run e2e:prod-load
E2E_PROD_RUN_ID=examday-2026-04-20 E2E_PROD_SHARD_COUNT=6 E2E_PROD_WORKERS=1 E2E_PROD_SHARD_INDEX=3 bun run e2e:prod-load
E2E_PROD_RUN_ID=examday-2026-04-20 E2E_PROD_SHARD_COUNT=6 E2E_PROD_WORKERS=1 E2E_PROD_SHARD_INDEX=4 bun run e2e:prod-load
E2E_PROD_RUN_ID=examday-2026-04-20 E2E_PROD_SHARD_COUNT=6 E2E_PROD_WORKERS=1 E2E_PROD_SHARD_INDEX=5 bun run e2e:prod-load
```

Notes:
- Shard `0` runs the control plane by default (editor + 10 proctors). Student shards are `1..N-1`.
- To also run students on shard 0, set `E2E_PROD_RUN_STUDENTS_ON_CONTROL_SHARD=true`.

## Optional Bootstrap (create exam + schedule automatically)

If you want a full loop (create exam + publish + create schedule), run shard `0` with:

```bash
E2E_PROD_BOOTSTRAP=true E2E_PROD_ALLOW_BOOTSTRAP=true bun run e2e:prod-load
```

This writes `e2e/.generated/prod-runtime.json` with the new `examId` and `scheduleId`.
Other shards will automatically pick it up (or override via `E2E_PROD_RUNTIME_PATH`).

Important:
- This creates real data in the target DB. Use only in a dedicated E2E tenant.
- Proctor accounts must be assigned to the created schedule if your backend enforces schedule staff assignments for proctors.

## Provision Editor + Proctors via DB (generates unique passwords)

If you want fully automated staff setup (1 editor + 10 proctors) with unique passwords, use the backend helper.

This requires:
- `DATABASE_URL` pointing at the same DB your `baseURL` deployment uses
- explicit consent: `E2E_ALLOW_PROD_DB_MUTATIONS=true`

Example:

```bash
export DATABASE_URL='mysql://...'
export E2E_ALLOW_PROD_DB_MUTATIONS=true

# after bootstrap, read scheduleId from e2e/.generated/prod-runtime.json and provision:
cd backend/go
go run ./cmd/e2e_provision_staff -- \
  --schedule-id <SCHEDULE_ID> \
  --target ../../e2e/prod-data/prod-target.json \
  --output-creds ../../e2e/prod-data/prod-creds.json
```

Then run the Playwright shards (they will use `e2e/prod-data/prod-creds.json` for logins).

## Live 100-User Runner (Dashboard)

Reusable real-time runner driven by a register URL:

```bash
REGISTER_URL="https://your-host/student/<scheduleId>/register" \\
USERS_FILE="e2e/prod-load/live-users.example.csv" \\
USER_COUNT=3 \\
DASHBOARD_PORT=3333 \\
SCREENSHOT_INTERVAL_MS=1000 \\
JPEG_QUALITY=45 \\
LIVE_MODE=balanced \\
HEADLESS=true \\
HEADED_USERS=0 \\
bun run e2e:live-runner
```

Open dashboard:

```txt
http://localhost:3333
```

Required envs:
- `REGISTER_URL`
- `USERS_FILE`

Optional envs:
- `USER_COUNT` (default `100`)
- `DASHBOARD_PORT` (default `3333`)
- `SCREENSHOT_INTERVAL_MS` (default `1000`)
- `JPEG_QUALITY` (default `45`)
- `LIVE_MODE` (`balanced` default, `fast` = near real-time: `SCREENSHOT_INTERVAL_MS=250`, `JPEG_QUALITY=30`)
- `HEADLESS` (default `true`)
- `HEADED_USERS` (default `0`): mix mode. First N users run headed, rest run headless.
- `MAX_CONCURRENT_USERS` (default `20`): process users in a worker pool to avoid CPU/network spikes.
- `OUTPUT_DIR` (default `e2e/.generated/live-runner`)
- `NAV_TIMEOUT_MS` (default `30000`)
- `START_POLL_INTERVAL_MS` (default `1500`)
- `START_TIMEOUT_MS` (default `1200000`)

Mixed example (3 visible browsers + rest headless):

```bash
REGISTER_URL="https://your-host/student/<scheduleId>/register" \\
USERS_FILE="e2e/prod-load/live-users.500.csv" \\
USER_COUNT=50 \\
HEADLESS=true \\
HEADED_USERS=3 \\
MAX_CONCURRENT_USERS=20 \\
LIVE_MODE=balanced \\
bun run e2e:live-runner
```

## Live SAT Runner (Access-Link + continuous answering)

Same monitor grid (`live-dashboard-server.ts`), SAT-shaped entry + answering.
Bots join via the SAT Student Link (`/join/:accessLinkId`), wait for the
proctor to start, then keep answering (radios cycle, SPR textbox fill, Next
question loop) across module handoffs and the scheduled break until
`SAT Complete`.

```bash
SAT_JOIN_URL="https://your-host/join/<accessLinkId>" \\
USERS_FILE="e2e/prod-load/live-users.sat.example.csv" \\
USER_COUNT=3 \\
DASHBOARD_PORT=3333 \\
MAX_CONCURRENT_USERS=10 \\
HEADLESS=true \\
HEADED_USERS=0 \\
EXAM_TIMEOUT_MS=9000000 \\
bun run e2e:live-sat-runner
```

Open dashboard:

```txt
http://localhost:3333
```

Required envs:
- `SAT_JOIN_URL` (`REGISTER_URL` accepted as fallback)
- `USERS_FILE` (`userId,email,password,candidateId` — `candidateId` is the student code on `student_code` links)

Optional envs: same as IELTS runner, plus `EXAM_TIMEOUT_MS` (default `9000000` = 150 min for a full SAT),
`CONTEXTS_PER_BROWSER` (default `5`), `ABORT_ON_FATAL_JOIN` (default `true`), and
`JOIN_FAILURE_ABORT_THRESHOLD` (default `8`).

### Browsers

Contexts are spread across a small pool of Chromium instances
(`ceil(MAX_CONCURRENT_USERS / CONTEXTS_PER_BROWSER)`). A crashed instance is
replaced automatically and only costs its own contexts — one shared browser
used to fail every in-flight bot at the same instant.

### Prerequisite: the exam window must be open

Bots can only join while the **schedule** is `scheduled` or `live`. The moment
the proctor (or the SAT clock) completes the run, `exam_schedules.status`
becomes `completed` and every entry attempt is rejected with
`409 Registration is closed for this schedule.` — which the entry page renders
as *"Registration is closed for this schedule."* The Student Link itself can
still look `live`, and the join form still renders, so this is easy to misread
as a bot bug.

Before every load run:

1. Create/open a schedule for the exam (or bootstrap a fresh one) so it is
   `scheduled`.
2. Publish (or reuse) the Student Link and start the SAT session from the
   proctor UI.
3. Point the runner at that link's `/join/<accessLinkId>` URL, then start the bots.

When entry is refused for a run-scoped reason (registration closed, link ended,
paused, not open yet) the runner now aborts instead of grinding through 100
two-minute retry loops:

- the operator log/control panel prints `ABORTING RUN — <code>: <reason> Fix: <hint>`,
- remaining students are reported as `skipped` on the monitor,
- the summary JSON gains `aborted`, `abortReason`, and `skipped`,
- the process exits with code `3` (the control badge turns red).

Set `ABORT_ON_FATAL_JOIN=false` to keep running the rest of the roster anyway.
A run where nothing at all is admitted also aborts once
`JOIN_FAILURE_ABORT_THRESHOLD` students have failed.

## SAT Settings UI

Start the local control panel, set the Student Link URL, roster, student count,
concurrency, screenshot frequency, and timeouts in the form, then choose
**Start students**. All browsers are headless. **Stop all** terminates the
runner and its browser process group.

```bash
bun run e2e:live-sat-control
```

Open `http://localhost:3333`. The student screenshot grid is embedded in the
page and also runs on `3334`. The controller binds to localhost by default.

Run settings can be prefilled from the control URL (query values override the
settings this browser saved last):

```txt
http://localhost:3333/?joinUrl=https%3A%2F%2Fhost%2Fjoin%2F<accessLinkId>&usersFile=e2e%2Fprod-load%2Flive-users.500.csv&userCount=100&userOffset=0&maxConcurrentUsers=15&screenshotIntervalMs=5000&jpegQuality=30&startTimeoutMinutes=20&examTimeoutMinutes=150
```

Recognised keys: `joinUrl`, `usersFile`, `userCount`, `userOffset`,
`maxConcurrentUsers`, `screenshotIntervalMs`, `jpegQuality`,
`startTimeoutMinutes`, `examTimeoutMinutes`. Unknown or out-of-range values are
ignored and the form keeps its previous/default setting.
