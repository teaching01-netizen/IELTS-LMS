# Phase 05 — Testing, Verification, Observability & Rollout (production-grade gate)

## 1. Objective
Prove the optimization is production-grade: contract-identical, authorized, consistent, redacted, faster, observable, and safely deployable/rollback-able. This phase blocks release.

Depends on: Phases 01-04 complete. Blocks: production rollout.

## 2. Entry criteria
- Phase-01 goldens + bench exist. Phase-02/03 equivalence green. Phase-04 GET-only refresh verified. No open TODOs in prior phases.

## 3. AT execution matrix (all must pass)
| ID | What | How | Gate |
| AT-01 | Shell equivalence (full 150-Q fixture) | canonical-JSON diff old vs new; golden snapshot | zero diff |
| AT-02 | Preview redaction | assert no answer_definition/correctOptionId/acceptedResponses/is_pretest leakage; scan serialized bytes | zero hits |
| AT-03 | Role matrix | admin/builder/observer × GET shell/preview, POST shell, mutations | exact allow/deny per table_fullpath + authorization helpers |
| AT-04 | Tenant isolation | builder org A vs exam org B; cached response not cross-served | deny + isolation test |
| AT-05 | Read consistency | concurrent save/commit during 200 shell reads; assert single-revision trees | no mixed trees |
| AT-06 | Open-shell CAS | 20× concurrent POST no-draft; exactly 1 clone + version_created | count check |
| AT-07 | Latency | Phase-01 bench rerun N=1/10/50, 3 runs | p95 improves (frozen threshold), no write-path regression |

## 4. Detailed TODOs
### 4.1 Regression sweep
- [ ] 5.1 Run: backend authoring + delivery suites, cmd/api contract/mysql tests, openapi drift check, frontend exam-authoring tests, typecheck, lint, build. Record counts vs Phase-01 baseline (list any pre-existing failures explicitly — do not silently inherit red).
- [ ] 5.2 Grep for leftover TODO/FIXME/parallel-loader dead code; remove Phase-02 old loaders ONLY after cutover proven (or keep if team prefers thin wrappers — decide explicitly, no dead code by accident).
### 4.2 Edge & failure states
- [ ] 5.3 Empty exam (no sections), section without modules, module without questions, missing routing row, non-sat provider, missing draft, workbook-imported media refs — each returns prior behavior.
- [ ] 5.4 Slow-DB/cancelled-ctx: snapshot Tx aborts cleanly, no partial JSON, no hung connections (pool stats checked).
- [ ] 5.5 Cache-specific: revision flap, nil-cache, cross-exam, multi-instance note (in-process cache is per-instance; document that correctness holds via revision key, only hit-rate varies).
### 4.3 Observability (production-grade)
- [ ] 5.6 Verify metrics: request latency histogram by route (shell GET/POST, preview GET), db query count (test bench) or query-duration histogram (prod), VersionCache hit/miss on preview path, pool wait/lock wait panels. Keep label cardinality bounded (route/method/status only).
- [ ] 5.7 Logs: request-id correlated errors; debug-level versionID+revision on cache miss; NEVER log question content/answers/PII.
- [ ] 5.8 Staging soak: 30-min mixed read/write load; watch p95, error rate, pool saturation, cache hit ratio.
### 4.4 Security review
- [ ] 5.9 Authz re-review: cache read after authz (code-walk the final diff), builder scope via GetForActor on every read, observer deny on POST, no new public route, no widened CORS/timeout.
- [ ] 5.10 Redaction re-review: diff preview serializer fields before/after; confirm deliveredAnswer path shared, not forked.
### 4.5 Maintainability review (clean-architecture gate)
- [ ] 5.11 SOLID check: loaders single-responsibility; service depends on cache abstraction (DIP); no handler business logic; no duplicated SQL builders; error mapping centralized via apperrors.
- [ ] 5.12 Complexity check: no new dep unless justified (singleflight already via cache; no ORM); bulk SQL stays readable; assembler pure + tested.
### 4.6 Rollout
- [ ] 5.13 Deploy order: backend first (frontend compatible), then frontend. Staging verify AT-01..07, then prod canary (if available) watching latency/error/pool.
- [ ] 5.14 Rollback: single-commit revert each side; no data migration so no data rollback. Kill-switch: cache-off path (nil/flag) verified working.
- [ ] 5.15 Update baseline-report.md with final numbers + decision log (keep old loaders? cache on/off default? index added?).

## 5. Final acceptance checklist
- [ ] AT-01..AT-07 pass; FT-01..03 pass.
- [ ] Full regression suite green (or pre-existing failures triaged + recorded).
- [ ] No schema migration outstanding (or migration verified + rollback tested).
- [ ] API compatibility verified (openapi drift clean).
- [ ] Authorization + redaction verified.
- [ ] Failure paths verified (cancel/slow-db/concurrent-write).
- [ ] Observability verified (metrics/logs/dashboards or explicit deferral with reason).
- [ ] Rollback path verified.
- [ ] Requirement -> AT -> TODO -> verification traceability complete (each AT maps to a test artifact).

## 6. Explicit non-goals (do not expand scope)
Workbook write optimization, scoring, new infra, unrelated UI polish. File follow-ups instead.
