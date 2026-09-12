# Phase 03 — Staging Provision + k6 Submit-Storm Run (load owner)

> Lane: student-answer durability close-out. Stage: PLAN ONLY (this file is the only output).
> Parent: plans-durability/overall-plan.md (goal, blockers B1/B2/B3, phases, ownership, standing rules).
> Ownership: k6/ plus staging target/creds (new files only, never the prod placeholder).
> Dependencies: none. Parallel with Phase 01 and Phase 02. Must NOT block on Phase 01.

## 1. Objective

Close blocker B3 (k6 never run, no staging target) by EITHER:

- (A) GREEN: provision a staging host plus seeded schedule, run k6/prod-submit-storm-200.js
  against staging only (reduced VUs first, then full 200), meet all pass criteria with output captured; OR
- (B) WAIVER: record an explicit owner-plus-date waiver stating what is missing plus the staging plan (see section 9).

Phase 04 needs 02-or-waiver plus 03-or-waiver, so either outcome unblocks Phase 04.
There is no third outcome: assumed-green, ran-against-prod, and ran-placeholder-as-is are all failures.

## 2. Dependencies and non-dependencies

- Depends on: nothing. Starts any time, parallel with Phase 01 and Phase 02.
- Must NOT depend on Phase 01. Phase 01 repairs the local e2e seed tool
  (backend/go/cmd/e2e_seed/main.go cleanup, lines 297-334, missing exam_versions handling)
  and re-seeds the local database. The staging seed is a different target (remote staging
  host plus staging database, seeded by the staging operator, NOT cmd/e2e_seed against local).
- May READ for grounding: k6/prod-submit-storm-200.js, k6/prod-load-helpers.js, k6/README.md,
  e2e/prod-data/prod-target.json, e2e/prod-data/prod-creds.example.json, e2e/support/prodData.ts, .gitignore.
- Must NEVER modify: src/, backend/ (read-only), existing e2e/ files, docs/, existing k6/ files,
  and specifically never edit e2e/prod-data/prod-target.json or e2e/prod-data/prod-creds.json.

## 3. Grounding - what the script is (verified by reading)

### 3.1 Entry point and required env

- Script: k6/prod-submit-storm-200.js (663 lines). Helpers: k6/prod-load-helpers.js (645 lines).
- Target and creds resolution (script lines 33-36): K6_TARGET_PATH defaults to
  ../e2e/prod-data/prod-target.json, K6_CREDS_PATH defaults to ../e2e/prod-data/prod-creds.json.
  readJson is a bare JSON.parse of open(path) (helpers lines 7-13): no placeholder guard.
- Safety gate: setup() calls ensureProdRunAllowed() (helpers lines 287-291), which throws
  unless K6_CONFIRM_PROD equals the string true. The name says PROD even for staging runs;
  the script has no separate staging gate. Section 7 constrains its use to staging only.
- Base URL and schedule resolution (helpers lines 44-83): K6_BASE_URL overrides target.baseURL;
  K6_SCHEDULE_ID overrides target.scheduleId; K6_REGISTER_URL variants can derive both; a stale
  e2e/.generated/prod-runtime.json scheduleId is also consulted. This phase passes explicit
  K6_TARGET_PATH plus K6_CREDS_PATH and keeps overrides minimal (K6_STUDENTS, K6_RUN_ID only).
- Student slice (script line 40, helper buildStudentSlice lines 293-304): K6_STUDENTS (default 200)
  and K6_STUDENT_OFFSET (default 0) slice target.students. The staging target file must contain
  at least K6_STUDENTS student entries or setup throws a Not-enough-students error.

### 3.2 Submit-storm shape (what it hammers)

- Scenarios (script lines 348-364): control = 1 VU x 1 iteration; students = per-vu-iterations
  with vus equal to studentCount, 1 iteration each; maxDuration 30m. Full run = 200 student VUs plus 1 control VU.
- controlFlow (lines 387-470): staff login trying creds.editor then each creds.proctors until
  the proctor-sessions GET returns 200; proctor presence join; poll until
  K6_CHECKED_IN_THRESHOLD students checked in (default equals studentCount, timeout default 900s);
  start_runtime command if runtime is not already live; poll until live (timeout default 1200s).
