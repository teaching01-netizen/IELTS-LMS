# Persistent login implementation evidence — 2026-10-29

Scope: implement [the low-level plan](../plans/2026-10-29-persistent-login-low-level.md)
in the current workspace. No production deployment, flag enablement, migration
or credential change was performed. Local database fixtures were disposable.
Unrelated pre-existing workspace changes were retained.

## Implemented

- Additive migration 0111 with guarded columns/CHECKs and startup schema checks.
- Stored remembered preference, idle snapshot and real password timestamp;
  bounded staff/admin policies; short student/master/observer policy preserved.
- Database-backed, locked admission with time read after lock acquisition,
  monotonic capped idle extension, terminal revocation and fixed hard expiry.
- Password snapshot fences, transactional reset/activation, atomic reauthentication
  rotation and revoke-all auditing; cookies only after acknowledged commit.
- Exact public-origin checks, no-store auth errors, expired-cookie logout,
  protected-route freshness and session/freshness-limited prepared PDFs.
- Generation-scoped session flights and request/download fences, cold unavailable
  and warm degraded recovery, paused offline/hidden timers respecting Retry-After,
  durable logout intent, cross-tab Web Locks/invalidation and explicit all-device
  uncertainty. Storage failure and late-login-after-logout have regression tests.
- Remembered-device choice and shared-device copy; confirmation uses the existing
  Dialog/Button design-system components and preserves same-user mounted work.
- OpenAPI additions, bounded backend auth metrics and a required connected CI gate
  that rejects skipped persistent-login database/process tests.

## Executed verification

Commands ran from the repository root unless a Go working directory is stated.
Database DSNs and passwords are intentionally omitted; `TEST_MYSQL_DSN` pointed to
local disposable MySQL over its Unix socket, and browser tests used a local TCP
fixture user. Production was not queried.

| Check | Result |
| --- | --- |
| Target Vitest auth/service/transport/raw-download/student-route suites | 97 tests passed across 17 files |
| `bun run typecheck` | Passed |
| `bun run lint` | Exit 0; 1,020 repository warnings, zero errors; final changed auth/browser files also lint clean |
| `bun run build` | Passed |
| Go domain/migration/telemetry suites with `-race -count=1 -json` and real DB | 289 cases/subcases passed, zero skipped |
| Target API auth/freshness/process/scope/refresh/PDF suites with `-race -count=1 -json`, real DB and built PDF frontend | 91 cases/subcases passed, zero skipped |
| `bunx playwright test e2e/persistent-login.spec.ts --project=chromium --project=firefox --project=webkit --trace=retain-on-failure --reporter=line` | 15 passed; real on-disk profiles closed/relaunched |
| Isolated WebKit remembered-login repetitions | 3 passed |
| `git diff --check` | Passed |
| OpenAPI lint | Seven existing schema errors remain; confirmed against pre-change HEAD |

Browser tests exercise remembered restart, opt-out restart, server idle expiry,
revocation, stale password / wrong password / rotation, exact-origin rejection,
and offline logout hiding two tabs and surviving a browser restart. Profiles are
deleted after each test so live cookies and browser caches are not retained as
artifacts. The final isolated run passed all 15 in 57.5 seconds. The Go process
test starts two independent API processes against the same DB, restarts one,
then revokes through the other and proves the next request is 401.

The targeted frontend command is:

```sh
bunx vitest run src/services/__tests__/authService.session.test.ts src/features/auth/__tests__ src/shared/api/__tests__ src/features/results/api/__tests__/satRawdataExport.test.ts src/features/student-delivery/api/answeredExamPdf.test.ts src/features/student/routes/__tests__/StudentSessionRoute.test.tsx
```

From `backend/go`, domain qualification is:

```sh
go test -race -count=1 -json ./internal/auth ./internal/authz ./internal/platform/config ./internal/platform/db ./internal/platform/apperrors ./cmd/migrate ./internal/platform/telemetry
```

The API qualification uses `ANSWEREDPDF_DIST` pointing at the built frontend and:

```sh
go test -race -count=1 -json -run 'TestPersistentLogin|TestLoginRemember|TestRememberedStaff|TestAuthResponsesAreNoStore|TestCredentialRoutes|TestAnonymousLogout|TestSensitiveRouteManifest|TestReauthenticateRejects|TestStaffPolling|TestAuthMiddleware|Test.*Recovery.*Scope|Test.*Attempt.*Refresh|TestPreparedPDFRoutesMySQL' ./cmd/api
```

## Wider checks and limits

`go test ./...` also passed with the ordinary environment (DB-gated tests skip
there; the connected runs above provide the real-DB evidence). OpenAPI lint
reported the same seven existing schema errors as pre-change HEAD: two unquoted
flow-description commas and five missing nullable type siblings in SAT schemas.
No OpenAPI lint success is claimed.

An earlier broader `-race` run of the entire API package failed on a shared
telemetry registry reassignment in statement-budget tests while an existing
staff-recovery test's live-bus goroutine was still running. It also found SAT
recovery fixtures missing adaptive policy in the reused local fixture DB. Those
failures are outside persistent login; the complete API race suite is not claimed
clean. The targeted auth/API qualification above executed without races or skips.
An initially skipped PDF test was rerun with `ANSWEREDPDF_DIST` and real Chromium
rendering and passed. One WebKit login failed in a heavily concurrent verification
run; three isolated repetitions and the subsequent full 15-test run passed.
A later redundant run exhausted local disk and timed out twice in Firefox.
After clearing task-generated artifacts, adding profile cleanup and migrating
a fresh isolated database, the final 15-test run passed without retries.
Generated Playwright profiles/reports are excluded from TypeScript scanning.

A local comparison copied the pre-change HEAD lookup into a temporary test,
measured 512 admissions with concurrency 8 and a 50/50 staff/student mix across
16 sessions, then removed the temporary code. This was a small, noisy local
sample, partly concurrent with browser startup, not deployed capacity evidence:

| Local measurement | Baseline SELECT/touch | New locked lookup |
| --- | --- | --- |
| p50 | 4.613 ms | 6.564 ms |
| p95 | 33.728 ms | 28.346 ms |
| p99 | 139.657 ms | 210.207 ms |
| Total for 512 requests | 658.882 ms | 787.824 ms |
| Pool wait count / duration | 0 / 0 | 0 / 0 |

The normal lookup now uses owner discovery, a transaction with UTC setup, user
and session locking reads, a database-clock read, optional touch and commit.
Recovery-scoped sessions additionally resolve their schedule. Even when no touch
is needed, the authority reads remain. The observed p99 increase exceeds the
plan's 10% investigation trigger. Keep new issuance disabled until deployment
load/lock/pool/latency qualification and an agreed capacity/SLO are recorded.

Local verification used MySQL 9.6.0. MySQL 8.4 CI configuration exists but the remote
CI job was not executed here. Public ingress/TLS, deployed primary routing,
operator names, actual device policy, incident rollback approval and production
load remain release prerequisites in the [runbook](../runbooks/persistent-login.md).
Implementation completion does not assert production rollout approval.
