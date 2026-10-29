# Low-level implementation plan: persistent login

Status: implemented locally, 2026-10-29. Input: [approved architecture](./2026-10-29-persistent-login.md). See [implementation evidence](../operations/2026-10-29-persistent-login-verification.md) and the [rollout runbook](../runbooks/persistent-login.md). The design below records the original implementation contracts; execution evidence and remaining deployment qualification are tracked separately. Production issuance remains disabled by default.

## 1. Change boundary and repository evidence

Keep the approved architecture: opaque browser cookie, hashed bearer in `user_sessions`, authoritative database expiry/revocation, explicit remembered-device choice, and password confirmation for sensitive actions. Implement automatic restoration within bounded policy, not an unbounded credential. Student authentication origins and attempt bearers retain their authority boundaries.

Default policy remains ordinary remembered staff: 7-day idle / 30-day hard maximum; admin and admin-observer: 24-hour idle / 7-day hard maximum; opt-out: configured existing staff policy, default 30 minutes / 12 hours. Student and emergency-master entry do not opt into staff persistence. Password freshness is 15 minutes. These are proposed product limits, not mandated standards.

Qualification refinement: the current frontend role union and router role lists omit backend `admin_observer`. This delivery's remembered-browser allowlist is therefore the currently supported admin/builder/proctor/grader roles. Observer API login retains short-session policy; applying the proposed admin persistence limits to observers waits for a separate verified frontend role-parity change. Do not expand reader permissions incidentally to this work.

### Verified implementation map

| Existing file / symbols | Verified role / consequence |
| --- | --- |
| `backend/go/internal/auth/auth.go`: `Session`, `SessionExpiry`, `CreateSession`, `CreateSessionInTx`, `LookupSession`, `RevokeSession`, `RevokeAllSessions`, `VerifyPassword`, `VerifyCSRF` | Session rules, SQL, password primitives and origin checks currently share this package. Reuse it as domain owner; do not add another authentication service. Lookup currently performs SELECT followed by unconditional touch. |
| `backend/go/internal/auth/sessionlookup_cache_impl.go`: `LookupSessionWithCache`, revoke wrappers | Duplicates DB lookup/touch and optionally authenticates from process-local cache. New persistent sessions must not depend on local cache coherence. |
| `backend/go/cmd/api/handlers_auth.go`: login/reset/activation/logout/session handlers, response/cookie helpers | Normal login verifies password before creation; successful login unconditionally writes account state active. Reset and activation are both credential writers. Reset currently commits before revocation. Cookie response currently recomputes deadlines. |
| `backend/go/internal/app/app.go`: recovery `CreateSessionInTx` adapter; `cmd/api/student_entry_recovery.go`; `handlers_device_recovery.go` | Alternative creation/cookie paths. Preserve legacy signatures as adapters so staff changes do not spread into exam recovery transactions. |
| `backend/go/internal/auth/session_proof.go`; `cmd/api/recovery_session_scope.go` | Source `account` also includes trusted bootstrap, not only password login. Source alone is not evidence of fresh password authentication. |
| `backend/go/internal/platform/tx/tx.go`: `Begin`, `Runner.WithTxRC`, retry methods | Existing transaction boundary and UTC setup. Retry implementation classifies MySQL 1213/1205 only; do not assume a connection/commit error is safely retried. |
| `backend/go/internal/platform/apperrors/errors.go`: `Code`, `statusFor`; `cmd/api/query_timeout.go`: `MapDBError` | Stable wire codes/statuses and transient database mapping. Add a real error code rather than matching message text. |
| `backend/go/internal/platform/db/schema.go`; `cmd/migrate/main.go`; migrations `0109`, `0110` | Startup schema guard, checksum/history tracking, lexical migrations, and guarded partial-DDL recovery. Never edit applied migration files. |
| `src/services/authService.ts`; `src/features/auth/authSession.tsx`; `src/shared/api/apiClient.ts` | Service has one global in-flight session promise; provider owns live app identity; client invokes global 401 handler before parsing its error. These three boundaries must cooperate without circular requests. |
| `src/app/router/createRouter.tsx`: `AdminIndexRedirect`, `SatIndexRedirect`; auth pages; `StudentEntryRoute.tsx` | Other consumers branch on auth status. Only changing `RequireAuth` would leave false redirects and false student “not resumable” decisions. |
| `src/features/results/api/satRawdataExport.ts`; `src/features/student-delivery/api/answeredExamPdf.ts` | Raw fetch paths bypass the shared API client and currently erase structured backend errors. They need the same generation/error reporting contract. |
| `backend/go/cmd/api/handlers_pdf_download.go`: prepare/download handlers | Prepared PDF records already bind staff user + session ID. Shared download route also serves students; do not put a blanket staff-password guard on it. |
| `src/services/examLifecycleService.ts`: `deleteExam`; `src/services/gradingService.ts`: release methods | Some domain adapters return error strings. Notify the shared reauth UI before those adapters erase the structured rejection; do not require a rewrite of every feature service. |

Inferred: the owning boundaries above can deliver this without JWTs, refresh-token storage, Redis, or a repository-wide auth-state rewrite. Unknown: deployed DB engine/version, replica/primary routing, session cache setting, effective timeout values, public origin/proxy contract, browser support matrix, actual load, and whether staff devices are personal. Resolve through non-secret deployment inspection and staging tests; no production measurements are claimed.

### Refinements required by the deeper inspection

1. **Credential locking includes activation.** All runtime password writers must participate; reset alone cannot establish the stale-password invariant. Offline seed/provision tools must be documented as maintenance-only or updated before being used against a serving deployment.
2. **A frontend generation cannot undo `Set-Cookie`.** Serialize credential-changing requests in cooperating tabs; after ambiguous network outcomes, reconcile authoritative state. Do not claim that dropping JSON prevents cookie races with old clients or navigation.
3. **Logout-all ambiguity differs from current-device logout.** If its response is lost and the current cookie disappears, an anonymous check cannot prove that every device was revoked. Show “this browser is signed out; all-device sign-out is unconfirmed” and require explicit authenticated retry.
4. **Strict expiry must be evaluated after lock acquisition.** A timestamp captured before a long lock wait is insufficient to promise that an expired session cannot be extended. Use DB time after locking the session. This costs additional database work; measure it before enabling persistence.
5. **UI exports are not all server exports.** This scope protects the enumerated server export boundaries below. Browser printing or CSV generation from data already authorized and loaded is not prevented by a server freshness guard. Do not advertise a universal data-loss-prevention guarantee.

## 2. Requirements, rules and invariants

Carry forward FR-1–FR-6 and INV-1–INV-6 from the architecture. The following operation contracts make their enforcement concrete.

