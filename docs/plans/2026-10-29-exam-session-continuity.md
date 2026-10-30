# Implementation plan: SAT and IELTS exam-session continuity

Date: 2026-10-29 (Asia/Bangkok). Status: phases 0–3 implemented 2026-10-30 behind `EXAM_ACCESS_ENABLED` (default off); phase 4 field qualification outstanding. See section 10.

## 0. Decision and scope

An admitted student should retain narrowly scoped authority to finish the sitting when the ordinary account session expires. Saved answers and submission receipts must survive retries and process replacement. Exam deadlines, pauses, termination, account-security revocation, and device transfer remain authoritative.

**Recommendation:** reuse `attempt_sessions` as a bounded exam-access grant, with a stable credential for the sitting. Remove routine credential rotation from the save path. Implement explicit revocation and route authentication isolation **before** issuing longer-lived grants. Keep the existing database, transactions, response ledger, leases, and terminalization service.

This revises the earlier suggestion to simply issue a longer sitting token: tests show that account disable and logout-all do not currently revoke attempt credentials, and cookie middleware can still block valid bearer saves. Increasing TTL alone would lengthen that security gap and leave the middleware dependency intact.

Scope: backend authorization, issuance/resume, save/submit/receipt recovery, clients consuming these contracts, and verification. No scoring-rule or deadline extension; no automatic acceptance of client-dated late answers; no queue/service replacement.

## 1. Evidence and its limits

Reproducible tests: `backend/go/cmd/api/exam_continuity_mysql_test.go`. Results and commands: [evidence report](evidence/exam-continuity-2026-10-29/report.md).

| Behavior | Evidence | Conclusion |
| --- | --- | --- |
| Expired account login + valid attempt bearer | New real-MySQL HTTP test saves successfully, renewal GET returns 401, expired attempt bearer then rejects another save; first answer remains stored | Confirmed gap: login-dependent renewal eventually strands the attempt |
| Credential rotation | Old token still passes signature/expiry verification; after `IssueAttemptTokenTx` the old token's HTTP save returns 401 and the replacement returns 200 | Confirmed backend race; frontend singleflight is mitigation within one JS context |
| Ambient login cookie | Same valid bearer: live cookie without CSRF returns 403; no cookie returns 200 | Confirmed save-path dependency on ordinary cookie/CSRF state |
| Account security events | Logout-all and disabled user, each tested with a bearer-only save, still return 200 | Confirmed account/attempt revocation separation; do not extend TTL first |
| Lost submit response | SAT and IELTS exact retries recover the stored digest after service recreation; only one receipt and seal exist | Existing transaction/idempotency foundation works |
| Expired bearer after commit | SAT and IELTS receipt retry fails with credential 401 while stored receipt/seal remain intact | Confirmation can be stranded; this is not evidence of lost committed answers |
| API process death | Submit, kill actual API process, start new process on same DB/key, replay same request for SAT and IELTS | Same digest and exactly one receipt/seal survive process replacement |
| Deadline crossing | IELTS saves B, section closes beyond grace, C is rejected with section/deadline error, DB still contains B; existing SAT deadline and late-evidence tests also pass | Existing deadline protection must be preserved |
| Transfer and multiple processes | Existing real-MySQL transfer/recovery cases, including two API and two worker processes | Existing fencing/recovery behavior is reusable |

These are finite local tests on an isolated MySQL 9.6 server, not a mathematical proof or production qualification. No production database, deployment, or secrets were accessed. Expiry is driven by database deadlines and an injected service clock; a four-hour browser sitting, iPad sleep/reload, proxy cookie behavior, real network partitions, and target-fleet capacity remain unverified. Process-restart tests cover death after commit, not every instruction boundary during commit. Go pass counts include named subtests; some baseline tests require DB and skip without it, recorded separately.

## 2. Requirements and acceptance criteria