- studentFlow (lines 472-639): one VU per student; deterministic jitter; bootstrap via
  student entry POST, then bootstrap POST, then precheck POST; collect every objective plus
  writing target from contentSnapshot; fail loud on zero targets (submit_missing_data) or more than
  K6_MAX_TARGET_KEYS_PER_USER (default 400); send mutation batch (SetChoice, SetSlot, SetEssayText ops)
  via mutations-batch POST; periodic heartbeat POST; hold K6_WORK_SECONDS (default 20); submit via
  submit POST with lastSeenRevision and submissionId; poll up to 180s for attempt.submittedAt;
  require attempt.finalSubmission; strict canonical re-verify of every key (10s retry), fail on any diff.
- Fence endpoints touched: auth login, proctor sessions GET, presence POST, schedules runtime GET,
  runtime commands POST, student entry POST, bootstrap POST, precheck POST, session GET polls,
  mutations batch POST, heartbeat POST, submit POST.
- handleSummary (lines 641-663): prints a JSON summary to stdout and writes
  e2e/.generated/live-runner/answer-diff-RUNID.json (gitignored via e2e/.generated/).
### 3.3 Thresholds and budgets (pass criteria source)

Script lines 365-370 are the only authoritative budgets for this script:

  http_req_failed: rate below 0.02
  submit_request_ms: p95 below 2000, max below 10000
  submit_correctness_failures: count equals 0
  submit_missing_data: count equals 0

k6/README.md lines 24-28 confirms: 200 students, near-simultaneous submit storm,
submit_request_ms p95 below 2000 and max below 10000, verifies submittedAt, answers,
writingAnswers, and finalSubmission. The script submit_request_ms budget IS the p95 budget.

### 3.4 Prod placeholder (must never run as-is)

- e2e/prod-data/prod-target.json lines 2-4: baseURL is the production Railway host,
  scheduleId is REPLACE_ME_SCHEDULE_ID, examId is REPLACE_ME_EXAM_ID, plus 1 editor,
  10 proctors, 200 W000001-style students. Running with default paths and no overrides
  would target the production host with garbage ids.
- Playwright-side guard e2e/support/prodData.ts lines 156-169 throws on REPLACE_ME, but the
  k6 path does NOT go through that guard (bare JSON.parse). The operator is the guard for k6.
- e2e/prod-data/prod-creds.example.json is the shape template: editor email plus password,
  proctors array of 10 email-plus-password entries. The real e2e/prod-data/prod-creds.json exists
  locally (untracked, E2E- prefixed passwords for local test accounts): do not copy its passwords.

### 3.5 Staging docs and hosts today

