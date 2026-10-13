# Recommendations

## P0 — close production correctness blockers

1. **Verify the actual DB and migration state before enabling classroom creation.** Confirm 0084 and 0086 are applied and both plan/policy triggers are present. If production is TiDB or any engine that skips these triggers, keep creation disabled during mixed-version rollout and add an equivalent enforced fence or complete the binary rollout first.
2. **Complete the attempt-writer lock audit.** Trace every response, route, module-attempt, close, reconcile, terminalization, and repair writer through all callers. Prove the shared attempt lock is acquired before dependent reads/writes; add tests for any bypass. Current A-LOCK1 evidence is insufficient for an end-to-end claim.
3. **Pin the verified source state.** The repository was dirty at review start. Commit or record a clean source snapshot and hashes for the Go/SQL/Lean inputs before release sign-off.

## P1 — resolve behavioral and coverage gaps

4. **Make answer cutoff wording explicit in docs/sat_newmode.md.** Confirm whether the authoritative boundary is server commit ordered against close or a stricter deadline. Do not promise browser-click-before-zero. Then force the exact save/close interleaving against the production DB.
5. **Extend the formal model to multiple sections per attempt.** Prove that global seal requires every declared section to satisfy the appropriate standalone or M1-plus-branch sequence. Current t5_sealed_gate is section-local.
6. **Expand end-to-end plan coverage.** Exercise each of full adaptive, M1+Easy, M1+Hard, M2-only Easy, and M2-only Hard across both SAT sections and narrowed scopes, including malformed/duplicate/orphan rows.
7. **Verify HTTP authorization and result privacy.** Test anonymous/student/wrong-schedule staff route requests and inspect the student completion JSON for leakage of terminalization evidence or unopened content.
8. **Exercise crash/retry/repair boundaries.** Drop ACKs after commit, kill processes at transaction/result boundaries, and verify replay and score repair against persisted state.

## P2 — establish operational limits

9. **Run multi-instance production-like load and soak tests** with actual database settings, retries, connection pools, and reconciler traffic. Define and report SLO-based pass criteria.
10. **Add an independent Lean checker in CI** if required by the assurance bar; the pinned local toolchain does not ship leanchecker.
