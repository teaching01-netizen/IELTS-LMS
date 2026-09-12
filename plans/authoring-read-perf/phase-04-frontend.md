# Phase 04 — Frontend Lifecycle (GET for refresh, explicit open)

## 1. Objective
Stop paying a write-Tx + exam FOR UPDATE on every shell refresh: use GET /shell for reads, reserve POST /shell for explicit draft-open, and keep React Query cache coherent with backend revisions — with zero visual/contract regression.

Depends on: Phase 03 (backend GET/POST semantics stable + verified). Blocks: Phase 05 sign-off.

## 2. Current system (confirmed)
- src/features/exam-authoring/api/assessmentQueries.ts:24-29: useAuthoringShell queryFn calls assessmentAuthoringApi.openShell (POST) with staleTime 30s.
- assessmentAuthoringApi.ts exposes getShell (GET) and openShell (POST); gateway unwraps envelope; ApiClient baseURL /api.
- Mutations invalidate shell/readiness/release keys (assessmentQueries.ts:55-100+); batch path does setQueryData + invalidate refetchType none.
- Consumers: AuthoringWorkspace, SatAuthoringRoute, SatWorkbookImportSheet (verify full consumer list at implementation).

## 3. Behavioral contract
- Entering authoring with no draft: explicit user-visible open action (or single mount-time ensure) creates draft once; success installs shell in cache.
- Refresh/remount/focus: GET only; no clone side effects; no extra POST storms.
- After any mutation (create/batch/duplicate/reorder/save-revision/delivery-settings/commit/undo/sample): UI shows fresh revision without manual reload; optimistic updates (where present) reconcile with server revision.
- Error surfaces unchanged: 404 no-draft (offer open), 409 conflict (refresh prompt), 403 (no access).

## 4. Acceptance linkage
Supports AT-06 (open once), AT-07 (fewer write-Tx), guards AT-01 (same tree rendered). Adds frontend-specific: FT-01 no POST on refetch; FT-02 single ensure per mount; FT-03 mutation-then-read coherence.

## 5. Design decisions
- Decision: keep useAuthoringShell queryKey ['assessment', examId, 'shell']; change queryFn to getShell; add explicit useEnsureDraftShell mutation for the open action.
  - Reason: minimal churn, existing invalidations keep working. Rejected: new key family (would orphan existing invalidations).
- Decision: mount-time ensure, not render-time POST: route/component calls ensure-mutation once when shell query reports 404/no-draft AND user intends to edit; observers (read-only) never trigger it.
  - Reason: prevents observer-triggered write Tx + 403 noise. Rejected: unconditional GET-then-POST on every mount (adds latency, defeats Phase 03).
- Decision: no new global store; React Query remains source of truth for shell. Rejected: parallel shell cache (sync bugs).

## 6. Detailed TODOs
### 6.1 Query layer
- [ ] 4.1 Change useAuthoringShell queryFn to getShell(examId); set staleTime/gcTime deliberately (keep 30s stale unless Phase-03 cache changes guidance); ensure refetchOnWindowFocus does not POST (it will GET after change — confirm desired focus behavior with product; default: keep current focus setting, only change transport).
  - Location: src/features/exam-authoring/api/assessmentQueries.ts. Depends: Phase 03 done. Verify: network spy test — mount + refetch emits GET only.
- [ ] 4.2 Add useEnsureDraftShell(examId): mutationFn openShell; onSuccess setQueryData(shell key) + invalidate readiness/release; onError map 409/404 to UI states.
- [ ] 4.3 Audit all openShell call sites (grep assessmentAuthoringApi.openShell): replace incidental reads with useAuthoringShell; leave only explicit ensure flows.
### 6.2 UI flows
- [ ] 4.4 SatAuthoringRoute/AuthoringWorkspace: implement no-draft empty state (Open draft button -> ensure mutation, disabled while pending, single-flight guard via mutation isPending).
- [ ] 4.5 Role-gate: observer/preview-only view never renders Open action and never calls ensure (verify with role matrix test).
- [ ] 4.6 Keep mutation invalidations as-is unless a specific double-fetch is proven; do not "optimize" by removing invalidations in this phase (correctness first).
### 6.3 Coherence
- [ ] 4.7 Verify versionRevision-driven refetch: after mutations, shell key invalidated; readiness keyed (examId, versionId, versionRevision) refetches on new revision (check readiness key usage — verify before changing).
- [ ] 4.8 Handle 404-during-editing (draft deleted/undone elsewhere): show recover CTA, do not loop ensure.

## 7. File-by-file plan
- CHANGE src/features/exam-authoring/api/assessmentQueries.ts (queryFn + new mutation hook).
- CHANGE route/component owning the no-draft state (verify: SatAuthoringRoute.tsx and/or AuthoringWorkspace.tsx).
- VERIFY: assessmentAuthoringApi.ts (no change expected), SatWorkbookImportSheet (commit flow already handles shell update via onCommitted — verify, don't duplicate), release/readiness queries, tests in api/__tests__/assessmentAuthoringApi.test.ts + any query tests.
- ADD: hook-level test (GET-only refetch, single ensure, observer never-ensures).

## 8. State lifecycle
React Query shell key: mount -> GET -> render; 404-no-draft -> CTA -> ensure POST -> setQueryData -> render; mutation -> invalidate -> GET fresh revision. No duplicated shell state.

## 9. Error/edge matrix
| Condition | Expected | Handling |
| Observer opens authoring | read-only shell, no Open CTA, no POST | role gate |
| Builder, no draft | CTA -> POST creates -> shell renders | ensure mutation |
| Concurrent open by two tabs | one 200 + one 200-or-409; UI ends on fresh GET | 409 -> invalidate + GET |
| Draft deleted mid-edit | save surfaces conflict; shell shows recover CTA | no auto-loop |
| Offline/retry | GET retries per ApiClient policy; POST ensure not auto-retried blindly | mutation retry off for ensure |

## 10. Compatibility
- No API change. Old cached shells shape-identical. No migration. Feature-flag: not required (small, revertible); if team wants safety, gate ensure-CTA behind existing role checks only.

## 11. Test strategy
- Unit/hook: queryFn transport spy; ensure single-flight; observer gate. Integration (msw/mock): 404->CTA->POST->GET flow; 409->recover. Regression: existing exam-authoring UI tests. E2E (if harness exists): author opens draft once, refreshes without POST.

## 12. Observability
- Reuse existing ApiClient error logging; add mutation error mapping to user messages (no new analytics). Verify no POST-shell-per-refresh in staging via request logs.

## 13. Rollout/rollback
- Ships with Phase-03 backend (compatible either way: GET works pre- and post-optimization). Rollback = revert frontend commit; backend unaffected.

## 14. Definition of done
- [ ] Zero POST /shell on refresh/refetch/focus in tests + staging HAR.
- [ ] Explicit open flow works for admin/builder, hidden for observer.
- [ ] Mutation coherence verified (no stale shell after save/commit/undo).
- [ ] Existing frontend tests green.
