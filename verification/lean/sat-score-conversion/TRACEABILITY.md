# Traceability

Statuses are separate. **Formal**: PROVED = kernel-checked in `Safety.lean`/`Counterexamples.lean`
(axioms: propext, Classical.choice, Quot.sound only). **Correspondence**: REVIEWED_WITH_TESTS = the
Go/SQL was read against the model and tests exercise it; there is no mechanized refinement.

| Guarantee | Theorem(s) | Code / SQL | Test | Formal | Correspondence |
| --- | --- | --- | --- | --- | --- |
| G-1 immutable | `published_immutable` | `0087` triggers; `SaveDraft`/`Publish` `WHERE status='draft'` | `TestPublishedRevisionIsImmutableAndAuditAppendOnly` | PROVED | REVIEWED_WITH_TESTS (TiDB: app guard only) |
| G-2 latest/unique numbers | `Reach.inv` (`pub_num`, `pub_inj`, `active_some`), `active_is_latest` | `Publish`: `MAX+1` under the pointer lock; `uq_…revision_number` | `TestPublishIdempotentMonotonicAndRestore` | PROVED | REVIEWED_WITH_TESTS |
| G-3 one chain / stale base | `no_fork`, `publish_requires_active_base`, `superseded_publish_is_rejected`; counterexample `naive_publish_forks` | `Publish` base check; pointer `FOR UPDATE` | `TestConcurrentPublishOnSameBaseOneWins` (+30× race soak), handler `STALE_BASE` | PROVED (model) | REVIEWED_WITH_TESTS; lock is obligation A-LOCK |
| G-4 published ⇒ valid | `published_is_publishable`, `publishable_resolves` | `Content.PublishIssues` in `Publish` | `TestPublishRequiresCompleteContentAndCalibration`, `TestContentValidate*` | PROVED (vs abstract `Publishable`) | REVIEWED_WITH_TESTS |
| G-5 no invented score | `resolve_sound`, `resolve_none_of_no_table`, `display_no_invention` | `Content.Resolve`, `satscoring.ApplyRevision` | `TestContentResolveFailsClosed`, `TestOverlayNeverInventsAScore` | PROVED | REVIEWED_WITH_TESTS |
| G-6 retroactive | `display_after_publish`, `display_depends_on_raw_only`, `witness_display_changes` | `sat.LoadResultForAttempt`, `results.GetSATResult` → `satscoring.Overlay` | `TestOverlayAppliesActivePolicyRetroactively…`, `TestSATGlobalScoreConversionIsRetroactiveMySQL` | PROVED | REVIEWED_WITH_TESTS |
| G-7 withheld / no policy | `display_withheld`, `display_released_only`, `display_without_policy` | `Overlay` no-ops without `classroomRaw` / active | `TestOverlayLeavesWithheldResultsAlone` | PROVED | REVIEWED_WITH_TESTS (release gates themselves: `../sat-result`) |
| G-8 optimistic lock | `save_requires_current_version` | `SaveDraft` `FOR UPDATE` + version check; `If-Match` | `TestDraftOptimisticLockAndPartialSave`, handler 412/428 | PROVED | REVIEWED_WITH_TESTS |
| G-9 idempotent retry | `retry_after_commit` | `Publish` already-active branch | `TestPublishIdempotentMonotonicAndRestore` | PROVED | REVIEWED_WITH_TESTS |
| G-10 results immutable | `result_raw_immutable` | no writer in `satscoring` touches `assessment_results` | `TestSATGlobalScoreConversionIsRetroactiveMySQL` (stored row byte-identical) | PROVED | REVIEWED_WITH_TESTS |