| Operation | Preconditions | Committed success | Failure and unchanged-state guarantee |
| --- | --- | --- | --- |
| Password login | Valid shape; permitted origin; current account/password; abuse budget | Session + creation audit committed, stored policy/deadlines returned, secure cookies issued | Wrong credentials -> generic 401; malformed flag -> 400; DB unavailable -> 503; disabled/indefinitely locked account never reactivated by success logic. Failed-attempt counters may change deliberately. |
| Session restoration | Browser cookie names a live row and currently eligible account | Identity returned; only idle deadline may advance | Unknown/revoked/expired -> session 401; DB failure -> 503; no cookie deletion or false unauthenticated state on dependency failure. |
| Password confirmation | Live staff account session; same actor; actual account password; CSRF/origin | Prior session revoked + replacement session/audit committed together | Wrong password -> 401 without global UI logout, except an actual account lockout may invalidate sessions; stale/current-session race -> 401; no partial replacement. |
| Password reset | Valid single-use token; server-derived token owner | Token consumed, password changed, prior sessions revoked, short replacement session created in one commit | Any pre-commit failure rolls all state back. Lost post-commit response is ambiguous; never automatically replay the consumed token. |
| Current logout | Same-origin request; cookie possession, with normal CSRF if session still live | Named token revoked if present; auth cookies removed; duplicate is successful | DB/commit error -> 503, local private UI hidden, logout intent remains pending; no server-success claim. |
| Logout-all | Live account session; origin/CSRF | All sessions existing at serialized revocation point revoked; cookies removed | Unknown post-commit outcome remains unconfirmed. A later deliberate password login is allowed. |

Rules: request polling never changes `credential_authenticated_at` or hard expiry; only an explicitly requested password login can opt into staff persistence; reauth retains the existing preference. Expiry comparisons are strict (`deadline > decision_time`), so equality is expired. Revocation is terminal for a token. Requests admitted before revocation may finish under their domain transaction rules; this feature does not retroactively cancel committed work.

Invariant owners:

- INV-1 account/session authority -> `auth` DB lookup, existing route role/scope authorization.
- INV-2 monotonic idle, fixed hard lifetime -> `auth` policy + locked touch.
- INV-3 terminal revocation -> `auth` transactional lifecycle functions.
- INV-4 real password freshness / same actor -> `auth` password workflows + freshness guard.
- INV-5 reset atomicity / stale-password exclusion -> common user/credential/session lock order across all runtime writers.
- INV-6 actor isolation / no student-scope expansion -> provider generation, transport response fence, origin-specific session issuance and existing attempt owners.

## 3. Entities, ownership and relationships

### Stored values

Add, through a new migration provisionally named `0111_persistent_staff_sessions.sql` (recheck the next number at execution):

| Column | Type / fallback | Purpose and writer |
| --- | --- | --- |
| `remembered` | `BOOLEAN NOT NULL DEFAULT FALSE` | Staff cookie persistence preference; password issuance only. Existing rows are not promoted. |
| `idle_window_seconds` | `INT UNSIGNED NULL` | Policy snapshot; new issuance persists it, lookup never changes it. NULL uses legacy role config. |
| `credential_authenticated_at` | `TIMESTAMP NULL DEFAULT NULL` | Accepted real password-authentication event; normal password login/reauth only. Other account sources leave NULL. Never backfill from `last_seen_at`. |

Add guarded CHECK constraints: remembered is 0/1; idle window is NULL or positive; remembered implies source `account`, no practice/recovery scope, eligible staff role, non-NULL idle window and password-authentication time. Do not constrain every legacy row to `idle_timeout_at <= expires_at`: existing rows may exceed that while lookup already enforces absolute expiry. New issuance/touch enforce the cap. Add the columns to `RequiredColumns` and test migration constraints directly; follow the existing metadata/prepare/execute style for partial-DDL reruns. No new table or index is needed for the normal token-hash lookup.

Proposed additions in package `auth`:

```go
type SessionPolicy struct {
    Remembered bool
    IdleWindow time.Duration
    AbsoluteLifetime time.Duration
}

// Add to existing Session; zero values preserve old fake/test callers.
// Remembered bool
// IdleWindowSeconds *int64
// CredentialAuthenticatedAt *time.Time
// ValidatedAt time.Time // derived DB admission time, not a new column

// Internal workflow result, never directly JSON-encoded or logged.
type CreatedSession struct {
    Session Session
    Token string // raw bearer: HTTP cookie boundary only
    User SessionUser // minimal locked identity summary for response
}
```

`SessionUser` is a small value containing only existing response identity fields, not a second persistent user model. `Session.Proof` remains the source/scope authority. `ValidatedAt` is assigned after locked lookup, so freshness guards use the same database admission clock rather than assuming API hosts have identical clocks. Cookies and React state are derived representations; they cannot authorize requests independently.

### Responsibility and SOLID application

| Unit | Single responsibility / dependencies |
| --- | --- |
| Proposed `internal/auth/session_policy.go` | Pure role/origin/config -> policy and freshness decisions; no HTTP, database or React. |
| Existing `auth.go` plus proposed `password_sessions.go` | Session persistence and password workflow transactions; reuse `*sql.DB`, `tx.Begin`, hashing and typed errors. No speculative repository interfaces. |
| Existing HTTP handlers + proposed `cmd/api/session_freshness.go` | Decode, trusted request context, CSRF/origin, response/cookies and route guard placement. No independent lifetime calculation. |
| Proposed `src/features/auth/authSessionState.ts` | Pure discriminated state transitions. Cannot authenticate from localStorage. |
| Existing `AuthSessionProvider` | Async lifecycle, retries, cross-tab signals, query isolation and reauth UI coordination. Does not choose server policy. |
| Existing `AuthService` / `ApiClient` | Wire parsing, generation-scoped single-flight, typed failures, response fencing. Transport reports failures; provider decides UI state. |

This applies SRP through ownership, OCP through the policy function, LSP through legacy adapters preserving existing contracts, ISP by reusing narrow existing boundaries, and DIP by keeping domain policy independent of HTTP/React. Do not introduce classes/factories/interfaces solely to name a principle.

Client state is a discriminated union, projected onto existing `session`/`status` consumers:

```ts
type AuthState =
  | { kind: 'checking'; generation: number }
  | { kind: 'signedOut'; generation: number }
  | { kind: 'unavailable'; generation: number; error: AuthFailure }
  | { kind: 'signedIn'; generation: number; session: AuthSession;
      recovery: 'idle' | 'retrying' | 'unavailable' }
  | { kind: 'logoutPending'; generation: number; intent: LogoutIntent;
      phase: 'sending' | 'retryable' | 'allDevicesUnconfirmed' };
```