| ID | Priority | Observable contract / acceptance |
| --- | --- | --- |
| FR1 | P0 | For a newly admitted exam grant, expire/remove the account cookie mid-sitting: save, lifecycle reads, module transitions, and submission work throughout the grant's bounded lifetime |
| FR2 | P0 | Concurrent resume/bootstrap calls for the same active grant return the same credential identity and deadline; neither invalidates an in-flight save or silently extends authorization |
| FR3 | P0 | Account disable, logout-all/security reset, explicit exam termination, and device transfer reject subsequently authorized writes; old-browser data remains recoverable, never silently accepted as current-owner writes |
| FR4 | P0 | Lost response or process kill after commit: exact retry returns the same receipt/digest with one terminalization; active-answer retries retain stable write IDs |
| FR5 | P0 | Pauses, section/module deadlines, control epochs, and ownership checks keep their existing semantics; a longer authorization lifetime never grants additional answer time |
| FR6 | P0 | Expired grant or unavailable server leaves drafts and submission intent recoverable, shows pending/reauthentication state, and never reports submission success without a receipt |
| FR7 | P1 | Provider-neutral late-evidence ingestion for offline IELTS drafts, with authorized staff review, immutable provenance, and no automatic scoring from a claimed client timestamp |

Security target: revocation is effective for operations authorized after the revocation transaction commits. A previously authorized write may commit first; tests must prove the serialization, not promise retroactive cancellation. Availability target: no scheduled 15-minute renewal is required for normal exam writes. Proposed maximum grant lifetime: 12 hours from admission, independently configured from account sessions; special sittings beyond this require staff-authorized extension/re-entry. Validate actual accommodations/pause policies before enabling issuance. No arbitrary production latency or capacity claim is made.

## 3. Entities and invariants

- `user_sessions`: account access; expiry is distinct from deliberate security revocation.
- `attempt_sessions`: exam grant, bound to user/schedule/attempt/browser-session and lease. `client_session_id` is an identifier, not cryptographic device possession; possession of the secret credential is the proof.
- `student_attempts`: authoritative owner, lease/control epochs, status, and terminal generation.
- Provider timelines/module boundaries: authoritative answer windows, independently of grant expiry.
- Response ledger and `attempt_submissions_v2`: stable operation identity, accepted answers, submission request hash and durable receipt.

Invariants: (I1) no unauthorized or superseded writer; (I2) one logical write/submission has one committed result per applicable generation; (I3) renewal/resume neither extends a grant nor resurrects revocation; (I4) failed auth/transport never clears unacknowledged drafts; (I5) a receipt read cannot mutate answers, route modules, or reseal an attempt; (I6) account idle/absolute expiry alone does not revoke an active exam grant; (I7) a longer grant does not move exam clocks.

## 4. Recommended design and interfaces

### A. Separate authentication mechanisms at the route boundary

Current global `authMiddleware` and `csrfMiddleware` in `backend/go/cmd/api/main.go` run before per-route authorization. Move mechanism selection to the matched, declared route policy, retaining the existing deny-closed authorization table in `internal/authz`.

- Explicit attempt-bearer routes authenticate the bearer, derive the actor from verified claims, and enforce attempt scope. Ambient cookies neither authorize nor block those routes.
- Cookie-authenticated routes retain session liveness, CSRF, origin checks, and recovery-session scope restrictions.
- Mixed routes explicitly choose and validate a mechanism; an invalid supplied bearer must not fall back to a more permissive cookie identity.
- Never bypass CSRF just because an arbitrary `Authorization` header exists. Keep account/staff routes protected and test malformed/foreign-origin requests. Preserve recovery-session restrictions through equivalent attempt scope checks.
- Bearer routes avoid ordinary session-store lookups, but retain the live exam authorization checks inside mutation transactions. DB errors remain retryable 503, not false 401 or anonymous authorization.

### B. Make revocation complete before changing credential lifetime

Extend the existing security operations (`internal/auth/auth.go`, `password_sessions.go`, and `cmd/api/handlers_auth.go`) to revoke associated live exam grants on logout-all, security reset, and explicit exam-access termination. Account disable must be enforced by the shared attempt authorization policy even if a state-changing caller bypasses these operations. Ordinary idle/absolute timeout must not be interpreted as revocation.

