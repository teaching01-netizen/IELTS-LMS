# SAT student lifecycle: failure review and proposed design

Design only. Reviewed 6 October 2026, against working tree based on `41dda34d`, including the user's existing uncommitted changes. No implementation, migration, or configuration was changed. This document is a proposal, not an approved exam policy or a production certification.

## 1. Challenge the requirements before choosing an architecture

The requirements confirmed by the user are **400 students joining within 60 seconds**, **practice self-registration**, and **preserve current SAT and IELTS behaviors separately**. That is 6.67 joins/second averaged across the minute. It does not mean arrivals are uniformly distributed: the difficult case is 400 students sharing a network, then saving and transitioning at the same deadline. This is a SAT lifecycle review; shared-boundary changes need IELTS regression checks, not a common exam policy or a claim of a complete IELTS audit.

“Cover all student edge cases” needs a bounded meaning. This review covers the discovered SAT backend entry, credentials, resume, content/media access, answer persistence, module entry/closure, adaptive routing, breaks, staff controls, timeout workers, finalization, presence, and result delivery paths. It enumerates failures and acceptance scenarios. Static inspection cannot establish the absence of every defect, verify deployed schema/configuration, or establish real-network performance.

Four product conflicts matter more than a new infrastructure component:

1. **Exam fairness versus offline recovery.** An ordinary browser cannot prove that a newly received answer was typed before the deadline. Client time, an old write ID, and a claimed timestamp are not proof. Automatically crediting arbitrary delayed writes permits additional working time.
2. **Full time after visible content versus server-owned time.** A server can timestamp activation; it cannot independently verify the first answerable frame. Withholding plaintext until activation necessarily charges some network/render delay to the student. Trusting a client visibility acknowledgement without a bound permits indefinite delay or extra preview time.
3. **Practice check-in versus account authority.** The user confirmed self-registration is intentional. Keep it. Self-declared email/name can label a practice attempt, but must not authenticate an existing account or expose its previous attempts.
4. **Pause semantics versus independent controls.** A room pause, individual pause, break pause, warning, extension, and pending Module 2 start must not independently reset or consume the same clock.

### Assumption register

| Status | Statement | Consequence |
| --- | --- | --- |
| Verified from user | 400 students arrive within 60 seconds | Size for this cohort, plus synchronized bursts |
| Verified from user | Practice self-registration is intended | Do not add mandatory roster approval or change entry into a high-stakes identity-verification flow |
| Verified from user | SAT and IELTS should keep their current, different behaviors | Share safety primitives only; SAT timing/routing/closure rules stay provider-specific |
| Verified from source | Go API, MySQL-compatible SQL, durable outbox, background reconciliation already exist | Keep these boundaries; no broker is required for this scale |
| Verified from source | New attempts use protocol V2; V1 mutation writes reject V2 attempts | Retain necessary compatibility without opening another canonical answer store |
| Verified from source | SAT supports personal and multiple cohort timing models | Freeze the selected model for each active sitting |
| Verified from source | Student early module submission is disabled | Preserve automatic closure unless the user changes policy |
| Verified from source | Normal personal entry starts immediately at DB time; legacy offer/enter/visible APIs remain | Client compatibility needs an explicit contract |
| Verified from source | `client_start` handoff can use a 15-second close window and 60-second auto-start; legacy/cohort grace is 3 seconds | These are existing behaviors/configuration examples, not newly approved policies |
| Verified from source | Entry, reads, media, responses, scoring, routing and completion have substantial ownership checks | Reuse and repair them rather than replacing everything |
| Assumed for proposal | Single region; 400 concurrent active students; browser delivery; practice duration example 144 minutes including a 10-minute break | Capacity estimates use these inputs; authored exam plan remains authoritative |
| Assumed for proposal | Disconnect alone does not pause time; authorized staff controls do | Avoid students gaining time by deliberately disconnecting |
| Assumed for proposal | Late drafts are retained as evidence; no silent reroute or automatic post-route score mutation | Preserves the current immutable-route model; user decision pending |
| Assumed for proposal | No automatic timer reset on refresh or takeover | Prevent extra time and divergent writers |
| Verified requirement; deployment unknown | Preserve the schedule's current personal/cohort timing choice | Do not switch the sitting to a different timing model; actual schedule/configuration still needs inspection before implementation |
| Unknown | Answer latency, exam interruption tolerance, availability/error budget | Proposed targets below require approval and measurement |
| Unknown | Actual deployment count, database engine/version, HA/failover guarantees, durability settings and network topology | Cannot claim a capacity or zero-loss guarantee |
| Unknown | Evidence review SLA, retention, who may grant credit/retakes, result release policy | Needed for a complete operational recovery policy |

Questions already sent to the user: latency/interruption targets; late-answer acceptance policy; timing, disconnect, device and early-submit rules; practice versus verified candidate entry. Answers establish practice self-registration and preservation of current provider behavior. For SAT, retain the existing automatic module closure, takeover capability, schedule timing choice, and acceptance/evidence behavior while fixing inconsistent enforcement. Latency/outage targets and any change to late-answer policy remain unanswered; do not treat that as approval.

Additional design-changing decisions to settle before implementation: (a) may room extensions lengthen personal breaks, as current source does; (b) should score information remain hidden until release; (c) may a revoked access link stop existing attempts or only new admissions; (d) what happens when an institution ends a room while personal clocks remain; (e) required retention and disaster recovery objectives.

## 2. Source evidence and coverage

These links describe the reviewed checkout, including uncommitted work, not necessarily the deployed release.

