# SAT Hardening Baseline (Phase 0)

Recorded 2026-09-10 before Chains 1-10. Commands re-run must match or improve.

- `pnpm typecheck` (`tsc --noEmit`): PASS, no output.
- `pnpm lint` (`eslint .`): PASS, no output.
- `pnpm vitest run src/products/sat src/features/exam-authoring/ui`: **51 files / 219 tests, all pass** (13.9s).
- Wall-clock-sensitive: `src/shared/hooks/useAuthoritativeDeadlineClock.ts` (shared 1s tick), room tests.
- Known dead behavior pinned by tests (to change in Chain 1): `sat-row-enter` stagger,
  `sat-live-dot` pulse, `sat-skeleton-shimmer`, segmented `sat-segmented-thumb`.
