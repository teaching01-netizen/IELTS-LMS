# Phase 03 WAIVER - k6 submit-storm (staging)

> Plan: plans-durability/phase-03-k6.md section 9 (waiving is a valid close; unblocks Phase 04 as 03-or-waived).
> Standing rules honored: no k6 run executed, K6_CONFIRM_PROD never set, no remote host probed,
> prod-target.json untouched, no existing file modified. New file only (this waiver).

## 1. Owner plus date

Phase 03 waived by Phase-03 load owner (durability lane subagent) on 2026-09-11.

## 2. What is missing (P1-P4, Step 1 checklist - ALL absent)

- P1 Staging host: ABSENT. Repo-wide grep for staging hosts returns no staging base URL.
  Only host strings in tree: prod https://ielts-lms-production.up.railway.app
  (e2e/prod-data/prod-target.json:2, playwright.prod-smoke.config.ts, playwright.remote.config.ts),
  localhost k6 targets (http://127.0.0.1:18116 in k6/k1xx_target.json),
  literal placeholder https://staging in k6/scale-proof/README.md examples (not a host),
  and https://ielts-warwick-institute.up.railway.app in deploy/leapcell-load/.env.example
  (a load-runner REGISTER_URL template of unknown provenance - NOT designated staging,
  therefore NOT probed and NOT usable; using it would be improvising a target).
  No e2e/prod-data/staging-target.json, no k6/staging-target.json (ls confirms both absent).
- P2 Seeded schedule: ABSENT. No staging host exists, so no staging schedule exists.
  Per section 10.1 boundary, local e2e_seed knowledge was NOT applied to any remote target
  and cmd/e2e_seed was never run against staging (there is no staging to run it against).
- P3 Staging creds: ABSENT. k6/staging-creds.json does not exist
  (ls: k6/staging-*: No such file or directory). No staging passwords exist anywhere in tree.
- P4 Reachability: UNMET / NOT RUNNABLE. Check 8.2 requires a STAGING_HOST value; none exists,
  so no reachability probe against a staging host was possible. Per safety rules no remote
  probe was performed (never probe prod; never improvise a target). Loopback control only:
  curl to http://127.0.0.1:18116 (local k6 target port) -> http_code=000, connection refused
  (curl exit 7; no server listening - there is no local staging stand-in running).

## 3. Staging plan (steps plus owners plus ETA)

1. Infra/staging operator provisions an https staging host deployed from (or equivalent to)
   the frozen V2 candidate tree (tree SHA at waiver time: 61a6dbe, k6 v2.0.0 darwin/arm64 present).
2. Staging operator seeds ONE fresh staging schedule (new UUID, staff-assigned, content-bearing:
   snapshot yields >=1 objective/writing target) via the staging deploy/admin/provisioning flow
   - explicitly NOT backend/go/cmd/e2e_seed (local-only tool, section 10.1 boundary).
3. Staging operator issues k6/staging-creds.json (gitignored path): editor + 10 proctor
   staging-only passwords, emails matching the new staging target file; validate via check 8.3.
4. Load owner creates e2e/prod-data/staging-target.json (full shape per section 5.1, 200
   staging-distinct student rows), re-verifies host string (check 8.1), then runs
   smoke-5 (8.4) -> ramp-25 -> full-200 on a FRESH schedule per full run (8.5),
   with two-person host re-confirm immediately before the full-200 launch.
ETA: TBD by staging operator (no operator or schedule is available in this environment).

## 4. Re-run pointer

Section 8.5 command with K6_RUN_ID=staging-full-<DATE>-<INITIALS> against the future
STAGING-HOST, only after smoke-5 (8.4) is green and the 8.6 pass table is evaluated
(http_req_failed rate<0.02, submit_request_ms p95<2000 max<10000,
submit_correctness_failures==0, submit_missing_data==0, no-5xx fence except tolerated
Duplicate-entry on start_runtime). Thresholds verified present in k6/prod-submit-storm-200.js:365-370.

## 5. Risk accepted

No concurrent-submit evidence; the durability candidate submit path is covered only by unit
and integration suites (62/62) plus local Playwright (Phase 01). Phase 05 must enter at
dogfood and pilot only (reduced exposure) because 200-way load evidence is absent.

## 6. Verification footprint (this waiver run)

- k6 version: k6 v2.0.0 (commit/devel, go1.26.3, darwin/arm64). Tree SHA: 61a6dbe.
- K6_CONFIRM_PROD was never set in any shell; zero k6 invocations performed.
- git diff --name-only shows NO change to e2e/prod-data/prod-target.json,
  k6/prod-submit-storm-200.js, k6/prod-load-helpers.js, backend/, src/, existing e2e/ files.
- Only new file from this phase: k6/staging-waiver.md (this file, non-secret, committable).
  No staging target/creds/log files were created (nothing real to point them at; creating
  placeholders would risk confusion with real staging files later).