| Ref | Owner / evidence |
| --- | --- |
| E1 | [Route inventory](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/main.go:618), [V2 response/submit/takeover routes](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/main.go:810) |
| E2 | [Anonymous entry](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/handlers_v2.go:1007), [link eligibility](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/accesslinks/service.go:1380), [registration/attempt creation](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/schedules/service.go:983) |
| E3 | [Credential issuance](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/auth/auth.go:646), [resume context](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/student_context.go:474), [takeover](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/attempts/submit.go:367) |
| E4 | [V2 save transaction](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/attempts/service.go:216), [writability](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/attempts/service.go:606), [question admission](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/attempts/service.go:674) |
| E5 | [Single resolver](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/handlers_v2.go:43), [bulk resolver](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/handlers_v2.go:252), [bulk switch](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/attempts/service.go:550) |
| E6 | [Compatibility response save](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/service.go:1411), [compatibility deadline gate](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/service.go:2133) |
| E7 | [Module start and compatibility entry](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/start_submit.go:111), [module-close manifest](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/close_module.go:240), [late evidence](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/late_evidence.go:46) |
| E8 | [Atomic module finalization](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/start_submit.go:950), [V2-first scorer](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/start_submit.go:1173), [adaptive route selection](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/start_submit.go:1300) |
| E9 | [Reconciler](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/reconcile.go:73), [break/next-module activation](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/reconcile.go:162), [personal sweep](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/reconcile.go:557), [worker cadence](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/background/runner.go:215) |
| E10 | [Per-student extension](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/proctor/service.go:461), [per-student pause/resume](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/proctor/service.go:1105), [room clocks](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/runtime/service.go:758) |
| E11 | [V2 submit receipt](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/attempts/submit.go:108), [SAT topology check](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/attempts/sat_modules.go:71), [SAT completion](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/sat/service.go:326), [terminal receipt owner](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/terminalization/service.go:447) |
| E12 | [Student branch and answer-key redaction](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/student_context.go:151), [media access](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/media.go:15), [result projection](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/service.go:472) |
| E13 | [Presence/precheck/integrity writes](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/student/telemetry.go:65), [V1 protocol fence](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/student/v1_write.go:283) |
| E14 | [Module constraints](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/migrations/0032_provider_neutral_sat.sql:254), [V2 ledger/projection constraints](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/migrations/0049_response_durability_v2.sql:174), [route uniqueness](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/migrations/0033_sat_runtime_authoring_hardening.sql:159), [evidence uniqueness](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/migrations/0075_sat_late_answer_evidence.sql:8) |
| E15 | [Transaction/retry owner](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/platform/tx/tx.go:79), [handoff runbook](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/docs/runbooks/sat-module-handoff.md:1) |

Existing protection worth retaining: attempt locks serialize saves and route decisions; V2 write/version uniqueness prevents duplicate effects; superseded writes cannot replace newer answers; SAT snapshot fallback rejects foreign questions; assigned branches are fenced in payload/media access; route identity is validated before creating Module 2; closure and final SAT terminalization can share a transaction; workers repair older provisional completion; live bootstrap uses `no-store` rather than immutable-version ETags; V1 writes do not mutate V2 attempts.

## 3. Findings: defects, policy gaps and operational risks

“Code-proven” means a deterministic counterexample follows from the inspected source. It does not mean a live exploit or production incident was reproduced. Priority: P0 protects identity/integrity, P1 protects exam correctness, P2 protects recovery and operability.

### F1 — P1: offline flushes above eight commands lose required admission data

**Code-proven, high confidence.** `ioFor` selects bulk I/O for more than eight commands. `normalizedQuestionOwners` calculates a deadline but never populates `ModuleStartedAt`. The personal SAT admission gate requires a non-nil start time, taking timing model from the runtime if necessary. E4/E5.

Counterexample: an active, unpaused personal SAT module has nine unanswered/new edits queued during a disconnect; valid current credentials and epochs; all arrive before the deadline. The bulk resolver returns owners with nil start times. The first new command fails `MODULE_NOT_STARTED`; the transaction rolls back. An equivalent one-command autosave can succeed. Existing bulk mock tests focus on query count, IELTS owners and missing SAT questions, rather than personal SAT save admission.

Smallest remedy: make single and bulk resolution produce the same complete question-admission contract, including canonical question identity, start, deadline and timing model. Do not disable deadline gates or lower the batch size as the permanent fix. Acceptance: identical admission outcomes for 1, 8, 9 and 100 valid commands, including exact replay and mixed duplicate/new writes.

### F2 — P1: close confirms versions without confirming the requested write

**Code-proven, high confidence.** The manifest has `WriteID`, but `pendingCloseWritesTx` never reads it or the lease. It compares only stored client version against the requested version. E7/E14.

Counterexample: old writer lease 1 stored question Q at client version 20 with answer A. After takeover, lease 2 holds new answer B at version 1, write W-B, not yet uploaded. Close manifest asks for Q/version 1/W-B. Stored version 20 passes; the server can close and route on A before B is durable.

Smallest remedy: close validates the exact durable write identity, originating lease and canonical payload hash in the ledger, with an explicitly permitted newer write in the same lease only if the manifest contract allows it. The comparison must not span unrelated leases. Preserve the common attempt lock. `closeId` also needs stable receipt/request-hash semantics if clients are to recover its exact result; it is currently validated/logged rather than stored as an operation receipt.

### F3 — P1: individual and room pause clocks are inconsistent

**Code-proven omissions and interleavings, high confidence; intended pause policy needs confirmation.** Individual pause/resume updates active modules, not attempt-owned breaks. Room resume clears module pause timestamps without preserving an outstanding individual pause. E9/E10.

Counterexample A: student is on an active 10-minute break; staff pauses that student for five minutes. The break deadline is unchanged. After resume, a sweep completes the elapsed break. The request-driven reconciler can also complete the break while the student remains paused; next-section Module 1 activation only checks the individual pause when `auto_start_at` is non-null, which next-section M1 does not have.

Counterexample B: individually pause a student; pause then resume the room. `resumeSATModules` clears that student's module pause while their individual status still says paused. Writes remain blocked, but module time can run and be consumed.

Smallest remedy: effective pause is the union of room and individual pause. Begin a single frozen interval on unpaused→paused and accumulate it only on paused→unpaused. This same owner governs active module, active break and pending auto-start remaining budget. A warning must not implicitly clear a pause. Reconciliation checks effective pause before both break completion and next-module activation. Test overlapping controls in both orders, duplicate pause/resume, review state, break and pending M2.

### F4 — P1: multiple answer identities/stores can acknowledge an answer that scoring ignores

**Code-proven counterexamples; frequency depends on active clients.** Compatibility PATCH writes `assessment_question_responses`; V2 writes `attempt_responses_v2`. Scoring prefers a present V2 answer, regardless of a later compatibility save. Separately, V2 accepts either exam-question ID or reusable question ID, persists the submitted ID, and scoring prefers the exam-question-ID row if both exist. E5/E6/E8.

Counterexample A: V2 saves A; compatibility PATCH later saves B for the same question successfully. V2-first scoring still uses A. Counterexample B: save A using exam-question ID; later save B using reusable question ID. Two V2 rows can exist; scoring selects A by ID preference instead of latest valid student edit.