`LogoutIntent` contains version, random operation ID, mode current/all, and creation time; no email, user object, session ID, CSRF or bearer. Store only this intent and credential-free invalidation notifications. The live session and password stay in memory. A missing/malformed local record never grants authentication. If intent persistence fails, hide private UI and report that offline logout cannot be remembered across restart; do not claim that it succeeded durably.

| State / event | Next state / effect |
| --- | --- |
| Checking + valid session response for same generation | SignedIn. |
| Checking + definitive session 401 | SignedOut; clear actor queries/headers. |
| Checking + transport/429/503 | Unavailable; no protected render or login redirect. |
| SignedIn + transient refresh failure | SignedIn/recovery unavailable; server still authorizes every request. |
| Any + logout intent | Increment generation synchronously, hide identity, cancel/clear queries, LogoutPending. |
| LogoutPending + confirmed revocation of requested scope | SignedOut; clear matching operation ID only. |
| LogoutPending/all + current session absent, all scope unconfirmed | Stay allDevicesUnconfirmed; offer explicit login then logout-all. |
| Any + stale generation response | Ignore/cancel; cannot change state or populate actor caches. |
| Reauth required | Keep SignedIn; open confirmation dialog, do not replay original operation. |

## 4. Exact function-level design

The existing targets named here were inspected. All additions and signature changes are proposals.

### 4.1 Configuration and pure policy

In `internal/platform/config/config.go`, add `PersistentLoginEnabled`, remembered staff/admin idle/absolute durations, and freshness duration. Proposed env names: `PERSISTENT_LOGIN_ENABLED=false`, `SESSION_REMEMBER_STAFF_IDLE_HOURS=168`, `SESSION_REMEMBER_STAFF_ABSOLUTE_HOURS=720`, `SESSION_REMEMBER_ADMIN_IDLE_HOURS=24`, `SESSION_REMEMBER_ADMIN_ABSOLUTE_HOURS=168`, `SESSION_CREDENTIAL_FRESH_MINS=15`. Validate positive integer durations, idle <= absolute, explicit upper bounds of 720 hours for remembered policy and 60 minutes for freshness, and overflow before duration multiplication. These bounds are proposal limits. The API startup check for this session-lifecycle release rejects `SESSION_CACHE=on` regardless of the issuance flag: otherwise turning issuance off could leave remembered rows served from incoherent caches. Preserve isolated cache unit/benchmark code, but keep API serving cache off throughout issuance, serving and rollback.

In proposed `session_policy.go`:

```go
func policyForPassword(cfg config.Config, role string, remember bool) (SessionPolicy, error)
func legacyPolicy(cfg config.Config, role string) SessionPolicy
func requireFreshPassword(s *Session, now time.Time, window time.Duration) error
```

- `policyForPassword`: student and currently unqualified admin-observer -> legacy; supported ordinary staff/admin class -> remembered policy only if requested and enabled; otherwise legacy. Unknown role -> deny, not default to ordinary staff. Master/bootstrap/reset/activation use legacy issuance and cannot call the password-authenticated policy constructor accidentally.
- `requireFreshPassword`: require live eligible staff account proof; reject NULL/future authentication time or age >= window with new `CodeReauthRequired`, mapped explicitly to HTTP 403 in `apperrors.statusFor`. Existing role/scope checks still apply. Never treat `issued_at` or source `account` as password evidence.
- Feature flag stops new remembered issuance, not interpretation of existing remembered rows. Sensitive-action freshness enforcement must remain active while any remembered sessions remain valid.

### 4.2 Issuance and password workflows

Retain existing exported `CreateSession` / `CreateSessionInTx` signatures for student/recovery/bootstrap callers. Delegate shared insertion/audit to one internal helper accepting a resolved policy and optional authenticated time, returning `CreatedSession`. Legacy wrappers keep remembered=false, NULL idle snapshot and NULL freshness and unwrap the old return tuple; this preserves student/config fallback semantics. New staff password workflows persist their selected idle snapshot; a student password login remains on the legacy metadata path. Do not duplicate token generation, scope validation, or insert statements.

Proposed workflow entry points in `internal/auth/password_sessions.go`:

```go
func LoginWithPassword(ctx context.Context, db *sql.DB, cfg config.Config,
    email, password string, remember bool, uaHash *string) (CreatedSession, error)
func Reauthenticate(ctx context.Context, db *sql.DB, cfg config.Config,
    currentID, userID, password string, uaHash *string) (CreatedSession, error)
func CompletePasswordReset(ctx context.Context, db *sql.DB, cfg config.Config,
    token, newPassword string, uaHash *string) (CreatedSession, error)
func CompleteActivation(ctx context.Context, db *sql.DB, cfg config.Config,
    token, newPassword, displayName string, uaHash *string) (CreatedSession, error)
```

All identities except normalized login email come from trusted session/token records. These functions own their transactions; HTTP handlers do not compose partial commits around them.

Common password-login/reauth algorithm: read current hash snapshot -> perform Argon2/bcrypt verification outside locks -> begin transaction -> lock user -> current-read credential and compare **exact hash** to verified snapshot -> reread current account state -> use DB decision time -> commit a failed-attempt update or complete issuance. Hash mismatch means generic invalid credentials and no session, not a retry with the old proof. Do not use second-resolution `updated_at` as the credential fence. Never log the snapshot or password.

On wrong password, the failed-attempt counter/lockout update must commit before returning 401. Do not return the authentication error from inside a transaction callback and accidentally roll back the counter. Account eligibility is rechecked under lock: never overwrite `disabled` or `pending_activation` with active; automatically clear a lock only when it is the existing timed failed-login lock and its valid deadline has passed. A concurrent new disable/role change wins over a previously verified password.

Reauth additionally locks/revalidates the exact current session; it must still be live, belong to the same user and account origin, and retain its current remembered preference. Revoke it, insert replacement/session audit, commit once. Only afterward invalidate the old cache entry and send cookies. Two concurrent confirmations cannot both replace the same current session. Wrong-password confirmation uses existing abuse policy; reaching the real lockout threshold may invalidate current access, which is distinct from UI logout on every wrong password.

Reset/activation hash the new password outside the transaction, then lock the owner user, credential, token, and affected sessions in the order below. Revalidate token hash/type/owner/deadline/unused state under lock; consume it, update credentials/account transition, revoke old sessions, create a legacy short replacement, commit once. Activation may transition pending-activation or the existing eligible activation state, but cannot reactivate a disabled account merely because an old token exists. Reset clears timed password lockout when permitted; it cannot silently undo an administrative disable. Preserve the existing response/short-cookie contract.

