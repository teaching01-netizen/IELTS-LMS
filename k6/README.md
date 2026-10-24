# k6 Prod Load Suite

This folder contains API-level production load tests for the IELTS proctoring flow.
The scripts drive the same backend endpoints as the UI, so they are useful for latency, throughput, and data-consistency checks.

Important limits:
- k6 does not validate browser rendering, permissions, or client routing.
- These runs mutate real schedule/runtime state.
- Use a dedicated production E2E tenant and a dedicated schedule per scenario run.

## Scenarios

### SAT device transfer burst

`k6/sat-device-transfer.js` drives one ownership change per student: device A
enters (authorized), device B enters with the same identity (must be blocked),
B requests a transfer, staff approves with the unconfirmed-answer
acknowledgement, B commits, then retries the commit (must recover at the same
lease). Correctness counters (`sat_transfer_competing_entry_authorized`,
`sat_transfer_stale_owner_accepted`, `sat_transfer_duplicate_ownership_change`)
must stay at zero. Run it concurrently with `k6/sat-exam-day.js` on a disjoint
student slice (`K6_STUDENT_OFFSET`) to measure transfers while saves continue.
Requires `K6_CONFIRM_SAT=true`, an isolated staging SAT schedule, and staff
credentials that can approve for that schedule. Operator steps:
`docs/runbooks/sat-device-transfer.md`.

```bash
k6 run \
  -e K6_CONFIRM_SAT=true \
  -e K6_BASE_URL=https://staging.example.com \
  -e K6_SCHEDULE_ID=<schedule-id> \
  -e K6_TARGET_PATH=/absolute/path/to/target.json \
  -e K6_CREDS_PATH=/absolute/path/to/creds.json \
  -e K6_STUDENTS=100 -e K6_STUDENT_OFFSET=5000 \
  k6/sat-device-transfer.js
```

### SAT personal module entry, 2,000 candidates

`k6/sat-module-entry-2000.js` exercises one synchronized module entry per
candidate, including Start, Enter, visibility ACK, and the authoritative
entry-state read. It checks branch uniqueness/correctness in adaptive mode and
simulates a lost Start or Enter response in the recovery modes. Give each VU a
different bearer credential in a local JSON array:

