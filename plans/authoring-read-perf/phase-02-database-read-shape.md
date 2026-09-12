# Phase 02 — Database / Read-Shape Foundation (bulk loaders + consistent snapshot)

## 1. Objective
Add bulk, version-scoped read functions for the authoring shell + delivery preview that return byte-equivalent projections with O(1) round trips instead of N+1, behind existing service boundaries. No handler/route/frontend changes in this phase; new code is additive + unit-tested, old loaders stay until Phase 03 cutover.

Depends on: Phase 01 baseline + golden snapshots. Blocks: Phase 03.

## 2. Current system (confirmed)
- Shell: exam_entities (1) -> exam_versions.revision (1) -> sections by version (1) -> modules per section (S=2) -> question rows per module (M=6) -> routing per section (2). Total ~13 service SELECTs (service.go:374-397, 1694-1802).
- Question rows: loadQuestionValidationRows joins exam_questions+modules+sections+revisions WHERE module_id=? ORDER BY display_order (readiness.go:108-142); row.summary() parses JSON per question (readiness.go:144-207).
- Delivery LoadSections: sections by version -> modules per section -> questions per module (~9 SELECTs for SAT) (delivery/service.go:411-523).
- VersionCache exists (NewVersionCache/GetChecked, cachedSections) but authoring Preview bypasses it via bare delivery.NewService (service.go:649-661; main.go:170).

## 3. Behavioral contract
- New loaders return identical ordering (display_order ASC; tie-break id where contract needs determinism — verify current contract first, do not invent new ordering).
- Empty sections/modules/questions project as [] not null (frontend + contracts_mysql_test.go:176 expect arrays).
- Errors preserve codes: Exam not found (404), Draft version not found (404), provider gate (422).
- No write semantics change; no lock escalation on reads beyond a short consistent-snapshot read Tx.

## 4. Acceptance linkage
Enables AT-01 (equivalence), AT-05 (consistency), AT-07 (fewer round trips). Must not break AT-02/03/04.

## 5. Design decisions
- Decision: version-scoped bulk SELECTs (sections; modules; routing; question rows) + in-memory assembly, instead of JOIN-everything mega-row.
  - Reason: preserves per-entity ordering, avoids row multiplication (150 questions × section/module columns), keeps diffs reviewable.
  - Rejected: single giant JOIN (payload bloat, fragile scan), ORM (not the codebase pattern — explicit SQL + tx.Runner).
- Decision: consistent-snapshot read transaction for the bulk set (or verified revision re-check if the platform cannot hold snapshot semantics).
  - Reason: prevents section-from-rev-R + questions-from-rev-R+1 mixed trees.
  - Invariant: read Tx must be short, no FOR UPDATE, no writes, respects ctx cancellation/timeout.
- Decision: keep row.summary() CPU work out of Phase 02 (profile in 01; optimize parsing in Phase 03 only if profile justifies).
- Decision: no schema migration. If EXPLAIN shows missing index on (exam_version_id)/(section_id)/(module_id, display_order), add index proposal to Phase 03 only with evidence; default is no migration.

## 6. Detailed TODOs
### 6.1 Bulk authoring reads (ADD, additive)
- [ ] 2.1 Add BulkLoadShellRows(ctx, q, versionID): sections (id/key/title/order/dur/brk/rev) ORDER BY display_order,id.
  - Location: backend/go/internal/authoring/ (new file e.g. bulk_read.go — confirm package layout; do not collide with workbook_import.go names).
  - Verify: unit test ordering + empty-version => [].
- [ ] 2.2 Add modules-by-version query: JOIN modules->sections WHERE exam_version_id=? ORDER BY section display_order, module display_order, id. Return sectionID with each row for grouping.
- [ ] 2.3 Add routing-by-version query: JOIN routing->sections WHERE exam_version_id=?.
- [ ] 2.4 Add question-rows-by-version query: extend loadQuestionValidationRows pattern with module filter IN-version: JOIN exam_questions->modules->sections WHERE exam_version_id=? ORDER BY section_order, module_order, display_order, id. Must return moduleID + all fields row.summary() needs.
  - Preserve: CAST(...AS CHAR) JSON handling, is_pretest, semantic_revision/revision.