Smallest remedy: for V2 attempts, all writable SAT adapters use one V2 command boundary. Normalize an unambiguous legacy alias to the pinned exam-question ID before versioning, ledger hashing and storage; reject ambiguous aliases. Legacy rows remain a read fallback only for genuinely legacy attempts. Resolve existing conflicting records through an auditable migration review, never by blindly choosing wall-clock timestamps.

### F5 — P1: repeated time-extension requests grant repeated time

**Code-proven, high confidence.** `ExtendAttempt` adds minutes every invocation; the command has no enforced idempotent operation receipt at this boundary. E10.

Counterexample: a five-minute grant commits, its HTTP acknowledgement is lost, and staff retries the same intended action. The active module gains ten minutes. A new command UUID/request hash, stored with the grant in the same transaction, makes retries replay the original grant; a new UUID denotes a deliberate second grant. Same rule applies to room extensions and other non-idempotent controls. Test commit-success/response-loss, concurrent duplicates and key reuse with changed minutes.

### F6 — P2: successful takeover is not replayable using the old credential after a lost acknowledgement

**Code-proven, high confidence.** Takeover replaces/revokes sessions before returning the new token. A retry authenticated with the old token fails session validation. E3.

Counterexample: takeover to a new browser commits; network drops the response; client retries with its old bearer, which is now revoked. The student needs another recovery path despite takeover having succeeded. Same-session token reissuance can also invalidate overlapping in-flight refresh requests.

Smallest remedy: authenticated recovery, separate from a writer mutation, returns authoritative lease/session state; an idempotent takeover receipt binds initiating principal, target client session and operation ID. It must never let a revoked former writer mint a fresh writer credential merely by knowing a receipt ID. Issuance reads the current lease; anonymous re-entry currently hardcodes lease 1. Refresh/rotation is serialized per browser, and failed requests preserve local drafts.

### F7 — P2: late evidence silently keeps the first answer for each question

**Code-proven behavior; product defect if all delayed evidence must be retained.** The unique key is `(module_attempt_id, question_id)`, and duplicate inserts are no-ops. E7/E14.

Counterexample: an old queued draft for Q arrives as evidence, then the student's actual final local draft arrives under another write ID. The second response returns recorded=0; the later draft and its route impact are not retained. Keep immutable evidence by attempt/module/question/write identity and originating lease/version; exact duplicates replay, reused identity with changed content conflicts. The staff view identifies the latest comparable draft without treating client timestamps as trusted. Review non-route-changing evidence too. Retention and review policy remain unknown.

### F8 — P2: answer paths disagree at deadline and control boundaries

**Code-proven, high confidence.** V2 excludes the exact `deadline + closeWindow` instant; compatibility personal save uses `now.After(...)`, admitting equality. The compatibility cohort gate rejects at the section deadline, whereas V2 has a drain grace. Compatibility `runtimeRevision` is shape-validated but not used as a pause/resume epoch fence. E4/E6.

Counterexample: the same answer reaches each endpoint at the grace endpoint and one accepts while the other refuses. Or a compatibility write delayed across pause→resume passes current-state gates although V2 rejects the old control epoch. Make every adapter use the same authoritative clock, half-open interval and control contract. A raw client timestamp cannot repair a packet held behind a lock.

### Policy/security gaps and risks requiring confirmation

| ID | Verified observation / risk | Proposed decision |
| --- | --- | --- |
| G1, P0 account-isolation risk | Public direct entry chooses an existing student account by self-entered email and creates a student session. Cookie-based resume resolves attempts by that user ID (E3). Self-registration is approved; public email is still insufficient proof of control of the existing account. | Preserve immediate practice entry with an attempt-scoped guest capability or isolated practice principal. Associate with an existing account only after account authentication; a public check-in must not authorize unrelated historical attempts. No mandatory roster approval. |
| G2, P1 policy | Newly received arbitrary writes are accepted inside the close grace; browser “frozen input” is not enforceable against a modified client. | Either openly define a server acceptance window, reject unknown new answers at the display deadline and retain evidence, or use trusted delivery. No claim that grace accepts only honest pre-deadline work. |
| G3, P1 policy | Module time starts before content response/render; backstop and break→M1 activation can begin clocks while disconnected. | Explicitly accept a server-start timing contract plus audited incident compensation, or redesign the bounded readiness protocol. Never reset on reload. |
| G4, P1 risk | Missing runtime in `v2Locker` yields a synthetic live gate. SAT still needs an assigned active module/deadline; a missing runtime could therefore bypass a session-liveness requirement when such rows exist. | SAT mutations fail closed on missing/unknown runtime/model; retain provider-specific legacy behavior only where explicitly supported. |
| G5, P1 risk | Topology completion checks at least one terminal module per required section; it does not independently require the exact base-plus-selected-branch graph. Normal routing constructs that graph, but corrupt/missing rows need stronger diagnosis. | Completion validates the pinned required graph and route identity, not counts alone; quarantine inconsistent attempts with a staff-visible reason. |
| G6, P2 risk | Bootstrap assembles live state with several reads; result projection returns stored score payload without a release-status filter. | One consistent read snapshot/version for authoritative state; student-safe result DTO; expose score fields only under the approved release policy. Current practice result output is not evidence of an approved withholding rule. |
| G7, P2 risk | Malformed nonempty stored link section scope can fall back to unrestricted legacy scope; source migrations anticipate schema drift. Scope edits are already blocked after participation. | Preserve explicit NULL legacy default, fail closed on invalid nonempty configuration, verify deployed constraints and pin the resolved scope. |
| G8, P2 operational | Retry classifier uses error strings; some telemetry is emitted inside retried transactions. Actual HA settings, lock waits, and 400-student network behavior are unverified. | Retry known transient DB codes; unknown commit outcome means replay/lookup, not fresh command; count committed facts after commit/outbox. |

## 4. Numeric design envelope and targets

All numbers below except 400/60 seconds are **proposed engineering targets or sizing assumptions**, not measurements or user-approved SLAs.

