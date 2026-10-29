# Implementation plan: reliable persistent login

Status: proposed, 2026-10-29. Repository inspection only; no application changes or tests run. All new fields, contracts, limits, and files below are proposals. Paths are repository-relative.

Detailed execution design: [Low-level implementation plan](./2026-10-29-persistent-login-low-level.md). Its function contracts and explicit corrections refine this architecture, including activation/reset lock participation, ambiguous logout-all acknowledgement, and browser cookie races.

## 0. Context and current behavior

Goal: staff returning to this browser should usually resume work without entering a password. Reload, browser restart, and temporary service failure should not cause unnecessary sign-outs. Authentication must still end after explicit logout, revocation, account changes, or a defined maximum lifetime.

### Evidence map

| Verified behavior | Inspected owner |
| --- | --- |
| Normal login creates a random 32-byte opaque bearer; only its SHA-256 hash is persisted. Session creation checks current account role/state in a transaction. | `backend/go/internal/auth/auth.go`: `CreateSession`, `CreateSessionInTx` |
| Defaults: 30-minute staff idle timeout, 60-minute student idle timeout, 12-hour absolute expiry. Lookup extends idle expiry, not absolute expiry. | `backend/go/internal/auth/auth.go`: `SessionExpiry`, `LookupSession`; `backend/go/internal/platform/config/config.go`: `Load` |
| Staff cookies have no `Expires`/`Max-Age`. Student cookies persist until absolute expiry and are reissued by authentication middleware. | `backend/go/cmd/api/handlers_auth.go`: `setSessionCookies`, `setCreatedSessionCookies`; `backend/go/cmd/api/main.go`: `authMiddleware` |
| Server validates session revocation, expiry, account state, role, and authentication origin on the DB lookup path. | `backend/go/internal/auth/auth.go`: `LookupSession`; `sessionlookup_cache_impl.go`: `LookupSessionWithCache` |
| The live app uses `AuthSessionProvider`, not the separate localStorage-backed `useAuthStore`. No external production consumers of that store were found in `src`. | `src/main.tsx`; `src/features/auth/authSession.tsx`; `src/store/useAuthStore.ts` |
| Session bootstrap is single-flight. Warm refresh generally retains identity on transient errors; cold bootstrap has no identity to retain and becomes unauthenticated. Broad error-code matching can also misclassify errors as lost sessions. | `src/services/authService.ts`: `getSession`; `src/features/auth/authSession.tsx`: `refresh` |
| A global ordinary API 401 clears authentication immediately; student attempt endpoints have an exception. No auth-provider cross-tab synchronization or request-generation fence exists. | `src/features/auth/authSession.tsx`; `src/shared/api/apiClient.ts` |
| Logout clears local cached data even if server logout fails. The server may therefore retain a valid browser credential after the UI signs out. | `src/features/auth/authSession.tsx`: `logout`, `logoutAll`; `AuthSessionLogout.test.tsx` |
| Password reset commits the new password before separately revoking sessions. A failure between these steps can leave old sessions usable. | `backend/go/cmd/api/handlers_auth.go`: `passwordResetCompleteHandler` |
| Optional session cache is process-local; revocation invalidates this process only. Defaults and example configuration leave it off. | `backend/go/internal/auth/sessioncache_impl.go`; `sessionlookup_cache_impl.go`; `backend/.env.example` |
| Practice and staff-assisted recovery sessions carry restricted authentication origins, distinct from account authentication and attempt credentials. | `backend/go/internal/auth/session_proof.go`; `backend/go/cmd/api/recovery_session_scope.go` |

Inferred: browser-scoped staff cookies and the default deadlines explain repeat login prompts. These are mechanisms found in code, not a diagnosis of a specific production incident.

Unknown: deployed timeout values, enabled cache, actual browser cookie behavior, API replica count, proxy/origin setup, session failure rates, and organizational session requirements. Inspect deployed non-secret configuration and sanitized response headers before rollout. No production configuration or traffic was measured.

Scope: staff password login, session lifecycle, browser restoration, revocation, and sensitive-action password confirmation. Student session/attempt lifetimes, exam identity, MFA/SSO, account administration redesign, and a login-page visual redesign are outside this change.

## 1. Requirements

### Functional