Put shared attempt-access policy in the existing `internal/auth` boundary; reuse it from `internal/attempts/service.go`, `internal/delivery/service.go`, and read verification in `auth.go`. Preserve caller transaction ownership, expected binding/lease checks, and current locking discipline. Include active-user eligibility in the authoritative decision; test revocation and issuance against concurrent writes. Inspect and align lock ordering across issuance (currently attempt then user), account security operations (currently user then user sessions), transfer, and save before merging; do not introduce an unreviewed user/attempt lock inversion. Bounded deadlock retry is recovery, not permission to ignore ordering.

Issuance/resume must not clear `revoked_at` as a generic upsert side effect. Revoked grants require an explicit, authenticated re-entry or staff recovery transition; ordinary credential reads cannot resurrect them. Browser-local logout should revoke that browser's exam grant; logout-all revokes all the user's exam grants. Do not implicitly submit or erase drafts during logout.

### C. Stable bounded exam grant

Add a policy/version snapshot to `attempt_sessions` using the next unused additive migration. Reuse existing `token_id`, binding, `issued_at`, `expires_at`, lease, and revocation fields; no new grant service/table is required. Legacy rows retain the 15-minute policy. For the new policy:

1. Initial verified admission creates a random grant ID and a fixed expiry using database time, under the existing ownership/admission transaction.
2. Same authorized browser + same active lease resumes with the same token ID and original expiry. Sign the same scoped claims; do not replace the ID on normal GET/bootstrap.
3. Token `exp` and stored expiry describe the same grant horizon; checks use consistent boundary semantics (`now >= expiry` rejects). Do not refresh an idle deadline on normal saves.
4. Module/section status and lease/control epoch checks still govern every mutation. Completed grants may retrieve a receipt, but cannot write or reopen the attempt.
5. Transfer/security recovery explicitly creates new authority and fences the previous credential. Normal resume cannot take ownership or reset revocation.
6. Existing frontend `expiresAt` remains compatible. Clients stop proactive refresh for a sitting-policy grant, retain the legacy refresh path for legacy credentials, and preserve drafts when the grant actually expires.

Keep signing configuration identical across normal restarts/replicas. The current token format has no key ID; uncoordinated `AUTH_SECRET` replacement invalidates tokens. A verification keyring with bounded previous-key retention is a separate prerequisite for routine secret rotation during active sittings. Never log credential material.

### D. Narrow resume and receipt contracts

Proposed new interfaces (paths are proposals, not existing endpoints):

- `POST /v2/student/attempts/{attemptID}/access:resume`: valid exam grant; returns `{attemptId, clientSessionId, leaseEpoch, credentialPolicy, expiresAt, attemptToken}` without loading exam content or rotating a sitting grant. If a legacy credential has expired, existing authenticated account admission or staff recovery establishes authority; a candidate ID/email is never sufficient proof.
- `GET /v2/student/attempts/{attemptID}/submission-receipt?submissionId=...`: current authorized exam grant, or explicitly scoped authenticated recovery. Returns an existing receipt for the current terminal generation, or a documented not-found result. It never accepts final commands or changes state. Reuse receipt/hash/digest owners from `internal/attempts/submit.go`; do not implement a second sealing path.

Existing submit remains the transactional authority: verify grant -> lock attempt -> check live access/lease/control/runtime -> apply final commands -> seal -> persist receipt -> commit -> acknowledge. Clients persist the exact submission ID and payload across timeout/reload and check receipt before creating a replacement operation.

Expired/revoked credentials are never accepted merely because a receipt exists. After the bounded grant expires, explicit account/proctor recovery is required. Return stable typed reasons for expiry, revoked access, lease fencing, deadline closure, and temporary backend failure; do not classify all failures as a request to bootstrap again. Proposed new reason codes must be added centrally in `internal/platform/apperrors/errors.go` and mapped in clients together.

