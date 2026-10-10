 Implementation plan: SAT access-code start burst on one API instance                                                                                                                    
                                                                                                                                                                                         
 0. Context and current behavior                                                                                                                                                         
                                                                                                                                                                                         
 Recommendation: Keep one Go API instance. Replace the single shared reservation lock with 200 durable, independently claimable reservation slots per schedule/code generation. Put a    
 bounded per-schedule admission queue in front of the database work, and prepare the authorized exam response before committing the start. This targets both the measured lock           
 contention and the delay candidates can experience after their exam timer starts. No Redis, extra API instance, or new service.                                                         
                                                                                                                                                                                         
 - Verified — pre-0081 root cause: the former `StartWithCode` implementation serialized reservation claims on one `sat_start_code_guards` row. In those old local 600-candidate runs, guard-lock wait summed to about 161 seconds and post-start state/content assembly summed to about 942 seconds across concurrent requests.
 - Verified — observed result: six local 600-candidate waves missed the existing p95-under-2-seconds and drain-under-2-seconds qualification gate. Cold-wave p95s ranged from            
   4.924–9.958s; warm-wave p95s were 2.072–5.842s. Several runs also had request errors. These are local measurements, not production SLO evidence.                                      
 - Verified — current UX: SatStartCodeScreen.tsx shows “Checking your code…” while the request is pending and says the timer starts when the candidate begins. The client does not       
   blindly retry; it checks authoritative state after an uncertain result.                                                                                                               
 - Unknown: production MySQL version/topology and whether the local 2-second qualification target is also the production SLO.
                                                                                                                                                                                         
 This is both a concurrency-design issue and an optimization issue: the former shared database row serialized a burst, while post-commit work added delay after the timer began. It is not a problem with the exam’s access-code requirement itself.
- Verified — current-path measurement after migration 0081: request-specific queue timing shows differing individual admission waits; the cold 600 burst p95 is 6.671s and warm p95 is 4.687s among HTTP responses that returned timing headers. New cold/warm waves had 40/232 TCP resets without response headers. These are not the old pre-slot guard-lock measurements; do not attribute current waits to that former guard lock from these measurements.
                                                                                                                                                                                         
 1. Requirements                                                                                                                                                                         
                                                                                                                                                                                         
 ┌───────┬──────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ 
 │ ID    │ Behavior                                                 │ Acceptance criterion                                                                                             │ 
 ├───────┼──────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤ 
 │ FR-1  │ A valid candidate can start only with an authorized      │ 600-candidate test creates no duplicate start or schedule runtime; every accepted attempt starts the correct     │ 
 │       │ attempt, valid code generation, and open start window.   │ first module.                                                                                                    │ 
 ├───────┼──────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤ 
 │ FR-2  │ Code-abuse protection remains per schedule and code      │ At most 200 comparisons are pending plus failed for a generation/window; only real exhaustion returns cooldown.  │ 
 │       │ generation.                                              │ Code rotation gets a fresh generation budget.                                                                    │ 
 ├───────┼──────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤ 
 │ FR-3  │ A candidate’s exam timer does not run while waiting for  │ Start time is the durable start transaction’s DB time; response content is prepared before commit and returned   │ 
 │       │ admission or response assembly.                          │ promptly after it.                                                                                               │ 
 ├───────┼──────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤ 
 │ FR-4  │ No unauthorized or unselected module content is          │ Start commit rechecks attempt ownership, schedule/code generation, current scope, control epoch, and start       │ 
 │       │ returned.                                                │ window.                                                                                                          │ 
 ├───────┼──────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤ 
 │ NFR-1 │ Retain one API instance and shared MySQL authority.      │ No correctness dependency on adding replicas or sticky sessions.                                                 │ 
 ├───────┼──────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤ 
 │ NFR-2 │ Reduce burst contention without weakening the            │ Multi-request MySQL tests prove the budget invariant and measure the 600-candidate path.                         │ 
 │       │ 200-comparison budget.                                   │                                                                                                                  │ 
 ├───────┼──────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤ 
