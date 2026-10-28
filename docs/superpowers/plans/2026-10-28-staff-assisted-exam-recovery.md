# Staff-assisted device transfer and exam continuation — implementation plan

Date: 2026-10-28 (Asia/Bangkok)

Status: approved product decisions; repository-grounded implementation design. **Plan only.**

Goal: Staff can move an existing SAT, IELTS, or ACT sitting to another browser using a personal QR/link and a single-use code, choose the affected section/module, and optionally set its remaining time. The old machine need not work. Staff may reopen a timed-out section even after automatic advancement, preserving subsequent saved work.

Architecture: Retain the existing attempt, registration, published version, answer stores, writer lease, and provider services. Add staff-issued recovery grants and an attempt-owned recovery control. Delivery orchestrates continuation; attempts owns writer authority; runtime owns clock calculation; terminalization owns immutable completion history. Recovery credentials are separate from ordinary entry/start codes.

Tech stack: Go 1.26.3, MySQL, React/TypeScript, existing Bun scripts, Vitest, Go tests/sqlmock, real-MySQL integration tests, Playwright, installed qrcode and Dialog components. No new service or queue.

## 1. Change boundary and repository evidence

### Approved product contract

- One staff popup: student/exam, eligible section/module, live remaining countdown, optional exact remaining-time override, personal QR/link, one-time expiring code, status.
- Opening the popup previews state. The explicit **Create QR and code** action begins the transfer and immediately revokes the old writer. Merely opening or dismissing a preview does not change authority.
- Countdown continues while moving devices, including after code expiry. Earlier discussion of pausing at issuance was superseded.
- An explicit remaining-time override is the amount awarded **when the student presses Continue exam**, not a deadline based on when staff typed it.
- No override means retain the original deadline, not a frozen copy of the remaining seconds displayed earlier.
- A new browser needs the personal link plus code; no login, registration, email, or name entry.
- Code verification prepares a device. Questions and answers are withheld until the explicit Continue exam action. Preparation itself never grants answer access.
- Staff can select an earlier section/module that timed out, even if later sections opened or were answered. A timed-out whole attempt can also continue.
- Explicit student submission is final. Proctor termination, forced submission, cancellation, and unauthorized room end are not reopened through this feature.
- Saved subsequent answers and already-selected SAT Module 2 branches are preserved. Only the focused recovery stage can be worked on during a rewind.
- Personal IELTS audio resumes at its latest server-confirmed checkpoint; classroom/shared audio is unaffected.
- Expired/reissued codes do not restore the original device. Staff must explicitly restore that device.
- Audit records are automatic. Unsent data on an inaccessible machine cannot be promised.

### Verified implementation map

All paths below are relative to the repository root. Existing targets were inspected; new paths/symbols below are **Proposed**.

| Boundary | Verified files and symbols | Consequence |
|---|---|---|
| Staff/student transfers | backend/go/cmd/api/handlers_device_transfer.go: studentTransferRequestHandler, proctorDeviceTransferDecisionHandler, admitStudentSession | Existing flow needs an authenticated student and an identified target browser before approval. It cannot serve the requested cold-browser flow unchanged. |
| Ownership | backend/go/internal/attempts/ownership.go: Admit, admitInTx, lockOwnershipRow, WriterPolicyOf | Current policy is SAT-specific; an empty owner can be claimed. A recovery hold must prevent ordinary admission from reclaiming it. |
| Transfer transaction | backend/go/internal/attempts/device_transfer.go: RequestTransfer, DecideTransfer, CommitTransfer, commitTransferInTx, auditTransfer | Existing locking, revocation, audit, and replay conventions are reusable. Ownership currently moves at commit, later than the new requirement. |
| Transfer schema | backend/go/migrations/0076_attempt_device_transfers.sql | Existing rows require student auth and target-session data. Keep this schema/API compatible rather than making its required fields meaningless for staff grants. |
| Canonical answers | backend/go/internal/attempts/service.go: saveInTx, lockAttempt, validateTokenSession, ensureActiveSession, ensureWritable, ensureQuestionAdmittedForProvider | V2 lease/control fences exist for all providers. Recovery must feed this boundary, including the snapshot-runtime configuration. |
| Legacy writes | backend/go/cmd/api/handlers_v1_writes.go: requireV1StudentIdentity; backend/go/internal/student/v1_write.go: ApplyMutationBatchInTx, PrepareSubmitInTx, ensureV1ClientSession | Cookie-authenticated V1 mutations must not bypass a recovery hold. |
| Other owner writers | backend/go/internal/student/telemetry.go: RecordPrecheck, RecordHeartbeat, ensureTelemetryClientSession; presence.go: FlushPresence; internal/proctor/service.go: Pause, Resume, ExtendAttempt, ReArmAttemptStage | Telemetry and delayed memory-presence flushes can claim an empty owner. Ordinary control commands must use recovery focus without clearing a hold or shifting suspended clocks twice. |
| Delivery compatibility | backend/go/internal/delivery/service.go: Bootstrap, SaveResponse, ensureSaveModuleAdmitted | Protocol-1 answer paths remain supported. Protocol-2 recovery must not acknowledge a legacy write ignored by its scorer. |
| SAT progression | backend/go/internal/delivery/start_submit.go: finalizeModuleTx, finalizeModuleWithBasisTx, nextModuleTx, chooseAdaptiveRoute, insertModuleAttemptTx | Module completion reasons exist; Module 1 currently routes forward and inserts a unique route decision. Replaying that logic after rewind would conflict or select a different branch. |
| SAT timing and workers | backend/go/internal/delivery/sat_personal.go, reconcile.go: ReconcileAttemptTimeout, reconcileSteady, ReconcilePersonalTimeouts; backend/go/internal/runtime/service.go: RearmPersonalStageInTx, SyncV2TimingForAttemptInTx | Existing deadlines, entry offers, breaks, and timeout sweeps must respect recovery focus. Rearm alone does not reopen a terminal module. |
| SAT recovery frontiers | backend/go/internal/delivery/module_boundary.go, close_module.go, recovery_resolution.go; migrations 0096–0100 | Boundaries, close intents, late-evidence frontiers and receipts are keyed to a module attempt. A reopened run must not reuse an earlier frozen frontier. |
| IELTS clocks | backend/go/internal/runtime/ielts_personal.go: readyIELTSPersonalSectionInTx; migration 0094 | Attempt-owned section timelines exist. Room state may naturally end while an individual clock is relevant. Current completed timelines do not store a dedicated completion reason. |
| Runtime projections | backend/go/cmd/api/student_context.go: loadStudentRuntimeContext, projectIELTSPersonalRuntime; backend/go/cmd/api/handlers_v2.go: v2Resolver, loadIELTSTimelines, v2Locker; v2locker_snapshot.go: snapshotLocker | Both read views and authoritative write gates must resolve the same recovery clock and focused section. |
| Terminal facts | backend/go/internal/terminalization/service.go: TerminalizeInTx, sealAttemptInTx, SQLTerminalizationRepository; migrations 0043, 0056 | One immutable receipt currently exists per attempt. UPDATE/DELETE is prohibited. Clearing submitted_at alone cannot reopen and reseal safely. |
| Provider completion/results | backend/go/internal/sat/service.go: completeInTx, terminalizationCompletionSealer.SealCompletion; backend/go/internal/terminalization/service.go: materializeSATResult, materializeACTResult, materializeACTCanonicalProjection | SAT seals with reason sat_complete, not necessarily time_expired. SAT/ACT existing-result branches can return without recalculating. Both need generation-aware behavior. |
| Grading projections | backend/go/migrations/0008_grading_results.sql; backend/go/internal/grading/{projection,result_read,review_read,service,sessions}.go; backend/go/internal/results/service.go | student_submissions currently has a unique attempt_id. Old results/review drafts must remain historical instead of being reused as current grading input. |
| Authentication | backend/go/internal/auth/{auth,session_proof,sessionlookup_cache_impl,attemptverify_read}.go; cmd/api/student_entry_recovery.go: lookupOwnEntry, writeStudentEntry | A verified cookie origin is required. A recovery code must not mint an unrestricted account session for the student. |
| Routing/authorization | backend/go/cmd/api/main.go; backend/go/internal/authz/{table_auth,table_staff,table_fullpath,middleware}.go; handlers_domain.go: requireProctorDeps, requireProctorAttemptScope | Register routes explicitly; reuse admin/proctor role and assignment checks. Deny observers and unrelated schedules. |
| SAT staff UI | src/products/sat/routes/SatSessionRoomRoute.tsx; ui/SatSessionRoomStudents.tsx: StudentDetail; ui/SatDeviceTransferRequests.tsx | Add a selected-student action rather than requiring a student-originated request. Retain the old review queue while old clients drain. |
| IELTS/ACT staff UI | src/components/proctor/{ProctorDashboard,StudentDetailPanel}.tsx; src/features/proctor/routes/ProctorRoot.tsx | These surfaces need the same recovery popup and transport contract. |
| Student route | src/app/router/createRouter.tsx; src/features/student/routes/StudentSessionRoute.tsx; hooks/useStudentSessionRouteData.ts | Recovery must be reachable before RequireAuth. Existing student route currently requires authenticated loading. |
| Compatibility exports | src/features/student-delivery/routes/StudentSessionRoute.tsx; src/features/proctoring/routes/ProctorRoot.tsx | These are re-exports. Change the actual owners, not both copies. |
| Audio | src/components/student/StudentListening.tsx: syncProgressFromAudio, seekToPercent, adjustCurrentTime | Position currently lives in the audio element/component; it is not recoverable on a new browser. |
| Reusable UI | src/components/ui/Dialog.tsx; src/features/exam-authoring/ui/access-links/AccessLinkShareSheet.tsx: useQrCodeDataUrl; package.json | Dialog behavior and qrcode already exist. Extract the QR hook only if needed to avoid importing authoring UI into student/staff delivery bundles. |
| Durable replay | backend/go/internal/lifecycle/receipts.go: Hash, Load, Store; internal/platform/tx/tx.go | Reuse operation receipts and bounded READ COMMITTED retry. Receipt replay is after authorization and must not recreate superseded authority. |
| Tests | backend/go/integration/sat_device_transfer_test.go; e2e/sat-device-transfer.spec.ts; e2e/student-multi-device.spec.ts | The existing SAT E2E copies practice-entry localStorage into the second browser. The new test must use a completely clean browser without this copy. |