### E. Preserve answers without inventing extra answer time

Keep IndexedDB/checkpoints and the response ledger. Existing SAT late evidence remains separate from scored answers. IELTS snapshot-backed attempts do not share SAT's normalized module topology, so do not force their drafts into SAT's module-bound evidence table. FR7 is a separate provider-neutral evidence contract, authenticated by the existing staff-assisted recovery grant, keyed by attempt/write ID with payload hash, original lease/version, claimed client time, server receive time, and review disposition. A claimed client timestamp is evidence, not proof of timely completion. Until FR7 ships, retain IELTS local drafts and route them through staff recovery; do not claim server-side preservation for unsent drafts after device storage loss.

## 5. Alternatives and trade-offs

| Option | Result | Why choose/reject |
| --- | --- | --- |
| Small renewal-only endpoint + bounded old/new overlap | Removes content dependency and rotation collision; still depends on periodic renewal and login recovery | Useful conservative interim step if scope must be reduced; incomplete for FR1 |
| Separate long-lived refresh secret + short access tokens | Exam continuity independent of login | Extra secret, refresh rotation/replay state, and periodic dependency; prefer only if short access-token exposure is a firm requirement |
| Stable bounded grant + live DB authority | Eliminates normal renewal while reusing existing revocation/lease checks | Recommended after revocation fixes; stolen credentials remain useful longer unless revoked, so scope and revocation are essential |

Illustration only: four hours / 15 minutes = 16 token lifetimes per student. A stable sitting grant removes routine renewal opportunities; it does not remove database writes or make the network reliable. No production request-rate or speedup is inferred.

## 6. Ordered implementation phases

| Phase | Verified files/components | Change | Done when |
| --- | --- | --- | --- |
| 0: evidence | `cmd/api/exam_continuity_mysql_test.go`, existing transfer/recovery/deadline suites | Keep characterization tests and turn each gap into an explicit desired-behavior test as its phase lands | Baseline reproduced on actual MySQL; expected current gaps clearly labeled |
| 1: access boundary | `cmd/api/main.go`, `internal/authz/{authz,middleware}.go`, `internal/auth/auth.go`, `password_sessions.go`, `internal/attempts/service.go`, `internal/delivery/service.go` | Route-declared auth mechanism; shared live access policy; deliberate account/exam revocation propagation; preserve recovery scopes and lock order | Cookie/CSRF cannot block a valid declared bearer route; disabled/revoked access fails across both providers and replicas; staff routes retain CSRF |
| 2: grant issuance | `internal/auth/auth.go`, `cmd/api/student_admission_gate.go`, `handlers_device_transfer.go`, `student_context.go`, `internal/attempts/ownership.go`, additive migration and `internal/platform/config/config.go` | Versioned grant lifetime snapshot, idempotent same-writer issuance, narrow resume endpoint; gated issuance for new sittings | Concurrent resume does not rotate/extend/resurrect; account expiry does not stop active sitting; wrong owner and expired grant fail closed |
| 3: receipts/clients | `internal/attempts/submit.go`, `cmd/api/handlers_v2.go`, `src/services/attemptCredentialAdapter.ts`, `src/features/student/infrastructure/responseDurabilityTransport.ts`, `src/features/student-delivery/api/assessmentDeliveryApi.ts`, `src/shared/durability/DurableResponseEngine.ts` | Narrow receipt query, explicit expiry/revocation handling, grant-aware proactive refresh, stable durable submission intent | Lost ACK/reload checks receipt; one seal/digest; no premature success or draft deletion; legacy clients remain compatible |
| 4: qualification/rollout | Existing `e2e/student-auth-lifetime.spec.ts`, new backend tests, existing integration suites and deployment runbook | Compressed expiry faults, real long browser sitting, concurrency/load, old/new deployment matrix, canary | All P0 criteria pass; school mock sitting completes with reconciled answers and receipts |
| Follow-up: evidence/key rotation | `internal/delivery/late_evidence.go`, existing staff recovery interfaces, `internal/platform/crypto/crypto.go` | FR7 provider-neutral evidence; signing keyring if operational rotation is required | Staff-reviewed evidence never silently changes scoring; old/new signing keys coexist for bounded grant lifetime |

