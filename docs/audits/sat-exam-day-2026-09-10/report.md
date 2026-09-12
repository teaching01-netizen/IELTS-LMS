# SAT exam-day audit — 10 September 2026

**Decision: I would hold exam-day release of this working tree until the scoring, session identity, timer, and submission findings are fixed and rehearsed together.**

Audited directly, without skills or sub-agents. Scope: student access-link entry, SAT session identity, answer persistence, timing, module/adaptive transitions, final submission, and Go scoring/readback. This reviews the current local files, including existing uncommitted changes. It does not establish which revision/configuration is deployed.

Application code was not changed. Temporary fault-injection tests were run, preserved as `.txt` evidence here, then removed from the test directories.

## Findings

### 1. P0 — Saved SAT answers do not reach the table used for scoring and adaptive routing

**Trigger:** A student answers through the current SAT UI, then submits a module or reaches its timeout.

The SAT hook exclusively sends answers through the V2 durability transport. Both Go V2 persistence branches write `attempt_responses_v2`. SAT module scoring instead joins `assessment_question_responses`; absent rows produce null answers, which count as incorrect. The resulting raw score also selects the second-module branch. SAT result question readback uses that older table too.

For fresh attempts whose answers exist only in V2, this means raw correct counts can be zero despite acknowledged saves, adaptive routing can select the wrong branch, and the result review can show unanswered questions. The V2 records still exist; this is a scoring/read-model disconnect, not proof that the answer records were deleted.

Evidence: [src/features/student-delivery/hooks/useSatResponsePersistence.ts:296](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/hooks/useSatResponsePersistence.ts:296), [src/features/student/infrastructure/responseDurabilityTransport.ts:56](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student/infrastructure/responseDurabilityTransport.ts:56), [backend/go/internal/attempts/service.go:338](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/attempts/service.go:338), [backend/go/internal/delivery/start_submit.go:484](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/start_submit.go:484), and [backend/go/internal/results/service.go:797](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/results/service.go:797). Repository-wide Go/SQL searches found no bridge or migration trigger copying the V2 writes into the SAT response table. This is a code-traced finding; a real MySQL student-to-score reproduction was not run.

**Fix boundary:** Give scoring, adaptive routing, and result readback the same canonical response source used by student saves, or maintain an explicit atomic projection. Verify a known-correct V2 answer increases raw score, chooses the expected branch, and appears in the released review. Include timeout completion, not only manual submission.

### 2. P1 — SAT creates a second client-session identity for heartbeats and credential refresh

**Trigger:** A normal student session already has an established writer identity, and the SAT transport sends its first heartbeat or refreshes its credential.

The shared attempt/session code owns an established client ID under `ielts-student-client-session:v1:...`, with the attempt snapshot providing the preferred identity. SAT creates an independent random value under `sat-client-session:...`. The heartbeat includes the independent ID, while the bearer can still identify the established session. The backend explicitly rejects this mismatch with `Client session does not match the attempt credential.` SAT also passes the independent ID to credential refresh, risking a credential for a different writer than the one used by V2 saves. Heartbeat errors are swallowed by the integrity hook, hiding the initial problem from the student.

Evidence: [src/features/student-delivery/api/assessmentDeliveryApi.ts:53](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/api/assessmentDeliveryApi.ts:53), [src/services/studentAttemptRepository.ts:993](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/services/studentAttemptRepository.ts:993), [backend/go/cmd/api/handlers_v1_writes.go:40](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/handlers_v1_writes.go:40), and [src/features/student-delivery/hooks/useSatIntegrityControl.ts:44](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/hooks/useSatIntegrityControl.ts:44).

**Reproduced:** With an established session seeded in the shared session store, a heartbeat sends a newly generated ID instead. The test covers the transport mismatch; the backend rejection is verified in source, not through a deployed request.

**Fix boundary:** Reuse the shared attempt client-session owner for SAT heartbeat, credential refresh, and takeover. Rehearse entry → heartbeat → credential renewal → save → explicit takeover on one attempt.

### 3. P1 — The default cohort-v3 module countdown freezes between refreshes

**Trigger:** An active `cohort_section_v3` module has less remaining time than its enclosing section.

The controller stops its local `now` updates for cohort timing, but still uses that frozen `now` to calculate the personal module countdown. The shared authoritative clock advances the section time only. Taking the minimum therefore leaves the module display stuck until a fresh bootstrap arrives. The normal live-socket polling interval is 20 seconds; refresh failures can make the discrepancy longer. Backend reconciliation still expires the personal module, so the student can see apparent time remaining while the server closes it.

Evidence: [src/features/student-delivery/hooks/useSatExamController.ts:186](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/hooks/useSatExamController.ts:186), [src/features/student-delivery/hooks/useSatExamController.ts:717](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/hooks/useSatExamController.ts:717), and [backend/go/internal/delivery/reconcile.go:421](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/reconcile.go:421). SAT schedules select this model in [backend/go/internal/schedules/service.go:569](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/schedules/service.go:569).

**Reproduced:** Personal module time 60 seconds, section time 120 seconds, advance the fake clock by 10 seconds without a bootstrap: expected **50**, received **60**.

**Fix boundary:** Derive both clocks from advancing server-adjusted time/deadlines. Verify normal ticks, offline expiry, pause/resume, and extensions while the module deadline precedes the section deadline.

### 4. P1 — Final submission can remain on a loading screen after connectivity returns