Add `revokeUserSessionsInTx(ctx, q tx.Tx, userID, reason string, now time.Time) error`, shared by reset/activation/logout-all. Capture precisely the live row IDs being revoked under lock, update them, and write their audit rows in the same transaction; do not infer IDs from a timestamp-equality/range query that can include earlier revocations. `RevokeAllSessions` remains a transaction-owning compatibility wrapper. Post-commit cache invalidation never happens before the database decision commits.

### 4.3 Lock order, authoritative lookup and touch

Use `users` -> `user_password_credentials` (if needed) -> reset/activation token (if needed) -> `user_sessions` in stable ID order -> session events. Session creation obtains at least a user shared lock; reset/activation/logout-all obtain the user exclusive lock. A single-session revoke may lock only that row, provided it never subsequently acquires an earlier lock. Existing recovery wrappers still participate through the shared user lock and insertion helper. Do not pull attempt/domain row locks into session lookup. Inventory maintenance writers separately before live use.

Consolidate DB session lookup/touch in `auth`, removing duplicated authority decisions from the cache-disabled path. Proposed `LookupSession(ctx, db *sql.DB, cfg, token)` drops caller-supplied request-start time in favor of DB decision time. Adjust `LookupSessionWithCache`, `defaultSessionResolver`, the local `SessionResolver` type and their tests accordingly; existing test resolvers remain injectable. All inspected production callers resolve through `defaultSessionResolver` and concrete SQL DB handles. New methods/functions must not dynamically assert BeginTx support on a handle that may not have it.

The strict implementation is:

1. Discover candidate `user_id` by unique token hash on the primary, without taking locks; this is only a locator, never an authorization decision.
2. `tx.Begin` with explicit READ COMMITTED; user `FOR SHARE`, then exact session `FOR UPDATE`. Recheck that locked session still has the discovered owner and supplied hash. Select only session fields under that lock; do not use a broad join that locks recovery attempt rows in a different order.
3. Fetch `UTC_TIMESTAMP()` **after locks are acquired**. Use the database's existing timestamp precision consistently. Read any recovery-scope locator without taking an attempt mutation lock, then validate stored proof with existing rules.
4. Validate current account role/state, revocation, idle/hard deadline, remembered metadata, and scope. Bad/absent state -> rollback/read-only completion and `(nil, nil)`; operational errors -> error, never absence.
5. Compute `newLastSeen = max(storedLastSeen, dbNow)` and `newIdle = min(expiresAt, max(idleTimeoutAt, dbNow + effectiveIdleWindow))`. Snapshot window is used when present, otherwise legacy policy. Monotonicity applies to the effective deadline `min(idleTimeoutAt, expiresAt)`; normalizing a legacy idle value beyond hard expiry does not reduce valid authority. Skip a physically unchanged UPDATE; a no-op is still a valid session, not a failed authorization.
6. Update locked row and commit before returning session metadata, setting derived `ValidatedAt` to this DB decision time. On failed/ambiguous commit return retryable service error; do not publish the computed deadline as persisted. Absolute/password-authentication times remain unchanged.

This deliberately replaces the stale-read/unconditional-update race with a short transaction at the shared boundary. It adds round trips/locking compared with today's SELECT+UPDATE; no speedup is claimed. Test actual staff/exam workloads and DB engine semantics before rollout. If it misses the agreed latency/capacity gate, optimize query/lock acquisition against the verified engine without weakening admission semantics. Do not restore cache authentication as a shortcut.

`LookupSessionWithCache` delegates directly to this owner when cache is disabled. Remembered serving is release-gated on all processes having cache off; compatibility cache code is not evidence of multi-instance revocation. Record a separately reviewed coherence design before ever enabling it for remembered rows.

### 4.4 HTTP contract, cookies and origin

In `handlers_auth.go`, extend `loginRequest` with `RememberMe *bool` so omission and explicit false are supported; reject non-boolean JSON through existing strict decoder. Normal password login calls `LoginWithPassword`; master-key branch remains legacy with NULL password freshness. Response additions are `remembered: boolean` and `credentialAuthenticatedAt: string | null`; existing fields remain unchanged.

Add `reauthenticateHandler` and an authenticated route in `main.go`/`authz/table_auth.go`. Require account-origin staff session, CSRF, origin and credential-attempt limiter before invoking the workflow. Proposed request `{password}` only: no user ID, role, duration or remembered override. Bad password is 401; expired session is 401; stale password for a protected action is 403 `REAUTH_REQUIRED`; store errors are 503. Reauth requests set `skipUnauthorizedHandler` on the frontend.

Introduce `writeAccountSession(w, r, app, created)` with a pure JSON projection from the workflow result, using persisted deadlines. No post-commit user lookup is necessary for the new account path. Existing practice-specific `buildSessionResponse` behavior and student `setCreatedSessionCookies` calls remain adapters. One internal cookie builder owns attributes; account writer sets persistence only from `created.Session.Remembered`, while the existing student adapter keeps its established persistence behavior. Set-Cookie only after acknowledged commit; preserve Secure/HttpOnly/Path=/, no Domain, existing SameSite. CSRF cookie remains readable. Cookie Max-Age/Expires use remaining absolute lifetime, never idle expiry. Staff middleware does not emit cookies on ordinary requests.

Add a small no-store middleware before authentication/CSRF for `/api/v1/auth/*`, so even early errors carry `Cache-Control: no-store`. Same-origin handling must cover anonymous logout and credential-establishing POSTs too, including login CSRF. Existing `sameOriginAllowed` compares only hostname and ignores ports/scheme: do not claim exact-origin validation from it. Add proposed `AUTH_PUBLIC_ORIGIN` / `Config.AuthPublicOrigin` for these browser-auth boundaries. New API production startup requires `COOKIE_SECURE=true` and a valid HTTPS exact origin with no user-info/path/query/fragment, even while new issuance is disabled; set this non-secret configuration before deploying the new binary. Compare normalized scheme/host/effective port against Origin or Referer and reject foreign/null origins. Missing both is accepted only for `Sec-Fetch-Site: same-origin`, otherwise rejected; update CLI/test clients to supply Origin. Derive fallback local-development origin from the actual request, never an arbitrary untrusted forwarded host. Keep proxy configuration explicit in the runbook; do not reuse the coedit origin config.

Make logout's authz entry public **only for revoking the supplied current cookie and clearing cookies**, with same-origin validation still enforced and normal CSRF when a live session is available. Anonymous logout gains no account identity or logout-all capability. Missing/unknown/already-revoked token -> success; DB unavailable -> 503. Keep logout-all authenticated. Do not write positive cookie refreshes before logout; existing student reissue is overwritten by the later matching clear.