- [ ] 2.5 Add AssembleShell(examID, providerKey, versionID, rev, sections, modulesBySection, routingBySection, questionsByModule): pure function building Shell with same nesting/order/empty-array behavior.
  - Enables: AT-01. Verify: table test incl. empty modules, missing routing (nil), 150-question grouping.
### 6.2 Consistent snapshot
- [ ] 2.6 Add withConsistentSnapshot(ctx, fn): short read Tx (via tx.Runner read path if available; verify runner API — do NOT assume WithTx is write-only). Fallback: sequential reads + start/end revision check with documented retry/409 policy — decide from Phase-01 isolation findings.
  - Invariant: never take FOR UPDATE here; always honor ctx deadline.
- [ ] 2.7 Add ShellBulk(ctx, examID): resolve exam_entities + exam_versions.revision (consider single JOIN query) then bulk-load + assemble inside snapshot. Keep Shell() untouched.
### 6.3 Bulk delivery preview reads
- [ ] 2.8 Add version-scoped bulk delivery loader (new method or delivery package addition): sections+modules+questions by versionID in 3 queries, same deliveredAnswer redaction path (reuse deliveredAnswer/rawJSON — do not fork redaction logic).
  - Verify: redaction unit test (answer keys stripped, is_pretest server-side).
- [ ] 2.9 Wire cache-compatibility: bulk delivery loader must accept the existing VersionCache.GetChecked loader-func shape so Phase 03 can plug app.Versions without changing cache semantics.
### 6.4 Equivalence harness
- [ ] 2.10 Add equivalence test: for fixture versions (empty/small/full-150), assert ShellBulk == Shell and BulkPreview == LoadSections output (canonical JSON compare). This is the Phase-03 cutover safety net.
- [ ] 2.11 Benchmark new loaders vs old on Phase-01 fixture (query count + wall time); record in baseline-report.md addendum. If no improvement, STOP and re-diagnose before Phase 03.

## 7. File-by-file plan
- ADD backend/go/internal/authoring/bulk_read.go (names TBD at implementation; keep small focused funcs, SRP per loader).
- ADD backend/go/internal/authoring/bulk_read_test.go (ordering/empty/grouping/equivalence).
- ADD or EXTEND delivery bulk loader (prefer extending delivery/service.go adjacent to LoadSections; do not create parallel delivery package).
- VERIFY: service.go Shell/loaders, readiness.go rows/summary, delivery/service.go LoadSections/loadModules/loadQuestions, tx.Runner API, VersionCache GetChecked signature.
- REMOVE: nothing in Phase 02.

## 8. Data/state lifecycle
Read-only: exam_entities/current_draft_version_id -> exam_versions.revision -> sections/modules/routing/questions. Source of truth stays MySQL; no new persisted state; no cache writes in Phase 02.

## 9. Error/edge matrix
| Condition | Expected | Handling |
| Version deleted mid-read | 404 Draft version not found | snapshot Tx error mapping (do not leak sql.ErrNoRows) |
| Non-sat exam | 422 provider gate preserved by caller (ShellBulk also gates if called directly) | same apperrors code |
| Empty section/module | [] not null | assembler default |
| 150+ questions | grouping correct, order stable | equivalence test |
| ctx cancelled | ctx err propagated, Tx rolled back | no partial Shell |

## 10. Compatibility/migration
- No migration by default. If index needed: propose AFTER EXPLAIN evidence; online DDL plan + rollback (drop index) in Phase 03.
- Old + new loaders coexist; no API change.

## 11. Test strategy
- Unit: ordering, grouping, empty, redaction-shape. Integration (mysql test tag where available): equivalence on real schema. Benchmark: counts + latency. Regression: existing authoring/service_test.go + delivery tests untouched and green.

## 12. Observability
- No prod telemetry in Phase 02. Tests may log query counts. Define Phase-03 metric names now (e.g. authoring_shell_bulk_queries, preview_single_build) for implementation.

## 13. Rollout/rollback
- Additive code only; rollback = do not call new funcs. No deploy risk.

## 14. Definition of done
- [ ] ShellBulk + bulk preview loader implemented, unit + equivalence tested.
- [ ] Query-count reduction demonstrated on fixture (target: shell 13 -> <=6 incl. identity/revision; preview path single build).
- [ ] No handler/route/frontend touched. Existing suite green.
