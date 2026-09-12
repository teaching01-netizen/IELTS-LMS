# Phase 03 — Backend Service & Handler Wiring

## 1. Objective
Cut over Shell/Preview/OpenShell read paths to the Phase-02 bulk loaders with identical contracts, remove the preview double-build, split OpenShell into explicit ensure-vs-read semantics, and plug the existing delivery VersionCache into authoring preview — without changing routes, JSON, authz, or write behavior.

Depends on: Phase 02 (bulk loaders + equivalence tests green). Blocks: Phase 04 implementation, Phase 05.

## 2. Current wiring (confirmed)
- Routes: main.go:424-446 (TierWrites + adminLimit; shell GET/POST, preview GET, workbook preview/commit via authzRoute, undo/validate/delivery-settings).
- Handlers: handlers_authoring.go: authorShellHandler (GET shell), authorOpenShellHandler (POST shell), authorPreviewHandler (GET preview -> Authoring.Preview).
- Service: Shell (374) N+1; OpenShell (404) write Tx + exam FOR UPDATE even when draft exists, then Shell(); Preview (649) Shell() + bare delivery.NewService(s.db, s.runner).LoadSections.
- Authz: requireAuthoringExam{Read,Write} + GetForActor per request (authoring_authorization.go) — unchanged.
- Cache: app.Versions = delivery.NewVersionCache (main.go:170), passed to shared.Build Deps; authoring service constructed without it (verify shared.Build wiring before touching).

## 3. Behavioral contract
- GET shell / POST shell (draft exists) / GET preview: same status codes, same JSON field-for-field (canonical compare vs Phase-01 goldens).
- POST shell without draft: same clone-CAS semantics + version_created event (do not weaken).
- Preview: same delivery projection, same redaction (no answer_definition keys, no is_pretest leakage).
- AuthN/Z order unchanged: role -> tenant (GetForActor) -> service. Cache lookups only AFTER authz, keyed (versionID, revision, projectionSchemaVersion).
- Write routes: zero behavior change.

## 4. Acceptance linkage
Directly satisfies AT-01 (equivalence), AT-02 (redaction), AT-05 (snapshot consistency), AT-06 (open-shell CAS), AT-07 (latency). Guards AT-03/04 (authz).

## 5. Design decisions
- Decision: Shell() delegates to ShellBulk internally (same func name/signature) rather than adding a parallel endpoint.
  - Reason: no route/contract churn; frontend untouched in this phase. Rejected: /shell/v2 (duplication, migration burden).
- Decision: Preview resolves draft identity+revision once, then single bulk delivery build; remove Shell() call from Preview.
  - Reason: halves preview IO. Rejected: caching the full authoring Shell for preview (stores answer keys in cache — larger blast radius).
- Decision: OpenShell fast path — check draft existence WITHOUT write Tx first? NO by default: must verify race semantics. Two options, decide at implementation with a concurrency test:
  - (a) keep single write Tx (safe, still pays lock on every POST) but Phase 04 reduces POST frequency so cost matters less; or
  - (b) read draft pointer first, only enter write Tx when pointer is NULL (faster, but needs CAS correctness proof under concurrent open).
  - Recommended: implement (b) ONLY with a concurrent-open test proving single-clone + losers return shell-or-409 per contract; else keep (a).