### 4.5 Sensitive-route manifest

Wrap these inspected full mounted registrations in `main.go` with proposed `withFreshPassword(app, handler)`, inside their existing authorization wrapper and before domain side effects. Pass `Session.ValidatedAt` to the pure freshness decision; a zero value from a test/fake resolver fails closed unless the test supplies an explicit admitted time. Existing role/scope guards are retained; freshness is an additional requirement, not an authorization grant. The policy table's mount-relative `POST /export` cannot distinguish all these operations.

| Mounted route | Guard placement / special handling |
| --- | --- |
| `DELETE /api/v1/exams/{id}` | Guard the exam-delete registration. |
| `POST /api/v1/grading/submissions/{submissionID}/release-now` | Guard before release handler. |
| `POST /api/v1/grading/submissions/{submissionID}/schedule-release` | Guard scheduling request; a later worker executing the committed schedule does not need an interactive session. |
| `POST /api/v1/grading/export` | Profile-export alias, guarded. |
| `POST /api/v1/results/export` | Guarded. |
| `POST /api/v1/results/export-profile` | Deprecated profile-export alias, guarded. |
| `GET /api/v1/results/sat/export/rawdata` | Guarded before any export bytes. |
| `GET /api/v1/answer-history/submissions/{submissionID}/export` | Guarded. |
| `POST /api/v1/sat-answered-pdf/attempts/{attemptID}` | Legacy staff PDF generation, guarded. |
| `POST /api/v1/sat-answered-pdf/attempts/{attemptID}/prepare` | Staff prepare, guarded; inside `prepareAnsweredPDFHandler` cap publish expiry to min(session hard deadline, credential fresh-until). Recheck the bound immediately before publication if rendering crossed freshness expiry. |
| `GET/HEAD /api/v1/sat-answered-pdf/downloads/{exportID}` | Shared staff/student handler: retain current binding/user/session/assignment validation. Staff records created under this policy expire no later than the credential freshness cap. Do not globally require a staff password on student downloads. Pre-policy staff records are rollout compatibility data with existing bounded TTL, not proof of new freshness. |

Routine reads, authoring saves, student bearers and proctor exam-control routes keep their existing policy. Add a route test for every row/alias, including a denied student/recovery principal. Browser-side export of already loaded data is explicitly outside the manifest.

### 4.6 Frontend transport, state and UI

In `src/services/authService.ts`:

```ts
type LoginPayload = { email: string; password: string; rememberMe?: boolean };
// Extend existing AuthSession with optional additive fields above.
getSession(generation: number, signal?: AbortSignal): Promise<AuthSession | null>;
reauthenticate(password: string): Promise<AuthSession>;
invalidateSessionRequest(): void;
```

Single-flight is scoped by generation, not one process-wide promise across actors. A pending request's `finally` clears only its own promise identity, not a newer request's flight. The service owns its transport AbortController; a joining caller's signal cancels only that caller's wait, not the shared request. Actor-generation invalidation may abort the old service flight. This keeps StrictMode/unmount cleanup from canceling another live caller. Session checks use `retries: 0` and `skipUnauthorizedHandler: true`; only an exact 401/explicit empty-session contract yields null. Malformed success payload is unavailable/protocol failure, not logged out. Service exposes no automatic mutation retry. Reauth/login/reset/activation bypass unrelated global sign-out effects for their own credential errors.

In `src/shared/api/apiClient.ts`, keep existing consumer methods, extend unauthorized context to include request generation and parsed `ApiError`. Add these narrow capabilities rather than a generic event bus:

```ts
setAuthGenerationReader(reader: (() => number) | null): void;
setReauthenticationRequiredHandler(handler: ((e: ApiError) => void) | null): void;
captureAuthGeneration(): number | undefined;
assertAuthGeneration(captured: number | undefined): void;
reportAuthFailure(error: ApiError, context: AuthRequestContext): Promise<void>;
// Proposed AuthRequestContext contains endpoint, method, requestId,
// captured generation, and skipUnauthorizedHandler; no credential fields.
```

`request` captures generation at dispatch; checks before each retry, before reporting an error and after body parsing/before returning data. A changed generation throws a local `AbortError`-shaped cancellation without retries or credential-error UI. Parse error first, then report exact 401 or 403 `REAUTH_REQUIRED`. `reportAuthFailure` uses registered handlers and the same generation checks; it never stores identity or replays the failed operation. Raw adapters call this narrow reporting/fencing contract. Preserve existing authorization-header/CSRF precedence, student attempt handling and retrySafe rules. Do not route all bearer 401s into cookie logout: session checks own the cookie verdict.

Provider ordinary-401 handler checks originating generation, then performs one deduped session check with unauthorized reporting bypassed. Null -> sign out and clear caches; valid -> keep/reconcile identity; transient -> retain warm identity/recovery state. Return to the original request as an error; do not retry a mutation automatically. This avoids reentrant 401 -> session check -> same handler loops.

In `authSession.tsx`, add pure `reduceAuthState(state, event)` in proposed `authSessionState.ts`, and route all state changes through one transition helper. Update latest-state/generation refs synchronously at transition time rather than waiting for `useEffect`. On identity-changing operations: increment generation, invalidate session flight, stop previous retry timer, cancel active queries and clear private caches, then apply only matching-generation results. Same-actor reauth increments the credential generation but preserves mounted draft UI; do not clear unrelated unsaved work. Cancel/clear reads before replacing identity, and fence completed 200 responses too, not only late 401s.

Provider owns recovery: one abortable timer per generation; proposed retry delays 1, 2, 4, 8, 16, then 30 seconds with jitter while visible/online; honor server Retry-After as a lower bound rather than capping it to an earlier retry. Parse both delta-seconds and HTTP-date forms; clamp invalid/past values to the normal backoff and never jitter below a valid server deadline. Hidden/offline tabs pause timers. Retry button and online/visibility events reuse the same flight; visibility triggers recovery checks when pending or stale, not a periodic keepalive. StrictMode cleanup removes listeners/timers and cancels its own wait without canceling another subscriber's shared service flight.

Cross-tab coordination belongs in proposed `src/features/auth/infrastructure/authBrowserCoordination.ts`: versioned logout-intent storage, BroadcastChannel with storage-event invalidation fallback, and `withAuthMutationLock<T>(operation)` using `navigator.locks.request('ielts-auth-mutation', {mode:'exclusive'}, ...)`. Use the lock for login, reauth, reset completion, activation, and logout; read intent before and after waiting for it. Reconcile credential-establishing success against a new non-cached server session check while still holding the lock before unlocking protected rendering. The lock serializes cooperating browser code, not database authorization or old clients. If Web Locks is unavailable, use an in-tab promise queue and focus reconciliation; keep remembered mode unavailable on that unqualified browser rather than claim cross-tab serialization. Ordinary short login remains available. No localStorage spinlock pretending to be atomic.