| ID | Behavior | Acceptance criterion |
| --- | --- | --- |
| FR-1 P0 | Remember staff login on this device. | An opted-in live session survives reload and a real browser-process restart, including an overnight absence within policy, without credentials. Opt-out retains short-session behavior. |
| FR-2 P0 | Distinguish unavailable authentication from absent authentication. | Cold network failure/429/503 shows a retryable session-check screen; it neither renders protected content nor redirects to login. A warm transient failure retains current UI identity; server authorization remains authoritative. |
| FR-3 P0 | Enforce bounded lifetime and revocation. | Invalid, idle-expired, absolutely expired, revoked, disabled, or role-mismatched sessions cannot authorize new requests. Logout-all and successful password reset invalidate prior sessions. |
| FR-4 P0 | Keep sensitive actions protected during long sessions. | Specified sensitive routes reject stale password authentication before side effects; confirmation of the same account resumes the user's task without losing drafts. |
| FR-5 P0 | Maintain actor isolation across tabs and races. | Logout/account switch clears actor caches in every cooperating tab; late bootstrap and old API responses cannot restore the previous actor. Failed server logout is reported as unconfirmed and cannot silently auto-restore. |
| FR-6 P0 | Preserve student scope and existing delivery. | Student restart, attempt-token refresh, practice scope, recovery scope, and timed-exam regression tests retain their existing behavior. |
| FR-7 P1 | Device-session management. | A later feature may list and revoke individual devices. Not needed for this delivery; current-device and all-device logout are sufficient. |

### Non-functional

| ID | Constraint / target | Validation consequence |
| --- | --- | --- |
| NFR-1 Security | Server owns identity, expiry, scope, and password freshness; no staff bearer in JS storage. | Negative API, cookie, CSRF, same-origin, and freshness tests. No claim of a particular NIST assurance level. |
| NFR-2 Failure safety | Database failure returns 503, never false 401 or successful revocation. Password changes and revocation commit atomically. | Failure injection and real database transaction tests. |
| NFR-3 Concurrency | New requests after committed revocation are rejected on every API instance. Touch cannot revive an expired/revoked session or shorten a newer idle deadline. | Two-instance tests against the primary database; cache off. Requests already admitted may finish unless their domain operation has a separate transactional fence. |
| NFR-4 Work / availability | No periodic request solely to keep login alive. Preserve existing tab-local single-flight checks. | Request-count tests; compare session-check p95/p99 and SQL/request with baseline at the same load. Proposed gate: investigate >10% regression, not an existing SLO. |
| NFR-5 Usability / accessibility | Retry/reauth states explain the action, retain safe return paths, and support keyboard/focus and screen readers. | Browser tests for retry, confirmation, unsaved work, and role-safe navigation. |

## 2. Core entities and invariants

Continue using `user_sessions` as the authoritative session record and existing `users` / `user_password_credentials` as account authority. Retain token hashing, unique token-hash constraint, audit events, and authentication-source scope.

Proposed additive session columns:

- `remembered BOOLEAN NOT NULL DEFAULT FALSE`: explicit staff persistence choice; old rows remain short sessions.
- `idle_window_seconds INT NULL`: snapshot of the selected server policy. NULL uses legacy role/config behavior. Validate positive bounds at issuance.
- `credential_authenticated_at TIMESTAMP NULL`: server-recorded time of real password verification; NULL requires confirmation for sensitive actions. Session checks, polling, and cookie presence never update it.

Use existing `issued_at`, `expires_at`, `idle_timeout_at`, and `revoked_at`; no refresh-token table or second bearer is required. Student cookie persistence remains governed by its existing path, independently of the new staff `remembered` flag.

- INV-1: an authenticated client is backed by a live server session and current account authorization; client storage cannot grant access.
- INV-2: ordinary requests may advance idle expiry to `min(absolute expiry, now + stored idle window)` but never advance absolute expiry. Concurrent touches are monotonic.
- INV-3: revocation is terminal for that token. A fresh password login may create a new session; a touch cannot.
- INV-4: only actual password verification grants password freshness; confirmation rotates session/CSRF credentials and cannot switch actor.
- INV-5: a completed credential reset cannot leave earlier sessions usable or allow a previously verified old password to issue a new session afterward.
- INV-6: stale client requests cannot overwrite a later login/logout/account switch; persistence cannot expand student authentication scope.