**Verified workspace observation at planning start:** playwright.sat-staff-ux.config.ts had a local modification. It was not edited by this task; recheck the working tree and preserve unrelated work at implementation time. Highest migration inspected is 0104; use the next available migration numbers at implementation time.

**Inferred:** The feature crosses lifecycle/terminalization, not just transfer UI. An implementation that adds QR and credentials while keeping current terminal receipt semantics cannot satisfy approved timeout reopening.

**Unknown, with explicit resolution:** Some legacy completed rows may lack reliable timeout provenance. Add precise provenance for new closures; classify existing rows from immutable receipt, module completion reasons, timeline deadline/finish evidence, and control audit. Unknown or contradictory provenance is ineligible with a visible staff reason; never infer timeout from submitted_at alone. Task 1 must produce classification fixtures for all three providers before finalizing the migration/backfill.

Non-goals: detecting whether hardware really broke; automatically granting time on disconnect; recovering never-synced answers; reopening student-submitted work; changing question content, adaptive scoring policy, or the published version; adding unsupported ACT test formats.

## 2. Requirements, errors, and invariants

| ID | Acceptance criterion | Authoritative owner |
|---|---|---|
| FR-01 | Assigned staff issue/reissue a sitting-specific QR+code and immediately fence all existing writer credentials. | Delivery orchestration + attempts writer helpers |
| FR-02 | Clean browser redeems link+code once, without identity entry; no exam payload appears before Continue. | Recovery grant + credential issuer |
| FR-03 | Original countdown runs during transfer. Optional exact seconds become the target clock at Continue. Expired target requires positive override. | Runtime recovery clock |
| FR-04 | Staff selects an active or provably timed-out earlier stage, including a stage before current automatic advancement or an entirely timed-out attempt. | Eligibility + delivery continuation |
| FR-05 | Subsequent answers, tools, selected SAT route and unconsumed time survive rewind; only recovery focus is writable. | Delivery + runtime |
| FR-06 | Staff restores the original browser explicitly; outstanding recovery credentials become unusable. Original revoked tokens are never un-revoked. | Attempts + delivery |
| FR-07 | IELTS personal audio resumes from acknowledged server position for the same part/media. | Audio checkpoint boundary |
| FR-08 | Staff sees issued/ready/continued/expired/replaced/restored state; audit records old/new authority, target, clock change and actor automatically. | Grant state + audit |
| FR-09 | Reopened attempt has no current old score; reseal creates a new completion generation and recalculates current results. | Terminalization + grading/results |
| INV-01 | At most one authorized writer; while held, none. UUID/session ID alone is not a recovery credential. | Locked attempt + lease |
| INV-02 | Every mutation, admission, bootstrap, media/content read, submit, takeover and recovery-write path respects hold/focus. Revoked cookie-path access cannot bypass it. | Shared recovery authority projection and existing trusted boundaries |
| INV-03 | Reissue/restore and competing redemption serialize on attempt lock. A stale code, claim, receipt or lease cannot reclaim ownership. | SQL transaction + operation/grant keys |
| INV-04 | Explicit student submit, proctor termination/forced end, cancellation, and unknown legacy closure never become eligible by waiting for a deadline. | Closure provenance |
| INV-05 | No other student's timer or room stage changes during an individual recovery. | Attempt-owned control |
| INV-06 | Old terminal receipts, prior answer frontiers, grading drafts and audit remain historical. No deletion of completion evidence. | Generation-aware storage |
| INV-07 | Answer client versions/server revisions remain monotonic; no answer-store reset, synthetic copying, or old offline-queue replay. | Existing response protocol |
| INV-08 | Every displayed resumed deadline and server acceptance gate derive from the same clock. No independent frontend timer authority. | Runtime |
| INV-09 | Identical retry does not extend expiry, add time twice, replay audio seeking, emit another completion, or duplicate break/form consumption. | Operation receipt + run generation |

New error reasons use the existing error envelope and appropriate existing base code. Proposed stable detail reasons:

| HTTP | Reason | Effect |
|---|---|---|
| 422 | RECOVERY_INVALID_TIME / RECOVERY_INVALID_INPUT | No mutation; require integer seconds 1..86400 for an explicit award. |
| 403/404 | Existing forbidden/not-found semantics | Wrong role, assignment, sitting, or principal sees no private data. |
| 409 | RECOVERY_INELIGIBLE / RECOVERY_MANUAL_SUBMIT / RECOVERY_CONTROLLED_END | State unchanged; show eligibility reason to staff. |
| 409 | RECOVERY_STALE / RECOVERY_SUPERSEDED / OPERATION_ID_CONFLICT | Refresh authoritative state; never silently reapply another staff member's change. |
| 410 | RECOVERY_EXPIRED | Code/claim no longer authorizes entry; hold and original timer remain as they were. |
| 422 | RECOVERY_INVALID_CREDENTIALS | Same public message for wrong link/code; no candidate identity leak. |
| 429 | RECOVERY_CODE_LOCKED | Persisted attempt budget exhausted; staff must reissue. |
| 409 | RECOVERY_TIME_REQUIRED | Countdown reached zero and no positive override exists; remain on ready screen. |
| 503 | Existing unavailable/transient errors | Whole transaction rolls back; retry same operation ID. |

**Engineering defaults, not additional product decisions:** issuance TTL 10 minutes (matches current request TTL default), claim/preparation TTL 10 minutes from successful redemption, 6 decimal digits, 256-bit link secret, at most 5 wrong codes per grant. Use existing anonymous-auth IP tier as well as the persisted grant budget. No automatic expiry extension. A consumed code cannot be used by another browser even during preparation TTL. Staff can reissue. Make constants server-owned, not a settings UI.

## 3. State, entities, and ownership

### 3.1 Existing attempt remains the sitting

Keep attempt ID, registration, student principal, version, existing answer maps/rows, lease_epoch, control_epoch, and revision. Add:

- terminal_generation BIGINT UNSIGNED NOT NULL DEFAULT 0: current completion generation, advanced only when actually reopening an already sealed sitting.
- recovery_control JSON NULL: typed, server-written control described below. Do not reuse existing recovery JSON, which carries a different compatibility/draft contract.

Proposed pure Go values in internal/exams/recovery.go; SQL ownership helpers remain in internal/attempts/recovery_control.go. **Verified dependency constraint:** attempts/service.go already imports runtime. Runtime must not import attempts. The existing exams package has no attempts/runtime dependency and can hold these small shared domain values without a new abstraction package. Signatures below use examdomain for internal/exams.