- Decision: inject delivery VersionCache (or a small revision-checked authoring-shell cache) via constructor, defaulting to nil-safe (nil = today's direct load). No globals.
  - Reason: DIP — service takes cache interface; tests inject fake. Rejected: package-level cache var (test pollution, multi-tenant risk).
- Decision: keep per-question summary() semantics identical in Phase 03; micro-opt (reduced re-parsing) only if Phase-01 profile proves CPU-bound AND equivalence tests cover it.

## 6. Detailed TODOs
### 6.1 Shell cutover
- [ ] 3.1 Replace Shell() body with: resolve identity+revision (single JOIN if equivalent) -> withConsistentSnapshot -> bulk loaders -> AssembleShell. Preserve error codes/messages (do not change user-visible strings unless required; frontend/tests may match them).
  - Depends: 2.5, 2.6, 2.7. Enables: AT-01/05/07. Verify: equivalence + golden snapshot + mysql contract tests.
- [ ] 3.2 Materialize-then-query discipline: close each rows set before next query (fixes rows-open-while-querying pattern in loadModules).
- [ ] 3.3 Keep isMissingTable/missing-routing nil behavior identical (fresh-env tolerance in loadSections/loadRouting).
### 6.2 Preview single-build
- [ ] 3.4 Rewrite Preview(): authorize path unchanged (handler) -> resolve draft identity+revision (same helper as Shell) -> sat gate -> bulk delivery load (Phase 02 §2.8) via injected cache (GetChecked on (versionID, revision)) -> return Preview{...}.
  - Depends: 2.8, 2.9. Enables: AT-02/07. Verify: redaction test + golden preview + cache hit/miss test.
- [ ] 3.5 Remove bare delivery.NewService-per-request on this path; use injected service/cache from App graph (verify shared.Build + BuildApp wiring; thread Versions through authoring service constructor — check all constructors/call sites incl. tests).
### 6.3 OpenShell semantics
- [ ] 3.6 Decide 5(a) vs 5(b) with evidence: write concurrent-open test (N=20 POST shell, no draft) asserting exactly 1 clone + all callers get shell or documented conflict.
- [ ] 3.7 Implement chosen path; preserve clonePublishedSATToDraftTx + CAS + version_created event untouched.
- [ ] 3.8 Ensure POST shell with existing draft returns shell WITHOUT cloning and with minimal locking per chosen design; document lock behavior in code comment.
### 6.4 Cache correctness
- [ ] 3.9 Cache key = (versionID, revision, projectionSchemaVer). Invalidation = revision mismatch (reload), NOT TTL-only. Verify stale-author-sees-old-shell test: save revision bumps exam_versions.revision (confirm touchModuleDraft/touchQuestionDraft path does so — verify, do not assume) then shell reflects new content.
  - Depends: revision-bump verification (grep touch* + UpdateDeliverySettings + replaceCompleteSATDraft paths).
- [ ] 3.10 Singleflight/herd: reuse VersionCache.GetChecked semantics (already herd-tested: versioncache_test.go:94); do not add second singleflight lib.
- [ ] 3.11 Bound cache size (existing VersionCacheMaxVersions) + per-tenant safety: cache stores version-scoped trees; authz still runs per request BEFORE cache read. Add test: cached version of exam A never served for exam B.
### 6.5 Perf proof
- [ ] 3.12 Re-run Phase-01 bench: assert query-count + latency deltas recorded; investigate any regression before Phase 04.

## 7. File-by-file plan
- CHANGE backend/go/internal/authoring/service.go — Shell/Preview/OpenShell bodies only; keep types + write methods untouched.
- CHANGE backend/go/internal/authoring/bulk_read.go (Phase-02 file) — only if snapshot/error-mapping fixes needed.
- CHANGE backend/go/internal/delivery/service.go — only to expose/share bulk loader + cache-compatible signature; no redaction-logic fork.
- CHANGE backend/go/internal/app/* or shared.Build (verify exact path) + backend/go/cmd/api/main.go BuildApp — thread Versions/cache into authoring service.
- CHANGE backend/go/cmd/api/handlers_authoring.go — only if OpenShell split needs it (prefer service-level change; handlers stay thin).
- VERIFY: authoring_authorization.go (untouched), routes (untouched), openapi.yaml (untouched — confirm no drift via openapi_drift_test if present), contracts_mysql_test.go.
- ADD: cache-correctness tests (stale-revision, cross-exam isolation, concurrent-open), redaction test if not already covering preview path.

## 8. Data/state lifecycle
- Reads: snapshot Tx (short, no FOR UPDATE) -> bulk rows -> assembled response; optional cache entry keyed by revision.
- Writes: unchanged Tx + FOR UPDATE + CAS + revision bumps. Cache never written on mutation path except via revision-mismatch reload (no explicit invalidation needed if key includes revision — verify all mutation paths bump revision).

## 9. Error/edge matrix
| Condition | Expected | Layer |
| Mid-read concurrent save | snapshot-consistent old tree (not mixed) | service snapshot Tx |
| Revision bump between key-probe and load | GetChecked mismatch -> reload (singleflight) | cache wrapper |
| Cache disabled (nil) | direct bulk load, correct | constructor nil-guard |
| Non-sat | 422 before any cache population | Preview/Shell gate order |
| Missing draft | 404, no cache write | resolve step |
| Concurrent open, no draft | exactly one clone; others shell-or-409 per contract | OpenShell CAS test |

## 10. Compatibility/migration
- No API/schema change; no migration. Constructor signature change: update all call sites (prod + tests) in same commit; check contracts_mysql_test.go:38-style manual App construction.

## 11. Test strategy
- Acceptance: AT-01/02/05/06/07 on fixture. Integration: mysql contract tests, authz matrix, cache isolation, concurrent open. Unit: assembler edge cases. Regression: full authoring + delivery suites. Benchmark: Phase-01 script rerun.

## 12. Observability
- ADD (small, bounded): handler latency histogram labels already exist? verify telemetry package; add cache hit/miss counters reuse (MVersionCacheHit/Miss) for preview path; log versionID+revision at debug (never exam content/PII). Alert: none new (read-path only).

## 13. Rollout/rollback
- Single backend deploy; rollback = revert commit (no data change). Gate: goldens + bench + authz green. If cache causes staleness in staging, disable via constructor nil (keep kill-switch: VERSION_CACHE=off must keep correctness — verify flag path).

## 14. Definition of done
- [ ] Shell + preview on bulk path, goldens byte-equivalent.
- [ ] Preview single-build; query counts match Phase-02 targets.
- [ ] OpenShell semantics proven under concurrency.
- [ ] Cache keyed by revision, isolation tested, nil-safe.
- [ ] Bench deltas recorded; no write-path regression.