## 3. API / interface changes

| Interface | Proposed contract |
| --- | --- |
| `POST /api/v1/auth/login` | Add optional boolean `rememberMe`; omission means false for existing clients. Server chooses policy from verified role and login origin, never caller-provided role/duration. Continue existing response shape; add `remembered` and `credentialAuthenticatedAt` as optional fields for compatibility. |
| `GET /api/v1/auth/session` | Keep read/validate contract; return additive metadata and accurate deadlines. It does not issue a new authentication event or reset absolute/password-authentication time. Set `Cache-Control: no-store` for auth responses, including errors. |
| Proposed `POST /api/v1/auth/reauthenticate` | Live account session + same-origin + CSRF + `{password}`. Identity comes from the session. Verify password with existing hashing and abuse controls, then atomically revoke the current session and create its replacement. Preserve remembered preference; a real authentication event may start a new absolute lifetime. Return the normal session payload and new cookies only after commit. |
| Sensitive operation | Valid session with stale/missing password freshness returns proposed `403 REAUTH_REQUIRED` before side effects. Ordinary permission/CSRF failures remain distinct and do not log the user out. |
| Logout / logout-all | Keep contracts; acknowledge success only after durable revocation. Current logout must work with an expired/revoked cookie too, clearing matching cookies even when it grants no authority. Logout-all requires a live account session. |

Register the new endpoint in `backend/go/cmd/api/main.go` and `backend/go/internal/authz/table_auth.go`; do not grant it to practice/recovery principals. Invalid credentials remain generic; failures during lookup/commit are retryable service errors, not proof of logout. Reauthentication uses the strict credential-attempt rate-limit class, not the generous session-read class. If logout is made callable with an expired session, enforce its same-origin requirement even on the anonymous path; retain normal CSRF validation when a live session exists.

Frontend: add login option through `LoginPage` -> provider -> `AuthService`; add provider state `unavailable` alongside loading/authenticated/unauthenticated. Keep existing additive response compatibility. Reauthentication wrong-password 401 must bypass global sign-out handling using the existing `skipUnauthorizedHandler` option.

## 4. Critical data flow

1. Login: validate payload -> verify password -> transaction locks current account/credential authority and confirms it still matches what was verified -> choose server policy -> persist session + event -> commit -> issue cookies and session JSON. A password reset racing verification must force re-verification, not accept a stale hash.
2. Return: browser sends persistent cookie -> existing auth middleware -> primary database validates account/session -> conditional monotonic idle touch -> session response -> provider unlocks the role-appropriate route. Cold temporary failure stays in `unavailable`, with retry and online/visibility-triggered recovery.
3. Sensitive action: existing role/scope authorization + server freshness check -> either `REAUTH_REQUIRED` with no effect or normal handler. User confirms password -> replacement session commits -> pending UI action may be submitted. Do not blindly replay mutations after ambiguous outcomes; retain existing idempotency rules.
4. Logout: immediately hide private UI, cancel actor queries, clear caches, and fence in-flight work -> POST durable revocation -> clear cookies -> publish credential-free cross-tab invalidation. Failure leaves a visible unconfirmed-logout state and a local logout-intent marker; retry logout before any future automatic session restoration. The marker is UI intent, not an authorization credential.

## 5. Recommended design

### Proposed policy defaults

These are product defaults to confirm, not security-standard mandates. Initially apply only when the new staff UI explicitly sends `rememberMe=true`.

| Context | Idle window | Hard maximum from password authentication | Browser storage |
| --- | --- | --- | --- |
| Remembered builder/proctor/grader | 7 days | 30 days | Persistent opaque cookie |
| Remembered admin / admin observer | 24 hours | 7 days | Persistent opaque cookie |
| Staff opts out / existing client | Existing 30 minutes | Existing 12 hours | Browser-session cookie |
| Student account/practice/recovery | Existing configured policy, default 60 minutes | Existing configured policy, default 12 hours | Existing student cookie behavior |
| Emergency master-key login | Existing short policy only | Existing short policy only | No remembered issuance or password freshness from the master key |