~~~go
type RecoveryTarget struct {
    SectionKey      string
    ModuleAttemptID string // empty for snapshot-backed section-only providers
    ModuleID        string
}
type SuspendedRecoveryStage struct {
    Target RecoveryTarget
    State string
    RemainingSeconds int
    EntryRemainingSeconds *int
    BreakRemainingSeconds *int
    RunGeneration uint64
}
type RecoveryControl struct {
    Version string // "staff_recovery_v1"
    ID string // stable control identity across code reissues
    Phase string // held | working | returning
    ActiveGrantID string
    OriginalSessionID string
    Target RecoveryTarget
    FocusRunGeneration uint64
    Suspended []SuspendedRecoveryStage
}
~~~

The grant stores a requested time policy; the existing provider clock stores the effective working deadline. Do not persist a second mutable remaining-seconds counter. Suspended seconds are deliberate frozen continuation values for later stages, not a competing active clock.

Reissuing while held retains the same control/original browser. A genuinely new transfer while already working creates a new control identity and captures the current writer as its original browser, merging any still-suspended continuation stages by target identity rather than discarding or duplicating them.

### 3.2 New attempt_device_recovery_grants table

Separate from attempt_device_transfers because a staff-issued grant has no student requester or target browser at creation.

Required columns:

- id, attempt_id, schedule_id, issued_by_user_id, operation_id UNIQUE, request_hash.
- active_attempt_id nullable UNIQUE: one issued/claimed live grant per attempt; set NULL at terminal state.
- state: issued | claimed | started | expired | replaced | restored | locked.
- target_section_key, target_module_attempt_id nullable, target_module_id nullable; requested_remaining_seconds nullable.
- expected_control_epoch, expected_lease_epoch, grant_revision.
- link_secret_hash, code_mac, failed_code_count, issued_at, expires_at.
- sealed_issuance BLOB: authenticated-encrypted code/link payload for authorized replay of a lost staff response; no plaintext credential columns. Use purpose-derived keys from existing auth secret, standard-library AES-GCM/HMAC, random nonce, and grant/attempt IDs as associated data. Do not invent reversible hashing. Clear the capsule on claim or terminal state. Staff status never returns secrets except authorized live-grant reveal/replay.
- claim_proof_hash, target_client_session_id nullable, claimed_at, claim_expires_at.
- started_at, resulting_lease_epoch, begin_operation_id, begin_receipt JSON.
- restored_at, restored_by, created_at, updated_at.

Use FK/index conventions of 0076 and server UTC timestamps. Grant state and recovery hold are distinct: expiring a grant does not clear recovery_control or allow an unowned admission.

### 3.3 Completion and module-run generations

**Required, not optional scope:** existing immutable attempt receipts and unique grading rows prevent safe timeout reopening.

1. Add terminal_generation DEFAULT 0 to attempt_terminalizations; change PK to (attempt_id, terminal_generation), retain terminalization_id UNIQUE and immutable UPDATE/DELETE triggers. Existing receipts become generation 0.
2. Add terminal_generation DEFAULT 0 to student_submissions; replace unique attempt_id with UNIQUE(attempt_id, terminal_generation). Create fresh submission/section/grading rows on the next seal, never overwrite previous grading work.
3. Add terminal_generation to assessment_results (current projection), attempt_submissions_v2 receipts, and relevant generated completion payloads. Keep one current assessment_results row per attempt/provider; replace its projection only with the new generation, while history remains in immutable terminal receipts and versioned submissions/results.
4. Current receipt/submission/result lookups join student_attempts.terminal_generation. Historic by-ID staff views remain available as historical, and are read-only if superseded.
5. Add run_generation DEFAULT 0 to assessment_module_attempts. Retain module attempt ID and answer identities on reopening.
6. Add matching run_generation to assessment_module_boundaries and assessment_module_close_intents (composite PKs), assessment_module_boundary_resolutions (composite receipt identity), assessment_late_answer_evidence (immutable origin generation), and assessment_late_evidence_frontiers (composite frontier identity). Historical evidence stays immutable. Add run generation to lifecycle request hashes/receipts and frozen-batch context. Version-0 requests default to 0 only for untouched runs; missing run on a reopened module is rejected, never interpreted as current.
7. IELTS timelines gain explicit completion_reason and run_generation. Proven new timeout transitions write time_expired. Manual closures and administrative closures use distinct values.

Do not select MAX(generation) as authority: the attempt's current generation is authoritative, including an open generation with **no terminal receipt yet**.

### 3.4 Audio checkpoint

Proposed attempt_audio_checkpoints table, PK(attempt_id, section_key, part_id, media_revision):

- position_ms, client_sequence, lease_epoch, run_generation, updated_at.
- Identity/media revision resolved against the pinned exam; do not use a transient signed URL as media identity.
- Server accepts a newer sequence from the current authorized lease/run. A legitimate backwards seek may lower position; do not use MAX(position).
- One checkpoint stream per part. Reuse an existing stable media revision if available; otherwise derive a server fingerprint from the pinned part ID and media reference.

### 3.5 State transitions

| Current | Operation / guard | Committed result |
|---|---|---|
| Ordinary active or eligible timed-out sitting | Staff issue, expected epochs match | recovery_control held; lease/control advance; all attempt sessions revoked; grant issued; original clock still runs |
| Held + live grant | Correct link/code + browser proof | Code consumed; grant claimed for one browser; preparation capability only |
| Held + claimed | Continue + ready, positive effective time, matching revision | Target opened under current run; writer credential/session minted; focused clock starts/continues; grant started |
| Issued/claimed | Expiry or wrong-code budget exhausted | Grant expires/locks; hold remains; original deadline still elapses |
| Held | Staff reissue | Previous grant/claim invalidated; exactly one new grant; hold remains |
| Held | Staff restore original | Outstanding grant invalidated; original browser designated for readiness; fresh credential issued only on its explicit Continue |
| Working rewind | Focus ends authoritatively | Score that run; resume preserved later stage without route reselection or duplicate break/form consumption |
| Any pre-begin state | Student manual submit/admin stop wins before issuance | Recovery rejected; no token minted |
| Reopened sitting | Current generation fully completes | Exactly one new immutable terminal receipt and newly computed current result |

## 4. Function-level design and API contracts

Every new symbol/route in this section is **Proposed**. Existing symbols named as integration points above are verified.

### 4.1 Attempts: ownership and admission

Create internal/attempts/recovery_control.go:

~~~go
// ParseRecoveryControl and the value types belong to internal/exams.
func ParseRecoveryControl(raw []byte) (*RecoveryControl, error)
// These SQL helpers belong to internal/attempts.
func FenceForRecoveryInTx(ctx context.Context, q tx.Tx,
    attemptID, controlID, grantID, actorID string) (lease, control uint64, err error)
func AuthorizeRecoveryFocus(control *examdomain.RecoveryControl,
    sessionID string, target examdomain.RecoveryTarget, runGeneration uint64) error
~~~

- Called only after the common attempt row lock. Fence captures original session once per control, advances lease/control epochs, revokes all attempt_sessions with reason device_transfer, and persists held control atomically with grant insertion. Reissues rotate authority without replacing the original-browser identity.
- Update ownershipRow/AttemptState scans to include the control and current generation.
- In admitInTx, check recovery control **before** terminal/empty-owner admission. Held never auto-claims or mints a normal writer token. Working permits only the assigned owner; provider-independent enforcement applies even if legacy SATSingleWriter is off.
- Keep SAT writer_policy serialized value compatible; do not reinterpret every old IELTS/ACT attempt as SAT policy. Recovery control enforces all providers only for affected sittings.
- Apply this authority to Takeover/takeoverInTx, old CommitTransfer, V1 cookie mutations/submits, normal refresh/entry and protected read paths. An old transfer request is cancelled/conflicted when staff recovery begins.
- Apply it to precheck/heartbeat ownership claims too. The memory-presence flusher's SQL must exclude held controls and require the still-current client-session binding so dirty data queued before issuance cannot refill an empty owner. Preserve the current memory path's request-cost model; do not add per-heartbeat SQL merely to solve delayed-flush ordering.
- No extra per-component guard copies: read a shared authority projection at each existing trusted entry boundary and pass it to owner checks.