| Dimension | Proposed envelope / rationale |
| --- | --- |
| Arrival | 400/60s average = 6.67/s; rehearse all 400 arrival attempts in a 5-second burst = 80/s |
| Steady answer writes | Assume one aggregate save per student every 5s = 80 write requests/s; typical 1–2 commands/request; deliberate editing burst one save/student/second = 400/s |
| Polling | State poll every 5s with jitter = 80 reads/s; during 5s of a transition, 1s jittered polls = 400 reads/s; never poll full immutable content repeatedly |
| Presence | Example 30s heartbeat = 13.3/s; source also supports a configurable window, so do not hardcode presence as time authority |
| Handoff | 400 students × final batch + close + next start = 1,200 logical requests; draining within 5s requires 240 requests/s, before polls and retries |
| Recovery burst | 400 students × 30 queued commands = 12,000 commands, bounded into one request/student; include batches of 9 and 100 to cross the resolver boundary |
| Exam data | Example 98 delivered questions/student × 400 = 39,200 current answer slots. Five accepted edits/slot = 196,000 ledger rows. At assumed 1–4KiB/ledger payload, raw payload is approximately 0.2–0.8GB before indexes, replicas and retained evidence |
| Join/bootstrap | API p95 ≤1s, p99 ≤2s at 400/60s; end-to-end usable entry p99 ≤5s on the declared exam network |
| Answer-save ACK | API p95 ≤200ms, p99 ≤500ms; browser-to-durable-ACK p99 ≤1s on the declared exam network |
| Close/start | API p99 ≤1s each; first answerable M2 frame p99 ≤2s after start commit. This is a measurement target, not “full time from render” proof |
| Timeout recovery | Personal due work p99 ≤5s after the acceptance window; general/cohort p99 ≤10s; final receipt p99 ≤10s after final closure |
| Availability | Tentative 99.95% successful valid command availability in declared exam windows; separately track bad-outcome safety. 99.95% allows 7.2s unavailable in a four-hour window, so a 60s failover violates that window target |
| Recovery | API instance failure recovery target ≤5s; DB outage service recovery proposal ≤60s, which needs incident handling and availability-budget accounting. Regional disaster RTO/RPO remain unapproved |
| Data safety | No acknowledged answer loss on API crash; acknowledged writes survive the selected DB failure envelope only if HA durability/failover actually guarantees it. Local-only drafts cannot have server durability guarantees |

Start with the existing deployment and pools, instrumented against these targets. For a redundant deployment, a sizing experiment might use two API replicas, 16 API DB connections each and an 8-connection worker budget: 40 aggregate connections, not a prescription. At 400 transactions/s and 50ms average connection occupancy, Little's Law gives 20 average occupied connections; long-tail waits, polling, auth and worker work require headroom. Measure transaction occupancy and total DB capacity before selecting pool sizes. Increasing pools does not fix a shared schedule-row lock.

Shared NAT: entry rate limits must admit the authorized 400 students plus bounded retries. With three check-in/credential-related requests each, the room can generate 1,200 requests/minute before retries. Identify which routes share each bucket; count retries and other classrooms at the same IP. Rate-limit authenticated writes by principal/attempt, with a separate coarse edge limit. Do not rely on independent per-process buckets being a global quota after adding replicas.

## 5. Phase 1: Initial proposal — three options

| Option | Complexity | Failure behavior | Consistency | Operability | Cost basis | Reversibility |
| --- | --- | --- | --- | --- | --- | --- |
| A. Minimal: repair the existing Go monolith, canonical V2 writes, per-attempt transactions, existing DB/outbox/workers | Low incremental change; one domain owner inside current packages | Process crash recovers from committed state; DB outage blocks canonical writes; existing single deployment remains an availability limitation | Strong answer/route/receipt transactions; eventual notifications/projections | Existing tooling plus focused invariants, alerts and recovery procedures | Lowest engineering and infrastructure increase; HA is an explicit extra | High: additive contracts/receipts and per-runtime policy versioning; drain active sittings before rollback |
| B. Same domain architecture, two stateless API instances plus a dedicated worker role and HA single-writer database | Moderate deployment work; no new answer broker | One API instance may fail without losing committed state; worker outages create repair lag; DB failover still dominates outage risk | Same transactional model; local caches must not authorize mutations; primary reads for authoritative state | More rollout, pool, shared rate-limit, revocation and multi-instance outbox discipline | Extra API capacity, worker reservation and HA DB cost; provider quote needed | Good: collapse compute roles later; data/API contracts remain compatible |
| C. Durable command queue and per-attempt processors; asynchronous projections | High: ingestion receipts, processor sequencing, routing barriers, poison messages and deadlines | Can durably accept into queue during DB outage, but cannot safely expose next branch until state is processed; backlog can consume deadlines | Ordered per-attempt processing; eventual reads; queue admission is not an applied answer ACK | Additional lag, replay and queue operations; more incident states | Highest implementation/on-call burden plus broker/storage | Low to moderate: migrating ordered history and ACK semantics back is difficult |

## 6. Phase 2: Stress-test the proposal

Option A is sufficient for the traffic requirement if measured, but one API/DB failure may fail the availability target. Merely adding replicas under option B does not fix F1–F8, increases aggregate pools, and changes assumptions behind local rate limits and revocation caches. Option C solves neither untrusted offline timing nor identity verification; it introduces a dangerous distinction between “queued”, “applied”, “routed” and “scored”. At this scale its operational cost is unjustified.

The strongest challenge to A/B is fairness: server timing cannot establish the student's render instant, and close grace cannot authenticate edit time. Another is the common database: a highly available application still loses write service when the DB fails. Finally, locking an entire cohort for a staff command can delay last-second answers; lighter locking must preserve an atomic control boundary rather than simply stop checking state.

## 7. Phase 3: Final recommendation

**Select A as the domain design.** Fix contract parity, practice account isolation, pause and command idempotency at the existing boundaries. Keep synchronous transactional answers/routing and the existing durable outbox. Preserve SAT and IELTS's distinct current policies; a common durability primitive must dispatch to the existing provider rule rather than impose SAT module deadlines or routing on IELTS. The confirmed scale does not justify a queue or microservices.

If the proposed availability requirement is accepted and current deployment has a single API/DB failure point, deploy **B as the hosting topology for A**. Redundancy is a requirement-driven operating decision, not a replacement data model. Do not claim A meets 99.95% until the topology and rehearsals demonstrate it. Cost is expressed as added component roles because the provider, region and existing infrastructure are unknown; invented dollar prices would be misleading.

| Pillar | Gain | Sacrifice / mitigation |
| --- | --- | --- |
| Latency | No queue hop; small transactions; immutable content reuse | Bounded DB lock wait; content delivery can consume start time; benchmark real network |
| Correctness | One answer identity and write contract; atomic close/route/seal; explicit control fencing | No automatic speculative progress during DB outage |
| Durability | Ledger and terminal receipts survive API crash; outbox survives lost broadcasts | HA DB guarantees must be verified; client-only drafts are incident evidence |
| Complexity/cost | Reuse current architecture and tests | Focused migration/compatibility work still required; optional HA topology adds operating cost |