Staff login offers “Keep me signed in on this device,” initially checked to match the requested behavior, with “Turn off on a shared computer.” If the deployed staff devices are shared terminals, default it off before rollout. The server defaults omitted fields to false. Activation/reset/bootstrap and student entry do not silently opt into staff persistence.

Cookie issuance belongs in the existing auth handler boundary: `__Host-session`, Secure in production, HttpOnly, Path=/, no Domain; CSRF cookie stays readable. Preserve current SameSite policy pending a real external-link/origin test. Remembered-cookie `Expires` and `Max-Age` match the authoritative absolute deadline, never the moving idle deadline. Do not reissue staff cookies on every poll or promote legacy sessions through middleware.

Fresh password window: proposed 15 minutes, enforced server-side. Initial protected route set: exam deletion, grading release-now/schedule-release, and staff result/answer exports (including raw-data and export-profile aliases). Enumerate exact mounted routes in the phase-0 manifest from `main.go`, and attach one reusable freshness guard at those registrations, before handlers. Do not use ambiguous mount-relative policy keys such as `POST /export` to guess which operation is protected. Newly added account/security mutation routes must use the same guard. Routine authoring saves and proctor exam controls keep their current authorization behavior.

### Alternatives and decision

| Class | Approach | Trade-off / decision |
| --- | --- | --- |
| Minimal change, selected | Extend existing opaque DB sessions with explicit bounded persistence, reliable restore, revocation, and sensitive-action confirmation. | Reuses current authority and contracts; long-lived bearer theft remains a risk, bounded by expiry/revocation and freshness gates. |
| Structural change | Short active sessions + separate rotating remembered-device credential. | Useful if independently scoped API clients or credential separation becomes necessary. Adds rotation, concurrent tabs, reuse detection, and lost-response recovery; a stolen remember credential can still obtain sessions. Not justified by this request alone. |
| Requirement change | Keep short sessions and make password-manager/passkey re-entry fast. | Lowest persistence risk and good for shared terminals; does not deliver unattended multi-day restoration. Passkeys would be a separate feature. |

Avoid a timer that continuously refreshes login. Added request rate would be `open tabs / interval seconds`; for illustration only, 2,000 tabs polling once/minute add about 33 requests/s, plus current SELECT/touch work, without solving browser restarts or the hard deadline. Bounded persisted sessions require no new keepalive traffic. Real workload is unknown.

OWASP supports opaque session identifiers, secure cookie handling, server expiry/revocation, and reauthentication for sensitive operations; the limits above are this proposal's policy choice. See [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), and [CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). Persistent bearer sessions have a larger theft window; periodic automatic rotation is not included in the minimum design. Rotate on successful password authentication. Reconsider the separate-credential design if risk policy requires shorter bearer exposure; it must include explicit rotation race/lost-response semantics.

## 6. Production and failure-mode deep dives

