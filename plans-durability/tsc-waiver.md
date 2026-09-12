## tsc-full waiver (Phase 02 → Phase 04 gate) — SIGNED, rung-1 GREEN

- Owner: L0 durability-lane orchestrator · Date: 2026-09-11 · HEAD: 61a6dbe (node v26.0.0, tsc 5.8.3)
- Claim: tsc FULL is WAIVED (toolchain-issue, not code-issue). The durability lane is type-clean under project-mode alias resolution. Full-program green is blocked by (a) OOM when the untracked 1.9G deepseek-harness/ checkout is in the program, and (b) 23 pre-existing SAT-UI type errors on committed HEAD without it — both outside this lane.
- Dirty-tree caveat: worktree carries uncommitted SAT-UI-branch work (engine 2298 lines vs HEAD 1261; untracked useResponseDurabilityStatus.ts + e2e/student-durability.spec.ts). Lane errors below are worktree-scoped; HEAD lane is clean.
- L0 disposition (2026-09-11): fixed the 2 dirty-tree lane TS2375 errors in src/shared/durability/DurableResponseEngine.ts (exactOptionalPropertyTypes — never assign explicit undefined to optional): (1) :1004-1018 readTombstone builds the object then conditionally sets originLeaseEpoch; (2) :1887-1901 reconcile pending built without receivedAt/order, conditionally carried from live. Behavior-identical (values only present when defined — same runtime shape as before). Vitest durability 54/54 still green post-fix.
- Scoped-clean evidence (rung-1 GREEN post-fix):
  - rung 1 project-mode lane scope (/tmp/tsc-phase02/tsc-lane-rerun.json, absolute includes, extends root tsconfig): exit=2 with ONLY src/shared/error/errorTypes.ts(18,11) TS2339 captureStackTrace — PRE-EXISTING per docs/sat-hardening.md:40-42. ZERO errors in DurableResponseEngine.ts, types.ts, useResponseDurabilityStatus.ts, StudentAttemptProvider.tsx.
  - rung 1b spec proper-flags (Phase 02 evidence): exit 0 empty output.
  - rung 1 HEAD-tree lane scope (Phase 02 evidence): ZERO lane errors, same single pre-existing artifact.
- Failure evidence (full program):
  - dirty-tree --listFilesOnly: exit 134 OOM signature-O (~50s, heap 2036.7MB default) — log /tmp/tsc-phase02/census.err.
  - HEAD-tree full --incremental (/tmp tsbuildinfo, 4096MB): exit 2, 23 errors ALL in src/features/student-delivery/** (out-of-lane SAT-UI), ZERO lane errors, 39s, no OOM — log /tmp/tsc-phase02/head-rung2.log.
  - scope-B full minus harness: exit 2 (2 lane TS2375 now FIXED + 1 SAT error), 29s, no OOM — log /tmp/tsc-phase02/scopeB-full.log.
- History: default-heap OOM + larger-heap internal crash (prior rounds); 4GB-heap V8 OOM ~470s (V1 round).
- Follow-up (NOT this lane): root tsconfig include/exclude hardening for the untracked deepseek-harness/ checkout, with error-parity proof; plus SAT-UI 23-error cleanup on their branch.
- Lane-freeze statement: no further lane type work in Phase 02 scope; any new lane type error → lane owner, then rung-1 re-run (~1 min).