## 8. Data ownership and consistency

| Data | Authoritative owner | Consistency and lifetime |
| --- | --- | --- |
| Candidate identity, eligibility, schedule admission | Auth/admission boundary plus roster registration | Verify principal; atomically bind to sitting; admission closure distinct from existing-attempt resume |
| Pinned exam version, effective scope, timing/handoff/scoring policy | Attempt/sitting snapshot | Immutable for an active sitting; no silent reinterpretation after deploy/config change |
| Writer session, lease, effective control epoch | Attempt command boundary | Current DB state, fenced inside mutation; takeover increments lease once |
| Canonical response and mutation history | V2 response owner | One exam-question ID; projection, ledger and revision commit together |
| Module clock, break clock, pending-start budget | SAT lifecycle owner in delivery/runtime | DB clock and effective pause; reload cannot reallocate time |
| Adaptive decision | Close transaction | Immutable branch/policy/answer revision or digest; one decision per required section |
| Terminal receipt/final snapshot | Existing terminalization service | One compatible terminal outcome; response digest records exactly what was sealed |
| Grade/release | Grading/result owner | Submission safety separate from eventual grading; corrections are revisions with audit, not attempts reopened |
| Late drafts | Evidence owner | Separate append-only evidence; never automatic score/route mutation |
| Presence, visibility, browser integrity signals | Telemetry projection | Advisory and bounded; never admission, clock, cheating verdict or submission authority |
| Notification/outbox | Durable event owner | Transactional intent; at-least-once delivery; clients reread authoritative state |

No new generic framework is needed. Route existing adapters into these owners. Preserve useful package boundaries; responsibility belongs where every affected caller crosses.

## 9. Flows and state machines

### Admission and recovery

Practice eligibility → isolated practice identity or authenticated existing account → registration uniquely bound to sitting/candidate → one attempt → current lease credential → precheck/content → waiting for session/module start. No preapproved roster is required for the confirmed practice use case.

Registration and attempt creation use stable domain keys and replays. A process dying between stages must not leave an unrecoverable user; retry resumes the stage already committed. Concurrent creation of the same normalized email must converge through uniqueness/reload rather than surfacing an unexplained insert failure. Stable name/email corrections require staff policy, not minting a second sitting.

Resume is a read/recredential flow, including after admission closes. It returns current attempt/module, accepted answers, pending evidence status and terminal receipt. It never allocates a new timer or silently takes over another writer. Expired credentials require authenticated recovery; student draft preservation does not authorize a stale writer.

### Attempt

Logical states: ADMITTED → READY → IN_PROGRESS → COMPLETING → SUBMITTED. IN_PROGRESS may have effective PAUSED as an orthogonal control. Any nonterminal state may become TERMINATED through authorized policy. COMPLETING is a derived/operational state while a closure or repair is pending, not permission to change answers. Terminal states never return to IN_PROGRESS.

Completion, grading and release are distinct: SUBMITTED → grading PENDING/READY → release WITHHELD/RELEASED. An invalidated/terminated attempt retains its audit evidence and follows its own result policy.

### Module

Logical states: ASSIGNED_NOT_STARTED → ACTIVE ↔ REVIEW → CLOSING → LOCKED. CLOSING is derivable from the immutable display deadline and acceptance deadline; it need not be a new stored enum. REVIEW is writable only while ACTIVE would be writable. LOCKED is immutable for canonical answers. Automatic timeout/valid close/staff termination supplies the completion reason.

Personal start sets the timer exactly once at DB activation. Retry/reload returns that start. Cohort start returns the remaining room window, never a fresh full window. Old offer/enter/visible adapters must honor a frozen protocol version or receive an actionable compatibility response; a generation field that is ignored on one route and required on another cannot masquerade as one protocol.

### Adaptive handoff

ACTIVE M1 → display deadline freezes UI → approved drain policy → confirm exact durable final writes or bounded worker close → under attempt lock score canonical answers, persist route, lock M1, create exactly selected M2 and event → commit → next content/start according to captured handoff policy.

No M2 assignment/content from the unselected branch. No answer lands between route scoring and M1 lock. A retry learns the committed route. Late M1 writes after lock are evidence only and cannot block current M2 saving. Client-start backstop runs against an unpaused remaining delay, not an elapsed wall-clock delay that disappears during pause.

### Break

Normal personal path: NOT_REQUIRED or ACTIVE → COMPLETED → next section's base module. The server creates ACTIVE break at prior section closure, with authored duration. Effective pause freezes it. At expiry, worker closes it and opens the next stage according to frozen timing policy. A zero break never leaves a pending barrier. Legacy PENDING→ARMED→ACTIVE offer behavior remains only for captured compatible sittings; no API handshake is mandatory on the current server-driven flow.

### Writer and drafts

Writer: UNCLAIMED → OWNED(client session, lease) → OWNED(new session, lease+1) → CLOSED. Draft: LOCAL_PENDING → DURABLY_ACKNOWLEDGED or SUPERSEDED; refusal becomes RETRYABLE, NEEDS_REAUTH, FENCED, or CLOSED_MODULE_EVIDENCE. Those client states are necessary parts of the backend contract even though this task implements no client code.

## 10. Contracts and invariants

### Contract requirements

| Operation | Required semantics |
| --- | --- |
| State/resume | Authenticated own-attempt read, consistent revision/timestamps, current timing/control/lease, pinned content identity; `no-store`; an old HTTP response cannot regress state |
| Save batch | Attempt, canonical exam-question ID, write ID, originating lease, control epoch, client version, full bounded response aggregate. Atomic batch; per-command ACK only after commit: applied, duplicate, superseded plus canonical revision/hash |
| Compatibility save | Translate into the same canonical owner for V2; no parallel authoritative table; retain explicit V1 legacy behavior only |
| Start | Assigned module, current writer/control, captured protocol; idempotent activation; same start/deadline on replay; content belongs to pinned selected module |
| Close | Module/attempt identity, close operation ID/hash, exact durable-write manifest and originating lease. Pending manifest is a retryable conflict; receipt after committed lock/route; duplicates recover same closed module outcome |
| Evidence | Originating write identity/lease/version and untrusted client timestamp; bounded append; exact duplicate replay; altered duplicate conflict; no scoring side effect |
| Takeover/refresh | Authenticated own-attempt recovery, explicit target session and operation identity; lease increment once; old writer fenced; lost token response recoverable via authenticated path |
| Staff control | Actor assignment/role checked transactionally; operation ID/request hash, expected state/revision, named target stage, reason; duplicate grant does not add time twice |
| Finalize | One attempt terminal receipt/digest/result consistency. Repeated requests, timeout worker and alternate submission adapters agree on terminal fact even if their transport submission IDs differ |