```json
[{"attemptId":"attempt-1","token":"bearer-token-1","expectedBranch":"higher","expectedModuleId":"module-higher-id","otherModuleId":"module-lower-id","otherQuestionIds":["eq-lower-1","eq-lower-2"],"expectedResponseCount":27}]
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
In adaptive mode every Bootstrap body is also scanned for the unassigned
branch's module id (`otherModuleId`) and for every question of that branch
(`otherQuestionIds`, both required): the server delivers both adaptive branches
from one immutable version tree, so a body that mentions either means the
delivered-branch fence regressed (`sat_other_branch_leaks` and
`sat_other_branch_question_leaks` must stay 0). The question-id scan exists
because a body that drops the module but still carries its questions is the
same leak.
Adaptive mode also records expiry -> routed-branch-visible latency as
`sat_branch_visible_ms`, thresholded at p50 < 5 s, p95 < 8 s, p99 < 10 s,
max < 30 s. Those numbers are the proposed release bar, not an agreed one.

For the synchronized timeout-capacity gate, add `-e K6_SAVE_LOOP=1`. Each
candidate keeps answering its module while the window elapses, then waits for
the server (the 1 s worker sweep or the candidate's own lazy reconcile) to
close it. `sat_timeout_close_ms` is deadline -> locked; `sat_lost_saves` must
stay 0, meaning no answer the server accepted went missing from the response
projection after the close. `sat_route_drift` must also stay 0: the delivered
branch must not change identity across the close, and it must stay the branch
the credential names. `K6_SAVE_POLL_MS` (250) sets the poll cadence and
`K6_CLOSE_WAIT_SECONDS` (120) the wait budget. Use a schedule whose personal
module window is short enough to expire inside the run, and give every attempt
`expectedResponseCount` seeded answers. Run it once with the worker stopped and
once with two workers to check idempotency, and read worker tick duration plus
MySQL lock waits alongside the k6 summary.

The save-loop gate cannot check that the delivered branch matches the score of
the saved answers: the answer key is redacted from every student payload by
design, so no client can recompute the expected route. That parity is asserted
server-side (`backend/go/integration`, `sat_last_second_answer_test.go`); the
load test pins the observable half — correct and stable branch identity across
the close, and no lost accepted answer.

This is a controlled staging load test that mutates attempts. The k6 latency
metric ends at the visibility ACK and is a protocol proxy. To gate the actual
first answerable browser frame, run `e2e:live-sat-runner` with
`SAT_ASSERT_ENTRY_FRAME=true` and inspect `answerableFrameP95Ms`,
`answerableFrameP99Ms`, and `answerableFrameMaxMs` in its summary. The browser
runner collects each module's frame event, including adaptive modules.

### SAT recovery lifecycle reads, up to 2,000 candidates

`k6/sat-recovery-lifecycle-2000.js` repeatedly calls the read-only `/state`
projection used by sessions pinned to `sat_recovery_v1`. It verifies the
recovery policy and attempt identity, and fails if question content or answer
rows appear in the lifecycle response. The script accepts credentials with a
`scheduleId` per attempt for the many-room case; omit it and provide one
`K6_SCHEDULE_ID` to test a single room. Every attempt must be synthetic and
already admitted to the recovery policy. This measures the API/DB path only;
it does not measure browser rendering or prove capacity for writes and closes.

```bash
K6_CONFIRM_SAT=true \
K6_BASE_URL=https://staging.example.com \
K6_ATTEMPT_TOKENS_PATH=/absolute/path/to/synthetic-attempt-creds.json \
K6_VUS=2000 \
bun run k6:sat-lifecycle
```

By default the first read wave is synchronized, followed by jittered polls every
10–20 seconds for two minutes. Set `K6_INITIAL_JITTER_SECONDS=15` for a
staggered comparison or `K6_DURATION=5m` for a longer steady-state sample. Run
200, 500, then 2,000 VUs against the same isolated topology; record API and
worker pool settings, DB query/lock metrics, and the k6 latency distribution.
The script asserts response shape and zero unexpected failures but deliberately
does not invent a latency threshold before a topology-specific baseline exists.

Before the 2,000 candidate run, set `SHED_MODE=exam` and `VERSION_CACHE=on` and size
`DB_POOL_MAX_API`, `DB_POOL_MAX_WORKER`, and `DB_POOL_MAX_IDLE` from the actual
database connection budget. Reserve worker capacity so expired personal
modules can finalize without competing with entry writes. Record the deployed
settings and database saturation alongside the k6 output; a local `k6 inspect`
only checks script configuration and does not establish the latency gate.

### SAT frozen-answer close and recovery, up to 2,000 candidates

`k6/sat-recovery-close-2000.js` drives a pre-deadline save, frozen frontier
registration, bounded recovery writes, close receipt, idempotent close replay,
and explicit next-module activation. By default it spreads 2,000 baseline saves
uniformly across 10 seconds (200 requests/s) and jitters post-deadline close
starts by up to 2 seconds, matching the current browser cohort behavior. Set
`K6_SAVE_SPREAD_MS=0` and `K6_CLOSE_JITTER_MS=0` for a deliberately synchronized
burst diagnostic. It assigns a configurable 20% of
students to reconnect 45 seconds after Module 1 expires and a separate 1% to
start Module 2 after a 60-second entry delay by default, safely inside the
independent entry allowance, which starts when Module 2 becomes eligible. A
119-second override is a near-cutoff diagnostic: request arrival can cross the
deadline under load, so use the dedicated MySQL expiry E2E for deterministic
cutoff verification.

The script prepares deterministic answer hashes and the close envelope before
the deadline, records that client-preparation cost as
`sat_close_manifest_preparation_ms`, and sends the envelope at the deadline (or
after reconnect for offline candidates). This keeps a single local k6 host's
hashing work from being reported as API latency. The resulting
deadline-to-start-ack metric is an API-protocol diagnostic; the browser runner
remains the source for the deadline-to-first-answerable-frame gate.

Use only an isolated synthetic schedule with recovery-policy sessions already
admitted and active in Module 1. Set every Module 1 deadline to
`K6_WAVE_AT_MS`. Provide one unique credential per VU; `questions` must contain
valid synthetic question IDs and answers whose frozen values match the expected
route. `scheduleId` may be provided per credential for the many-room case, or
once through `K6_SCHEDULE_ID` for one synchronized room.

```json
[
  {
    "scheduleId": "optional-when-K6_SCHEDULE_ID-is-set",
    "attemptId": "attempt-1",
    "token": "synthetic-attempt-token",
    "moduleId": "module-1-id",
    "moduleAttemptId": "module-attempt-1-id",
    "expectedNextModuleId": "expected-module-2-id",
    "expectedUnchangedNextModuleId": "expected-lower-module-2-id",
    "questions": [
      {"questionId": "eq-1", "answer": "A", "frozenAnswer": "B"}
    ]
  }
]
```

When `expectedUnchangedNextModuleId` is supplied, the unchanged-answer cohort
must route to that branch; candidates that upload final edits use
`expectedNextModuleId`. Omit it when every synthetic answer is expected to
select the same branch.

The script reads authoritative writer epochs and saves one answer set shortly
before the deadline. Offline candidates make a second edit and upload that
frozen version after reconnecting. By default, 10% of connected, non-delayed
candidates make a final edit inside close; the remaining candidates reuse their
confirmed writes in the manifest, matching the browser's durable close
envelope. Set `K6_FINAL_EDIT_PERCENT=100` to stress a final-write burst or `0`
to measure the unchanged-answer path. It validates the server's content hashes,
every write acknowledgment, the selected next module, and close replay
stability. The scale profile samples 1% of exact receipt
replays by default (20 replays in a 2,000-VU wave) so the healthy transition
measurement is not dominated by a second write per student. Set
`K6_CLOSE_REPLAY_PERCENT=100` for a separate full replay-flood check; set it to
`0` to disable replays. The opt-in Go/MySQL harness defaults to 100% for waves
of 10 or fewer students and 1% above that; override with
`SAT_RECOVERY_K6_CLOSE_REPLAY_PERCENT`. Requests are chunked below 150 KiB and
at most 100 commands, within the current API envelope. Run 200, 500, then 2,000
VUs for both one shared room and many rooms on the same representative topology:

```bash
bun run k6:sat-close -- \
  -e K6_CONFIRM_SAT=true \
  -e K6_BASE_URL=https://staging.example.com \
  -e K6_SCHEDULE_ID=<schedule-id> \
  -e K6_ATTEMPT_TOKENS_PATH=/absolute/path/to/synthetic-close-creds.json \
  -e K6_VUS=2000 \
  -e K6_WAVE_AT_MS=<shared-module-deadline-unix-ms> \
  -e K6_OFFLINE_PERCENT=20 -e K6_OFFLINE_DELAY_SECONDS=45 \
  -e K6_ENTRY_DELAY_PERCENT=1 -e K6_NEXT_ENTRY_DELAY_SECONDS=60