│ NFR-3 │ Handle transient overload visibly.                       │ Implemented maximum admission wait: 15 seconds from handler entry or earlier cancellation. On expiry, return a    │
│       │                                                          │ retryable capacity error, never a wrong-code cooldown. This bounds application admission only. The 2-second    │
│       │                                                          │ p95 remains the local performance target and has not been met.                                                   │
 └───────┴──────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘ 
                                                                                                                                                                                         
 2. Core entities and invariants                                                                                                                                                         
                                                                                                                                                                                         
 - Code generation: Stored encrypted in sat_session_start_codes; generation changes on rotation.                                                                                         
 - Reservation slots: Implemented 200 durable slots for each schedule/code generation. Each slot is free, pending, or failed; migration 0081 backfills live reservations.
 - Attempt: Its accepted code/start state and module activation remain authoritative in the database.                                                                                    
 - Schedule runtime: One runtime and pinned plan per schedule, created through the existing start transaction.                                                                           
                                                                                                                                                                                         
 Invariants:                                                                                                                                                                             
                                                                                                                                                                                         
 1. There are exactly 200 usable budget slots per generation. Pending reservations and failed comparisons occupy slots; successful comparisons release them; expired pending             
    reservations fail conservatively.                                                                                                                                                    
 2. One attempt cannot hold multiple active reservations.                                                                                                                                
 3. A start is committed at most once; its first-module activation and runtime/pinned plan remain atomic with the accepted start.                                                        
 4. The start transaction rechecks the live code generation and exam window. A queued request cannot start after the authoritative window closes.                                        
 5. The timer starts at durable acceptance—not when the student clicks, and not while the server is waiting to admit the request.                                                        
                                                                                                                                                                                         
 3. API / interface changes                                                                                                                                                              
                                                                                                                                                                                         
 Keep the existing POST /api/v1/assessment-delivery/schedules/{scheduleID}/start-with-code contract, bearer authorization, and started/resume outcomes.                                  
                                                                                                                                                                                         
 - Keep START_CODE_BUSY distinct from invalid-code/cooldown errors.                                                                                                                      
 - Keep the current no-blind-retry behavior and authoritative recovery read after an uncertain outcome.                                                                                  
 - Update the waiting copy to say the exam is starting and the timer begins when it opens. Do not tell candidates to re-enter the code while their request is still pending.             