**Trigger:** From the final module's review page, module submission succeeds, then finalization and the immediate recovery bootstrap fail during an outage.

The controller enters `submitting`, catches the error without leaving that phase, and disables its periodic bootstrap polling in that phase. The route renders only “Finalizing SAT responses…” without displaying the stored error or a retry control. Unrelated external updates might rescue it, but the submission flow has no independent recovery once the connection returns.

Evidence: [src/features/student-delivery/hooks/useSatExamController.ts:197](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/hooks/useSatExamController.ts:197), [src/features/student-delivery/hooks/useSatExamController.ts:582](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/hooks/useSatExamController.ts:582), [src/features/student-delivery/hooks/useSatExamController.ts:636](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/hooks/useSatExamController.ts:636), and [src/features/student-delivery/routes/SatStudentSessionRoute.tsx:236](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/routes/SatStudentSessionRoute.tsx:236).

**Reproduced:** Restore a working bootstrap endpoint after the fault and advance 60 seconds: phase remains **`submitting`**, additional controller bootstrap calls **0**.

**Fix boundary:** Preserve idempotent submission identity while exposing a retryable finalization state and continuing bounded recovery polling. Distinguish recorded answers from completed result generation.

### 5. P1 — Unassigned adaptive modules are treated as active by the answer-write gate

**Trigger:** A V2 answer request names a question in an unassigned branch of the current SAT section.

The question resolver left-joins module attempts. When there is no assigned attempt row, the empty state is converted to `active`. The V2 write service then accepts `active`/`review`, and its section check alone cannot exclude another branch within the same section. This bypasses the intended module assignment boundary; it does not require the normal UI to provide a navigation button for that branch.

Evidence: [backend/go/cmd/api/handlers_v2.go:48](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/handlers_v2.go:48), [backend/go/cmd/api/handlers_v2.go:65](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/handlers_v2.go:65), and [backend/go/internal/attempts/service.go:276](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/attempts/service.go:276).

**Reproduced:** A SQL-mocked question belonging to an unassigned branch resolves to **`ModuleState: active`**, rather than being rejected.

**Fix boundary:** Require an assigned, active module attempt for normalized SAT questions. Keep any legacy IELTS/ACT compatibility rule provider-specific. Verify current, future, unchosen, and submitted module writes independently.

### 6. P2 — Optional profile storage can block successful exam entry

**Trigger:** Browser localStorage is full or storage access is restricted when a student joins.

After the server admits the student, `finishEntry` stores the remembered profile before navigating. `saveProfile` does not catch storage exceptions, so a profile write failure prevents navigation despite successful admission. The initial profile read also performs `getItem` outside its try/catch, allowing a storage-access exception to break rendering.

Evidence: [src/features/student/routes/StudentAccessLinkEntryRoute.tsx:95](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student/routes/StudentAccessLinkEntryRoute.tsx:95), [src/features/student/routes/StudentAccessLinkEntryRoute.tsx:111](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student/routes/StudentAccessLinkEntryRoute.tsx:111), and [src/features/student/routes/StudentAccessLinkEntryRoute.tsx:182](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student/routes/StudentAccessLinkEntryRoute.tsx:182).

**Reproduced:** Admission succeeds; the optional profile write throws `QuotaExceededError`; the student destination never renders.

**Fix boundary:** Treat profile persistence as best-effort. Do not weaken the separate answer-durability safeguards. Verify both denied reads and failed writes while entry still navigates.

## Verification and limits

- Existing SAT/durability tests: **50 files, 218 tests passed**.
- TypeScript: **passed** (`npm run typecheck`).
- Selected Go suites: **passed** for delivery, SAT, attempts, access links, runtime, terminalization, API, and worker.
- Targeted audit tests: **4 frontend failures and 1 Go failure**, each asserting the required safe behavior described above. These are deliberate fault reproductions, not pre-existing suite failures.
- The scoring disconnect was traced across the real frontend transport, Go writer, scorer, routing, result reader, and repository migrations; it was not reproduced against MySQL.
- No deployed-site browser rehearsal, real database concurrency run, full cohort load test, production configuration inspection, or live score verification was performed. Go tests gated on an isolated MySQL DSN are not evidence of a real database pass here.

The existing SAT lifecycle E2E helper advances modules through direct API calls without establishing correct-answer scoring, and checks result provider/kind rather than the expected score. See [e2e/sat-product-workspace.spec.ts:43](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/e2e/sat-product-workspace.spec.ts:43) and [e2e/sat-product-workspace.spec.ts:238](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/e2e/sat-product-workspace.spec.ts:238). Passing that path cannot detect finding 1.

## Next verification after fixes

Run one real student journey on an isolated MySQL-backed environment: known correct/incorrect answers through the UI, assert V2 acknowledgement, assert adaptive branch and raw score, refresh mid-module, expire the module while offline, reconnect, pause/resume, renew the credential, perform takeover, and interrupt/retry final submission. Then run the expected exam-day cohort load against that same flow and configuration.

## Evidence files

The adjacent `.log` files retain command output. The four `.txt` files contain the temporary test sources and their original locations. To rerun, restore each source at its recorded location without the first comment line, run the targeted Vitest files and `go test ./cmd/api -run TestAuditUnassignedSATModuleMustNotBeActive -count=1`, then remove those temporary files. The tests currently fail intentionally because the reported defects remain unfixed.