### 4.2 Delivery: recovery orchestrator

Create internal/delivery/device_recovery.go and device_recovery_types.go:

~~~go
type IssueDeviceRecoveryRequest struct {
    OperationID string
    ExpectedLeaseEpoch uint64
    ExpectedControlEpoch uint64
    Target examdomain.RecoveryTarget
    RemainingSeconds *int
}
type ClaimDeviceRecoveryRequest struct {
    OperationID, LinkSecret, Code, ClientSessionID, BrowserProof string
}
type BeginDeviceRecoveryRequest struct {
    OperationID string
    ExpectedGrantRevision uint64
    Ready RecoveryReadiness
}
type RecoveryReadiness struct {
    ContentReady bool
    AudioReady bool // required only for personal audio in chosen section
}

func (s *Service) RecoveryOptions(ctx context.Context,
    scheduleID, attemptID string) (*DeviceRecoveryOptions, error)
func (s *Service) IssueDeviceRecovery(ctx context.Context,
    scheduleID, attemptID, actorID string,
    req IssueDeviceRecoveryRequest) (*IssuedDeviceRecovery, error)
func (s *Service) ClaimDeviceRecovery(ctx context.Context,
    grantID string, req ClaimDeviceRecoveryRequest) (*RecoveryReadyView, error)
func (s *Service) RecoveryReady(ctx context.Context,
    grantID, browserProof string) (*RecoveryReadyView, error)
func (s *Service) BeginDeviceRecovery(ctx context.Context,
    grantID, browserProof string, req BeginDeviceRecoveryRequest,
    issue RecoveryCredentialIssuer) (*RecoveryBeginResult, error)
func (s *Service) RestoreOriginalDevice(ctx context.Context,
    scheduleID, attemptID, actorID, operationID string,
    expectedControlEpoch uint64) (*RecoveryRestoreResult, error)
~~~

Type contracts:

- DeviceRecoveryOptions: attempt/control epochs, candidate display, provider, serverNow, eligible targets with originalDeadlineAt/remainingSeconds, ineligibility reasons, live grant status, lastServerSaveAt.
- IssuedDeviceRecovery: safe grant status plus staff-only link/code/expiry. No answer data. Live secret replay requires current staff authorization and active matching grant.
- RecoveryReadyView: verified candidate name, exam/target labels, grantRevision, time policy, originalDeadlineAt/serverNow, checkpoint metadata, and a readiness manifest containing media references/content version and question IDs **without question text, answers, passages, transcripts or answer keys**.
- ContentReady means required assets are locally available; readiness booleans are UX signals, never authorization. Existing APIs still deny questions before Begin.
- RecoveryBeginResult: attempt/schedule/student route locator, authoritative lease/control/run/generation, credential and expiry, current clock, next route, replayed flag. Existing serializers redact private server snapshots.
- RecoveryCredentialIssuer is an injected composition-root callback that inserts the scoped user session and attempt credential into the **same supplied transaction**; delivery does not import cmd/api or own cookies. Its proposed signature is below. Credentials are returned only at the authenticated edge; begin_receipt and generic lifecycle receipts contain metadata/IDs, not raw tokens.

~~~go
type RecoveryCredentialIdentity struct {
    UserID, ScheduleID, AttemptID, ClientSessionID string
}
type RecoveryCredentialBundle struct {
    SessionID, SessionToken, CSRFToken string
    AttemptToken string
    SessionExpiresAt, AttemptExpiresAt time.Time
}
type RecoveryCredentialIssuer func(context.Context, tx.Tx,
    RecoveryCredentialIdentity, uint64) (RecoveryCredentialBundle, error)
~~~

At composition root wire a transaction-scoped reopen callback into delivery, following its existing SetSATTerminalizerInTx convention. The callback delegates to terminalization.ReopenTimedOutInTx; it does not start a nested transaction.

### 4.3 Runtime: target clocks and continuation

Create internal/runtime/recovery.go:

~~~go
type RecoveryClockPlan struct {
    DeadlineAt time.Time
    AwardedSeconds *int // nil retains original deadline exactly
}
func PlanRecoveryClock(now time.Time, originalDeadline *time.Time,
    requestedSeconds *int) (RecoveryClockPlan, error)
func BeginRecoveryStageInTx(ctx context.Context, q tx.Tx,
    attemptID string, target examdomain.RecoveryTarget,
    clock RecoveryClockPlan, now time.Time) error
func SuspendRecoverySuccessorsInTx(ctx context.Context, q tx.Tx,
    attemptID string, target examdomain.RecoveryTarget,
    now time.Time) ([]examdomain.SuspendedRecoveryStage, error)
func ResumeRecoverySuccessorInTx(ctx context.Context, q tx.Tx,
    attemptID string, stage examdomain.SuspendedRecoveryStage,
    now time.Time) error
~~~

- Reuse clock arithmetic from existing SAT modules/IELTS timelines. ACT/snapshot sections get an attempt-owned recovery focus deadline; do not mutate the room's section deadline.
- No override: effective deadline is exactly the existing target deadline. No rounding-derived time gift. Reject if already elapsed.
- Pass that exact DeadlineAt through the clock plan; an integer remaining-seconds display is never converted back into a replacement deadline.
- Override: deadline = server transaction time + awarded seconds; clear target pause accounting for this new run so old accumulated pause/extension is not counted twice. Preserve original allowance/history in audit.
- At Begin, snapshot remaining time for live successors, their armed entry/break deadlines, and suspend them. **Do not suspend at grant issuance**: approved countdown continues during transfer.
- On focus completion, resume its already-existing successor from saved seconds. Zero seconds never becomes a fresh full allocation: keep it expired and offer staff recovery for that stage. Finished stages are skipped. Unopened stages follow existing handoff/break rules once.
- Record which section-entry forms/breaks were already consumed; preserve existing assessment forms records. A rewind must not ask the same mandatory form again or award the same break twice.
- Projection, save gate, question resolver and timeout worker resolve focus first. While working, nonfocused later sections are inaccessible even if a room clock says live. Whole-room pause/cancellation/authorized stop still has authority; a natural time_expired room completion does not end a valid individual recovery clock.

### 4.4 Completion provenance and generation

Create internal/terminalization/reopen.go:

~~~go
func (s *Service) ReopenTimedOutInTx(ctx context.Context, q tx.Tx,
    attemptID, scheduleID, actorID, recoveryID string,
    target examdomain.RecoveryTarget) (generation uint64, err error)
~~~

- Revalidate closure provenance under the attempt lock. For SAT, sat_complete plus timeout module provenance is eligible; sat_complete alone is insufficient. For IELTS, use timeline/control provenance; ACT uses effective provider and authoritative timeout receipt.
- If current sitting is still open, generation does not advance just for a device change or a prior-module rewind.
- If sitting is sealed and eligible, preserve the old receipt; increment terminal_generation; clear current submitted/final projection; retain previous snapshot in the old receipt. Do this at Begin, not issuance.
- Current results are withheld atomically by generation mismatch/open state. Never return an old non-null result as the new client's completion signal.
- Teach SQLTerminalizationRepository current-generation lookup/insert; seal and materialization use generation in replay identity.
- Every operation that publishes/reviews/repairs a result rechecks current generation under lock. Old grading pages get a superseded conflict on write.
- New completion creates fresh student_submissions + section/writing/review rows for that generation. Previous manual grading remains history; carry forward unchanged section feedback only if already supported with exact answer-revision equality, otherwise regrade normally.
- SAT/ACT materializers replace the **current** assessment_results projection for a later generation rather than hitting existing same-status no-op branches.
- For a rewound SAT module, clear its current raw_correct/scoring projection until re-finalization. Keep the original route-decision raw score as selection evidence. Update markModule1QualificationTx to evaluate any forced-plan qualification against the newly finalized Module 1 score and the original policy threshold; it must not reuse historical route raw_correct as the student's current score. Preserve the already-administered branch identity.
- Old terminal events/submit receipts cannot reseal, re-release or rematerialize an earlier generation. Carry generation in new outbox payloads; legacy missing field means 0. Repairs select current-generation receipts only.

### 4.5 HTTP/authentication

Proposed canonical /api/v1 endpoints (frontend backendBridge already uses /v1 naming):