On another tab's credential event, fence old work and recheck the server. A logout event immediately hides identity. Publish invalidation only after the corresponding operation/intent is established; include random event/operation ID to avoid loops and clearing a newer intent. Messages carry no credentials or authoritative user object. A browser/transport cancellation cannot roll back a server commit or Set-Cookie already applied; an ambiguous mutation enters recovery, and the next server check reconciles the actual cookie. Account switch requires server-confirmed identity before protected rendering.

UI changes in existing `LoginPage.tsx` and `validation/authForms.ts`: explicit remembered checkbox with shared-device copy, initially checked for the agreed personal-device policy; omission from old clients remains false. Add proposed `AuthUnavailableSurface.tsx` using existing `ErrorSurface`, and `ReauthenticateDialog.tsx` using existing `Dialog`/input/button primitives. Dialog states required/submitting/error retain mounted content; autocomplete=current-password, focus trap/restore, labelled errors, escape/cancel, no credential persistence, reset password state on close/submit completion. Multiple REAUTH_REQUIRED errors open one dialog. Successful confirmation says to repeat the original action; unsafe mutations are never queued for blind replay.

Update all inspected status branches: `RequireAuth.tsx`, `LoginPage.tsx`, `ActivateAccountPage.tsx`, `PasswordResetRequestPage.tsx`, `PasswordResetCompletePage.tsx`, `AdminIndexRedirect`/`SatIndexRedirect` in `createRouter.tsx`. Unavailable/logoutPending must not fall through to a login redirect. Token-reset/activation pages may still display their explicit token forms according to existing behavior, but cannot infer that a failed bootstrap proves logout. In `StudentEntryRoute.tsx`, map unavailable cookie-auth restoration to the existing transient reconnect surface instead of `not-resumable`; keep independent attempt/entry capability paths intact. `ConnectionRecoveryNotice` calls the same refresh owner, avoiding a second scheduler.

Raw-fetch adapters: `satRawdataExport.ts` and `answeredExamPdf.ts` capture generation, parse structured backend error into existing `ApiError`, report through the shared transport hooks and assert generation again before blob download/returning a prepared URL. Keep their successful filename/PDF validation and student caller headers unchanged. No reauth notification for attempt-token failures. Staff must reprepare a session-bound PDF after reauthentication rotates its session. Existing adapters that turn errors into strings still receive their original failure; the provider has already received REAUTH_REQUIRED. No broad service-contract rewrite is needed.

### 4.7 Logout-intent recovery

`logout()` / `logoutAll()` first create a versioned intent and increment generation; never wait for the network before hiding private UI. Clear/cancel current actor data and broadcast intent. Inside mutation lock, send the requested POST with no automatic retry by transport. On confirmed success, remove only that intent operation ID, then signedOut. On timeout/503/offline, retain intent, expose scope and retry option, and retry before any automatic restoration after reconnect/restart.

For current-device pending logout, repeatedly revoking whatever cookie is currently present is safe only while no deliberate new login has replaced the intent. Check operation ID inside the mutation lock; a user-confirmed new login supersedes the old current-device intent and old retry completions cannot clear/revoke the new state. Do not send a delayed old logout after new login.

For all-device pending logout: if the session remains live, retry the same authenticated logout-all. If it is absent, clear current-browser private state/cookies via current logout but keep all-device outcome unconfirmed; require explicit sign-in and retry logout-all to confirm that scope. Do not quietly downgrade to current-device success. A successful later login alone does not claim the previous all-device request completed. No receipt table is added for a recovery guarantee the existing API cannot provide.

## 5. Consequential control flow

Pseudocode is design only; use existing Go/TypeScript idioms when implementing.

```go
// Password snapshot verified outside transaction; authoritative fences inside.
sqlTx := tx.Begin(ctx, db, readCommitted)
defer rollback(sqlTx)
u := lockUserForUpdate(sqlTx, candidateUserID)
credential := lockCredential(sqlTx, u.ID)
if credential.Hash != verifiedSnapshotHash { return invalidCredentials }
now := readDBTime(sqlTx)
if !accountEligible(u, now) { return invalidCredentials }
if !passwordMatched {
    recordFailedAttempt(sqlTx, u, now)
    if err := sqlTx.Commit(); err != nil { return unavailable }
    return invalidCredentials
}
recordSuccessfulPasswordLogin(sqlTx, u, now) // no blind reactivation
if replacingSession != nil { validateAndRevokeExactLiveSession(sqlTx, replacingSession, now) }
created := insertSessionAndEvent(sqlTx, trustedPolicy, now)
if err := sqlTx.Commit(); err != nil { return unavailable } // outcome may be unknown
return created // HTTP writes cookies only here
```

```ts
async function refresh(): Promise<AuthSession | null> {
  const generation = currentGeneration();
  if (readLogoutIntent()) return recoverLogoutBeforeRestoring();
  try {
    const result = await authService.getSession(generation);
    if (!isCurrent(generation)) return currentSession();
    // On identity change, cancel/clear prior actor data before accepting result.
    transition(result ? validSession(result) : definitiveNoSession());
    return result;
  } catch (error) {
    if (!isCurrent(generation) || isCancellation(error)) return currentSession();
    transition(currentSession() ? warmUnavailable(error) : coldUnavailable(error));
    scheduleOneRecovery(generation, error);
    return currentSession();
  }
}
```

Backend operational errors are classified at the auth boundary and rendered as 503 with existing request IDs. Do not expose raw SQL/driver strings as UI copy. Preserve internal wrapped causes for bounded reason telemetry; no password/hash/cookie/session-token logging. Counters distinguish restored/absent/transient/stale-discard/reauth-required/logout-pending with fixed labels, not user IDs or arbitrary messages.

## 6. Dependency-ordered implementation sequence