Errors carry stable reason, scope (attempt/module/question), retryability, current relevant epochs/revisions and server time. Expired credential → reauthenticate; stale control → reread and preserve draft; stale writer → stop canonical writes; closed old module → evidence; overload → jittered retry using the same IDs and `Retry-After`. No success response before durable commit. No generic “attempt closed” treatment for a refusal scoped only to a prior module.

Deadline contract: active input before D; any accepted drain window is `[D, D+W)`; reject new canonical writes at D+W and after module lock. Exact previously committed replay remains a read of the original outcome under current authorization. Use DB time after required locks. W is captured policy; approval of grace implies accepting its fairness ceiling unless trusted delivery exists.

### Invariant register

| ID | Invariant | Current assessment / proposed owner |
| --- | --- | --- |
| I1 | One intended sitting per practice registration key; public check-in cannot confer another account's authority | Registration/attempt uniqueness exists; account isolation needs G1 remedy |
| I2 | One current writer; previous lease cannot mutate | Substantial existing fencing; fix credential replay/renewal and all adapters |
| I3 | Every ACKed answer is represented by durable canonical identity/hash | V2 protects this; F1/F4 violate path equivalence and scoring intent |
| I4 | Newer comparable edit wins; retries never have extra effects | V2 ledger/version constraints protect core; extensions/evidence need separate receipts |
| I5 | All mutations use same module/state/time/control verdict | Partially protected; F1/F8/G4 require one boundary |
| I6 | Effective pause stops module, break and pending start exactly once | Partially protected; F3 |
| I7 | Route is computed from the frozen canonical base responses and never changes afterward | Atomic route exists; fix close-manifest identity and compare score/digest in reconciliation |
| I8 | Exactly required base + selected branch graph is completed within pinned scope | Normal routing protects creation; strengthen corruption checks beyond section counts |
| I9 | One terminal outcome/receipt; no post-terminal canonical mutation | Existing terminalization owner/uniqueness; unify cross-endpoint replay contracts |
| I10 | No unselected/future content or answer keys leak through alternate surfaces | Existing branch/key/media fences; retain tests and explicit release contract |
| I11 | A crash after any step leaves either no effect or a recoverable committed outcome | Core transactions/outbox exist; takeover/entry response-loss and recovery policy need work |
| I12 | A malformed policy or dependency outage cannot silently widen access or grant time | G4/G7 and deployed schema need fail-closed checks |

Database constraints already cover per-registration attempt uniqueness, per-attempt/module uniqueness, mutation write/version uniqueness, one route per attempt/section, terminal receipt and result uniqueness, and enum vocabulary. They do not independently prove one active module, selected-branch topology, pause arithmetic or assigned-question ownership. Keep those under the attempt boundary; add a DB constraint only if it expresses the invariant directly without a fragile parallel representation.

## 11. Failure analysis and student edge-case matrix

| Flow / scenario | Failure to prevent | Required recovery or rule |
| --- | --- | --- |
| Join before window / after admission end | Admit unauthorized early/late candidate | Explicit admission verdict; already admitted resume has separate eligibility |
| Double-click check-in, retry, two tabs | Duplicate user/registration/attempt | Stable keys, unique constraint conflict→reload; preserve original sitting |
| Wrong schedule/code/name/email, case variants | Impersonation or duplicate identity | Principal-bound admission; normalize once; indistinguishable public refusal |
| Link paused/revoked while entry is in flight | Complete admission under revoked eligibility | Recheck admission authorization at credential/registration commit; define existing-attempt policy |
| Join commits; session/token response fails | Student stranded behind duplicate creation | Retry resumes committed attempt; authenticated credential recovery |
| Shared NAT or burst of 400 | Legitimate students 429/timeout | Per-attempt authenticated limits; measured shared-IP entry budget; bounded queues |
| Late cohort arrival | Fresh full room time | Return remaining room window or expiry; no per-arrival reset |
| Refresh/back/reopen during ACTIVE | Reset deadline or overwrite drafts with stale snapshot | Fixed start; versioned snapshot adoption; compare local outbox with canonical ACKs |
| Refresh during close/break/start | Repeat route or create missing module | Current state/receipt recovery; idempotent transitions |
| Second device/two tabs | Competing canonical writers | Explicit takeover; one lease; preserve old device drafts separately |
| Takeover success, lost ACK | Old token cannot recover new session | Authenticated recovery plus takeover receipt; no stale-writer escape hatch |
| Token expires during module or reconnect | Discard unsaved work | Early credential refresh; bounded authenticated recovery; draft not deleted on 401 |
| Same-session refresh requests race | Last token wins, earlier request returns unusable credential | Serialize refresh; credential generation/order; recover authoritative session |
| Network flaps, offline 30-answer queue | Bulk rejects legitimate module / retry storm | F1 parity; batch bounded to 100; jitter; preserve IDs and epochs |
| Two answer requests reordered | Earlier answer overwrites newer | Monotonic versions within lease; exact canonical question ID |
| Same write ID/same payload | Apply twice | Durable duplicate ACK, no revision increment |
| Same write ID/different payload | Silent overwrite | Conflict; keep both client drafts for investigation |
| Same version/different writes | Nondeterministic winner | Version collision; reread; explicit new edit/version |
| Clear answer / blank / zero / fraction | Resurrect old answer or misgrade | Explicit blank semantics; strict published SPR scoring; zero is a valid value |
| Review/annotations/eliminations save races | Non-answer action rolls back a valid answer | Full aggregate with one version contract; validate bounds; preserve aggregate intent |
| Mixed valid/current and closed-module batch | One stale packet blocks all current-module progress | Backend documents atomicity; client groups by module/control epoch and preserves rejected old-module drafts |
| Forbidden module/question/media ID | Read/write other branch/candidate | Pinned version + assigned module + scope check on every surface |
| Answer waits for lock across deadline | Approve using stale pre-lock timestamp | Judge locked DB time; measured queue/lock-wait SLO; incident evidence on refusal |
| Just before/exactly/after D or D+W | Endpoint disagreement / extra working time | One half-open acceptance contract; synchronized boundary tests |
| Student omits close or submits empty manifest | Endless M1 / promise of unsent drafts | Bounded server close; empty manifest means no local durability claim, never proof no draft exists |
| Final write vs close vs worker races | Route without last acknowledged answer | Common attempt lock; exact manifest; immutable decision/digest |
| Close duplicate with changed payload | Retry misrepresented as original closure | Request-hash/receipt conflict; no repeated route |
| M2 start delayed/offline beyond backstop | Invisible time consumption / unlimited preparation gap | Explicit bounded start policy; pause-aware remaining delay; staff incident handling |
| Pause while saving or entering | Pre-pause intent applies after resume | Control epoch fence; no automatic re-stamping old command |
| Pause during break or pending start | Break consumed / unseen next module starts | Effective pause owner covers both; same predicate in reads and workers |
| Individual + room pauses overlap | Double pause credit or premature unpause | Union of pause scopes; only effective transitions change time |
| Warning while paused | Warning effectively resumes or corrupts paused state | Warning is an event separate from blocking pause state |
| Duplicate extension/re-arm | Double extra time / timer reset | Command receipt; no re-arm after accepted response/visible-use policy; exact target stage |
| Break zero, expired, slow worker | Student stranded / next module loses allotment | Server transition; no zero-duration barrier; activation uses frozen policy |
| End room while personal attempt active | Incorrect termination or partial closure | Explicit force-end policy; durable jobs per attempt; replay-safe finalization |
| Final submit vs terminate vs timeout | Conflicting receipts/results | First committed authorized terminal fact wins; deterministic terminal conflict |
| Student closes browser without submit | Attempt never completes | Worker progresses/terminalizes independently of requests |
| Final receipt commits, response fails | Student retries with new ID and receives false failure | Lookup terminal fact by attempt; compatible endpoint replay; never resubmit answers after seal |
| Websocket/poll notification lost/out of order | UI remains on old module | Notifications are hints; bounded polling; ignore older revisions |
| Telemetry missing/spoofed/client clock wrong | False cheating verdict or extra time | Server timestamps; presence advisory; no automatic guilt or timer grants |
| Malformed response/policy/legacy data | Unbounded parsing, bad score, fail-open scope | Body/depth/count caps; canonical validation; quarantine corrupt nonempty policy |
| Result pending/unreleased/invalidation | Leak or display misleading score | Student-safe release projection; submitted receipt independent of grading readiness |