| Method/path | Authorization | Behavior |
|---|---|---|
| GET /proctor/sessions/{scheduleID}/attempts/{attemptID}/device-recovery | Admin or assigned proctor | Options/status; no automatic fence |
| POST /proctor/sessions/{scheduleID}/attempts/{attemptID}/device-recovery | Same + CSRF | Issue or explicit replace; expected epochs; idempotent operation |
| POST /proctor/sessions/{scheduleID}/attempts/{attemptID}/device-recovery/restore-original | Same + CSRF | Invalidate outstanding grant, designate original browser |
| POST /student/device-recovery/{grantID}/claim | Anonymous credential endpoint | Link secret + code; returns preparation access only |
| POST /student/device-recovery/{grantID}/ready | BrowserProof capability | Refresh readiness/status; bounded claim TTL |
| POST /student/device-recovery/{grantID}/begin | Same capability | Exactly-once Continue; issue scoped student cookie + attempt credential after commit |
| POST /student/sessions/{scheduleID}/audio-checkpoint | Current attempt bearer | Current section/part/lease/run checkpoint |

New file cmd/api/handlers_device_recovery.go; register in main.go and explicit authz tables/full-path aliases. Reuse requireProctorDeps/requireProctorAttemptScope for staff, normal body limits/error mapping and CSRF/origin conventions. Public means only that no login is needed; handlers still authenticate the grant/capability.

Browser URL: /student/recover/{grantID}#key=<opaque-secret>. Fragment is read client-side and sent in POST body; code is separate and never encoded into QR. Strip fragment after persisting the pending claim in sessionStorage. No secrets in path/query, analytics, audit, logs or lifecycle receipts. Set no-store and no-referrer on these surfaces; don't cache private API responses.

Before claim, browser generates/stores a 256-bit BrowserProof and a stable operation ID. Server stores its hash on successful claim. Lost response can be recovered by the same proof/operation, while another browser cannot retry the used code. Preparation capability never becomes a generic attempt token.

Add recovery authentication source in internal/auth/session_proof.go and schema: authentication_source recovery, role student, new recovery_attempt_id FK, practice_schedule_id NULL. Derive the bound schedule from that attempt in session lookups; do not repurpose practice_schedule_id. Add RecoveryAttemptID/derived RecoveryScheduleID to SessionProof, with a matching schema CHECK.

Extend CreateSession with a transaction-compatible insertion helper; keep old API as a wrapper:

~~~go
func CreateSessionInTx(ctx context.Context, q tx.Tx, cfg config.Config,
    userID, role string, proof SessionProof,
    userAgentHash, ipMetadata *string, now time.Time,
) (sessionID, sessionToken, csrfToken string, err error)
~~~

Update both normal and cached session lookups. Restrict recovery-origin sessions at the API's existing route authorization/session wiring to the bound sitting and required auth self/logout endpoints; never grant account administration or another sitting's entry. At the shared studentSessionContext/resolveStudentAttemptIDForUser boundary, constrain resolution to RecoveryAttemptID, rejecting any conflicting candidate/attempt selector even within the same schedule. Use the same bound-attempt projection for cookie-based V1 authorization. Sign attempt tokens using existing IssueAttemptTokenTx.

Restore-original uses the existing original browser's authenticated principal plus its private original client-session binding (or still-valid signed original attempt proof) to expose a recovery-ready state, only after staff designates that browser. Never accept the original UUID alone. Continue issues a **new client-session ID**, as well as a new lease and credential, so stale V1 queued requests carrying the original ID cannot become writable again. Never set revoked_at back to NULL. If that browser has lost all proof, use a newly issued QR/code on it, as with any replacement browser.

### 4.6 Audio

Create internal/delivery/audio_checkpoint.go and frontend student audio checkpoint adapter/hook.

~~~go
type AudioCheckpointRequest struct {
    SectionKey, PartID, MediaRevision string
    PositionMS int64
    Sequence, LeaseEpoch, RunGeneration uint64
}
func (s *Service) SaveAudioCheckpoint(ctx context.Context,
    claims crypto.AttemptClaims, req AudioCheckpointRequest) error
~~~

Validate current owner/lease/run/focus, enabled personal audio, published part/media identity, finite/bounded position, and sequence. Old/stale writes are no-op or fenced; equal sequence with different payload conflicts. Keep server-confirmed timestamp/position separate from optimistic local position.

StudentListening posts at a bounded 2-second cadence while playing and on pause/seek/ended/part change. Do not post every timeupdate event or block answer autosave. Restore once after metadata loads for matching media revision. Start playback only after explicit Continue and handle play rejection with a visible Play control. Never seek back again on subsequent polling renders.

## 5. Algorithms and transaction ordering

Global order: attempt row → runtime/control read → relevant module/timeline rows in stable order → grant/boundary/frontier/result rows → session/receipt/audit writes. Do not acquire room-wide exclusive locks for one candidate. Reuse WithTxRCRetry; generate stable operation secrets outside the retry callback or replay the encrypted issuance.

### 5.1 Issue/reissue

~~~text
authenticate assigned staff; validate request shape
begin transaction
  lock attempt; verify schedule/provider/version and current scope
  replay authorized identical operation if still current, without extending TTL
  check expected lease/control epochs; classify target closure
  reject manual/admin/unknown closure or wrong/unpublished target
  invalidate outstanding old transfer/grant/claim
  create or retain recovery control; remember original browser once
  fence old writer and revoke all old attempt credentials
  insert new issued grant and encrypted staff reveal capsule
  store metadata-only receipt + audit with old/new epochs and target/time policy
commit
return QR/link/code/status; countdown remains original
~~~

If audit/session/grant insert fails, roll back the fence as well. After an ambiguous response, query/replay same operation; do not create another grant automatically.

### 5.2 Claim

~~~text
apply IP limit; validate capability/body shape without revealing identity
resolve grant's attempt ID; lock attempt then grant
verify active grant, hold identity and expiry with database time
if same claimed browser proof/operation: return existing ready projection
if consumed by different proof or superseded: refuse
constant-time link-secret hash and code-MAC verification
  wrong code with correct secret: increment persisted failure count; commit refusal
  fifth failure: lock grant and clear live marker; hold remains
on correct credentials:
  consume code, bind browser proof/session, set claim TTL, clear secret capsule
  return sanitized ready view
commit
~~~

Wrong-code counters and lazy expiry need an error-after-commit result pattern like existing CommitTransfer.finalError. Returning an ordinary transaction error must not roll back the failure counter or expiry transition.

### 5.3 Begin/Continue

~~~text
verify claim proof; lock attempt, runtime facts, target/successors and grant
if same begin operation already committed:
  confirm owner/current lease/run/generation still match
  recover/refresh credentials without changing time or authority
else:
  require matching live claim/revision; recheck administrative closure
  compute time from original deadline or explicit staff override
  reject zero time, missing required assets or mismatched media version
  snapshot and suspend successor clocks at this transaction's server time
  reopen terminal generation if needed; invalidate current old result
  advance focused module run; create working recovery boundary for that run
  apply target clock; make only target eligible
  rotate writer/control epochs and bind target browser
  insert scoped user session + attempt credential using the same transaction
  persist started grant + immutable begin receipt + audit/outbox metadata
commit
set cookies; return route/credential/deadline
~~~

Front-end loads question content after this commit. That network latency consumes time as ordinary delivery does. Preparation preloads required non-question assets; do not silently move the deadline to a later poll.

Retry recovery must work if cookies/response were lost: the same BrowserProof can retrieve a newly minted credential only while its started grant still owns the current lease/run. A later transfer/restore permanently invalidates that recovery path.

Automatic timeout/room advancement during the hold does not cancel the grant: it is the approved reason this flow exists. Begin checks the current control identity, active grant/revision, issuer-authorized target/time policy and administrative state, not equality to an obsolete pre-timeout global control epoch. Staff issue/replace/restore still use expected epochs to prevent overwriting another staff action. An ordinary staff time edit during a pending grant updates/invalidate its ready revision so the student must refresh the displayed award before Continue.

### 5.4 Focus completion and successor resume

- finalizeModuleWithBasisTx checks recovery_control before ordinary nextModuleTx; finalizeModuleTx continues delegating to it.
- If a previously selected SAT successor exists, reuse its module/route. Recalculate only the recovered module's score; retain the original route-decision basis as historical selection evidence.
- If no route was selected before recovery, use ordinary routing on the new finalized Module 1 answers.
- Resume preserved live successor with deadline now + saved remaining seconds; clear its suspension. If next stage is still unstarted, use its preserved offer/break/form state rather than granting a duplicate allowance.
- Keep recovery control while traversing suspended stages, then clear it when no suspension remains; restore ordinary timing only where provider policy matches. ACT/legacy-cohort personal override remains attempt-owned until its final focus completes.
- Reconcile workers re-read current recovery control, run generation and deadline under the same lock before changing state. A candidate selected before a rewind is merely a hint, never authority to expire the new run.