```

The hard thresholds are save acknowledgment p99 <=1s and healthy
deadline-to-next-module-start-ack p95 <=3s / p99 <=5s. Offline recovery must
settle within its fixed 120-second allowance; the separate next-module entry
sample must start before its 120-second window expires. These are protocol
metrics, not proof of a painted first answerable browser frame. Pair them with
the SAT browser runner's `deadlineToAnswerableFrame*` measurements, which begin
at the previous timed-out module's server deadline and end when a visible,
enabled answer control is present. `SAT_ASSERT_ENTRY_FRAME=true` applies the
same p95 <=3s / p99 <=5s hard gates to that complete browser path. Capture API/DB
pool settings, lock waits, worker due lag, per-room distribution, and k6 output.
The workload mutates its attempts and cannot certify production capacity unless
the staging topology and data match the planned deployment.

The opt-in local Go/MySQL harness provisions synthetic attempts and defaults to
two local API processes. Set `SAT_K6_API_INSTANCES` (1–8) and
`SAT_RECOVERY_K6_API_POOL` (1–200) to compare local topologies; MySQL must allow
at least `instances × pool + 8` connections for API pools and fixture
verification. It raises `RATE_LIMIT_MAX_KEYS` to at least the requested cohort
size so an inherited development cap does not turn unrelated limiter eviction
into a false workload failure. These settings affect only the local diagnostic;
they do not change normal application runs or qualify production capacity.

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

### IELTS throughput, 500 then 2,000 candidates

`k6/ielts-throughput.js` measures the IELTS answer path in three invocations
(`IELTS_TP_PHASE=ready|steady|submit`): a readiness wave with a retry that must
return the same persisted deadline, an open-loop mix of durable saves, 20-answer
flushes, exact replays and runtime polls, and a submit wave with a resubmit that
must return the same digest. It requires `K6_CONFIRM_IELTS=true`,
`K6_CONFIRM_IELTS_TARGET=<host:port of K6_BASE_URL>` and a credential file
marked `"synthetic": true`. Locally, `TestIELTSThroughputK6MySQL` seeds the
fixture, runs all three phases with staff roster sweeps and the worker, and
reconciles every candidate against the database. Procedure, knobs, connection
budget and flag rollback: `docs/runbooks/ielts-capacity.md`.

## Data

- `e2e/prod-data/prod-target.json` contains the non-secret target data, including 200 students.
- `e2e/prod-data/prod-creds.json` contains the login secrets and remains untracked.

## Safety gate

Set `K6_CONFIRM_PROD=true` before running the production load scenarios. SAT
recovery rehearsal scripts require `K6_CONFIRM_SAT=true` and an isolated
synthetic schedule. Never use real student attempts for load.

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