| Failure | Consequence | Safeguard / owner | Verification / residual risk |
| --- | --- | --- | --- |
| Cache hit on another API instance after logout/account change | Revoked authority accepted | Keep `SESSION_CACHE=off` across the fleet for this rollout; primary DB owns decisions. Do not add Redis solely for this feature. | Two processes, no sticky sessions, revoke on A then request on B. Re-enable caching only with a separately proven coherence design. |
| Touch races logout/expiry or completes out of order | Deadline revived or shortened | Conditional live-row UPDATE with authoritative time, revocation/expiry predicates, and `GREATEST` capped at absolute expiry. Handle MySQL unchanged-row counts by re-reading when needed; zero changed rows alone is not proof of absence. | Deterministic real-DB races; already-admitted operations remain governed by domain transactions. |
| Password reset crashes after credential commit | Old sessions survive | Move credential update, token consumption, all-session revocation, and replacement-session creation into one transaction, locking user before credentials/session rows. Reuse `CreateSessionInTx`; invalidate caches only after commit. Login rechecks the verified credential under the same lock order. | Inject failure at each write and race old-password login with reset. All state rolls back or commits together. |
| Logout-all races issuance | Some preexisting session escapes | Serialize revoke-all and issuance using a consistent user-row lock before session writes. Define logout-all at this transaction's serialized point. | Barrier-based tests; deliberate later password login remains allowed. |
| Cold offline/429/503 | False login prompt | Explicit unavailable state; capped jittered backoff honoring Retry-After, pause while offline, user retry; dedupe checks. Exact auth verdict codes replace `/session/` regex matching and generic 403 logout. | Fake timers and offline browser tests. No offline authorization is granted. |
| Slow bootstrap/old 401 arrives after new login | New actor logged out or old actor restored | Provider auth generation; apply results only to their initiating generation. Carry generation to global 401 handling, and confirm ambiguous ordinary 401s with deduped session lookup without recursion. | Controlled out-of-order responses. Do not retry an unsafe mutation automatically. |
| Server logout fails or response is lost | Persistent cookie silently restores later | Clear private UI immediately; persist credential-free logout intent, notify other tabs, retry revocation on reconnect/bootstrap before restore, show incomplete status. Clear marker only after confirmed revocation or deliberate new login. | Offline logout -> restart -> reconnect must not restore old session. Cookie theft remains usable elsewhere until server revocation succeeds; communicate the unconfirmed result. |
| Cross-tab account switch | Stale private data and CSRF | Credential-free BroadcastChannel/storage invalidation; cancel queries before clearing; invalidate generations and recheck server. Server identity never comes from a broadcast. | Two tabs, logout/login/reauth and suspended-tab resume. Existing API client already prefers live CSRF cookie. |
| Cross-site request or cached session payload | Unauthorized operation / identity leakage | Preserve CSRF + same-origin checks; no-store all auth responses. Test Secure/__Host attributes and actual reverse proxy path. | Wrong/missing CSRF and foreign Origin rejected without side effects; normal GET/POST and external navigation tested. |
| Shared device or stolen persistent cookie | Longer account exposure | Visible opt-out, bounded idle/hard maximum, role limits, fresh-password gates, durable logout. Never use stored passwords or localStorage bearer tokens. | Test opt-out and deadlines. Clearing cookies/private browsing may still require login; persistence cannot override browser policy. |

## 7. Ordered implementation phases

All new locations are proposed. Existing files below were inspected. Do not edit unrelated auth-store code just to consolidate it.

| Phase | Files / components | Specific change | Coverage / done when |
| --- | --- | --- | --- |
| 0. Capture baseline | Existing config/handlers, `main.go`, deployment configuration; extend this document | Record effective non-secret timeouts/cache/topology; list exact sensitive mounted routes and all aliases. Confirm personal vs shared staff devices. Baseline successful restoration and unwanted-login reasons. | Policy and route manifest complete; no unknown production setting represented as verified. |
| 1. Compatibility | New next-numbered migration under `backend/go/migrations/`; `backend/go/internal/platform/config/config.go`; `backend/.env.example`; existing schema guard conventions | Add nullable/defaulted session fields; bounded remembered-policy config and a rollout switch initially off. Validate ordering/positive duration limits and cookie security. Preserve existing sessions via NULL/default fallback. | Old binary works with expanded schema; new binary with feature off behaves as before. Migration locking evaluated on actual DB version/table size. |
| 2. Authoritative lifecycle | `backend/go/internal/auth/auth.go`, `sessionlookup_cache_impl.go`; `backend/go/cmd/api/handlers_auth.go` | Centralize selected expiry policy, stored idle window, password-authentication timestamp; monotonic conditional touches; atomic reset/revocation; credential verification fence; user lock order for issuance/revoke-all. Make cookie writer use stored session metadata rather than recomputing deadlines separately. | FR-1/3/6; INV-1–5 pass real DB tests. Cache-disabled behavior consistent through both lookup entry points. |
| 3. API security | `backend/go/cmd/api/main.go`, `handlers_auth.go`; `backend/go/internal/authz/table_auth.go`; proposed auth freshness guard | Optional remember flag, persistent staff cookies, no-store, reauth route, sensitive-route guard and explicit error. Ensure expired-cookie logout remains callable without granting account authority. Emergency/reset/activation paths stay non-remembered unless a later explicit design changes them. | FR-1/3/4; opt-out, scopes, strict rate limits, all sensitive-route aliases and wrong-password handling tested. |
| 4. Browser lifecycle | `src/services/authService.ts`; `src/features/auth/authSession.tsx`, `RequireAuth.tsx`, `LoginPage.tsx`; `src/shared/api/apiClient.ts`; proposed retry/reauth surfaces | Checkbox and additive types; unavailable state in both guard and login page; generation fence, exact errors, session-confirmation path for ordinary 401, online/visibility recovery, cross-tab invalidation, logout-intent handling. Shared reauth surface intercepts REAUTH_REQUIRED while preserving drafts and requiring deliberate safe resubmission. | FR-1/2/4/5/6; no auth token in JS storage; cold outage does not redirect; late requests cannot change actor. |
| 5. Verification | Extend inspected auth/cookie/liveness/frontend tests; proposed persistent-login browser and real-DB suites | Execute matrix below, including actual persistent browser profile restart and two API processes. Instrument bounded reason labels; never log tokens, passwords, CSRF, or raw cookies. | Every P0 and invariant has passing evidence, with skips reported separately. |
| 6. Release | Deployment configuration and session runbook | Schema first, compatible backend and frontend while switch off, complete backend fleet, internal cohort then broader enablement. Provide policy rollback that also bounds existing remembered rows. | Production restore/revocation checks pass; support can identify expiry vs transient failure. |

