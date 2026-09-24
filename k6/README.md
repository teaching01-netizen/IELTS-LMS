# k6 Prod Load Suite

This folder contains API-level production load tests for the IELTS proctoring flow.
The scripts drive the same backend endpoints as the UI, so they are useful for latency, throughput, and data-consistency checks.

Important limits:
- k6 does not validate browser rendering, permissions, or client routing.
- These runs mutate real schedule/runtime state.
- Use a dedicated production E2E tenant and a dedicated schedule per scenario run.

## Scenarios

### SAT personal module entry, 2,000 candidates

`k6/sat-module-entry-2000.js` exercises one synchronized module entry per
candidate, including Start, Enter, visibility ACK, and the authoritative
entry-state read. It checks branch uniqueness/correctness in adaptive mode and
simulates a lost Start or Enter response in the recovery modes. Give each VU a
different bearer credential in a local JSON array:

```json
[{"attemptId":"attempt-1","token":"bearer-token-1","expectedBranch":"higher","expectedModuleId":"module-higher-id","otherModuleId":"module-lower-id","expectedResponseCount":27}]
```

Use a fresh SAT personal schedule and 2,000 pre-admitted attempts for each run.
For adaptive mode, prepare those attempts at the end of the preceding personal
module; `K6_WAVE_AT_MS` must equal the expected expiry time in Unix milliseconds.
The selected and alternate module IDs, expected branch, and number of saved
Module 1 responses are required for every adaptive credential. Adaptive VUs
poll the entry-state row until the worker creates the branch, then perform one
Bootstrap to verify branch and response integrity. Run each mode on a
fresh cohort, since entry changes attempt state.

```bash
k6 run \
  -e K6_BASE_URL=https://staging.example.com \
  -e K6_SCHEDULE_ID=<schedule-id> \
  -e K6_ATTEMPT_TOKENS_PATH=/absolute/path/to/attempt-creds.json \
  -e K6_VUS=2000 \
  -e K6_MODE=initial \
  -e K6_WAVE_DELAY_SECONDS=120 \
  k6/sat-module-entry-2000.js
```

Set `K6_MODE` to `adaptive`, `lost-start`, or `lost-enter` for the other gates.
This is a controlled staging load test that mutates attempts. The k6 latency
metric ends at the visibility ACK and is a protocol proxy. To gate the actual
first answerable browser frame, run `e2e:live-sat-runner` with
`SAT_ASSERT_ENTRY_FRAME=true` and inspect `answerableFrameP95Ms`,
`answerableFrameP99Ms`, and `answerableFrameMaxMs` in its summary. The browser
runner collects each module's frame event, including adaptive modules.

Before the 2,000 candidate run, set `SHED_MODE=exam` and `VERSION_CACHE=on` and size
`DB_POOL_MAX_API`, `DB_POOL_MAX_WORKER`, and `DB_POOL_MAX_IDLE` from the actual
database connection budget. Reserve worker capacity so expired personal
modules can finalize without competing with entry writes. Record the deployed
settings and database saturation alongside the k6 output; a local `k6 inspect`
only checks script configuration and does not establish the latency gate.

- `k6/prod-start-exam-200.js`
  - 200 students in the waiting room
  - measures propagation from `runtime.actualStartAt` to student visibility of `live`
  - threshold: `start_exam_propagation_ms max < 2000`

- `k6/prod-section-transition-200.js`
  - 200 students
  - uses proctor `end-section-now` as the proxy for section-zero transition
  - threshold: `section_transition_ms max < 2000`
  - requires a schedule that accepts section override actions; authentic IELTS mode rejects the endpoint

- `k6/prod-submit-storm-200.js`
  - 200 students
  - near-simultaneous submit storm
  - thresholds: `submit_request_ms p(95) < 2000`, `submit_request_ms max < 10000`
  - verifies `attempt.submittedAt`, `answers`, `writingAnswers`, and `finalSubmission`

- `k6/prod-resume-100.js`
  - 100 students
  - simulates browser close by pausing requests, then refreshing attempt credentials with a new `clientSessionId`
  - verifies attempt identity and prior state survive the resume path

- `k6/prod-auto-submit-200.js`
  - 200 students
  - proctor completes the exam and the backend auto-submits the cohort
  - verifies `attempt.submittedAt` and `finalSubmission`

## Data

- `e2e/prod-data/prod-target.json` contains the non-secret target data, including 200 students.
- `e2e/prod-data/prod-creds.json` contains the login secrets and remains untracked.