Do not enable phase 2 issuance before phase 1 is complete. Keep the existing frontend hardening already in the working tree; these phases build on it rather than reverting it.

## 7. Required verification matrix

| ID | Stimulus | Persisted + external result |
| --- | --- | --- |
| T1 | SAT/IELTS mid-sitting login idle expiry, absolute expiry, absent cookie | Continue normal authorized writes/transitions; one grant, unchanged authorization deadline |
| T2 | 20 simultaneous same-writer resume requests mixed with saves | Stable token ID/expiry; no rotation-induced 401; accepted writes reconcile exactly |
| T3 | Two competing browsers; transfer or logout-all races a save | Serialized winner; no old-authority writes authorized after revocation commit; no silent takeover |
| T4 | Disabled user, reset credentials, explicit grant revoke, expired grant, forged bearer, wrong user/attempt | Defined rejection; zero unauthorized mutation or credential resurrection; drafts retained |
| T5 | Live, expired, malformed account/CSRF cookies on a valid bearer route; spoofed bearer on a cookie staff route | Bearer routes depend only on declared valid exam proof; staff CSRF/session checks remain intact |
| T6 | Commit submit, drop HTTP response, kill process, retry via another process and after browser reload | Same submission ID/hash/digest; one seal, one receipt, exact final answer set |
| T7 | Lose grant while receipt exists | Authorized recovery can read it; expired/foreign bearer cannot; receipt lookup never reseals |
| T8 | Offline across SAT module close / IELTS section deadline | Previously committed answers intact; no post-deadline normal mutation; retained local drafts/evidence handled explicitly |
| T9 | DB unavailable during access check/save/commit acknowledgement | Retryable failure or unknown outcome; no false logout/success; replay establishes committed result |
| T10 | Two API + two workers, process replacement, policy flag off/on, mixed legacy/new clients | DB remains authoritative; old grants still validate; no duplicate terminalizations or stale-owner writes |
| T11 | Grant cap reached during long pause/accommodation | Controlled expiry and staff recovery/extension; no automatic extra answering time or indefinite grant |
| T12 | Signing-key mismatch/replacement | Detectable auth failure with preserved drafts; staged keyring test if rotation support implemented |

Run failure tests with real MySQL transactions, barriers/controlled clocks, and persisted-row assertions. Run browser checks on desktop and an actual iPad, including sleep, reload, offline/reconnect, and storage unavailable. A localStorage/IndexedDB failure must be visible; no backend can recover an answer never transmitted and no longer stored on the device. Qualify at measured cohort/replica capacity; do not substitute local timings for production SLOs.

## 8. Rollout, rollback, and telemetry

1. Add backward-compatible schema and dual-policy verification first. All API/worker instances must understand new grants before issuance is enabled.
2. New issuance flag is admission-only and policy is persisted; turning the flag off stops new grants, not existing students. Legacy rows keep legacy semantics. Do not migrate active grants by blindly resetting expiries or revocation fields.
3. Run local/staging fault tests; then a four-hour mock on desktop + iPad with account expiry forced mid-sitting. Reconcile database answers, submission receipts, and frontend acknowledgements.
4. Canary newly created mock/small cohorts. Proposed guardrails: no authorized write rejection caused solely by account timeout or normal resume; zero unauthorized post-revocation writes; zero duplicate seals; all acknowledged answers present. Establish latency baselines before setting p95/p99 thresholds.
5. Tag metrics by provider, route, credential policy/kind, and bounded failure reason. Separate account expiry, grant expiry, revocation, lease fencing, CSRF, DB failure, save acknowledgement delay, pending age, and receipt replay. Current bearer requests can be logged as `actor=anonymous`, so anonymous alone is not an incident classifier. Never emit tokens, answer text, emails, or candidate IDs as metric labels.
6. On a guardrail breach stop new-policy issuance, preserve active-grant verification, and use staff recovery. Do not roll back to a verifier/issuer that cannot honor existing grants or rotates them on resume. Prefer a forward fix while students are sitting. Additive schema remains until all issued grants and rollback windows expire.

