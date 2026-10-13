# Production test plan and execution record

## Executed in this working-tree snapshot

| Case | Evidence | Result |
| --- | --- | --- |
| POST receipt with failing or indefinitely pending release projection refresh | `src/features/exam-authoring/api/__tests__/publishMutationReceipt.test.tsx` | Passed in targeted Vitest run; mutation result is returned independently of read projection. |
| Parent sheet identity through draft-shell removal; receipt and exact room target | `src/features/exam-authoring/ui/__tests__/AuthoringWorkspace.test.tsx` | Passed; mount identity and exact target assertions. |
| Published direct URL/reload does not open a draft; explicit edit opens one | `src/features/exam-authoring/ui/__tests__/AuthoringWorkspaceNoDraft.test.tsx` | Passed. |
| Invalid or unverified publish result does not become success | `publishMutationReceipt.test.tsx`, `ExamPublishSheet.test.tsx` | Passed. |
| Real Chromium publish → shell removal → success → Done → reload → Create room, with focus and axe checks | `e2e/sat-authoring-lifecycle.spec.ts`, `playwright.sat-authoring.config.ts` | Six authoring browser tests passed; the lifecycle case asserts exact version ID/number/scope, no draft POST after reload, restored focus, axe checks, and no page/console errors. |
| Shared release route and settings consumer compatibility | `SatDeliveryReleaseRoute.test.tsx`, `ExamSettingsPage.test.tsx` | Passed: 11 release-route tests and 10 settings-page tests in the focused run. |
| Full repository unit suite | `bun run test:run -- --silent` | Follow-up passed: 783 files; 6,656 passed; 2 skipped; transcript in `evidence/unit-suite.txt`. |
| TypeScript and production bundle | `bun run typecheck`, `bun run build` | Both passed on the current application changes. |
| Changed application-file lint and whitespace | Changed-file `bunx eslint`; `git diff --check` | 0 lint errors/warnings; diff check passed. |
| Pinned Lean build and axiom audit | `lake build ... && lake env lean AxiomAudit.lean` | Exit 0; see `PROOF_REPORT.md`. |

The new browser lifecycle tests use controlled/mock API behavior. Follow-up real-MySQL tests exercise the existing publication/replay/revision and concurrent draft-open paths separately; they do not connect that database to the browser scenario. See `PROOF_REPORT.md` for the precise local DB profile and transcripts.

Follow-up parent regressions also verify shell-read errors remain visible despite stale published metadata, and pending local question data remains exportable with visible copy feedback after the shell becomes NO_DRAFT. This is partial R6 evidence; it does not replace the live two-context co-edit scenario below.

## Not yet run / required before a production claim

| Case | Required setup and oracle |
| --- | --- |
| R6 remote publish while another tab has dirty edits | Two real browser contexts and the collaboration API; publish remotely, then verify the recovery payload remains readable and every write to the sealed version is rejected/fenced. |
| Commit then drop acknowledgment and retry | Retained-key service replay passed on isolated migrated MySQL. Actual dropped HTTP acknowledgment through a fault proxy remains untested; reuse the identical operation key and payload and inspect the persisted result/event/version/pointers. |
| Crash before commit / after commit before response | Isolated DB and restartable API process; inspect all durable publication rows and operation ledger after restart. |
| Publish/open contention across multiple API instances | At least two API processes against one isolated DB; use barriers and inspect duplicate effects, draft clones, conflicts, lock waits, and timeout behavior. |
| Actual release/settings HTTP compatibility and permission cases | Run API/client contract suites against the supported deployment version skew and author roles. |
| Capacity | Agree a workload and SLO first; then report p50/p95/p99, errors, timeouts, DB lock waits, pool saturation, and invariant violations. No capacity target is currently defined. |
| Manual accessibility | Screen-reader walkthrough, actual 200% browser text zoom/magnification, visible-focus and focus-obscuration review, and manual contrast across full workflows. |

Do not use production for fault injection. Database tests require an isolated migrated test DB; a skipped test is not evidence of success. The prior disposable-MySQL SAT journeys in `docs/specs/sat-staff-ux-ui-verification.md` cover separate room/session flows and do not substitute for these post-publish fault cases.