## Safety gate

Set `K6_CONFIRM_PROD=true` before running any scenario. The scripts refuse to run without it.

## Common overrides

- `K6_BASE_URL` defaults to `prod-target.json.baseURL`
- `K6_SCHEDULE_ID` defaults to `prod-target.json.scheduleId`
- `K6_REGISTER_URL` can be set to a student registration link like `/student/<scheduleId>/register`; the scripts derive both base URL and schedule ID from it
- `K6_AUTO_REGISTER=true` enables a pre-registration bootstrap step before the load test starts
- `K6_TARGET_PATH` defaults to `e2e/prod-data/prod-target.json`
- `K6_CREDS_PATH` defaults to `e2e/prod-data/prod-creds.json`
- `K6_STUDENTS` controls the student count for each run
- `K6_STUDENT_OFFSET` slices into the student list for smaller shards
- `K6_RUN_ID` labels the run in logs and request reasons
- `K6_DEBUG=true` enables extra logging
- `K6_REALISTIC_MODE=true` sends incremental typing-style answer mutations before submit
- `K6_REALISTIC_TYPE_STEPS` controls typing chunks per answer/writing field (default `8`)
- `K6_REALISTIC_STEP_PAUSE_MS` pause between typing chunks (default `400`)
- strict answer integrity verification is now enabled by default in `prod-submit-storm-200.js`:
  - verifies all objective answer keys and all writing task keys
  - canonicalized comparison (`\\r\\n`/`\\r` -> `\\n`, trim outer whitespace, preserve internal spacing)
  - objective answers are sent as array-style `SetChoice` payloads by default
- `K6_MAX_TARGET_KEYS_PER_USER` guards pathological snapshots (default `400`)
- `K6_DIFF_DEBUG_RAW=true` includes raw expected/actual values in mismatch artifacts (default is hashed output only)

## Typical runs

Start exam:

```bash
K6_CONFIRM_PROD=true \
K6_STUDENTS=200 \
K6_CHECKED_IN_THRESHOLD=200 \
k6 run k6/prod-start-exam-200.js
```

Section transition:

```bash
K6_CONFIRM_PROD=true \
K6_STUDENTS=200 \
K6_CHECKED_IN_THRESHOLD=200 \
k6 run k6/prod-section-transition-200.js
```

Submit storm:

```bash
K6_CONFIRM_PROD=true \
K6_STUDENTS=200 \
K6_CHECKED_IN_THRESHOLD=200 \
k6 run k6/prod-submit-storm-200.js
```

Submit storm with realistic typing cadence:

```bash
K6_CONFIRM_PROD=true \
K6_STUDENTS=200 \
K6_CHECKED_IN_THRESHOLD=200 \
K6_REALISTIC_MODE=true \
K6_REALISTIC_TYPE_STEPS=10 \
K6_REALISTIC_STEP_PAUSE_MS=300 \
k6 run k6/prod-submit-storm-200.js
```

Resume after browser close:

```bash
K6_CONFIRM_PROD=true \
K6_STUDENTS=100 \
K6_CHECKED_IN_THRESHOLD=100 \
k6 run k6/prod-resume-100.js
```

Auto-submit:

```bash
K6_CONFIRM_PROD=true \
K6_STUDENTS=200 \
K6_CHECKED_IN_THRESHOLD=200 \
k6 run k6/prod-auto-submit-200.js
```

Run with Playwright live runner together:

```bash
K6_CONFIRM_PROD=true \
K6_SCRIPT=k6/prod-start-exam-200.js \
REGISTER_URL="https://your-host/student/<scheduleId>/register" \
USERS_FILE="e2e/prod-load/live-users.500.csv" \
USER_COUNT=100 \
bun run e2e:live-with-k6
```

Notes:
- `e2e:live-with-k6` starts k6 in background, then runs Playwright live runner.
- Override k6 scenario with `K6_SCRIPT=...` (default `k6/prod-start-exam-200.js`).
- Logs are written automatically:
  - k6: `e2e/.generated/live-runner/k6-<timestamp>.log`
  - live runner events: `e2e/.generated/live-runner/live-runner-<timestamp>.log`

## Notes

- The scripts assume the schedule is assigned to at least one proctor/editor account in `prod-creds.json`.
- If you reuse the same schedule for multiple scenarios, later runs will not be meaningful because the earlier run mutates runtime state.
- The section-transition scenario intentionally relies on `end-section-now`; if the backend returns a validation error about IELTS authentic mode, use a schedule that allows section overrides.