- Implemented tradeoff: allow a bounded wait up to 15 seconds for capacity, then return a retryable capacity response. This is not an exam timing extension: the start window is still checked at commit, and no module time elapses while waiting.
- Each valid, authorized start request that reaches `StartWithCode` and returns an HTTP response includes `Server-Timing`: total application admission wait plus start-worker, runtime-initializer, and slot-capacity waits. `Access-Control-Expose-Headers: Server-Timing` makes the header readable to browser clients.
- The 600-wave harness can print one synthetic `student_index` record per candidate. These values are only application queue waiting—not whole HTTP latency or DB-pool/SQL/network time. A transport reset has no response header and its queue wait is unavailable; no real student ID is added to metric labels or load logs.
                                                                                                                                                                                         
 4. Critical data flow                                                                                                                                                                   
                                                                                                                                                                                         
 1. Authenticate the attempt and validate the request as today.                                                                                                                          
 2. Admit the request through a bounded per-schedule in-process queue. Waiters hold no database connection. Start-work concurrency is capped below the configured DB pool capacity so    
    other exam/proctor work retains connections.                                                                                                                                         
 3. Claim one free/expired slot using an indexed row-level claim, such as FOR UPDATE SKIP LOCKED on the supported MySQL version. Do not lock one schedule-wide guard row for every       
    candidate.                                                                                                                                                                           
 4. Verify the code and settle the slot. Success releases the slot; mismatch consumes it for the active failure window. When slots are merely locked or pending, wait or report          
    capacity—do not report cooldown.                                                                                                                                                     
 5. Prepare the response from the pinned exam version and verify current access scope. In the start transaction, recheck authorization, generation, window, control epoch, and runtime   
    state; atomically commit accepted start, first-module activation/deadline, and the single schedule runtime/pinned plan.                                                              
 6. Return the prepared response after commit. If the acknowledgement is lost, the existing resume path recovers the committed start.                                                    
                                                                                                                                                                                         
 The scope/content refactor must preserve the current server-side authorization boundary; cached content alone must never authorize delivery.                                            
                                                                                                                                                                                         
 5. Recommended design and tradeoff                                                                                                                                                      
                                                                                                                                                                                         
 Use two separate controls:                                                                                                                                                              
                                                                                                                                                                                         
 - Durable correctness control: 200 MySQL-backed reservation slots per generation. This preserves the existing failed-plus-pending budget across retries, restarts, and instances.       
 - One-process resource control: bounded admission queue and active-work semaphore. This protects the 32-connection local test pool from a 600-request stampede; it is not the security  
   budget.                                                                                                                                                                               
                                                                                                                                                                                         
 Start tuning with no more than 24 concurrent start workers against a 32-connection pool, leaving connections for other work; benchmark and tune rather than hard-code this as a         
 production optimum. Keep the existing cap of 600 waiters per schedule. A process restart can drop in-memory waiters, but an already committed start remains recoverable from the        
 database.                                                                                                                                                                               
                                                                                                                                                                                         
 The proposed 15-second wait is a UX tradeoff, not a throughput fix or guaranteed SLO. Optimize toward the existing 2-second p95 gate; if the optimized one-instance profile still       
 misses it, report that honestly. Prefer a visible wait with the timer stopped over silently consuming exam time or weakening code protection.                                           
                                                                                                                                                                                         
 6. Production and failure-mode deep dives                                                                                                                                               
                                                                                                                                                                                         
 ┌───────────────────────┬─────────────────────────────────────────┬──────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────┐ 
 │ Risk                  │ Consequence                             │ Protection                                           │ Verification / residual risk                               │ 
 ├───────────────────────┼─────────────────────────────────────────┼──────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────┤ 
 │ Shared-row lock       │ Correct candidates serialize and miss   │ Independent durable slots; remove the guard row from │ Test concurrent slot claims on the production-supported    │ 
 │ contention            │ the burst target.                       │ the reservation hot path.                            │ MySQL version; SKIP LOCKED and query plans need            │ 
 │                       │                                         │                                                      │ validation.                                                │ 
 ├───────────────────────┼─────────────────────────────────────────┼──────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────┤ 
 │ DB pool overload      │ Queueing and transport failures despite │ Bounded admission; no connection held by queued      │ Tune against measured pool wait and lock metrics; current  │ 
 │                       │ one API process.                        │ requests; reserve pool capacity for other routes.    │ production pool size is unknown.                           │ 
 ├───────────────────────┼─────────────────────────────────────────┼──────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────┤ 
 │ Timer starts before   │ Candidate loses exam time during        │ Prepare authorized response data before start        │ Measure commit-to-response latency and verify rollback     │ 
 │ exam is ready         │ content/state assembly.                 │ commit; commit only after checks and preparation     │ exposes no content.                                        │ 
 │                       │                                         │ succeed.                                             │                                                            │ 
 ├───────────────────────┼─────────────────────────────────────────┼──────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────┤ 
 │ Code rotation races a │ Old code could start the wrong          │ Recheck generation in the start transaction; scope   │ Barrier test rotation between admission, comparison, and   │ 
 │ queued request        │ generation or be counted against the    │ slots to generation.                                 │ commit.                                                    │ 
 │                       │ new one.                                │                                                      │                                                            │ 
 ├───────────────────────┼─────────────────────────────────────────┼──────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────┤ 
 │ Duplicate starts or   │ Multiple start effects or runtimes for  │ Preserve existing transactional start/runtime        │ Two-request same-attempt test; 600 distinct attempts test; │ 
 │ runtime creation      │ one schedule.                           │ creation and attempt-level recovery.                 │ assert persisted rows.                                     │ 
 ├───────────────────────┼─────────────────────────────────────────┼──────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────┤ 
 │ Process crash / lost  │ Candidate may not know whether the      │ Existing authoritative recovery read; no automatic   │ Crash before and after commit; verify pre-commit requests  │ 
 │ ACK                   │ start committed.                        │ POST retry.                                          │ do not start and post-commit requests recover.             │ 
 ├───────────────────────┼─────────────────────────────────────────┼──────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────┤ 
 │ Rolling deployment    │ Old and new reservation algorithms      │ One-instance deploy: drain/stop old process before   │ Do not run mixed writers. Exact production deployment      │ 
 │ overlap               │ could each allocate budget.             │ enabling new algorithm; retain old tables during     │ process is unknown.                                        │ 
 │                       │                                         │ rollout.                                             │                                                            │ 
 └───────────────────────┴─────────────────────────────────────────┴──────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────┘ 
                                                                                                                                                                                         
 7. Ordered implementation phases                                                                                                                                                        
                                                                                                                                                                                         
 ┌─────────────────┬──────────────────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────┬────────────────────────────────────┐ 
 │ Phase           │ Files / components                                       │ Specific change                                                   │ Done when                          │ 
 ├─────────────────┼──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────┼────────────────────────────────────┤ 
 │ 1. Schema       │ Implemented                                              │ Add 200 slots per schedule/generation; backfill current pending   │ Migration is repeatable and        │
 │                 │ backend/go/migrations/0081_sat_start_code_reservation_s │ and in-window failed reservations; enforce one active slot per    │ invariant queries pass on the      │
 │                 │ lots.sql; backend/go/internal/platform/db/schema.go     │ attempt. Fail migration if existing data cannot fit the budget.   │ target MySQL version.              │
 ├─────────────────┼──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────┼────────────────────────────────────┤ 
 │ 2. Code         │ backend/go/internal/satstartcode/satstartcode.go         │ Seed slots on code creation and new generations on rotation in    │ No generation is usable without    │ 
 │ creation and    │                                                          │ the same transaction as the code change.                          │ its budget slots.                  │ 
 │ rotation        │                                                          │                                                                   │                                    │ 
 ├─────────────────┼──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────┼────────────────────────────────────┤ 
 │ 3. Admission    │ backend/go/internal/delivery/sat_code_entry.go;          │ Replace schedule-wide reservation locking with independent slot   │ Slot and start concurrency tests   │ 
 │ path            │ backend/go/internal/delivery/sat_start_code_admission.go │ claims; add bounded active-start work and bounded wait. Preserve  │ pass; no false cooldown from       │ 
 │                 │                                                          │ all transaction rechecks and failure-budget semantics.            │ pending saturation.                │ 
 ├─────────────────┼──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────┼────────────────────────────────────┤ 
 │ 4. Ready        │ backend/go/internal/delivery/sat_code_entry.go and       │ Prepare authorized section/state before committing the start;     │ Response content matches the       │ 
 │ response        │ entryStateBound path                                     │ return immediately after commit.                                  │ pinned plan; timer begins only on  │ 
 │                 │                                                          │                                                                   │ commit; rollback returns no        │ 
 │                 │                                                          │                                                                   │ content.                           │ 
 ├─────────────────┼──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────┼────────────────────────────────────┤ 
 │ 5. Candidate    │ src/features/student-delivery/ui/transitions/SatStartCod │ Make the waiting state clear; keep capacity errors separate from  │ UI test confirms pending request   │ 
 │ feedback        │ eScreen.tsx;                                             │ invalid-code cooldown; preserve uncertain-outcome recovery.       │ cannot be resubmitted and capacity │ 
 │                 │ src/features/student-delivery/application/satStartCode.t │                                                                   │ is not shown as a wrong code.      │ 
 │                 │ s                                                        │                                                                   │                                    │ 
 └─────────────────┴──────────────────────────────────────────────────────────┴───────────────────────────────────────────────────────────────────┴────────────────────────────────────┘ 
                                                                                                                                                                                         
 8. Test matrix                                                                                                                                                                          
                                                                                                                                                                                         
 ┌───────┬──────────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────┬─────────────────┬───────────┐ 
 │ Case  │ Setup / stimulus                                             │ Expected outcome                                                               │ Level           │ Coverage  │ 
 ├───────┼──────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼─────────────────┼───────────┤ 
 │ TC-1  │ 600 correct starts against cold runtime.                     │ All valid starts recoverable; one runtime and pinned plan; no duplicate        │ MySQL HTTP/load │ FR-1,     │ 
 │       │                                                              │ attempt starts.                                                                │                 │ FR-4      │ 
 ├───────┼──────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼─────────────────┼───────────┤ 
 │ TC-2  │ Repeat TC-1 with warm runtime/content cache.                 │ Same invariants; p95/drain recorded separately.                                │ MySQL HTTP/load │ NFR-1     │ 
 ├───────┼──────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼─────────────────┼───────────┤ 
 │ TC-3  │ 200 failed/pending budget slots; request 201.                │ True exhaustion returns cooldown; pending-only saturation waits or returns     │ MySQL           │ FR-2      │ 
 │       │                                                              │ capacity.                                                                      │ integration     │           │ 
 ├───────┼──────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼─────────────────┼───────────┤ 
 │ TC-4  │ Concurrently claim slots with barriers.                      │ No duplicate slot/attempt claims; pending plus failed never exceeds 200.       │ MySQL           │ FR-2      │ 
 │       │                                                              │                                                                                │ concurrency     │           │ 
 ├───────┼──────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼─────────────────┼───────────┤ 
 │ TC-5  │ Rotate code during a queued request.                         │ Old-generation request cannot start under new generation or consume its        │ MySQL           │ FR-2,     │ 
 │       │                                                              │ budget.                                                                        │ concurrency     │ FR-4      │ 
 ├───────┼──────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼─────────────────┼───────────┤ 
 │ TC-6  │ Close start window while request waits.                      │ Commit rejects; no start/runtime/module activation; no exam time consumed.     │ MySQL           │ FR-1,     │ 
 │       │                                                              │                                                                                │ concurrency     │ FR-3      │ 
 ├───────┼──────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼─────────────────┼───────────┤ 
 │ TC-7  │ Crash before commit, after commit, and before response.      │ Pre-commit state remains unstarted; post-commit state is recovered as resume.  │ Integration     │ FR-1,     │ 
 │       │                                                              │                                                                                │                 │ FR-3      │ 
 ├───────┼──────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼─────────────────┼───────────┤ 
 │ TC-8  │ Candidate attempt is unauthorized or current scope excludes  │ Start/content is rejected; no unselected content is returned.                  │ API integration │ FR-4      │ 
 │       │ content.                                                     │                                                                                │                 │           │ 
 ├───────┼──────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼─────────────────┼───────────┤ 
 │ TC-9  │ Simultaneous first starts for distinct attempts.             │ One runtime/pinned plan, all eligible attempts have correct module activation. │ MySQL           │ FR-1      │ 
 │       │                                                              │                                                                                │ concurrency     │           │ 
 ├───────┼──────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼─────────────────┼───────────┤ 
 │ TC-10 │ Six cold and warm 600-candidate waves on MySQL 8.4 with one  │ Zero correctness violations; report p95, drain, errors, pool waits, row locks, │ Load            │ NFR-1–3   │ 
 │       │ API process.                                                 │ and queue time.                                                                │                 │           │ 
 └───────┴──────────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────┴─────────────────┴───────────┘ 
                                                                                                                                                                                         
 Local verification results (2026-10-10):

 - Passed: `go test ./... -count=1` (MySQL-gated suites skipped because `TEST_MYSQL_DSN` was unset); frontend start-code tests (11 tests) and `npm run typecheck`; focused MySQL start-code tests covering concurrent starts, reservation expiry/budget, rotation, 200-slot inventory, and no timer activation while capacity-waiting.
 - Passed: migrations 0001–0081 on a fresh local MySQL 9.6 schema. Production MySQL 8.4 was not available.