| Slice | Exact existing targets / proposed additions | Done when |
| --- | --- | --- |
| A. Policy and schema | `config/config.go`, `backend/.env.example`, `auth/session_policy.go` (new), next migration, `platform/db/schema.go`, schema/migration tests | Guarded additive migration converges after partial apply; old rows remain legacy; invalid policy and enabled-cache combination rejected; pure policy boundaries tested. |
| B. Shared persistence | `auth/auth.go`, `sessionlookup_cache_impl.go`; `cmd/api/main.go` resolver type; existing cache/lookup/cookie/liveness tests | One insertion and one DB lookup authority; legacy creation tuple stays compatible; locked after-wait expiry and monotonic deadlines pass real DB tests; serving cache off verified. |
| C. Password transactions | `auth/password_sessions.go` (new), `handlers_auth.go`; legacy reset/activation logic removed from handlers after delegation | Login/reauth credential fence and state guards; atomic reset/activation/revocation; failed-attempt counters commit; concurrency/failure evidence available. No mixed old/new password writers serving when enabled. |
| D. HTTP and freshness | `handlers_auth.go`, `main.go`, `authz/table_auth.go`, `apperrors/errors.go`, proposed `session_freshness.go`, `handlers_pdf_download.go` | Persistent staff cookies use stored metadata; exact-origin/no-store contracts; expired-cookie logout; reauth code and all route-manifest rows tested; shared student PDF route unaffected. |
| E. Transport/state foundation | `shared/api/apiClient.ts`, `services/authService.ts`; new `authSessionState.ts` and `infrastructure/authBrowserCoordination.ts` | Generation-scoped flights, cancellation before stale return, parsed auth errors, mutation serialization, typed state tests; existing transport retry/CSRF tests remain passing. |
| F. Provider and consumers | `authSession.tsx`, all status consumers listed in §4.6; new retry/reauth surfaces; raw-fetch adapters | Restart restores; cold transient remains retryable; all-device logout uncertainty represented correctly; stale requests cannot render old data; dialog keyboard/focus behavior tested. |
| G. Connected qualification | New DB/API/browser suites below; existing student recovery and delivery suites | Target tests and static/build checks pass; real DB/browser/two-process tests execute, no hidden skips; load delta measured before issuance enabled. |
| H. Release | Runbook and non-secret deployment config | Schema -> compatible full backend fleet -> frontend -> internal opt-in cohort -> wider cohort; cache off; public origin verified; policy and rollback owner assigned. |

No slice claims persistent login complete before B–G establish the relevant invariants. Existing uncommitted proctor/recovery UI work is unrelated and must not be overwritten. Implementation results are recorded in the linked evidence document.

## 7. Worked traces

### Normal overnight return

1. Day 1 09:00: builder submits correct password + remember true. Under locked current credential/account, server commits session S: hard expiry day 31 09:00, idle expiry day 8 09:00, password-authentication time day 1 09:00. Cookie persists to hard expiry.
2. Browser process exits. Day 2 08:00 browser launches with its actual persistent profile; provider is checking, not authenticated from stored user data.
3. Lookup locks S, reads DB time, validates current account/S and advances idle to day 9 08:00. Hard expiry and password time stay unchanged; response unlocks normal workspace.
4. User requests result export. Freshness age >=15 minutes -> 403 REAUTH_REQUIRED before export generation; workspace/draft remains mounted.
5. User confirms password; under mutation lock server atomically revokes S and creates S2. Cookies rotate. User repeats the export; fresh server check permits it. Any prepared URL bound to S must be regenerated.

### Password reset races old-password login

Initial: session S is valid; credential hash H1; unused reset token T.

1. Login A reads H1 and verifies the old password outside locks, then pauses.
2. Reset B locks user/credential/T/sessions, validates T, stores H2, consumes T, revokes S, creates short replacement R, and commits once.
3. A obtains user/credential locks, rereads H2, detects H2 != H1 and returns generic 401 without creating a session or resetting account state.
4. Requests through S on another process are rejected. R is the only replacement created by B. If B failed before commit, H1/T/S all retain their original state; if its response was lost after commit, T stays consumed and old authority stays revoked.

### Lookup waits past expiry / revoke

1. S idle deadline is 10:30. Request A discovers its user at 10:29:59 but waits for the session row lock.
2. If another transaction revokes S and commits, A acquires the row and observes revoked_at, so no touch. If no revoke occurs but the lock becomes available at 10:30:02, A reads DB time after the wait and observes expiry, so no touch.
3. A returns session absence (401 at HTTP), not a freshly extended session. A DB failure instead returns 503, which the provider represents as unavailable.

### Offline all-device logout with ambiguous acknowledgement

1. Two tabs share an admin cookie. User selects logout-all; tab A persists intent L/all, fences requests and hides private UI; tab B receives invalidation and does the same.
2. Server may commit all-device revocation, but network fails before the response. L remains. On browser restart, intent recovery runs before session restoration.
3. If a live cookie still works, retry logout-all. If the session is absent, do not pretend absence proves all-device success: show current-browser signed out/all-device unconfirmed and require explicit sign-in then repeat logout-all.
4. A new logout-all intent L2 cannot be cleared by an old completion for L. There is no return of cached admin data while either intent is pending.

## 8. Verification and release gates

Planned tests below are additions; no listed new suite/test name exists until implementation. Use current tests as regression inputs, not evidence that the new behavior already works.