## 8. Test matrix

These tests are planned, not executed. Use fake clocks/barriers rather than sleep-based timeout/race tests. SQL mocks alone do not prove transaction behavior.

| Case | Setup / stimulus | Expected persisted + external outcome | Level | Coverage |
| --- | --- | --- | --- | --- |
| TC-1 | Staff opts in; reload; close/relaunch actual browser process with persistent profile; return next day within idle/absolute bounds. | Same live session restored; cookie deadlines match stored policy; no password prompt. Do not use copied Playwright storageState as the only restart proof. | DB + browser | FR-1; INV-1/2 |
| TC-2 | Opt out; omit remember flag; legacy row; attempt remember on student/master-key paths. | Existing short staff/legacy behavior; no long staff credential from excluded origin. Student behavior unchanged. | Unit/API/browser | FR-1/6; INV-6 |
| TC-3 | Requests before/equal/after idle and hard deadlines, with ordinary background polls. | Exact boundary enforced; only idle moves, capped by hard deadline. At hard deadline reauthentication required. | Fake-clock unit + DB | FR-3; INV-2/3 |
| TC-4 | Cold and warm network error/429/503; server recovery; repeated mounting/focus. | Cold retry surface, warm retained identity, no false logout; checks deduped and backoff honored; no protected cold render. | Frontend/browser | FR-2; NFR-4/5 |
| TC-5 | Ordinary 401 from unrelated/stale request; genuine expired session; forbidden/CSRF/REAUTH_REQUIRED 403. | Exact lost-session confirmation logs out; unrelated auth failures and permission errors do not erase a valid actor; no recursive check loop. | Frontend/API | FR-2/3/4/5 |
| TC-6 | Logout A; request B on another API process; logout-all; disable/role change in authoritative account row. | Requests admitted after change/revocation see rejection; matching cookies removed on successful logout; actor caches cleared. | Two-process DB/browser | FR-3/5; INV-1/3 |
| TC-7 | Concurrent touch/touch, touch/logout, touch/deadline; reset/old-password login; issuance/logout-all. | No revoked/expired resurrection, deadline regression, stale-password issuance, or old session surviving successful reset. | Barrier-based DB | FR-3; INV-2/3/5 |
| TC-8 | Abort/crash/fail each reset/reauth write before commit; lose response after commit. | No partial credential/revocation state. Lost reauth response may require fresh login; old revoked session never regains authority. Server errors do not claim success. | DB/failure injection | FR-3/4; INV-3–5 |
| TC-9 | Sensitive endpoint and every alias at 15-minute boundary; confirm wrong/correct password; foreign Origin/CSRF. | No side effect before fresh confirmation; wrong password retains session; correct same-user confirmation rotates credentials; wrong origin rejected. | API/browser | FR-4; INV-1/4 |
| TC-10 | Delayed bootstrap and API responses; logout/account switch from second tab; suspended tab returns. | Prior generation ignored, old queries canceled/cleared, current server actor restored with correct CSRF. | Frontend/browser | FR-5; INV-6 |
| TC-11 | Offline logout, application restart, reconnect; server revoke succeeds but response lost. | UI never silently restores old identity while logout intent pending; revocation retried idempotently; failure is visible; no success claim before confirmation. | Browser/API | FR-5; INV-3/6 |
| TC-12 | Student sitting reload/restart, attempt credential 401/refresh, practice and recovery scope. | Existing student durations and permission boundaries preserved; no staff reauth loop in an exam. | Existing + added regression | FR-6; INV-6 |
| TC-13 | Expanded schema with old/new binaries and flag off/on; cached responses; proxy cookie issuance; foreign inbound link. | Legacy clients accepted; no accidental promotion; auth responses no-store; cookies stored with correct security flags; measured navigation behavior understood. | Compatibility/browser | FR-1/3; NFR-1/2 |
| TC-14 | Baseline-matched load with cache off and no new keepalive. | Restore/check counts, query cost and latency meet agreed gate; no new polling amplification. | Load | NFR-4 |