- None found. Repo-wide grep for staging returns zero staging hosts, zero staging target or creds
  files, zero staging runbooks. k6/k105_target.json style files are local-port targets
  (http://127.0.0.1:18116), not staging. This phase creates staging files from scratch or waives.
- Binary present on this machine: k6 v2.0.0 (darwin/arm64), verified via k6 version.

## 4. Affected and new files (ownership)

- THIS FILE: plans-durability/phase-03-k6.md (planning-stage output, no code).
- NEW staging target (pick ONE): e2e/prod-data/staging-target.json (recommended, non-secret,
  committable) or k6/staging-target.json. Non-secret staging pointer: staging baseURL plus real
  staging scheduleId and examId plus roster. Mirrors prod shape, see section 5.
- NEW staging creds (LOCAL-ONLY, NEVER COMMIT): k6/staging-creds.json (strongly recommended path).
  Staging passwords mirroring prod-creds.example.json shape. k6 star-creds.json is already gitignored
  (.gitignore line 21); e2e/prod-data/staging-creds.json would NOT be ignored (only prod-creds.json
  is, .gitignore line 18), so prefer the k6 path or verify git status before any commit.
- NEW optional templates: e2e/prod-data/staging-target.example.json or k6/staging-creds.example.json,
  only if host or passwords cannot be shared; redacted shapes with REPLACE_ME secrets.
- NEW run outputs (local evidence): e2e/.generated/live-runner/k6-staging-RUNID.log and the auto-written
  answer-diff-RUNID.json. e2e/.generated/ is gitignored; attach by pasting into the gate report.
- DO NOT TOUCH: e2e/prod-data/prod-target.json, e2e/prod-data/prod-creds.json, any existing k6 script,
  backend files, src files, existing e2e specs, docs.

## 5. Contracts and interfaces

### 5.1 Staging target file contract (mirrors prod shape, staging values)

Mirror e2e/prod-data/prod-target.json and satisfy e2e/support/prodData.ts prodTargetSchema
(lines 50-58) where practical. The k6 script only requires the subset marked K6 below, but provide
the FULL shape to avoid drift:

- baseURL (K6): staging https URL, valid URL, never the prod host, never contains REPLACE_ME.
- scheduleId (K6): fresh staging schedule UUID, no REPLACE_ME.
- examId: real staging exam id, no REPLACE_ME (k6 storm does not read it; tooling parity needs it).
- editor: email plus displayName; must be assigned to the schedule.
- proctors: exactly 10 email-plus-displayName entries (loginControlStaff probes each until
  proctor-view GET returns 200; helpers lines 213-246).
- students (K6): at least K6_STUDENTS entries; recommend the full 200 with a staging-distinct email
  namespace (for example staging-plus-w000001 addresses) so dirty-staging triage can attribute rows.
  Each row: wcode non-empty, email valid, fullName non-empty.
- scenario: shape-parity block (shardCount 6, arrivalRampSeconds 300, checkedInStartThreshold 95,
  offlineToggleStudentCount 5, invalidCheckInCount 2, violations 4/4/4, interventions 10/6/2).
  Unused by submit-storm; keeps the file interchangeable with prodData tooling.
- At least one of editor or proctors must have proctor-view access to the staging schedule, or
  controlFlow throws No-authorized-staff-account before any student VU starts.

### 5.2 Staging creds file contract (mirrors prod-creds shape, staging secrets)

Mirror e2e/prod-data/prod-creds.example.json exactly: editor object with email plus password,
proctors array of 10 email-plus-password objects. Every email must equal the corresponding
target-file email (login posts email and password verbatim, helper line 221). Passwords are
staging-only, unique per account, never reused from the local prod-creds.json or committed
k6/k1xx creds files. Lives at k6/staging-creds.json (gitignored). Verify with
git status --porcelain that the creds path never appears as a committable change.

### 5.3 Env contract for every run

- K6_CONFIRM_PROD=true (the script only gate; name is misleading; section 7 constrains it to staging).
- K6_TARGET_PATH: absolute path to the staging target file.
- K6_CREDS_PATH: absolute path to k6/staging-creds.json.
- K6_STUDENTS and K6_STUDENT_OFFSET: smoke 5, ramp 25, full 200 with offset 0.
- K6_CHECKED_IN_THRESHOLD: set equal to K6_STUDENTS explicitly each run.
- K6_RUN_ID: staging-smoke-DATE-INITIALS, then staging-full-DATE-INITIALS.
- Optional: K6_AUTO_REGISTER=true only if staging students are not pre-registered;
  K6_DEBUG=true for the first smoke only.
- Forbidden: K6_BASE_URL or K6_SCHEDULE_ID overrides pointing anywhere except the staging pair;
  any K6_TARGET_PATH pointing at prod-target.json; K6_DIFF_DEBUG_RAW=true on shared screens.

## 6. Step-by-step implementation (in order; stop and record on first red)

All commands run from the repo root. k6 open() resolves relative target paths against the k6
directory, so this plan uses absolute paths in env to remove CWD ambiguity.

### Step 0 - Safety preflight (every session, before any k6 invocation)

1. Run pwd and git status --porcelain. Confirm the repo root and note dirty files.
2. Run k6 version. Expect k6 v2.0.0 or newer 2.x; record the actual string.
3. Print the resolved target WITHOUT secrets and eyeball the host (command 8.1). Confirm the host
   string is the staging host, does NOT contain ielts-lms-production, does NOT contain REPLACE_ME.
4. Know the abort: Ctrl-C stops k6; student VUs are single-iteration so a run drains.

### Step 1 - Staging prerequisites checklist (all four true, else section 9 waiver)

- P1 Staging host: an https staging base URL deployed from (or equivalent to) the frozen V2
  candidate tree, reachable from this machine (any HTTP response proves reachability; probe 8.2).
- P2 Seeded schedule: a dedicated staging schedule exists (fresh UUID, pre-live or reusable),
  assigned to at least one staging staff account, with a content snapshot yielding at least one
  objective or writing target. One schedule PER full run: reuse of a completed or cancelled runtime
  fails by design (script lines 465-467 and 511-513).
- P3 Staging creds file: k6/staging-creds.json exists locally with the 5.2 shape, emails matching
  the target file, staging-only passwords. Validate JSON parses and email sets match (check 8.3).
- P4 Network reachability: this machine reaches the staging host on 443 with no VPN or allowlist gap.
  Record the probe output.

### Step 2 - Create staging target plus creds files (new files only)

1. Copy the SHAPE never the secrets: cp e2e/prod-data/prod-target.json e2e/prod-data/staging-target.json
   (or k6/staging-target.json), then replace baseURL, scheduleId, examId, and student emails.
   Keep 200 student rows: K6_STUDENTS=200 needs all 200.
2. Create creds from the EXAMPLE shape, not from the real local file:
   cp e2e/prod-data/prod-creds.example.json k6/staging-creds.json, then fill 11 staging passwords.
3. Validate both files parse as JSON and the email sets match (check 8.3).
4. Run git status --porcelain. k6/staging-creds.json must NOT show as a committable change
   (it is ignored). staging-target.json has no secrets and may be committed or kept local; record which.

### Step 3 - Smoke run at reduced VUs (K6_STUDENTS=5)

Run the exact command 8.4 with output teed to e2e/.generated/live-runner/. Expected: setup passes,
control VU drives runtime to live, 5 student VUs bootstrap, mutate, submit, strict-verify OK,
thresholds green. If smoke is red, do NOT proceed to full: triage per section 10 and re-run smoke
on a FRESH schedule if the runtime was consumed.

### Step 4 - Ramp run (K6_STUDENTS=25, recommended)

Same command shape with K6_STUDENTS=25, K6_CHECKED_IN_THRESHOLD=25, a staging-ramp RUNID.
Catches checked-in-gate and live-propagation issues at 5x smoke before burning the 200-student
schedule. May be skipped only if smoke was green AND the operator records why; skipping ramp
never skips smoke.

### Step 5 - Full run (K6_STUDENTS=200, fresh schedule recommended)

Exact command 8.5. Expected wall time is minutes (jitter up to 2s plus bootstrap, 20s work hold,
submit, verify poll; maxDuration 30m is the cap, not the norm). Keep the full stdout plus stderr
log AND the auto-written answer-diff-RUNID.json.

### Step 6 - Evaluate pass criteria (8.6) and record evidence

- All four script thresholds green.
- No 5xx on fence paths except the single tolerated Duplicate-entry on exam_session_runtimes
  for start_runtime (script lines 65-69 and 446).
- Attach: full k6 stdout threshold plus checks block, answer-diff-RUNID.json summary, target host
  plus schedule plus runIds, git rev-parse --short HEAD of the tree under test.
- Any red: file as blocked-with-evidence (log excerpt plus failing threshold or check name).
  Do NOT re-run blindly on the same schedule (see section 10).

### Step 7 - Report to Phase 04

Hand Phase 04 ONE of: (a) GREEN packet (pass table plus pasted threshold output plus log paths plus
tree SHA), or (b) SIGNED WAIVER (section 9). A verbal k6-passed without pasted output is not a handoff.

## 7. Safety rules (read before every run; violation aborts the phase)

1. NEVER set K6_CONFIRM_PROD=true against a prod host. The variable is the script run-gate, not proof
   of prod authorization. In this phase it is authorized for staging hosts only. Print the resolved
   baseURL before EVERY invocation and confirm it is the staging host.
2. Verify the target host string before every run: the baseURL grep must show the staging host,
   the REPLACE_ME grep must be empty, and the echoed K6_TARGET_PATH plus K6_CREDS_PATH must name
   the staging files, never prod-target.json or prod-creds.json.
3. Staging-only. No K6_BASE_URL override to prod, no register URL to a prod link, no editing
   prod-target.json to just try. The deny-string is the checked-in prod baseURL: if it appears in
   the resolved base URL, abort.
4. Fresh schedule per full run. k6 mutates runtime state (k6 README Notes: reuse will not be
   meaningful). A consumed live-to-completed or cancelled schedule fails by design: provision new.
5. Secrets hygiene. Staging creds stay in k6/staging-creds.json (ignored), never pasted beyond the
   email list, never committed. K6_DIFF_DEBUG_RAW stays unset (default hashed mismatch output).
6. Two-person check for the full 200. Smoke may be solo; the full run requires re-confirming the host
   string in the same terminal session immediately before launch (command 8.5 embeds the grep).

## 8. Verification (exact commands plus expected outputs)

Replace STAGING_HOST, file paths, and RUNIDs with real values. Run from the repo root.

### 8.1 Preflight - resolved target (no secrets)

Commands:

  pwd
  git rev-parse --short HEAD
  K6_TARGET_PATH="$PWD/e2e/prod-data/staging-target.json"
  node -e "const t=require('./e2e/prod-data/staging-target.json'); console.log('baseURL='+t.baseURL); console.log('scheduleId='+t.scheduleId); console.log('examId='+t.examId); console.log('students='+t.students.length); if(/REPLACE_ME/i.test(t.scheduleId+t.examId+t.baseURL)) throw new Error('PLACEHOLDER PRESENT'); if(t.baseURL.includes('ielts-lms-production')) throw new Error('PROD HOST - ABORT');"
  grep -o '"baseURL": *"[^"]*"' "$K6_TARGET_PATH"
  echo "K6_TARGET_PATH=$K6_TARGET_PATH"
  echo "K6_CREDS_PATH=$PWD/k6/staging-creds.json"

Expected: baseURL prints the staging host, student count prints the seeded count, no PLACEHOLDER
or PROD-HOST error, and the baseURL grep shows the staging host.

### 8.2 Reachability (no auth needed)

Commands:

  STAGING_HOST="https://STAGING-HOST"
  curl -sS -o /dev/null -w 'reachability http_code=%{http_code} time=%{time_total}s' --max-time 15 "$STAGING_HOST/api/v1/schedules/00000000-0000-0000-0000-000000000000/runtime"; echo

Expected: an HTTP code (200, 400, 401, or 404 all prove reachability). DNS failure, timeout, or TLS
error means P4 is unmet: take the waiver path (section 9), do not proceed.

### 8.3 Shape check - target and creds email match (no passwords printed)

Commands:

  node -e "const t=require('./e2e/prod-data/staging-target.json'); const c=require('./k6/staging-creds.json'); const tE=new Set([t.editor.email].concat(t.proctors.map(function(p){return p.email}))); const cE=new Set([c.editor.email].concat(c.proctors.map(function(p){return p.email}))); console.log('target staff='+tE.size+' creds staff='+cE.size+' students='+t.students.length); for (const e of tE){ if(!cE.has(e)) throw new Error('creds missing '+e); } console.log('EMAIL SETS MATCH');"
  git status --porcelain -- k6/staging-creds.json e2e/prod-data/staging-target.json

Expected: target staff=11, creds staff=11, students=200 (or the seeded count, which must be at least
the planned K6_STUDENTS), plus EMAIL SETS MATCH. git status must NOT list k6/staging-creds.json as a
committable change (it is ignored). If it appears as untracked-conmittable, STOP and keep it local.

### 8.4 Smoke run - 5 VUs (must pass before full)

Commands:

  mkdir -p e2e/.generated/live-runner
  export K6_RUN_ID="staging-smoke-DATE-INITIALS"
  K6_CONFIRM_PROD=true K6_TARGET_PATH="$PWD/e2e/prod-data/staging-target.json" K6_CREDS_PATH="$PWD/k6/staging-creds.json" K6_STUDENTS=5 K6_CHECKED_IN_THRESHOLD=5 K6_RUN_ID="$K6_RUN_ID" k6 run k6/prod-submit-storm-200.js 2>&1 | tee "e2e/.generated/live-runner/k6-$K6_RUN_ID.log"

Expected (green smoke): exit 0; summary shows http_req_failed rate near 0, submit_request_ms p95
below 2000 and max below 10000, submit_correctness_failures count 0, submit_missing_data count 0;
all checks pass; the stdout JSON block carries the matching runId; answer-diff-RUNID.json is written.
Any bootstrap, precheck, submit, or ANSWER_MISMATCH failure line is red: stop, keep the log, triage
per section 10.

### 8.5 Full run - 200 VUs (fresh schedule; host re-confirm embedded)

Commands:

  mkdir -p e2e/.generated/live-runner
  export K6_RUN_ID="staging-full-DATE-INITIALS"
  grep -o '"baseURL": *"[^"]*"' "$PWD/e2e/prod-data/staging-target.json"
  K6_CONFIRM_PROD=true K6_TARGET_PATH="$PWD/e2e/prod-data/staging-target.json" K6_CREDS_PATH="$PWD/k6/staging-creds.json" K6_STUDENTS=200 K6_CHECKED_IN_THRESHOLD=200 K6_RUN_ID="$K6_RUN_ID" k6 run k6/prod-submit-storm-200.js 2>&1 | tee "e2e/.generated/live-runner/k6-$K6_RUN_ID.log"

Note: the grep MUST show the staging host before the run starts; abort on prod or placeholder.
Expected (green full): the same four thresholds green at 200 VUs; 200 student VUs plus control
executed; request volume near 200x the per-student fan-out; zero correctness failures; the summary
JSON plus answer-diff-RUNID.json present. Paste the threshold and checks block into the gate report:
exit 0 alone is insufficient.

### 8.6 Pass-criteria evaluation (copy this table into the report)

- http_req_failed from script line 366: green value is rate below 0.02.
- submit_request_ms p95 from script line 367 and README line 27: green value is p95 below 2000 ms.
- submit_request_ms max from script line 367: green value is max below 10000 ms.
- submit_correctness_failures from script line 368 (strict full-key verify): green value is count 0.
- submit_missing_data from script line 369 (zero-target guard): green value is count 0.
- No 5xx on fence paths (section 3.2 list): green is zero 5xx except the tolerated Duplicate-entry
  on exam_session_runtimes for start_runtime (script lines 65-69 and 446).
- Evidence attached (standing rule): green is full stdout threshold block plus
  answer-diff-RUNID.json summary plus host, scheduleId, runIds, and tree SHA.

All rows green means Phase 03 GREEN. Any row red means attach the failing row plus a log excerpt
and either remediate on a fresh schedule or waive per section 9.

## 9. Waiver path (explicitly allowed: waiving is a valid close)

If ANY of P1-P4 (Step 1) cannot be met, do NOT fake a run. File a waiver with ALL of:

1. Owner plus date: Phase 03 waived by NAME on YYYY-MM-DD.
2. What is missing (check each): host present-or-absent with detail; seeded schedule present id
   or absent with detail; creds present or absent with detail; reachability probe output pasted
   from check 8.2. Phase 04 must see exactly what was absent.
3. Staging plan: who provisions the host, how the schedule gets seeded (which deploy, job, or admin
   flow creates a fresh staff-assigned content-bearing schedule), who issues k6/staging-creds.json,
   and the re-run command pointer (section 8.5 with the future K6_RUN_ID).
4. Risk note: the durability candidate submit path is then covered only by unit and integration suites
   (62 of 62) plus local Playwright (Phase 01); there is no 200-way concurrent-submit evidence, so the
   Phase 05 rollout must start at reduced exposure (dogfood then pilot) because load evidence is absent.

Waiver block template (fill every field):

  Phase 03 WAIVER - k6 submit-storm (staging)
  Owner: NAME. Date: YYYY-MM-DD.
  Missing: host=PRESENT-or-ABSENT-detail; schedule=PRESENT-id-or-ABSENT-detail;
    creds=PRESENT-or-ABSENT-detail; reachability=PASTE-check-8.2-output.
  Staging plan: STEPS-plus-OWNERS-plus-ETA.
  Re-run: section 8.5 command with K6_RUN_ID=PLANNED-ID against STAGING-HOST.
  Risk accepted: no concurrent-submit evidence; Phase 05 enters at dogfood and pilot only.

The waiver satisfies this phase DoD and unblocks Phase 04 as 03-or-waived.

## 10. Edge cases (anticipated failures plus prescribed response)

### 10.1 Staging seed absence: the Phase 01 boundary (MUST READ)

Symptom: no staging schedule exists, the only schedule is already completed or cancelled, or its
content snapshot yields zero answer targets (No-answer-targets failure with submit_missing_data).
Boundary: Phase 01 seed knowledge (FK 1451 fix in cmd/e2e_seed, fresh local seed, DATABASE_URL
shadowing) applies to the LOCAL database only. Do NOT run cmd/e2e_seed against staging, do NOT apply
Phase 01 edits to any staging path, do NOT wait for Phase 01 to finish. Staging seeding is a separate
operation owned by the staging operator (staging deploy plus staging admin or provisioning flow).
Response: request a FRESH staging schedule (new UUID, staff-assigned, content-bearing) from the staging
operator; point the staging target file at the new scheduleId and examId; re-run smoke first. If no
operator or schedule is available, file the section 9 waiver naming schedule as the missing item.

### 10.2 Creds rotation and unauthorized staff

Symptom: No-authorized-staff-account error (helpers lines 238-243), or login 200 followed by a
non-200 proctor-view probe cycling through all 11 accounts.
Causes: password rotated, schedule not assigned to those staff, or wrong tenant emails.
Response: confirm the 8.3 email match; have the staging operator re-issue passwords or assign the
schedule to the target staff; update ONLY k6/staging-creds.json; re-run smoke. Never fix by borrowing
local prod-creds.json passwords or by pointing at the prod host.

### 10.3 Dirty-staging interference (another run consumed the schedule)

Symptom: mid-run Schedule-runtime-is-already-completed-or-cancelled failure (script lines 465-467
and 511-513); intermittently high http_req_failed; start_runtime 409s interleaved with foreign runIds.
Cause: two operators sharing one staging schedule (k6 mutates runtime state; k6 README warns reuse
will not be meaningful).
Response: serialize staging use (announce the window plus K6_RUN_ID), provision one schedule per full
run, use distinct K6_RUN_IDs and student offsets per operator, re-run on the fresh schedule.
Record the colliding runId if visible.

### 10.4 Flaky network and runner-local resource pressure

Symptom: http_req_failed marginally above 0.02 with timeouts while correctness counters stay 0 and p95
is fine; or local k6 OOM at 200 VUs.
Response: re-run smoke to isolate staging versus runner; prefer a stable network, close competing load,
keep K6_WORK_SECONDS at default; if the same threshold fails twice, escalate for root cause per the
standing rule (same failure twice means escalate, never blind re-patch) and attach both logs.

### 10.5 Accidentally targeting prod (abort procedure)

Triggers: preflight shows the production host, K6_TARGET_PATH resolves to prod-target.json, or
K6_BASE_URL was exported to prod in the shell.
Response: press Ctrl-C immediately and do NOT let setup finish; unset K6_BASE_URL, K6_SCHEDULE_ID,
and K6_REGISTER_URL; delete any prod-run log from evidence; record the near-miss in the report;
restart at Step 0. A run that touched prod is an incident, not evidence.

### 10.6 Zero-target and pathological snapshots

Symptom: Target-key-count exceeds K6_MAX_TARGET_KEYS_PER_USER=400, or the zero-target failure.
Cause: staging schedule linked to an empty or draft exam version.
Response: link the staging schedule to a full published exam version (reading plus listening plus
writing), provision a new schedule, re-run smoke. Do not raise K6_MAX_TARGET_KEYS_PER_USER to hide it.

## 11. Definition of Done

Phase 03 is DONE when ONE of the following is recorded in the gate report:

- GREEN: the section 8.5 full staging run (after 8.4 smoke green) meets every row of 8.6, with pasted
  threshold and checks output plus the answer-diff-RUNID.json summary plus host, scheduleId, runIds,
  and tree SHA attached. New staging files exist only at the section 4 paths; prod-target.json is
  untouched (git diff --name-only shows no e2e/prod-data/prod-target.json, no k6 script edits,
  no backend changes).
- WAIVED: the section 9 waiver is signed with owner plus date, names the missing items with probe
  evidence, and carries the staging plan, the re-run pointer, and the risk note.

Either outcome is reported to the parent as the Phase 03 result and unblocks Phase 04 as
03-green-or-waived. A verbal it-passed without pasted logs does not count.

## 12. Handoff checklist for the implementation agent (no redesign)

1. Read overall-plan sections 3 (B3), 4 (Phase 03 row), and 6 (standing rules) before touching anything.
2. Execute section 6 Steps 0-7 in order; use ONLY the section 8 commands (fill in staging values).
3. Create ONLY the section 4 new files; verify git status shows no edits to prod-target.json, k6 scripts,
   backend, src, or existing e2e files.
4. Deliver the section 8.6 table (green) or the section 9 waiver block (waived) with owner plus date.