## 6. Concrete implementation sequence

Tasks are dependency ordered. Checkboxes describe future implementation, not work already performed. Each task starts with failing behavioral tests, applies the narrow implementation, and runs its targeted tests. Do not deploy partial slices with issuance enabled.

### Task 1 — Closure eligibility and shared recovery values

Files: new internal/exams/recovery.go and recovery_test.go (pure shared values/parser); new internal/attempts/recovery_control.go and recovery_control_test.go (authority/SQL helpers); new internal/delivery/device_recovery_eligibility.go and device_recovery_eligibility_test.go; inspect/update existing IELTS timeout writers in internal/runtime/ielts_personal.go.

- [ ] Encode the proposed target/control types; version validation rejects malformed stored control.
- [ ] Implement a pure eligibility classification from trusted provider/closure facts: live, time_expired, manually_submitted, controlled_end, unknown.
- [ ] Add fixture tables for SAT sat_complete with all relevant module reasons, ACT time_expired, IELTS timeline completion, manual submit and controlled room end.
- [ ] Specify historical backfill predicates from inspected writer/audit evidence. No UPDATE based merely on elapsed wall time.

Representative test:

~~~go
// Proposed pure-policy API; use this table to drive the implementation.
for _, tc := range []struct{
    name string
    facts ClosureFacts
    allowed bool
}{
    {"live", ClosureFacts{Provider:"act", Open:true}, true},
    {"expired", ClosureFacts{Provider:"act", ReceiptReason:"time_expired"}, true},
    {"manual", ClosureFacts{Provider:"ielts", ReceiptReason:"student_submit"}, false},
    {"sat-timeout", ClosureFacts{Provider:"sat", ReceiptReason:"sat_complete", TargetReason:"time_expired"}, true},
    {"sat-forced", ClosureFacts{Provider:"sat", ReceiptReason:"sat_complete", TargetReason:"proctor_end"}, false},
    {"unknown", ClosureFacts{Provider:"ielts", ReceiptReason:"legacy_unknown"}, false},
} {
    t.Run(tc.name, func(t *testing.T) {
        if got := EligibleForStaffRecovery(tc.facts); got != tc.allowed { t.Fatalf("got %v", got) }
    })
}
~~~

Define ClosureFacts and EligibleForStaffRecovery in the new eligibility file; include attempt-level blockers as well as selected-stage provenance.

### Task 2 — Migrations and versioned completion history

Files: proposed migrations 0105_staff_device_recovery.sql, 0106_recovery_completion_generations.sql, 0107_recovery_module_runs.sql, 0108_audio_checkpoints.sql; internal/terminalization/service.go and new reopen.go; internal/platform/db/schema.go; cmd/migrate migration tests.

- [ ] Add control/grant/audio storage and auth proof columns/checks; add DB state/range/unique constraints.
- [ ] Migrate receipt/submission uniqueness and all old rows to generation 0; inspect actual generated unique-index names before dropping, as 0008 declares inline UNIQUE.
- [ ] Version module boundaries/close intents/frontiers. Existing immutable evidence/history stays intact. Version-0 clients remain unchanged for untouched attempts.
- [ ] Implement current-generation receipt lookup/insert and generation-aware completion payloads.
- [ ] Add MySQL migration rerun, old receipt immutability, composite uniqueness and reopen/reseal tests. Preserve purge FK/trigger behavior from migrations 0090 and 0056.

### Task 3 — Recovery grant issuance and immediate fencing

Files: new internal/delivery/device_recovery.go, device_recovery_types.go; internal/attempts/{ownership,service,submit}.go; new recovery helpers; cmd/api/handlers_device_recovery.go; internal/platform/config/config.go; crypto helper/tests.

- [ ] Implement options/issue/reissue, secure generation, encrypted replay capsule and automatic audit using existing transaction/replay conventions.
- [ ] Add server feature gate STAFF_DEVICE_RECOVERY (default false). Existing held/started recoveries remain resolvable when new issuance is disabled.
- [ ] Add admission/refresh/takeover/old-transfer guards so no path claims the empty writer slot while held.
- [ ] Test two concurrent staff issues (one expected-epoch winner), failed grant/audit insert rollback, and lost issue response replay with unchanged expiry.

### Task 4 — Clean-browser claim, preparation and scoped authentication

Files: handlers_device_recovery.go; main.go; internal/auth/{auth,session_proof,sessionlookup_cache_impl}.go; internal/authz/{table_auth,table_staff,table_fullpath}.go; new scoped-session tests.

- [ ] Implement atomic code consumption, browser-proof binding, persisted wrong-code budget, ready refresh and expiry.
- [ ] Add CreateSessionInTx and recovery-origin proof validation; keep CreateSession callers compatible.
- [ ] Register the anonymous claim/ready boundary and assignment-scoped staff routes. Enforce recovery cookie scope in existing central API auth/session wiring before protected handlers.
- [ ] Test no identity/questions before code verification; no question content or attempt token in ready state; no access to another sitting/account using recovery cookie.
- [ ] Test lost claim response, two browsers consuming the same grant, and reissue/restore racing with claim.

### Task 5 — Runtime rewind, exact time award and server write gates

Files: new internal/runtime/recovery.go; internal/delivery/{device_recovery,start_submit,reconcile,sat_personal,module_boundary,close_module,recovery_resolution,service}.go; internal/runtime/{service,ielts_personal}.go; cmd/api/{handlers_v2,v2locker_snapshot,student_context}.go.

- [ ] Implement Begin with original-deadline vs explicit-time policy and suspended-successor snapshots.
- [ ] Support SAT personal/cohort, IELTS personal/current deployed variant, and ACT/legacy section clocks without changing shared schedule timing.
- [ ] Resolve recovery focus before room stage in bootstrap/lifecycle/static/media and all question admission paths.
- [ ] Version SAT close/boundary/frontier reads/writes; stale worker/frozen batches cannot close or modify the new run.
- [ ] Preserve already-selected M2, existing answer IDs/client versions, entry forms, break consumption and successor time.
- [ ] Implement targeted timeout-after-room-end and Return-to-successor paths; do not reuse terminal module rearm as a reopen operation.
- [ ] Add Begin lost-response replay with no extra time, duplicate start, positive-override-at-zero, and previous-section rewind tests.

### Task 6 — Generation-aware result, grading and repair consumers

Files: internal/terminalization/service.go; internal/sat/service.go; internal/act/{service,repair}.go; internal/grading/{projection,result_read,review_read,service,sessions}.go; internal/results/{service,sat_attempt_answers,sat_rawdata_export}.go; internal/answerhistory/service.go; internal/maintenance/jobs.go; internal/satscoring/impact.go; internal/delivery/{service,student_result_release,reconcile}.go.

- [ ] Change existing current-by-attempt queries to join current terminal_generation. Retain explicit historical-by-ID reads with a historical marker.
- [ ] Rework student_submissions writers/selectors for (attempt_id,generation). Prevent old review save/release requests from editing current output.
- [ ] Rebuild SAT/ACT current results on the later generation, including section/raw scores, instead of returning the earlier same-status projection.
- [ ] In terminalization.markModule1QualificationTx, distinguish preserved route-selection evidence from the current Module 1 score. Test a recovered M1 crossing the forced-branch qualification threshold while the issued M2 remains fixed.
- [ ] Fence terminal/repair/projector/outbox actions by generation. Natural room end may coexist with a live individual recovery; repair cannot infer completion solely from old receipt existence.
- [ ] Include current generation in answer-history-by-attempt resolution; explicit old-submission exports use its immutable historical snapshot.
- [ ] Search every production reference to attempt_terminalizations/student_submissions/assessment_results and classify it as current, history, or purge. The verified file list above is the initial manifest; no unclassified current consumer may remain.
- [ ] Regression: unchanged generation-0 results, existing ACT identity reconciliation and SAT release/conversion policy.

### Task 7 — Legacy paths and original-device restore