- Failed: the earlier cold 600-request HTTP wave committed 592 starts; 8 requests ended in TCP transport resets before handler metrics, p95 was 10.160s and drain 10.741s.
- Additional individual-wait cold wave on fresh local schema migrated through 0081: 560 HTTP responses / 40 resets; 560 accepted/started, one runtime. Whole-wave-request p95 6.942s / drain 7.041s; per-response admission-wait p95 6.671s (560 samples).
- Additional warm wave: 368 HTTP responses / 232 resets; 369 accepted/started including one setup start, one runtime. Whole-wave p95 4.944s / drain 5.003s; per-response admission-wait p95 4.687s (368 samples). Both miss the 2-second target; reset requests have no individual queue value.
                                                                                                                                                                                         
 9. Rollout and recovery                                                                                                                                                                 
                                                                                                                                                                                         
 - Deploy only when no active exam depends on the start path. Drain the single API process, apply the additive migration/backfill, verify the 200-slot invariant, then start the new     
   version.                                                                                                                                                                              
 - Do not let old and new reservation writers run simultaneously. Keep the existing guard/reservation tables for rollback and reconciliation; remove obsolete data only after the new    
   path is stable.                                                                                                                                                                       
 - Watch start p50/p95/p99, admission wait, START_CODE_BUSY, code cooldowns, slot occupancy/expiry, MySQL pool wait, row-lock time, duplicate starts, runtime count, and                 
   commit-to-response delay.                                                                                                                                                             
 - If slot claims or invariant checks fail, stop the new writer and restore the old version while preserving reservation records. Performance may regress on rollback; correctness must  
   not.                                                                                                                                                                                  
 - Validate on the actual supported production MySQL version and deployment settings before claiming production readiness.                                                               
                                                                                                                                                                                         
 10. Open decisions and final gap review                                                                                                                                                 
                                                                                                                                                                                         
