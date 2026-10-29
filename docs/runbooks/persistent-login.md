# Persistent staff login

Implementation: [low-level plan](../plans/2026-10-29-persistent-login-low-level.md).
Verification: [2026-10-29 evidence](../operations/2026-10-29-persistent-login-verification.md).

## Production configuration

Configure the whole API fleet before deploying this release:

```dotenv
COOKIE_SECURE=true
AUTH_PUBLIC_ORIGIN=https://exams.example.com
SESSION_CACHE=off
PERSISTENT_LOGIN_ENABLED=false
SESSION_REMEMBER_STAFF_IDLE_HOURS=168
SESSION_REMEMBER_STAFF_ABSOLUTE_HOURS=720
SESSION_REMEMBER_ADMIN_IDLE_HOURS=24
SESSION_REMEMBER_ADMIN_ABSOLUTE_HOURS=168
```

Replace the example origin with the public browser origin. It must be HTTPS,
including the correct nondefault port when applicable, with no credentials,
query or fragment. Terminate TLS at the trusted public ingress; preserve the
browser Origin/Referer and forward cookies and CSRF headers. Do not derive this
setting from forwarded headers or the coediting service's origin. Confirm login and logout through the actual ingress before enabling issuance.
The API refuses insecure production cookies or an enabled process-local session
cache. Workers retain their own runtime validation.

Use one authoritative MySQL primary for all session reads, credential writers
and revocations. Replica lag is incompatible with immediate revocation. Read the
actual database engine/version and pool/timeout configuration during staging;
local verification used MySQL 9.6.0 and does not establish deployed compatibility.
CI uses MySQL 8.4. Validate the CI result for the deployment revision.

Normal password login with an explicit remembered choice can persist supported
admin/builder/proctor/grader sessions. Admin uses 24-hour idle / 7-day hard limits;
other supported staff use 7-day idle / 30-day hard limits. Unchecked or omitted
choice uses the configured short staff policy. Students, emergency master login,
practice and recovery scopes are not promoted. Admin-observer remains short until
frontend role parity is separately delivered. Existing sessions are not promoted.

## Rollout

1. Assign a release owner, database operator, and rollback decision maker in the
   deployment record. Record the public origin, primary routing, effective policy,
   browser matrix, capacity/SLO and shared-device policy. Missing owners or an
   unverified primary/origin are release gates.
2. Apply additive migration `0111_persistent_staff_sessions.sql` through the
   existing migrator. Never modify applied migration history. Rerun/partial-DDL
   and CHECK-constraint tests are in `cmd/migrate`.
3. Deploy the compatible backend to the entire fleet, with issuance disabled.
   All serving password writers must use the new transaction boundary. Offline
   seed/provision commands directly upsert credentials: run them only while
   serving traffic is stopped, or migrate them to the same locking/revocation
   boundary first.
4. Deploy the frontend after every backend accepts `rememberMe`. Old readers
   ignore stored idle policy, so never enable persistence during mixed versions.
5. Qualify actual ingress, secure cookie attributes, primary routing, two-instance
   revocation, instance restart, dependency outage/recovery and the browser matrix
   in staging. Run the required connected CI contracts; a skip fails qualification.
6. Measure baseline and new SQL count, lock waits, database pool use, restore and
   ordinary request p95/p99, and 429/503 rates with the deployment's real
   student/staff mix and simultaneous tabs. Investigate >10% regression and agree
   a capacity/SLO before enabling issuance. The local microbenchmark showed a
   tail-latency regression; it is not a production load test.
7. Enable `PERSISTENT_LOGIN_ENABLED=true` for the internal rollout cohort only
   after the entire serving fleet is compatible. The flag is fleet configuration;
   the application does not implement a per-user cohort service. Use a separately
   controlled internal deployment/cohort if required. Widen only after reviewing
   correctness and latency evidence.

## Behavior and operations

Session bearer tokens exist only in HttpOnly cookies; stored session tokens are
hashed. Idle extensions never move the hard deadline or password timestamp.
Ordinary staff polling does not refresh cookies. Prepared staff PDFs are bound
to the issuing session and expire no later than that session's deadline. Browser
printing or exports from data already loaded remain outside this server boundary.

Current-device logout is idempotent even with an expired cookie. Offline logout
hides private UI immediately and persists only a credential-free intent; recovery
runs before restoration. If browser storage fails, the UI explains that the tab
must stay open. When an all-device response is lost and the session is already
absent, only current-browser sign-out is confirmed. Explicitly sign in and repeat
logout-all to confirm its wider scope. No anonymous check proves all devices were
revoked.

Web Locks serialize credential changes in cooperating tabs. Browsers without
Web Locks can use short login but cannot select remembered login. Broadcasts
contain only invalidation types and random operation IDs, never user objects or
credentials. Database authorization remains authoritative for old clients too.

Monitor `auth_session_lookup_total{outcome="restored|absent|transient"}`,
`auth_session_lookup_seconds`, alongside
existing HTTP status/latency, query duration, pool wait and deadlock metrics.
These labels contain no user/session identifiers. Error responses for auth routes
carry `Cache-Control: no-store`. Do not record request bodies, cookies, CSRF tokens,
passwords, password hashes or bearer tokens in deployment logs.

## Rollback

Disable new remembered issuance first. This does not revoke previously issued
credentials. Keep primary-backed admission, the cache disabled, and the additive
schema. If reverting to an old reader is necessary, first
have the operator approve the sign-in impact and revoke live remembered sessions
under the same user/session locking order as other lifecycle changes. Verify
that no remembered row remains live before deploying old readers. Do not drop
columns or undo migration history.

Stop rollout immediately for authorization after revocation on a new request,
student scope expansion, a protected action admitted without its role check, or a credential
leak. Investigate false login redirects, restore failures and the agreed latency
threshold before widening the cohort.