Files: internal/student/{v1_write,telemetry,presence}.go; internal/proctor/service.go; cmd/api/{handlers_v1_writes,student_context,student_entry_recovery,handlers_device_transfer}.go; internal/delivery/service.go; internal/attempts/{ownership,submit}.go.

- [ ] Put recovery hold/focus checks under the V1 mutation/submit attempt lock. Keep protocol-1 answer format; keep protocol-2 compatibility refusal.
- [ ] Protect ordinary entry/bootstrap, credential refresh, direct static reads, raw media and old transfer commit from bypassing held/ready/focused state.
- [ ] Protect telemetry/precheck owner claims and delayed FlushPresence writes. Test a dirty presence record captured before issuance and flushed after the attempt becomes held; owner must stay unavailable.
- [ ] Adapt ordinary proctor Pause/Resume/ExtendAttempt/ReArmAttemptStage to the focused recovery clock; do not clear the hold, rearm a terminal old run, or shift suspended successors twice. Invalidate pending ready revision on an intentional staff time-policy change.
- [ ] Implement explicit restore-original with expected control epoch, new lease/client-session ID, old grant invalidation, readiness and fresh credentials. Never resurrect old bearer rows.
- [ ] Test staff restore versus Begin, expired grant versus ordinary admission, and a stale old-device offline queue after restore/re-transfer.

### Task 8 — One shared staff dialog

Files: new src/features/proctor/ui/DeviceRecoveryDialog.tsx; new infrastructure/deviceRecoveryGateway.ts and api/deviceRecovery.ts; src/products/sat/routes/SatSessionRoomRoute.tsx; ui/SatSessionRoomStudents.tsx; src/components/proctor/{ProctorDashboard,StudentDetailPanel}.tsx; existing QR utility extraction only if needed.

- [ ] Use existing Dialog, clock hook and installed qrcode; no new UI framework.
- [ ] Add selected-student action to SAT and general proctor panels, including timed-out students in ended-by-time rooms.
- [ ] Render target picker, current live countdown, optional labelled mm:ss exact-time input, last server save, QR/link/code/expiry and status in one popup.
- [ ] State machine: preview → issuing → issued → ready → continued; expired/error/replaced/restored branches stay in the same dialog.
- [ ] Changing issued target/time is an explicit replace/reissue with new expected epochs, invalidating prior QR/claim. Do not mutate an already-started grant.
- [ ] Closing popup after issuance leaves the recovery intact. On reopen, fetch current status and reveal live secrets only to authorized staff; consumed codes are not redisplayed.
- [ ] Confirm impact inline before explicit issuance: old device will stop, countdown continues. No new risk-acknowledgement checkbox for this staff-originated flow.
- [ ] Keyboard focus/return, escape, copy feedback, text equivalent for QR, labelled time input, readable errors, and expiry status are required. Do not announce every countdown tick to screen readers.

Thai product labels:

| State | Copy/action |
|---|---|
| Dialog | ย้ายเครื่อง / ให้ทำต่อ |
| Target | ส่วนที่จะให้ทำต่อ |
| Time | เวลาคงเหลือ / กำหนดเวลาเหลือใหม่ |
| Award explanation when edited | นักเรียนจะได้รับเวลานี้เมื่อกดทำข้อสอบต่อ |
| Issue | สร้าง QR และรหัส |
| Issued | รอเปิดบนเครื่องใหม่ |
| Ready | เครื่องใหม่พร้อมแล้ว |
| Expired | รหัสหมดอายุ / ออกรหัสใหม่ |
| Restore | กลับไปใช้เครื่องเดิม |
| Done | ย้ายเครื่องแล้ว |

### Task 9 — Student recovery route and existing delivery integration

Files: new src/features/student/routes/StudentDeviceRecoveryRoute.tsx; new application/deviceRecovery.ts and infrastructure/deviceRecoveryGateway.ts under src/features/student; src/app/router/createRouter.tsx; actual student/routes/StudentSessionRoute.tsx and hooks/useStudentSessionRouteData.ts; provider bootstrap readers in src/features/student-delivery.

- [ ] Register /student/recover/:grantId before generic /student/:scheduleId/:studentId, outside RequireAuth. Do not let the generic route interpret recover as a schedule.
- [ ] Read fragment secret, prepare stable BrowserProof/operation ID, submit one code field. Keep raw code out of persistent localStorage.
- [ ] After successful claim, show verified student/exam/target/time, preload allowed assets, then enable Continue. Before Begin do not mount either exam shell.
- [ ] On Begin, hydrate the existing auth session using the committed scoped cookie, store attempt credential through the existing adapter, and navigate to the existing provider session route.
- [ ] Bootstrap may read only current focus. Suppress any current-result/auto-submit UI based on old completion data or room section; use returned generation/run/clock.
- [ ] Inspect src/shared/durability/DurableResponseEngine.ts and existing useSatResponsePersistence.ts superseded handling. Retain old local drafts for inspection, but never rebind their queued commands/frozen frontiers to the new lease/run or freshly restored client-session ID. Hydrate the active run from the server snapshot first.
- [ ] Expiry shows Ask staff for a new code; incorrect code is inline; server race refreshes ready state; failed begin retries the same operation.
- [ ] Reload after claim works in the same browser via BrowserProof, never by copying data from the old machine. A different browser needs a fresh staff grant.

### Task 10 — IELTS personal audio checkpoint and restore

Files: new internal/delivery/audio_checkpoint.go and tests; handlers_device_recovery.go checkpoint handler; StudentListening.tsx; new src/features/student/hooks/useListeningCheckpoint.ts; new checkpoint API adapter.

- [ ] Add owner/section/media/run-authorized checkpoint save/read.
- [ ] Hook audio events and throttled saves; propagate last acknowledged checkpoint to recovery readiness.
- [ ] Seek once after metadata; handle changed media, missing checkpoint, volume/play failure and backwards seek. Missing checkpoint does not silently claim precise recovery: show staff that no saved audio position exists.
- [ ] Maintain current shared-audio behavior when individual playback is disabled. No control over room speakers.

### Task 11 — Scenarios, accessibility and release gate

Files: new backend/go/integration/staff_device_recovery_test.go; new cmd/api/device_recovery_http_mysql_test.go; new e2e/staff-device-recovery.spec.ts; new dialog/route tests next to owners; extend existing SAT transfer regression tests without removing them.

- [ ] Exercise scenarios in section 8 against real MySQL and entirely clean Playwright contexts.
- [ ] Check exact stored owner/lease, hold, grants, deadlines, generations, saved responses, selected route and result visibility; HTTP 200 alone is insufficient.
- [ ] Run the appropriate checks below and record pass/fail/skip. A missing TEST_MYSQL_DSN is unverified integration coverage, not a pass.
- [ ] Perform staff/student keyboard and screen-reader status checks, including popup close/reopen and error recovery.
- [ ] Publish a runbook covering code expiry/reissue, restore-original, stale pending recovery and expired successor needing its own time grant.

## 7. Worked traces

### A. Fresh-browser device replacement; countdown and exact override

Initial: IELTS Listening has 03:00 left, writer A lease 7, current control 4, checkpoint 17:42, no hold.

1. Staff previews: no mutation. At 02:50 left, issues target Listening with override 08:00.
2. Transaction fences A: lease 8/control 5; hold set; all A credentials revoked. Original Listening deadline continues.
3. B is a clean browser. Opens personal QR, enters correct code. Claim binds proof B; no questions/attempt token returned.
4. After 40 seconds B is ready. Continue commits a new focused run, deadline serverNow + 480 seconds, lease 9 and credential B. It does not subtract the 40 seconds from the explicit award.
5. Questions load; answers are those last saved by A. Audio seeks once to acknowledged 17:42 and can play after the explicit student action.
6. Old A uploads an offline answer: refused under its stale lease. B's valid answer is saved.

Variant without override: step 4 retains the original deadline and its elapsed 40 seconds. If original time is zero, Continue refuses until staff reissues with a positive award.

### B. Computer failed in SAT RW Module 1; Module 2 already started

Initial: RW M1 locked/time_expired, route lower selected, RW M2 active with answer Q2 saved and 14:20 left.

1. Staff chooses RW M1 + 06:00; issuance fences old device, but M2 countdown keeps running.
2. At Begin 20 seconds later, preserve M2 answer Q2 and remaining 14:00; suspend M2, open a new M1 run with 06:00.
3. The new M1 run changes raw score enough to exceed the old route threshold.
4. On authoritative M1 close, recalculate its score but retain the original lower M2 route and module ID. Do not insert another route decision.
5. Resume M2 at 14:00 with Q2 still saved. No second M1→M2 break or entry form.
6. Final result uses final M1 answers and the originally administered M2. Route audit still identifies why/when the original branch was selected.