- Admission deadline: implementation allows at most 15 seconds from handler entry or earlier request cancellation for application admission only. It does not limit full request time or an already-admitted transaction. The measured individual waits in the two new waves are not a uniform 9 seconds; the returned cold requests had p95 6.671s/max 6.897s, while warm requests had p95 4.687s/max 4.919s. No-response candidates remain unmeasured.
- Production state: deployed MySQL version, pool configuration, API instance count, ingress connection/backlog behavior, and rollout settings are UNKNOWN. The local 600-wave transport resets require diagnosis on an approved production-equivalent path.
- Formal status: abstract Lean theorems were kernel-checked; `workerBound_transition` proves only the modeled aggregate worker count stays under its modeled limit. There is no Lean proof of Go/SQL refinement, elapsed-time limit, fairness, or production behavior.
- Correspondence status: REVIEWED_WITH_TESTS for the exercised local Go/MySQL 9.6 paths; UNVERIFIED for production environment/ingress and mechanized refinement.
- Production evidence: PARTIAL locally; NOT_TESTED in production.
- Verdict: implementation checks tested reservation/start invariants and observed attempts/modules remain unstarted while admission waits. Production readiness is BLOCKED: both new local 600 waves failed the existing p95 <2s latency gate and had transport resets, and production environment evidence is unavailable.