## 9. Remaining uncertainty

- Production deployed version, proxy/cookie settings, fleet/database capacity, and actual exam accommodation maxima were not inspected.
- A real four-hour browser/iPad soak and network-partition drill have not been run.
- A client edit's claimed timestamp cannot prove it preceded a deadline. Recovery and fairness policy must remain explicit.
- Signer/key changes, account-disable writers, maintenance, and every mixed-auth route must be enumerated during implementation; the plan does not claim those changes already exist.
- This pass adds executable characterization and a design artifact only; it does not deploy or implement the new backend authorization model.

## 10. Implementation status (2026-10-30)

Implemented, uncommitted, issuance flag default off:

- **Access boundary.** `cmd/api/route_authentication.go` picks the mechanism from the declared `authz` policy. Bearer routes never consult cookies. Mixed routes (`SessionOrBearer`) use the bearer only when one is presented. Unknown routes keep cookie + CSRF. The media content route is mixed, so staff cookie previews still work.
- **Live access policy.** `auth.ActiveAttemptPrincipalSQL` (active user) applies on every grant lookup. Logout-all and security reset revoke all of a user's grants in the same transaction. Browser logout revokes the grants bound to that browser's session (`auth.RevokeBrowserSessionWithCache`).
- **Lock order.** The global order is users → user_sessions → attempt_sessions. `auth.LockExamPrincipalTx` runs before any grant lock in transfer commit, staff device recovery, and the entry browser bind. `integration/exam_access_lock_order_test.go` pins this.
- **Grants.** Migration `0112` adds `credential_policy` and `account_session_id`. `auth.IssueExamGrantTx`:
  - creates a new grant with a fixed horizon (`EXAM_ACCESS_MAX_HOURS`);
  - returns the same token ID and expiry on resume;
  - lets revoked or expired grants return only through explicit re-entry, transfer, or recovery;
  - leaves legacy rows on legacy semantics.
- **Endpoints.** `POST /v2/student/attempts/{id}/access:resume` and `GET …/submission-receipt` are read-only. Receipts persist the final acknowledgements.
- **Typed errors.** `EXAM_ACCESS_EXPIRED` (401) and `EXAM_ACCESS_REVOKED` (403).
- **Metrics.** `exam_access_rejected_total{reason,policy}` and `exam_access_admitted_total{policy}`.
- **Clients.**
  - Sitting grants skip proactive refresh and resume with their own proof.
  - Attempt-scoped requests ignore account-generation changes.
  - Submission intent is durable and checks the receipt first.
  - Expiry and revocation show `authentication_required` and keep drafts.
  - A reload with an expired login loads the sitting through the stored grant, and the runtime poll falls back to it on a 401.

Verified locally on an isolated MySQL 9.6:

- Go: the full `./...` suite and the race detector on the continuity, transfer, and recovery suites.
- Vitest: the full suite.
- Browser: `playwright.exam-continuity.config.ts` on desktop Chromium. A sitting saves after account expiry and reloads with the same token ID.

Known unrelated failures:

- `TestSATRecoveryBoundaryFollowsModuleClockMySQL` and `TestSATRecoveryTwoWorkerBoundarySweepIsIdempotentMySQL` also fail on clean HEAD.
- The load-runner catalog lacks `sat-break-boundary`.

Still outstanding (phase 4 and follow-up):

- Real iPad and four-hour soak. Emulated tablets stop at the listening-audio readiness gate, so the browser scenario runs on desktop only.
- Network-partition drills, fleet capacity, and canary.
- FR7 provider-neutral late evidence.
- Signing keyring.