Start frontend regression with `bunx vitest run src/services/__tests__/authService.session.test.ts src/features/auth/__tests__`. From `backend/go`, run relevant auth, config, authz and selected API tests with Go, then the newly added real-DB suite against a disposable migrated database. Run `bun run typecheck`, `bun run lint`, `bun run build`, and targeted Playwright coverage through `bunx playwright test`. Add the new test names/DB prerequisites to this document when implemented; do not mistake skipped DB tests for passing coverage.

## 9. Rollout and recovery

1. Baseline unwanted sign-in prompts by server reason and client state; record deployed cache settings, cookie attributes and session-policy values without secrets.
2. Expand schema before deploying readers. Verify migration locking, fallback behavior, and backup/restore procedures on the actual database engine. No backfill that upgrades old sessions into remembered sessions.
3. Deploy backend and frontend with remembered issuance disabled. Complete backend fleet rollout before enabling: old readers would apply their old idle policy to remembered rows, so enablement during version skew is unsafe. Keep cache off everywhere. Existing student sessions continue their current policy.
4. Enable an internal staff cohort, exercise restart, overnight return, revoke-all, password reset, sensitive-action confirmation, and offline logout; then expand. New staff must log in once to opt in; do not infer consent/policy from an existing cookie.
5. Observe restore success, definitive expiry/revocation counts, unavailable-state duration, session-check 429/503, reset/reauth failures, and p95/p99 latency. Separate expected policy expiry from accidental logout. Proposed zero-tolerance rollout stops: successful use after committed revocation, scope expansion, credential leakage, or sensitive mutation without required freshness. A measured sustained rise in accidental redirects/restore errors also stops expansion.
6. Turning the switch off stops new remembered issuance but does not shorten already stored deadlines. To end persistence, use the compatible backend to revoke remembered sessions or explicitly clamp them under an approved rollback policy, commit, then clear their cookies on next contact. Expect affected users to sign in again. Do not roll back to old auth readers while remembered rows remain live. Retain expanded columns; do not drop schema during incident rollback.

Suggested operators: API owner handles policy/revocation and reset failures; frontend owner handles recovery/cross-tab regressions; release owner verifies fleet settings and rollout. Assign named owners at execution time.

## 10. Open decisions and final gap review

- Defaults proposed above: remembered staff on personal devices, 30-day hard / 7-day idle; admin 7-day hard / 24-hour idle; shared opt-out; 15-minute sensitive-action freshness. Confirm organizational rules and device ownership before enabling. If higher assurance or mandatory short sessions apply, reconsider persistent bearer restoration rather than claiming these defaults comply.
- Confirm actual DB engine/version, primary routing, deployed topology/cache values, and maximum supported exam duration. This plan does not change the existing student hard limit.
- Treat a later device list, passkeys/MFA, and automatic token rotation as separate requirements with their own evidence; none is needed to fix false logout and ordinary browser persistence.

Traceability: FR-1 -> phases 1–4 -> TC-1/2/3/13; FR-2 -> phase 4 -> TC-4/5; FR-3 -> phases 2/3 -> TC-3/6/7/8; FR-4 -> phases 3/4 -> TC-5/9; FR-5 -> phase 4 -> TC-5/10/11; FR-6 -> phases 2–4 -> TC-2/12. INV-1–6 are each covered in the matrix. No production guarantees are claimed until implementation and deployment checks pass.