### Partial failure, retry and concurrency rules

For an answer, ledger/projection/revision/audit either commit together or roll back together. For close, scoring inputs/locked module/route/next stage/event intent commit together. For finalization, receipt/snapshot/digest/result intent commit together. A crash after commit but before HTTP/broadcast must be recoverable by stable operation identity and state reads. No remote dependency is called while these locks are held.

Lock acquisition follows one documented graph for existing owners. Per-student mutations take the attempt lock and share-read runtime/control rows before module data. Schedule-wide transitions are special: inventory their actual runtime/section/attempt order and ensure they cannot acquire the reverse graph; use stable attempt ordering or the existing durable fanout with a clear control fence. The recent working tree removes some whole-cohort locking, so do not assume comments describing older locking still match. Deadlock handling supplements correct ordering; it does not replace it.

For MySQL, short transactions, consistent lock order and retrying deadlock victims are documented practices; locking reads retain locks until commit/rollback. READ COMMITTED reduces some gap locking but is not a universal no-lock guarantee. [MySQL locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html?ff=nopfpls), [deadlock handling](https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlocks-handling.html).

Unknown commit result: keep the same command IDs, authenticate, and replay/query durable receipts. Never label a connection failure “nothing saved”. Bounded server retries for known transient errors plus client jitter and `Retry-After`; permanent validation/fencing is not repeatedly retried. Frozen obsolete commands must not have their epochs silently changed to pass new authorization.

### Overload and dependencies

Protect answer/close/state work from exports, authoring, grading and presence. Keep worker concurrency bounded by its DB budget; prioritize deadline work and oldest due age rather than only a count. Bound ingress body/command sizes and request deadlines. For a 400-student cohort, measure rather than add a broker. Rejection must be explicit/retryable and preserve drafts; autosave throttling must not drop final edits.

API node outage: retry to healthy node using same identities. Worker outage: writes enforce deadlines themselves; resumes/close and a restarted worker recover transitions. DB outage: no durable ACK, no speculative branch, no unknown-policy start. Keep drafts locally; mark incident, recover authenticated state after DB returns, and apply the approved pause/compensation/evidence policy. Outbox/WS outage: writes remain safe and polling recovers UI. Media outage: authenticated, versioned retry/cache; visible broken-question incident can require compensation. Identity dependency outage: no new unverified admissions; existing valid sessions follow their captured policy.

