# Phase 04 to Phase 05 Handoff Note (Main Agent verification)

Gate result: Phase 04 PASSED. Independently verified by the Main Agent.

## Verified evidence

- Transport: `openShell` has exactly 2 src hits — ensure mutationFn (assessmentQueries.ts:73) plus API definition (:49). Zero incidental readers. SatDeliveryReleaseRoute (read-only consumer) now GETs: strictly safer.
- Query change is transport-only: same queryKey, same 30s staleTime (extracted to constant, value unchanged). New useEnsureDraftShell: POST, retry:false, setQueryData plus readiness/release invalidation, caller-owned errors.
- No-draft branch is distinct from the generic error surface: title "No editable draft", CTA only for admin/builder, disabled while pending with early-return guard, mapped failure copy, no auto-loop or auto-retry.
- Role path verified in code: useOptionalAuthSession session.user.role, AuthUserRole admin|builder|proctor|grader|student; router corroborates admin/builder-only routes.
- New tests: authoringShellLifecycle (6/6: FT-01/02/03/04a/04b plus classifier) and AuthoringWorkspaceNoDraft (6/6), each green twice consecutively.
- Existing suites: AuthoringWorkspace, SpineOverlays, SatDeliveryReleaseRoute, assessmentAuthoringApi — 31/31 green.
- eslint clean on all changed files. tsc: zero errors in changed files; only 4 pre-existing errors in untouched files (QuestionQueueRail, satBootstrapEquality, SatSessionsRoute).
- Deliberate deviation accepted: CTA-only, no mount-time auto-ensure. Zero POSTs without an explicit click — strictly satisfies explicit-open and FT-02/FT-03.

## Notes for Phase 05

1. One transient coupled-run failure (1 failed / 11 passed) passed on immediate rerun and twice consecutively afterward — noted, not gating. Watch for it in the soak.
2. Broader exam-authoring scope shows many pre-existing M/?? files from other sessions — Phase 05 must distinguish our 7 files from that noise.
3. Frontend/backend contract: response shape byte-identical through Phases 03-04; readiness keyed (examId, versionId, versionRevision) preserves version-driven refetch.