| Requirement / invariant | Test and stimulus | Expected evidence / level |
| --- | --- | --- |
| FR-1; INV-1/2 | New policy unit suite; remember true/false/omitted, admin/ordinary/student/master/unknown role, feature off, exact deadlines and invalid metadata | Exact policy/result fields; legacy fallback; no scope promotion. Unit + SQL migration constraints. |
| FR-1/3 | Extend `handlers_auth_cookie_test.go`, `auth_middleware_session_liveness_test.go` | Secure/__Host/HttpOnly/Path/SameSite, absolute Max-Age, CSRF readable, no staff polling Set-Cookie; revoked DB row defeats persistent cookie. API. |
| FR-3; INV-2/3 | New real-DB lookup tests, blocked row through idle deadline, simultaneous touches with reversed arrival, revoke between discovery and lock, same-second no-op | No resurrection/regression/false absence from zero changed rows; DB time after wait; exact stored cap. Real DB with barriers, not sleeps. |
| FR-3; INV-3/5 | New `password_sessions_mysql_test.go`: reset vs H1 login; activation vs login/reset; issue vs logout-all; duplicate tokens/reauth; administrative disable between verification and lock | Exactly allowed serialized state; all credential/session changes atomic; no disabled-account reactivation; only one reauth replaces a session. Real DB/concurrency. |
| FR-3/4; INV-4/5 | Inject failure at token consumption, password update, each revoke/create/audit, and commit; wrong-password attempts around lock threshold | Rollback or single complete commit; counters persist; no cookie before acknowledged commit; unknown commit reported unavailable, no unsafe replay. DB/API. |
| FR-4; INV-1/4 | Proposed `session_freshness_test.go`: each manifest row/alias, no/future/stale/current password time, role/scope denial, exact equality | 403 REAUTH_REQUIRED before side effects; no accidental student guard; unauthorized never gains scope. Full-router tests, not only helper unit tests. |
| FR-2/5; INV-6 | Extend frontend `authService.session.test.ts`, `AuthSessionProviderUnauthorized.test.tsx`, `AuthSessionLogout.test.tsx`; new state/coordination tests | Flights separated by generation, old finally cannot erase new flight, late 200/401 discarded, no recursive session request, wrong reauth password does not blanket logout. Controlled deferred promises. |
| FR-2/6 | Cold/warm offline, 429 Retry-After including >30 seconds, 503, malformed payload, router redirects, auth forms and student resume status | Correct unavailable/warm identity state; no false login redirect or not-resumable result; one timer, offline pause, no keepalive. Fake timers + browser. |
| FR-4/5 | Raw-data/PDF rejection and account switch during download; reauth focus/cancel/unsaved draft | Structured prompt before adapters erase errors; old-actor bytes not downloaded; rotated-session PDF reprepare; no blind mutation replay. Browser/adapter tests. |
| FR-5; INV-3/6 | Two tabs: login vs logout, reauth vs reauth, stale event/operation ID, storage failure, interrupted tab/unknown mutation, logout-all missing session | Serialized cooperating operations, identity reconciled, logout intent retained through restart, all-device uncertainty explicit. Browser with Web Locks; unsupported fallback qualified separately. |
| FR-1/3/5 | New `e2e/persistent-login.spec.ts`: actual persistent profile close/relaunch, overnight via controlled server test clock/DB fixture, primary-routed requests to two API processes | Real cookie persistence without storageState-only shortcut; revoke on A then new request on B rejected; process restart does not lose server authority. Connected E2E. |
| FR-6 | Existing student entry, cookie, practice, recovery-scope and attempt-refresh suites | Existing origin scopes/durations/attempt ownership and live exam behavior preserved. Regression. |
| NFR-1/2 | Anonymous logout/login/reauth Origin/Referer scheme/port/foreign/null/missing; valid proxy path; API error cache headers | Exact agreed origin policy; foreign requests rejected; no-store even on 401/403/503; no secrets in logs. API + deployment smoke. |
| Compatibility | New migration partial-apply/rerun suite using existing `TEST_MYSQL_DSN` patterns, old binary on expanded schema, feature off, then full fleet enabled | No legacy promotion; columns/defaults/constraints verified; skipped/unreachable real DB tests fail the release gate rather than count as passing. Migration/compatibility. |
| NFR-4 | Baseline vs new DB lookup, actual student/staff request mix, concurrent tabs, instance loss and session store recovery | Record SQL count, lock wait, DB pool use, p95/p99 restore/request latency and 503/429 rates. Proposed investigation trigger >10% regression; agree actual capacity/SLO before release. No invented capacity guarantee. |

Execution commands after implementation (from repository root unless `workdir` is specified):

```text
bunx vitest run src/services/__tests__/authService.session.test.ts src/features/auth/__tests__ src/shared/api/__tests__
bun run typecheck
bun run lint
bun run build
bunx playwright test e2e/persistent-login.spec.ts --project=chromium
bunx playwright test e2e/persistent-login.spec.ts --project=firefox
bunx playwright test e2e/persistent-login.spec.ts --project=webkit
```

From `backend/go`, run `go test ./internal/auth ./internal/authz ./internal/platform/config ./internal/platform/db ./internal/platform/apperrors`, targeted API auth/freshness/router suites, the new password-session real-DB tests, and targeted migration tests. Run `go test -race` on touched auth/API packages where practical. API tests follow existing disposable migrated-database fixtures; migration tests follow the scratch-schema `TEST_MYSQL_DSN` pattern. CI must explicitly require a reachable isolated test DB for this release. Never point destructive fixtures at production. Capture exact executed commands/results/skips at implementation time.

Release order: validate origin/policy/cache settings -> expand schema -> deploy full compatible backend fleet and all runtime password writers -> frontend -> internal opt-in cohort -> broader enablement. Old backends currently reject unknown `rememberMe` fields through `DisallowUnknownFields`; do not expose the new UI request before the backend fleet accepts it. Old auth readers also ignore the stored idle policy, so persistent issuance cannot start during that version overlap.

Rollback: stop new remembered issuance, retain cache off/freshness guard, then revoke remembered rows or clamp them under an explicit policy with an operator-approved sign-in impact. Only after no remembered rows remain live can a rollback to old readers be considered. Keep the additive schema. Turning off the flag alone does not undo issued credentials. Zero-tolerance stop conditions: post-revocation authorization on new requests, student scope expansion, sensitive action without freshness, leaked credentials; investigate false redirects, restore errors and agreed latency regressions before further rollout.

## 9. Extensibility, residual risks and definition of ready

One realistic extension is a different lifetime for graders: change `policyForPassword`/configuration and its tests; existing session snapshots/cookie/provider logic remain unchanged. Another is passkey confirmation: it would establish an explicit authenticator event at the workflow boundary and reuse freshness/response handling, but requires a separate protocol/security design; do not add an authenticator interface now.

Residual risks and actual unknowns:

- A persistent bearer can be stolen and used for ordinary authorized reads until revoked/expired; password confirmation narrows protected operations, not all access. No assurance-level certification or universal “best” lifetime is claimed.
- Browser policy, private mode, cleared cookies and unsupported coordination APIs can require login. Cross-tab invalidation only coordinates participating clients; DB revocation remains authoritative.
- Added locked lookups increase database work. Target DB engine/version/lock semantics, replica routing and measured load must be qualified. A deployment with no shared primary/session authority does not satisfy this plan.
- Lost reset/reauth acknowledgements can require a new password login; they cannot restore the revoked session. Logout-all remains explicitly unconfirmed when its scope cannot be established from existing APIs.
- New remembered sessions require one explicit password login after rollout. Existing NULL password freshness requires confirmation for protected routes; planned UI and old-client compatibility must be tested before enforcing it broadly.
- Seed/provision commands that directly upsert credentials are maintenance writers outside the browser runtime flow; verify their operational use and stop concurrent production execution or bring them under the same transaction/revocation boundary.

Ready to implement when the next migration number and target deployment facts are recorded, the route manifest remains accurate, and policy defaults/shared-device assumptions are accepted. Ready to release only when FR-1–6 and INV-1–6 have executed evidence across unit, DB, race and browser layers, and rollout/rollback checks have named owners. A plan document does not itself establish production readiness.

Reference guidance checked during planning: [OWASP authentication and sensitive-feature confirmation](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP CSRF origin guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [MySQL locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html), [MySQL changed-row semantics](https://dev.mysql.com/doc/refman/8.4/en/information-functions.html#function_row-count), and [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API). These support the mechanism choices; deployment-specific behavior still requires the tests above.