### C. Already sealed timeout; old results must not win

Initial: ACT generation 0 receipt reason time_expired, submission/result released, original responses revision 55.

1. Staff issue/claim prepares continuation; old receipt remains immutable.
2. Begin atomically advances generation to 1, clears current terminal projection, opens the target clock and withholds generation-0 current result.
3. A stale generation-0 release/repair job runs: cannot publish or rematerialize current output.
4. Student saves revision 56 and completes. Generation 1 gets its own immutable receipt and submission; current result is recomputed for generation 1.
5. Staff can still inspect generation 0 history. Student sees only the permitted current output.

### D. Concurrency and response loss

Initial: grant G issued, attempt held at lease 12.

1. B and C concurrently submit correct credentials with different browser proofs.
2. B acquires attempt/grant locks, consumes G, commits claimed proof B; response is lost.
3. C sees G claimed by another proof and cannot obtain readiness or a token.
4. B retries same operation/proof and gets existing ready state with unchanged expiry.
5. Staff reissues G2 while B presses Continue. Attempt lock serializes both: if reissue wins, B is superseded and gets no token; if Begin wins, reissue's old expected epochs conflict and staff must refresh before starting another move.
6. No combination gives both browsers writer access. A retried Begin after success does not reset the deadline.

## 8. Verification matrix and commands

| Case | Required evidence |
|---|---|
| SAT/IELTS/ACT fresh-browser claim | No login/localStorage migration; same attempt/student/version and saved answers |
| Link without code, code without link, wrong student/attempt | No identity, questions, credential or cross-sitting access |
| Immediate old-device fence | Refused V2 save/submit/takeover, V1 cookie mutation/submit, bootstrap refresh, old transfer commit, raw protected media; no unsaved queued write accepted |
| Delayed heartbeat/control writers | Cached pre-transfer presence flush cannot claim held owner; ordinary staff controls respect focus and invalidate stale ready-time views |
| Live countdown vs override | Original deadline unchanged during waiting; explicit award applied once on Continue; zero-time no-override refusal |
| Countdown reaches zero before staff or while waiting | Recovery remains available for proven timeout; no automatic room/global time extension |
| Earlier timeout after auto progression | Target picker includes older timed-out stage, excludes manually submitted and controlled-end stages |
| Downstream answered stage | Same answer values/client versions; only focused stage writable; successor resumes saved time |
| SAT original route | M1 answer changes cannot replace existing M2 route; missing M2 routes selected normally once |
| SAT old close intent/frontier | Old run cannot freeze, route, inject late answers or finalize new run |
| Completed timeout reopen | Old receipts unchanged; generation increments once; manual submit stays rejected |
| Results/grading | Old score hidden as current; old review/release job refused; reseal recomputes and creates fresh current submission |
| Restore original | Old grant/claim/token loses authority; old machine receives fresh credential only via designated ready/Continue path |
| Expiry/reissue | Countdown continues; hold survives expiry; failure count durable; no automatic old writer reclaim |
| Atomic failures | Forced failure at grant/audit/session/token insertion rolls back complete state transition |
| Audio | Latest acknowledged position, correct part/media, backwards seek sequence, stale lease refusal, shared audio unaffected |
| Accessibility | Keyboard-only create/copy/enter/continue/restore; focus return; text link equivalent; no per-second aria-live chatter |
| Untouched sitting regression | Existing entry/start codes, SAT old transfer, IELTS timing, ACT grading/reconciliation, form and break lifecycle unchanged |

Commands from repository root; use Bun for JS tools:

~~~bash
bun run typecheck
bunx vitest run src/features/proctor/ui src/features/student/routes src/components/student
bunx eslint src/features/proctor/ui/DeviceRecoveryDialog.tsx src/features/student/routes/StudentDeviceRecoveryRoute.tsx src/components/student/StudentListening.tsx
bun run build
bunx playwright test e2e/staff-device-recovery.spec.ts e2e/sat-device-transfer.spec.ts e2e/student-multi-device.spec.ts
~~~

From backend/go:

~~~bash
go test ./internal/attempts ./internal/delivery ./internal/runtime ./internal/auth ./internal/terminalization ./internal/results ./internal/grading ./internal/student ./internal/act ./internal/sat
go test ./cmd/api -run 'Recovery|DeviceTransfer|SingleWriter|V2|StudentEntry'
go test ./integration -run 'StaffDeviceRecovery|DeviceTransfer'
go test -race ./internal/attempts ./internal/delivery ./internal/runtime ./internal/auth
~~~

Real-MySQL suites require the existing TEST_MYSQL_DSN fixture environment. Playwright's existing global setup migrates/seeds fixture rows and needs its dedicated E2E database configuration; never aim it at production. Inspect skipped-test counts. No new load benchmark is required to prove this feature; do verify recovery does not add per-question/per-heartbeat SQL to unaffected attempts.

## 9. Rollout, extension probe, remaining risks and completion gate

### Rollout

1. Ship schema and generation-aware readers/writers with issuance disabled. All untouched rows remain generation/run 0.
2. Drain/replace **all API and worker binaries** that do not understand completion/run generations before enabling the feature. Database immutable-receipt triggers stay enabled. Do not assume an old worker's receipt-existence query is safe during a mixed rollout.
3. Verify schema/version capability at startup when STAFF_DEVICE_RECOVERY is enabled. Canary on internal schedules with all three providers and a real cold browser.
4. Enable staff entry points only after the cross-provider test gate, including completed-timeout reopen and later-stage preservation, passes.
5. Rollback disables **new issuance**; keep claim/Begin/restore and existing focused recovery handling available. Once generation > 0 exists, rolling back to pre-generation binaries is unsafe. Preserve schema/data and roll forward.
6. Purge deletes grants/checkpoints/versioned artifacts through existing exam-purge ownership; do not relax immutable terminal receipt triggers globally.

### Realistic extension probe

Changing the recovery code TTL touches the server recovery policy constants/config and expiry tests, not provider timing or UI logic. Adding another personal-audio part uses the existing stable media/checkpoint owner, not a new transfer workflow. Do not implement extra policy settings.

### Material risks and their resolutions

- **Historical provenance:** blocked rather than guessed; explicit fixture/backfill work in Task 1. New closure writers record exact reason.
- **Immutable completion:** generation migration and every current consumer are required before issuance; clearing submitted_at is insufficient.
- **Legacy/cohort timing:** use the attempt-owned recovery clock override; preserve room runtime. Test each deployed timing variant, including IELTS strings accepted by attempts/types.go.
- **Already released results:** withhold old current projection and preserve history on Begin; stale release/repair work is fenced by generation.
- **SAT evidence and adaptive route:** new run isolation plus preserved issued branch; do not replay ordinary forward routing over an existing route decision.
- **Missing audio checkpoint/unsent answers:** show the last server-confirmed state and its limitation; do not fabricate an exact crash position.
- **Scope size:** this is a lifecycle feature across all three products. Deliver dependent tasks with issuance disabled; a QR-only slice does not meet approval.

### Mandatory final self-review / done criteria

- [ ] FR-01..FR-09 and INV-01..INV-09 map to passing tests and implemented owners.
- [ ] Every new or changed current-by-attempt query is generation aware; historical/purge queries are explicitly classified.
- [ ] One normal and one adversarial trace above pass against real MySQL, not just mocks.
- [ ] All alternate writers/readers, timeout workers, result projectors and credential refresh paths respect recovery.
- [ ] No plaintext code/link secret or full private snapshot enters logs, audit, generic replay receipts or browser analytics.
- [ ] Staff popup and student route meet the approved one-popup/one-primary-action design.
- [ ] Test results distinguish executed passes from skipped/unavailable checks.
- [ ] No unrelated refactor/dependency/toolchain change; preserve the pre-existing playwright.sat-staff-ux.config.ts modification.

**Verification performed while authoring this plan:** read-only repository tracing and source/schema inspection; a source manifest check passed for 24 existing symbols in 12 owner files. Static checks passed for the nine plan sections, FR/INV coverage, eleven ordered tasks, fenced blocks, placeholders and whitespace. No implementation tests have been executed and no application source has been changed by this planning task.
