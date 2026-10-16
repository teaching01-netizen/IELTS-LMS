# Proof report: SAT session continuity and answer retention

## Verdict
| Field | Status |
|---|---|
| Formal status | **PROVED**: all 12 audited theorems in `proof/SatSessionContinuity.lean`, kernel-checked; no `sorry`, no custom axioms, no `native_decide`. |
| Correspondence status | **REVIEWED_WITH_TESTS**: Go and TypeScript code are not mechanically linked to the model. Each model step is mapped to code and to a passing test in TRACEABILITY.md. |
| Production evidence | **PARTIAL**: the fix was reproduced locally with real expiry (1-min idle, 1-min bearer): before the fix there was a 401 storm and failed saves; after it, both students reached "SAT Complete". No production sitting longer than 60 min has been observed since deploy `71fab6d6`. |

## Reproduce
```
cd verification/lean/sat-session-continuity
lake build                                        # evidence/lean-build.txt
lake env lean proof/SatSessionContinuity.lean     # evidence/axiom-audit.txt
lake env lean --run Replay.lean Model Continuity Counterexamples Retention   # evidence/kernel-replay.txt
```
Toolchain `leanprover/lean4:v4.19.0` (hash in `evidence/environment.json`), no Mathlib.

## Axiom audit
Theorems use only `propext` and `Quot.sound` (Lean core). `fixed_policy_serves_three_hours` and `old_policy_fails_three_hours` use no axioms; they are plain kernel `decide` computations. The independent replay re-checked all theorems of all 4 modules (25 + 31 + 19 + 29) and rejected a forged proof of `False`.

## What was proved
- **Continuity (fixed policy).** `active_student_always_served`: from entry, if requests are at most `gap` apart, `touch + gap < idle`, `0 < ttl` and every request is before the absolute deadline, then each request is authenticated on arrival and each delivery call is accepted. Inductive invariant `Inv`: not revoked; cookie expiry = absolute deadline; idle deadline = last touch + idle; `now ≤ lastTouch + touch`. `prod_active_student_always_served` instantiates it for prod with gap = 300 s.
- **Counterexamples (old policy).** `idleBound_cookie_frozen` (cookie never re-sent), `idleBound_logs_out_active_student` (unauthenticated from entry + idle), `idleBound_token_bounded`, and `idleBound_rejects_saves`: every delivery call from entry + min(abs, idle) + ttl on is rejected, for **every** activity pattern. Prod: 75 min. Incident check: student "My" entered 10:15:10; the last accepted save was 11:20:27 (65 min, within the 75-min bound); module 2 close failed at 11:26.
- **Differential witness.** The same concrete 3-hour, every-5-minutes trace is fully served under the fix (`fixed_policy_serves_three_hours`) and not served before it (`old_policy_fails_three_hours`). The general theorem gives the same result for that trace.
- **Retention.** `answer_never_silently_lost` (G3), `saved_answer_scored` (G4), `answer_accounted` (G5), plus the invariant `Good` (ACK truthful, snapshot exact after close, quarantine only after close, evidence only from quarantine).

## Anti-vacuity review
1. **Hypotheses are satisfiable.** `everyFiveMinutes_active` and the prod instance discharge every hypothesis by `decide`.
2. **The model can express the failure.** Same model, old policy → proven failure (G2). The continuity theorem is not true of every policy.
3. **Retention is not trivial.** `nonvacuous_trace` reaches a closed module with a scored ACKed answer, a scored lost-ACK answer and a quarantined late answer. `wipe_breaks_retention` shows G3 fails exactly when storage wiping is allowed (M6).
4. **Lean corrected my first drafts.**
   - The first continuity draft also assumed `gap ≤ refresh window`. Lean flagged that hypothesis as unused: the bearer is renewed at request time through the cookie, so its TTL never bounds the gap. Removed, which makes the theorem stronger.
   - The first retention draft claimed "a server row is never quarantined". That is false (lost ACK, then module close), so the invariant was dropped and G5 restated as "scored OR on device".
5. **The test can detect the bug.** The new engine test fails when `ATTEMPT_TOKEN_EXPIRED` is made terminal ("expected 5 calls, got 1"); the mutation was reverted.

## Implementation findings
| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | Student cookie Max-Age bound by idle (60 min) and never re-sent, so every sitting longer than 75 min breaks (G2). | Critical | **Fixed** `bc87947a`, `71fab6d6` (pushed) |
| F2 | Auth failures (401) on saves are non-terminal: answers stay pending and retry. Correct, but no test protected it. | Guard missing | **Test added** (`DurableResponseEngine.test.ts`) |
| F3 | Re-entry from a different device or cleared storage → 409 "Wcode … already registered" (`schedules/service.go:1228`). No self-service or staff path to recover. Open links instead silently start a new attempt. | High (recovery) | Open; RECOMMENDATIONS R1 |
| F4 | The session GET + bootstrap retry after 401 repeats about every 2.7 s with no backoff (measured 80 req/min per stuck student). | Medium (load) | Open; R2 |
| F5 | Lost ACK followed by close → answer is both scored and kept as late evidence (duplicate). | Low (proctor UX) | Documented; R3 |
| F6 | (Outside the Lean model.) Prod worker log, 15 Oct: `RunGradingProjection` failed every 5 s with FK 1452 on `section_submissions`. A `student_submissions` row already existed for an IELTS attempt under another `provider_key`. The projection looked the row up by provider, missed it, and wrote sections under an id that was never stored. One bad attempt aborts the whole batch and the cursor never advances, so **no later IELTS submission reached grading**. | High (IELTS grading) | **Fixed** `grading/projection.go` `ensureProjectionSubmission` (look up by `attempt_id`, relabel to `ielts`, return the stored id); real-MySQL regression `integration/ielts_projection_foreign_row_test.go`, which reproduced the exact prod error before the fix |

## Tests run (exact output in evidence/)
- `go test ./cmd/api -run 'TestStudentSessionCookiesOutliveTheIdleWindow|TestAuthMiddlewareRefreshesLiveStudentCookieToAbsoluteDeadline|…Liveness'`: PASS (`go-tests.txt`).
- `vitest` `assessmentDeliveryApi.test.ts` + `src/shared/durability`: 8 files, 126 tests passed (`vitest.txt`).