Disk-durable MySQL commits require checking actual configuration; official guidance recommends `innodb_flush_log_at_trx_commit=1` and `sync_binlog=1` for durability. This does not by itself prove zero-loss failover to an asynchronously replicated standby. Verify the actual engine/HA contract and rehearse failover. [MySQL durability guidance](https://dev.mysql.com/doc/refman/8.4/en/replication-options-binary-log.html).

### Security and privacy

Keep self-registration without account impersonation: an anonymous practice entrant gets capability over their own newly bound attempt, not an existing account selected by display email. Account association requires authentication independently of display name/email. Bind attempts to tenant, principal and sitting; deny cross-resource access, stale/revoked writer mutation, unknown runtime and corrupt scope. Check the same policy on HTTP, alternate snapshot routes, media and result responses. Keep answer keys/scoring configuration out of student payloads. Browser storage/device fingerprints are untrusted signals, not authentication.

Preserve CSRF/origin controls where cookie sessions authorize writes. No bearer/answer content in operational logs or metric labels; restrictive evidence/result access, defined retention and audit trails. A copied local draft from a replaced device may be evidence under authorized recovery, but must not be silently re-stamped as a current-lease canonical answer.

### Rollout, rollback and repair

Additive contracts/receipts first; new client compatibility before enabling policy for new sittings. Freeze timing, handoff, close window and protocol version in each active runtime/attempt. The current runtime captures handoff mode, while global close-window/auto-start tunables still need scrutiny for in-progress reinterpretation.

Canary on an isolated 400-student schedule; require contract/race/load/network gates below. Rollback disables new-policy admissions; keep compatible code and workers serving already captured active policies until those attempts drain. Never reverse a route, reset a clock, delete a terminal receipt, drop answer/evidence tables or roll back migrations during a live sitting.

Repair records correction reason, operator, original/current digest and policy revision. Investigate violated route/topology/receipt invariants; quarantine ambiguous attempts. Grant audited compensation/retake or a separate grade revision under institutional policy; never “repair” by silently editing canonical exam history.

## 12. Verification and implementation order for a later task

Fresh existing tests were run with `TEST_MYSQL_DSN=''` and `-count=1` for attempts, delivery, SAT, proctor, runtime, student, schedules, accesslinks, terminalization, background and API: **11 packages passed**. Real-MySQL tests were deliberately disabled; no live DB, production load or network rehearsal ran. No test or implementation code was added. The passing mocks do not disprove the source counterexamples above.

| Priority | Future change and acceptance evidence |
| --- | --- |
| P0 | Preserve practice self-registration while closing existing-account impersonation; test unknown email, existing student/staff email, copied identity, own-attempt resume and cross-tenant/historical-attempt access |
| P1 | F1 single/bulk parity: 1/8/9/100 real SAT new commands against real MySQL, matching current writer, deadline and pause policy |
| P1 | F2 close identity: old high-version lease + new low-version unsaved edit must be pending; concurrent exact save/close/sweep routes exactly once from the acknowledged digest |
| P1 | F3 pause union: individual/room controls in both orders; break and pending-start timing; duplicate pause/resume; warning during pause; assert elapsed time and allowed next state |
| P1 | F4 one canonical store/ID: V2→compatibility and compatibility→V2 edits, inner-ID aliases, blank clears, duplicate question reuse; bootstrap, route score and result all use final acknowledged answer |
| P1 | F5 idempotent controls: commit then lost ACK, concurrent duplicate grants, changed-payload reuse; exactly requested seconds added |
| P1 | Common deadline/control/authorization gates: D−1µs, D, D+W−1µs, D+W; runtime missing/unknown; locked module; stale control; forbidden branch/media; no provider fallback |
| P2 | F6 takeover/renewal response loss; expired bearer plus valid account recovery; old writer cannot regain lease; browser-local drafts retained |
| P2 | F7 evidence multiple writes/question; exact replay; altered duplicates; review completion; route unchanged, no score mutation |
| P2 | Cross-endpoint terminal replay, corrupted topology, completed-but-missing result/outbox repair, unreleased result redaction, malformed scope/policy |
| Exam-day gate | 400/60s arrivals, 400/5s burst, 400 simultaneous final saves/closes/starts, 30-edit reconnect queues, one shared NAT, mixed slow clients, worker restart, response loss, DB failover and paused room |

Race tests require real barriers/interleavings, not only sequential requests. Inject failure before/after each commit and response, compare durable rows/receipts/digests, and assert no double route/extension or missing acknowledged answer. Property tests should generate sequences of edit/retry/takeover/pause/close/terminate and assert I2–I9. Existing SAT MySQL integration suites and handoff k6 harness are useful foundations, but the general SAT load harness uses compatibility PATCH while modern handoff uses V2; both must exercise the canonical contract actually shipped. Every shared auth/attempt/runtime change also needs existing IELTS entry, V1/V2 save, pause/resume, section transitions, final submit and result-recovery regressions; do not introduce adaptive SAT module topology, grace or break policy into IELTS.

Operational acceptance: monitor durable ACK latency and failures, DB pool wait/lock wait, per-module rejection reasons, oldest due transition, route/digest mismatch, pending terminal receipts/results, outbox age, auto-start fraction, credential failures and unreviewed evidence age. Proposed action thresholds: answer p99 >500ms for two minutes, due transition age >10s, final receipt pending >30s, any route/digest mismatch or acknowledged-loss incident immediately actionable. Low-volume exam windows also require per-cohort completion counters; percentile metrics alone can hide one stranded student.

## 13. Twelve-month pre-mortem

| Why the design failed | Early signal | Prevention / trigger |
| --- | --- | --- |
| Old client or load harness still writes a second answer store | ACKs differ from route/bootstrap answer digest | One V2 canonical boundary; compatibility matrix and client-version telemetry |
| Offline flush tests missed the bulk threshold | Saves succeed online; reconnect rejects MODULE_NOT_STARTED | Actual SAT API parity tests at 8/9/100, not resolver mocks alone |
| Institutions adopt more timing/accommodation combinations | Manual grants, unexplained time loss after overlapping pauses | Frozen explicit policy plus one effective pause owner; scenario tests before enabling a new policy |
| A second replica invalidates local-limit/cache assumptions | More accepted bursts, delayed revocation, DB connections surge | Multi-instance rehearsal, summed pool budget, authoritative mutation checks |
| Late-evidence backlog becomes a hidden grading dispute | Old unreviewed evidence, repeated student complaints | Named owner, review SLA, complete immutable evidence and audited outcome policy |
| New exam versions or data repairs violate topology | Missing selected branches, wrong version/media | Publish validation plus runtime graph checks and quarantine; no fail-open corruption |
| Retry/telemetry overwhelms shared DB at the deadline | Pool wait and 429s rise precisely at closure | Separate workload budgets, compact state polls, bounded jittered retries and representative 400-student wave |
| Failover promotes a lagging DB and loses ACKed work | Missing ledger writes despite successful client receipts | Verify HA commit/promotion guarantees; restore/failover drill and retained command identities |
| Readiness timing promise exceeds what browser delivery can prove | M2 first-frame delay or repeated auto-starts | Clear start policy and network SLO; audited compensation; trusted delivery if proof is required |
| Safe rollback changes global settings for active attempts | Old runtimes suddenly use a different grace/start interval | Capture all behavior-changing policy inputs and drain-before-remove rollout |
| Monthly uptime masks a single interrupted high-stakes cohort | Monthly SLO green; exam complaints high | Exam-window and cohort safety SLOs, staffed escalation and periodic outage rehearsal |

## 14. What remains risky

The largest residual risk is policy, not throughput: identity proof, unverifiable offline edit time and browser-visible timing cannot be solved by transactions alone. A common database remains the authoritative dependency; HA durability and failure tolerance are unknown. Client-local drafts can disappear if storage is cleared or the device is lost. Legacy API/client coexistence and existing schema drift require measured migration evidence. No actual 400-student network/load/failover gate has passed in this review.

Proceed with the smallest architecture above after those decisions are settled. A guarantee to cover every future student behavior would be unsupported; explicit invariants, complete known-flow scenarios, durable receipts and rehearsed recovery make the remaining risk inspectable.
