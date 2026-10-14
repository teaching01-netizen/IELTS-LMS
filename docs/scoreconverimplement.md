 Implementation plan: Global SAT Score Conversion (2D matrices, retroactive)
                                                                                                     
 0. Context and current behavior                                                                     
                                                                                                     
 - Goal: Admins edit, import, publish, and restore SAT conversion matrices (Reading & Writing and    
   Math separately). The active revision applies to all SAT results, past and future.                
 - Current → desired: Today conversion is per exam version, 1D (section raw total → score), and      
   frozen into each result when it is sealed. Desired: one global versioned policy, 2D (Module 1 raw 
   × Module 2 raw), resolved when a result is read.                                                  
 - Plan only. No code was changed.
                                                                                                     
 ### Evidence map                                                                                    
                                                                                                     
 ┌────────────────────────────────────┬─────────────────────────────────────────────────┬──────────┐ 
 │ Claim                              │ Evidence                                        │ Status   │ 
 ├────────────────────────────────────┼─────────────────────────────────────────────────┼──────────┤ 
 │ Engine is 1D and per exam version  │ backend/go/internal/satconvert/convert.go       │ Verified │ 
 │                                    │ (Parse, Convert, Total, Table indexed by        │          │ 
 │                                    │ section raw total). Policy rows live in         │          │ 
 │                                    │ assessment_scoring_policies(exam_version_id,    │          │ 
 │                                    │ policy_key='estimated_sat'), written by         │          │ 
 │                                    │ authoring/score_converter.go.                   │          │ 
 ├────────────────────────────────────┼─────────────────────────────────────────────────┼──────────┤ 
 │ Converted scores are frozen in the │ terminalization/service.go:1125                 │ Verified │ 
 │ result payload                     │ convertClassroomScoresTx writes scaled,         │          │
 │                                    │ totalScaled, conversion, conversionStatus into  │          │ 
 │                                    │ assessment_results.score_payload.classroomRaw.  │          │ 
 ├────────────────────────────────────┼─────────────────────────────────────────────────┼──────────┤ 
 │ Frozen scores are asserted by an   │ cmd/api/sat_classroom_mysql_test.go:~509-519:   │ Verified │ 
 │ existing test                      │ "A later converter edit never rewrites a        │          │ 
 │                                    │ released result". The requested feature         │          │ 
 │                                    │ reverses this.                                  │          │ 
 ├────────────────────────────────────┼─────────────────────────────────────────────────┼──────────┤ 
 │ assessment_section_results.scaled_ │ Repo-wide grep finds only a DELETE              │ Verified │ 
 │ score is dead                      │ (terminalization/service.go:988) and SELECTs    │          │ 
 │                                    │ (results/service.go:981, sat/service.go:735),   │          │ 
 │                                    │ no INSERT.                                      │          │ 
 ├────────────────────────────────────┼─────────────────────────────────────────────────┼──────────┤ 
 │ Per-module raw scores are          │ classroomRaw.sections[].modules[{moduleKey,     │ Verified │ 
 │ available for 2D lookup            │ rawCorrect, total}] (service.go:1090). Role     │          │
 │                                    │ comes from satpublish.RoleOfModuleKey (-m1,     │          │
 │                                    │ -m2-lower, -m2-higher). Source rows:            │          │ 
 │                                    │ assessment_module_attempts.raw_correct and      │          │
 │                                    │ operational_question_count.                     │          │ 
 ├────────────────────────────────────┼─────────────────────────────────────────────────┼──────────┤
 │ Score-report release gates         │ results.SATScoreReportOpenSQL, re-read live at  │ Verified │
 │                                    │ delivery/service.go:~583.                       │          │
 │                                    │ studentSafeBootstrapResult and                  │          │
 │                                    │ satReleasedProjection only expose classroomRaw  │          │ 
 │                                    │ when release_status='released'.                 │          │ 
 ├────────────────────────────────────┼─────────────────────────────────────────────────┼──────────┤ 
 │ Readers of the converted score     │ Staff: results.GetSATResult and                 │ Verified │ 
 │                                    │ SatResultDetailRoute.tsx:76. Student:           │          │ 
 │                                    │ sat/service.go:~768 feeding delivery bootstrap  │          │ 
 │                                    │ and SatScoreReport.tsx. No SQL reads scaled     │          │
 │                                    │ (only ACT paths use JSON_EXTRACT).              │          │ 
 ├────────────────────────────────────┼─────────────────────────────────────────────────┼──────────┤ 
 │ Per-exam converter plumbing to     │ authoring/score_converter.go,                   │ Verified │ 
 │ remove                             │ cmd/api/handlers_authoring.go:1020, routes at   │          │ 
 │                                    │ main.go:617-618, authz/table_fullpath.go:42-43, │          │ 
 │                                    │ authz_policy_test.go:175-176,                   │          │ 
 │                                    │ satpublish/validator.go:281 validateConverter,  │          │ 
 │                                    │ ScoreConverterPanel.tsx,                        │          │ 
 │                                    │ SatDeliveryReleasePage.tsx, OpenAPI             │          │ 
 │                                    │ api/openapi/openapi.yaml:2701.                  │          │ 
 ├────────────────────────────────────┼─────────────────────────────────────────────────┼──────────┤ 
 │ Frontend integration points        │ SatRoot.tsx:22 navForRole,                      │ Verified │ 
 │                                    │ createRouter.tsx:345-447 (withAuth per route),  │          │ 
 │                                    │ src/products/sat/ui/SatWorkspaceNav.tsx.        │          │ 
 ├────────────────────────────────────┼─────────────────────────────────────────────────┼──────────┤
 │ Migrations                         │ Latest is 0086. Tree README:                    │ Verified │ 
 │                                    │ backend/go/migrations/README.md.                │          │ 
 ├────────────────────────────────────┼─────────────────────────────────────────────────┼──────────┤ 
 │ route-manifest.ts from the doc     │ Not located (the router is createRouter.tsx).   │ Unknown  │ 
 ├────────────────────────────────────┼─────────────────────────────────────────────────┼──────────┤ 
 │ Prod data: distinct per-exam       │ Needs queries.                                  │ Unknown  │ 
 │ converters, result volume, DB      │                                                 │          │ 
 │ engine (MySQL vs TiDB)             │                                                 │          │ 
 └────────────────────────────────────┴─────────────────────────────────────────────────┴──────────┘ 
                                                                                                     
 ### Corrections to the doc                                                                          
                                                                                                     
 1. Matrix dimensions are wrong for this repo.                                                       
   - authoring/readiness.go:31 satBlueprintModule sets R&W to 27 questions with 2 pretest, and Math  
     to 22 with 2 pretest.
   - The scorer skips pretest rows (delivery/start_submit.go:1322, operational_question_count is     
     non-pretest).                                                                                   
   - So operational counts are 25 (R&W) and 20 (Math), giving 26×26 and 21×21 matrices.              
   - The doc's 28×28 and 23×23 assume every question counts. The supplied 28×28 table cannot convert 
     a blueprint attempt: it would fail closed to "unavailable" (see open decision D1).              
 2. API prefix is /api/v1/... with an authz table, not /v1/sat/....                                  
 3. Projections table and publish job are unnecessary (see §5).                                      

 Non-goals
 - No change to answers, routing, timing, raw grading, or the score-report release gate.
 - No change to the existing 1D standalone-M2 semantics.                                             
 - No College Board "official" labeling.
                                                                                                     
 1. Requirements

 ### Functional                                                                                      

 ┌───────┬────┬───────────────────────────────────────────────────────┬────────────────────────────┐
 │ ID    │ P  │ Behavior                                              │ Acceptance                 │
 ├───────┼────┼───────────────────────────────────────────────────────┼────────────────────────────┤
 │ FR-1  │ P0 │ An admin edits per-subject grids by cell, keyboard,   │ Editing and saving a draft │
 │       │    │ or paste, with undo/redo, copy, and TSV/CSV/JSON      │ leaves every released      │ 
 │       │    │ export. Edits go to a draft only.                     │ score byte-identical.      │ 
 ├───────┼────┼───────────────────────────────────────────────────────┼────────────────────────────┤ 
 │ FR-2  │ P0 │ Validation rejects: incomplete matrix, duplicate or   │ Each error names its cell. │ 
 │       │    │ missing headers, non-numeric cell, value outside      │ Publish is blocked on      │ 
 │       │    │ 200–800 or not a multiple of 10. Non-monotonic cells  │ errors. A fixture with     │ 
 │       │    │ give warnings and are never auto-changed.             │ score decreases publishes  │ 
 │       │    │                                                       │ with warnings.             │ 
 ├───────┼────┼───────────────────────────────────────────────────────┼────────────────────────────┤ 
 │ FR-3  │ P0 │ The paste importer accepts a TSV with a blank         │ An N+1×N+1 paste with      │ 
 │       │    │ top-left cell, headers, CRLF, tabs, trailing blank    │ headers 0..N-1 imports all │ 
 │       │    │ lines, and headerless blocks.                         │ N² cells. A partial        │ 
 │       │    │                                                       │ rectangle replaces only    │ 
 │       │    │                                                       │ the selected cells.        │ 
 ├───────┼────┼───────────────────────────────────────────────────────┼────────────────────────────┤
 │ FR-4  │ P0 │ Publish makes one global revision active in a single  │ A previously released      │ 
 │       │    │ atomic step. Past and future released results resolve │ attempt shows the new      │ 
 │       │    │ against it. A concurrent publish on a stale base is   │ score after activation. A  │ 
 │       │    │ rejected.                                             │ second admin's stale       │ 
 │       │    │                                                       │ publish returns 409 and    │ 
 │       │    │                                                       │ changes nothing.           │ 
 ├───────┼────┼───────────────────────────────────────────────────────┼────────────────────────────┤ 
 │ FR-5  │ P0 │ Publishing one subject leaves the other subject's     │ The unchanged subject's    │ 
 │       │    │ tables unchanged.                                     │ content_sha256 is          │ 
 │       │    │                                                       │ identical across           │ 
 │       │    │                                                       │ revisions.                 │ 
 ├───────┼────┼───────────────────────────────────────────────────────┼────────────────────────────┤ 
 │ FR-6  │ P0 │ Resolution fails closed. A missing topology, a        │ Mismatched counts and      │ 
 │       │    │ dimension mismatch, or an unscored module gives       │ standalone attempts get no │ 
 │       │    │ conversionStatus:"unavailable", never a number.       │ invented score or total.   │
 │       │    │ Standalone M2 uses its own 1D table. The 400–1600     │                            │ 
 │       │    │ total exists only when both sections are full         │                            │
 │       │    │ topologies.                                           │                            │ 
 ├───────┼────┼───────────────────────────────────────────────────────┼────────────────────────────┤ 
 │ FR-7  │ P0 │ Impact preview shows old vs new over released results │ The report is correct      │
 │       │    │ before publish.                                       │ against a seeded dataset   │ 
 │       │    │                                                       │ and is bounded in size.    │ 
 ├───────┼────┼───────────────────────────────────────────────────────┼────────────────────────────┤
 │ FR-8  │ P0 │ Restore creates a draft copied from a prior revision. │ Revision numbers are       │
 │       │    │ Publishing it is a new activation.                    │ monotonic. Scores return   │
 │       │    │                                                       │ to the old table's values. │
 ├───────┼────┼───────────────────────────────────────────────────────┼────────────────────────────┤
 │ FR-9  │ P0 │ Only admins can edit, publish, or restore. Staff and  │ admin_observer is          │
 │       │    │ students never see more than today's gates allow.     │ read-only. Others get 403. │ 
 │       │    │                                                       │ A withheld or report-off   │ 
 │       │    │                                                       │ result carries no score.   │ 
 ├───────┼────┼───────────────────────────────────────────────────────┼────────────────────────────┤ 
 │ FR-10 │ P1 │ Dimension "profiles": multiple tables per topology,   │ Resolver picks by exact    │ 
 │       │    │ picked by exact (M1, M2) operational counts.          │ counts.                    │ 
 │       │    │ Shared-matrix assignment between lower and higher     │                            │ 
 │       │    │ routes must be explicit.                              │                            │ 
 ├───────┼────┼───────────────────────────────────────────────────────┼────────────────────────────┤ 
 │ FR-11 │ P1 │ Server-side rebase of a stale draft when the changed  │ n/a for P0.                │ 
 │       │    │ subjects are disjoint.                                │                            │ 
 └───────┴────┴───────────────────────────────────────────────────────┴────────────────────────────┘ 
                                                                                                     
 ### Non-functional                                                                                  

 ┌───────┬─────────────────────┬────────────────────────────────────────┬──────────────────────────┐ 
 │ ID    │ Quality             │ Target                                 │ Validation               │ 
 ├───────┼─────────────────────┼────────────────────────────────────────┼──────────────────────────┤ 
 │ NFR-1 │ Correctness: no     │ Fail closed. One pointer read per      │ TC-12, TC-13, TC-19      │ 
 │       │ stale or invented   │ request. Immutable revisions.          │                          │ 
 │       │ score               │                                        │                          │ 
 ├───────┼─────────────────────┼────────────────────────────────────────┼──────────────────────────┤ 
 │ NFR-2 │ Hot-path cost       │ Proposed (confirm): result read adds   │ Benchmark on a prod-like │ 
 │       │                     │ ≤1 PK read plus an O(1) lookup, p95 +5 │ DB                       │ 
 │       │                     │ ms.                                    │                          │ 
 ├───────┼─────────────────────┼────────────────────────────────────────┼──────────────────────────┤ 
 │ NFR-3 │ Safety and audit    │ Published content immutable,           │ TC-14, TC-20             │ 
 │       │                     │ checksummed. Every edit, publish, and  │                          │ 
 │       │                     │ restore audited with actor and request │                          │ 
 │       │                     │ id.                                    │                          │
 ├───────┼─────────────────────┼────────────────────────────────────────┼──────────────────────────┤ 
 │ NFR-4 │ Impact query        │ Output ≤ (sections × topologies ×      │ TC-10 plus EXPLAIN on a  │ 
 │       │ bounded             │ cells), independent of attempt count.  │ prod-sized copy          │ 
 │       │                     │ Admin-rate-limited.                    │ (Unknown: engine and     │ 
 │       │                     │                                        │ volume)                  │ 
 ├───────┼─────────────────────┼────────────────────────────────────────┼──────────────────────────┤ 
 │ NFR-5 │ Accessibility       │ Grid is keyboard-complete with a       │ Existing e2e:sat-a11y    │ 
 │       │                     │ screen-reader name for each cell and   │ pattern                  │ 
 │       │                     │ an announced error list.               │                          │ 
 └───────┴─────────────────────┴────────────────────────────────────────┴──────────────────────────┘ 
                                                                                                     
 2. Core entities and invariants                                                                     
                                                                                                     
 - Revision (sat_score_conversion_revisions, new). Fields: id, revision_number (null while draft),   
   status (draft or published), base_revision_id, content JSON, content_sha256, calibration_source,
   note, restored_from_id, version (optimistic lock), author and timestamps.                         
   - content has sections["reading-writing"|"math"] with tables{id: {kind:"matrix", m1Operational,   
     m2Operational, cells[][]} | {kind:"module2", operational, scores[]}}.                           
   - Each section also has assign{topology → [tableId]}. Cells are integer points. Ranges stay only  
     in standalone 1D tables, by reusing parseScore and checkScore.                                  
 - Active pointer (sat_score_conversion_active, a singleton row with id=1): revision_id,             
   activated_at, activated_by.                                                                       
 - Audit (sat_score_conversion_audit, append-only): actor_id, action                                 
   (draft_saved|published|restored), revision_id, from_revision_id, request_id, detail.              
 - Result payload (existing): raw classroomRaw stays frozen. The conversion overlay is computed on   
   read.                                                                                             
                                                                                                     
 ┌───────┬─────────────────────────────────────────────────────────────────────────────────────────┐ 
 │ ID    │ Invariant                                                                               │ 
 ├───────┼─────────────────────────────────────────────────────────────────────────────────────────┤ 
 │ INV-1 │ A published revision's content never changes. content_sha256 is verified on load.       │ 
 ├───────┼─────────────────────────────────────────────────────────────────────────────────────────┤ 
 │ INV-2 │ The pointer always references a published revision. Revision numbers are strictly       │ 
 │       │ increasing, allocated under the pointer lock.                                           │ 
 ├───────┼─────────────────────────────────────────────────────────────────────────────────────────┤ 
 │ INV-3 │ A displayed score = f(active revision, administered topology, module raw scores,        │ 
 │       │ operational counts), or unavailable.                                                    │ 
 ├───────┼─────────────────────────────────────────────────────────────────────────────────────────┤ 
 │ INV-4 │ The overlay adds nothing when classroomRaw is absent or the caller's existing gate      │ 
 │       │ withholds the result.                                                                   │ 
 ├───────┼─────────────────────────────────────────────────────────────────────────────────────────┤ 
 │ INV-5 │ Publish requires base_revision_id == active.revision_id. Otherwise it is rejected.      │ 
 ├───────┼─────────────────────────────────────────────────────────────────────────────────────────┤ 
 │ INV-6 │ No endpoint under this feature writes assessment_results, module attempts, or answers.  │ 
 └───────┴─────────────────────────────────────────────────────────────────────────────────────────┘ 
                                                                                                     
 3. API / interface changes                                                                          
                                                                                                     
 New group /api/v1/sat-score-conversion/…, registered in main.go and the authz tables. Reads need    
 admin or admin_observer. Writes need admin, and use the existing adminLimit.                        
                                                                                                     
 ┌────────┬────────────────────────────┬───────────────────────────────────────────────────────────┐ 
 │ Method │ Path                       │ Notes                                                     │ 
 ├────────┼────────────────────────────┼───────────────────────────────────────────────────────────┤ 
 │ GET    │ /settings                  │ Active revision summary and table dimensions              │ 
 ├────────┼────────────────────────────┼───────────────────────────────────────────────────────────┤ 
 │ GET    │ /revisions,                │ History and content                                       │ 
 │        │ /revisions/{id}            │                                                           │ 
 ├────────┼────────────────────────────┼───────────────────────────────────────────────────────────┤ 
 │ POST   │ /drafts                    │ Body {fromRevisionId?} (default: active). Also serves     │ 
 │        │                            │ restore.                                                  │ 
 ├────────┼────────────────────────────┼───────────────────────────────────────────────────────────┤ 
 │ PUT    │ /drafts/{id}               │ If-Match: <version>. 412 on stale. 409 if the draft is    │ 
 │        │                            │ already published.                                        │ 
 ├────────┼────────────────────────────┼───────────────────────────────────────────────────────────┤ 
 │ POST   │ /drafts/{id}/validate      │ Cell-level errors and warnings                            │ 
 ├────────┼────────────────────────────┼───────────────────────────────────────────────────────────┤ 
 │ POST   │ /lookup-preview            │ {draft, section, topology, m1, m2} → score or unavailable │ 
 ├────────┼────────────────────────────┼───────────────────────────────────────────────────────────┤ 
 │ POST   │ /drafts/{id}/impact        │ Histogram report                                          │ 
 ├────────┼────────────────────────────┼───────────────────────────────────────────────────────────┤ 
 │ POST   │ /drafts/{id}/publish       │ See below                                                 │ 
 └────────┴────────────────────────────┴───────────────────────────────────────────────────────────┘ 
                                                                                                     
 Publish (single transaction, then a returned snapshot):                                             
 - Re-validates server-side. Errors → 422 with cell paths.                                           
 - A stale base → 409 STALE_BASE.                                                                    
 - Re-publishing the already-active revision returns the same 200. Publishing a superseded revision  
   returns 409.                                                                                      
                                                                                                     
 Read-path change: no URL or shape change.                                                           
 classroomRaw.conversion|sections[].scaled|totalScaled|conversionStatus|topology are produced by the 
 overlay with today's JSON shape, plus conversion.converterVersion = "sat-global-v{n}".              
 SatScoreReport.tsx and SatResultDetailRoute.tsx therefore need no changes.                          
                                                                                                     
 Removed in release 2 (clean cutover): both per-exam sat-score-converter endpoints, their authz      
 entries (plus authz_policy_test.go lists), and OpenAPI paths.                                       
                                                                                                     
 4. Critical data flow                                                                               
                                                                                                     
 Publish: admin → handler → BEGIN → SELECT active … FOR UPDATE → SELECT draft … FOR UPDATE → check   
 status and base → validate → revision_number = MAX+1 → freeze content, compute sha256 → UPDATE      
 status='published' → UPDATE active SET revision_id → insert audit row → COMMIT.                     
 - Crash before commit: nothing changed.                                                             
 - Lost response: a retry re-publishes the same revision, which is a no-op that returns the same     
   body.                                                                                             
                                                                                                     
 Read (staff detail, student bootstrap): load result → existing gates → if classroomRaw is present,  
 read the pointer once → load the parsed revision from an LRU cache keyed by immutable revision id → 
 resolve → return.                                                                                   
 - Overlay failure degrades to raw-only plus a metric, not a 500. This follows the best-effort       
   pattern of satModules.                                                                            
 - With no active revision, the overlay is a no-op and legacy stored values stay visible.            
                                                                                                     
 5. Recommended design                                                                               
                                                                                                     
 - Read-time resolution, no projections table, no recalculation job.                                 
   - Module raw scores are already persisted, and nothing in SQL consumes scaled.                    
   - Activation is one pointer flip, so "all results update atomically" holds by construction.       
   - A projection table would add backfill, catch-up, and dual-source drift (FR-4 race with          
     concurrently sealed attempts) for no query benefit.                                             
   - Revisit only if SQL sort/filter on scaled score becomes a requirement.                          
 - Impact via one aggregate query, not a job.                                                        
   - Pivot module attempts per attempt and section, then GROUP BY (section, m1raw, m1ops, role,      
     m2raw, m2ops) over released classroom results with the report enabled.                          
   - Score each distinct cell old vs new in Go and multiply by its count.                            
   - Output is bounded by the number of cells.                                                       
 - New package internal/satscoring (revision store, publish, Overlay). satconvert keeps Topology,    
   TopologyOf, Total, Score, and checkScore. Its Parse, Table, and Convert are replaced by the v2    
   content model: 2D lookup for full topologies, 1D for standalone M2.                               
 - Where Overlay is called: the sat/service.go:~768 result loader (feeds bootstrap, so               
   satReleasedProjection still allowlists classroomRaw) and results.GetSATResult.                    
 - Frontend: src/features/sat-score-conversion/{api,contracts,ui}, the grid, and a route             
   sat/score-conversion under createRouter.tsx with withAuth(["admin"]). Add a "Score Conversion"    
   item to the admin branch of SatRoot.tsx navForRole (and to the workspace switcher via             
   SatWorkspaceNavContext).                                                                          
   - TSV parsing and export happen client-side. The server validates structured cells and is the     
     single source of validation truth.                                                              
   - A 28×28 grid doesn't need virtualization. Use roving tabindex plus a local undo/redo command    
     stack.                                                                                          
   - Header detection: N+1×N+1 means headers (must be 0..N-1). N×N means headerless. Any other       
     rectangle is a selection paste at the anchor. Otherwise reject.                                 
 - Unchanged: release gates, RepairClassroomResults, routing, and delivery.                          
                                                                                                     
 6. Production and failure-mode deep dives                                                           
                                                                                                     
 ┌─────────────────┬──────────────────┬────────────────────────────┬───────────────┬───────────────┐ 
 │ Risk            │ Consequence      │ Protection / location      │ Verification  │ Residual      │ 
 ├─────────────────┼──────────────────┼────────────────────────────┼───────────────┼───────────────┤ 
 │ Two admins      │ Silent overwrite │ Pointer FOR UPDATE plus    │ TC-8          │ Admin must    │ 
 │ publish         │                  │ the base check (INV-5), in │               │ re-create the │ 
 │ concurrently    │                  │ the publish transaction    │               │ draft (P1     │ 
 │                 │                  │                            │               │ rebase)       │ 
 ├─────────────────┼──────────────────┼────────────────────────────┼───────────────┼───────────────┤ 
 │ Edit on a stale │ Lost edit        │ If-Match version, 412      │ TC-6          │ None          │ 
 │ draft           │                  │                            │               │               │ 
 ├─────────────────┼──────────────────┼────────────────────────────┼───────────────┼───────────────┤ 
 │ Duplicate       │ Double           │ Idempotent on revision id  │ TC-9          │ None          │ 
 │ publish or lost │ activation       │                            │               │               │ 
 │ response        │                  │                            │               │               │ 
 ├─────────────────┼──────────────────┼────────────────────────────┼───────────────┼───────────────┤ 
 │ Revision        │ Wrong scores     │ Sha256 verified on load →  │ TC-14         │ Trigger       │ 
 │ content         │ shown            │ unavailable plus alert;    │               │ absent on     │ 
 │ corrupted or    │                  │ trigger and WHERE          │               │ TiDB          │ 
 │ edited          │                  │ status='draft' guards      │               │               │ 
 │                 │                  │ (MySQL only, TiDB skips    │               │               │ 
 │                 │                  │ triggers)                  │               │               │ 
 ├─────────────────┼──────────────────┼────────────────────────────┼───────────────┼───────────────┤ 
 │ Instance serves │ Inconsistent     │ No pointer caching (one PK │ TC-13         │ +1 read per   │ 
 │ a stale pointer │ scores           │ read per request); only    │               │ result load   │ 
 │                 │                  │ immutable revisions are    │               │               │ 
 │                 │                  │ cached                     │               │               │ 
 ├─────────────────┼──────────────────┼────────────────────────────┼───────────────┼───────────────┤ 
 │ Dimension       │ Wrong or absent  │ Exact (m1, m2) match or    │ TC-5, TC-12   │ Needs D1      │ 
 │ mismatch (25 vs │ score            │ unavailable; mismatches    │               │               │ 
 │ 27 operational) │                  │ surfaced in impact as      │               │               │ 
 │                 │                  │ "becomes unavailable"      │               │               │ 
 ├─────────────────┼──────────────────┼────────────────────────────┼───────────────┼───────────────┤ 
 │ Withheld or     │ Policy breach    │ Overlay runs behind the    │ TC-16         │ None          │ 
 │ report-off      │                  │ existing gates and no-ops  │               │               │ 
 │ result leaks    │                  │ without classroomRaw       │               │               │ 
 │ score           │                  │ (INV-4)                    │               │               │ 
 ├─────────────────┼──────────────────┼────────────────────────────┼───────────────┼───────────────┤ 
 │ Impact query    │ Slow DB          │ Admin-only, rate-limited,  │ EXPLAIN on a  │ Unknown       │ 
 │ load on exam    │                  │ bounded output, timeout    │ prod-sized    │ volume        │ 
 │ day             │                  │                            │ copy          │               │ 
 ├─────────────────┼──────────────────┼────────────────────────────┼───────────────┼───────────────┤ 
 │ Rolling deploy  │ Old pods show    │ Activate only after the    │ Rollout       │ Minutes at    │ 
 │ skew            │ stale values     │ fleet is fully on release  │ checklist     │ most          │ 
 │                 │ briefly          │ 1                          │               │               │ 
 ├─────────────────┼──────────────────┼────────────────────────────┼───────────────┼───────────────┤ 
 │ No active       │ Regression for   │ Overlay no-op preserves    │ TC-17         │ Newly sealed  │ 
 │ revision after  │ exams that had   │ legacy stored scores.      │               │ results show  │ 
 │ deploy          │ per-exam         │ Release 1 keeps the old    │               │ raw-only      │ 
 │                 │ converters       │ write path.                │               │ until v1      │ 
 │                 │                  │                            │               │ activates     │ 
 ├─────────────────┼──────────────────┼────────────────────────────┼───────────────┼───────────────┤ 
 │ Rollback to the │ New activations  │ Raw data is untouched, so  │ Runbook       │ Old binary    │ 
 │ old binary      │ ignored          │ forward-fix is the         │               │ shows legacy  │ 
 │                 │                  │ supported path             │               │ or raw-only   │ 
 └─────────────────┴──────────────────┴────────────────────────────┴───────────────┴───────────────┘ 
                                                                                                     
 7. Ordered implementation phases                                                                    
                                                                                                     
 ┌───┬────────────────────────────────┬────────────────────────────────┬────────────┬──────────────┐ 
 │ # │ Files / components             │ Change                         │ Covers     │ Done when    │ 
 ├───┼────────────────────────────────┼────────────────────────────────┼────────────┼──────────────┤ 
 │ 0 │ One read-only SQL audit        │ Count distinct per-exam        │ D1, D2,    │ Results      │ 
 │   │                                │ converters                     │ NFR-4      │ attached to  │ 
 │   │                                │ (assessment_scoring_policies   │            │ the PR       │ 
 │   │                                │ where                          │            │              │ 
 │   │                                │ policy_key='estimated_sat')    │            │              │ 
 │   │                                │ and released-attempt volume;   │            │              │ 
 │   │                                │ record DB engine               │            │              │ 
 ├───┼────────────────────────────────┼────────────────────────────────┼────────────┼──────────────┤ 
 │ 1 │ migrations/0087_sat_score_conv │ Three additive tables,         │ INV-1/2    │ Applies      │ 
 │   │ ersion.sql;                    │ singleton pointer row (null    │            │ idempotently │ 
 │   │ internal/platform/db/schema.go │ revision), triggers (MySQL     │            │ on a         │ 
 │   │ guard; migrations README       │ only)                          │            │ populated DB │ 
 ├───┼────────────────────────────────┼────────────────────────────────┼────────────┼──────────────┤ 
 │ 2 │ satconvert v2;                 │ Content model, validation      │ FR-2, FR-6 │ Unit tests   │ 
 │   │ internal/satscoring            │ (errors vs warnings), 2D and   │            │ green        │ 
 │   │                                │ 1D resolve, revision store,    │            │              │ 
 │   │                                │ canonical hashing              │            │              │ 
 ├───┼────────────────────────────────┼────────────────────────────────┼────────────┼──────────────┤ 
 │ 3 │ satscoring publish and draft   │ Endpoints per §3, audit,       │ FR-4, 5,   │ Integration  │ 
 │   │ logic; handlers in cmd/api;    │ telemetry                      │ 8, 9       │ tests green  │ 
 │   │ main.go;                       │ (sat_score_overlay_total{statu │            │              │ 
 │   │ authz/table_fullpath.go and    │ s}, publish counter,           │            │              │ 
 │   │ its policy test; OpenAPI       │ active-revision gauge)         │            │              │ 
 ├───┼────────────────────────────────┼────────────────────────────────┼────────────┼──────────────┤ 
 │ 4 │ sat/service.go,                │ Read-time overlay behind       │ FR-4, 6;   │ Retroactive  │ 
 │   │ results/service.go; new        │ existing gates                 │ INV-3/4    │ and gate     │ 
 │   │ Overlay                        │                                │            │ tests green  │ 
 ├───┼────────────────────────────────┼────────────────────────────────┼────────────┼──────────────┤ 
 │ 5 │ Impact query and handler       │ Aggregate histogram, rate      │ FR-7       │ Seeded-data  │ 
 │   │                                │ limit                          │            │ report       │ 
 │   │                                │                                │            │ matches hand │ 
 │   │                                │                                │            │ computation  │ 
 ├───┼────────────────────────────────┼────────────────────────────────┼────────────┼──────────────┤ 
 │ 6 │ src/features/sat-score-convers │ Grid, paste, undo/redo, copy,  │ FR-1, 3,   │ Vitest,      │ 
 │   │ ion/*; createRouter.tsx;       │ export, validation list, diff  │ 8; NFR-5   │ typecheck,   │ 
 │   │ SatRoot.tsx; SatRoot.test.tsx; │ and impact dialog, history and │            │ lint green;  │ 
 │   │ a11y e2e                       │ restore                        │            │ manual smoke │ 
 │   │                                │                                │            │ in browser   │ 
 ├───┼────────────────────────────────┼────────────────────────────────┼────────────┼──────────────┤ 
 │ 7 │ Rewrite                        │ Replace the "released report   │ Test       │ No stale     │ 
 │   │ sat_classroom_mysql_test.go    │ never changes" assertion with  │ hygiene    │ assertion    │ 
 │   │ TestSATClassroomConvertedScore │ the new contract. Update the   │            │ left         │ 
 │   │ MySQL; update                  │ model or record the            │            │              │ 
 │   │ classroom_raw_test.go; Lean    │ model-to-code gap in           │            │              │ 
 │   │ model                          │ ASSUMPTIONS.md.                │            │              │ 
 │   │ verification/lean/sat-result   │                                │            │              │ 
 │   │ (Convert.convertTopo_*)        │                                │            │              │ 
 ├───┼────────────────────────────────┼────────────────────────────────┼────────────┼──────────────┤ 
 │ 8 │ Release 2 (after v1 is         │ Clean cutover                  │ Whole-repo │              │ 
 │   │ verified active in prod):      │                                │ grep for   │              │ 
 │   │ remove                         │                                │ the old    │              │ 
 │   │ authoring/score_converter.go,  │                                │ symbols is │              │ 
 │   │ its handler, routes, authz and │                                │ clean      │              │ 
 │   │ OpenAPI entries,               │                                │            │              │ 
 │   │ ScoreConverterPanel.tsx and    │                                │            │              │ 
 │   │ its tests,                     │                                │            │              │ 
 │   │ assessmentAuthoringApi hooks,  │                                │            │              │ 
 │   │ satpublish.validateConverter,  │                                │            │              │ 
 │   │ and convertClassroomScoresTx   │                                │            │              │ 
 │   │ write path; later delete inert │                                │            │              │ 
 │   │ estimated_sat policy rows      │                                │            │              │ 
 └───┴────────────────────────────────┴────────────────────────────────┴────────────┴──────────────┘ 
                                                                                                     
 Exam-level readiness: replace the blocking sat.converter.missing publish check with a non-blocking  
 release-page warning ("no active table covers this exam's shape"), so exam publishing is not        
 coupled to later global changes.                                                                    
                                                                                                     
 8. Test matrix                                                                                      
                                                                                                     
 ┌───────┬───────────────────┬────────────────────────────────────┬─────────────────────┬──────────┐ 
 │ Case  │ Setup / stimulus  │ Expected                           │ Level               │ Coverage │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-1  │ Paste N+1×N+1 TSV │ All N² cells imported              │ unit (client)       │ FR-3     │ 
 │       │ with CRLF,        │                                    │                     │          │ 
 │       │ trailing blank    │                                    │                     │          │ 
 │       │ line              │                                    │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-2  │ Paste N×N         │ Whole grid replaced, and only the  │ unit                │ FR-3     │ 
 │       │ headerless, and a │ 12 cells replaced                  │                     │          │ 
 │       │ 3×4 block at an   │                                    │                     │          │ 
 │       │ anchor            │                                    │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-3  │ Duplicate header, │ Each yields a cell-addressed       │ unit and            │ FR-2     │ 
 │       │ missing row, abc, │ error. Publish blocked.            │ integration         │          │ 
 │       │ 205, 810, 190     │                                    │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-4  │ Table with        │ Warning only, cell unchanged,      │ unit                │ FR-2     │ 
 │       │ adjacent score    │ publish allowed                    │                     │          │
 │       │ decrease          │                                    │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-5  │ Table dims ≠      │ conversionStatus:"unavailable", no │ integration         │ FR-6,    │ 
 │       │ attempt           │ total                              │                     │ INV-3    │ 
 │       │ operational       │                                    │                     │          │ 
 │       │ counts (25 vs 27) │                                    │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-6  │ Save draft with   │ 412, no write                      │ integration         │ NFR-1    │ 
 │       │ stale If-Match    │                                    │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-7  │ Edit and save a   │ All released payloads              │ integration         │ FR-1,    │ 
 │       │ draft             │ byte-identical, scores unchanged   │                     │ INV-6    │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-8  │ Two admins        │ One succeeds, the other gets 409,  │ integration (MySQL) │ FR-4,    │ 
 │       │ publish on the    │ and the pointer ends at the first  │                     │ INV-5    │
 │       │ same base,        │                                    │                     │          │ 
 │       │ interleaved       │                                    │                     │          │ 
 │       │ (barrier)         │                                    │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-9  │ Publish twice     │ Same 200 body, one activation, one │ integration         │ NFR-1    │ 
 │       │ (lost response)   │ audit row                          │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-10 │ Seed released     │ Counts and deltas match hand       │ integration         │ FR-7,    │ 
 │       │ attempts across   │ computation. Output size is        │                     │ NFR-4    │ 
 │       │ topologies, run   │ independent of attempt count.      │                     │          │ 
 │       │ impact            │                                    │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-11 │ Publish a         │ Math content hash identical        │ integration         │ FR-5     │ 
 │       │ R&W-only change   │                                    │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤
 │ TC-12 │ Standalone M2,    │ Standalone uses its 1D table. No   │ unit                │ FR-6     │ 
 │       │ M1-only, or mixed │ total from non-full topologies.    │                     │          │ 
 │       │ topology          │                                    │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-13 │ Activate v2       │ A previously released attempt now  │ integration         │ FR-4,    │ 
 │       │                   │ shows v2. A newly sealed attempt   │                     │ NFR-1    │ 
 │       │                   │ shows v2. Two app instances agree  │                     │          │ 
 │       │                   │ on the next read.                  │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-14 │ Corrupt a         │ Load fails closed to unavailable,  │ integration         │ NFR-3    │ 
 │       │ revision's        │ metric increments, no number       │                     │          │ 
 │       │ content directly  │                                    │                     │          │ 
 │       │ in DB             │                                    │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-15 │ Concurrent seal   │ The attempt resolves against       │ integration         │ FR-4     │
 │       │ of an attempt     │ whichever pointer it read,         │                     │          │ 
 │       │ during publish    │ consistently                       │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-16 │ Report switch     │ Receipt projection only, no score  │ integration         │ FR-9,    │ 
 │       │ off, result       │ or classroomRaw                    │                     │ INV-4    │ 
 │       │ pending, Standard │                                    │                     │          │ 
 │       │ Practice sitting  │                                    │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-17 │ No active         │ Legacy stored scores still shown,  │ integration         │ rollout  │ 
 │       │ revision          │ no errors                          │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-18 │ Roles: admin,     │ Per §3 matrix. Each endpoint has   │ integration         │ FR-9     │ 
 │       │ admin_observer,   │ an authz table entry.              │ (authz_policy_test) │          │ 
 │       │ builder, grader,  │                                    │                     │          │ 
 │       │ proctor, student  │                                    │                     │          │
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-19 │ Restore v1 as a   │ Revision number increments, scores │ integration         │ FR-8     │ 
 │       │ draft and publish │ equal v1 table                     │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-20 │ Edit, publish,    │ Audit row with actor and request   │ integration         │ NFR-3    │ 
 │       │ restore           │ id for each                        │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-21 │ Grid keyboard     │ Arrow, Tab, Enter, Esc work. Error │ e2e a11y            │ NFR-5    │ 
 │       │ navigation and    │ list is announced.                 │                     │          │ 
 │       │ screen-reader     │                                    │                     │          │ 
 │       │ names             │                                    │                     │          │ 
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-22 │ Overlay failure   │ Raw-only result, metric            │ unit                │ NFR-1    │ 
 │       │ (pointer read     │ incremented, not a 500             │                     │          │ 
 │       │ error)            │                                    │                     │          │
 ├───────┼───────────────────┼────────────────────────────────────┼─────────────────────┼──────────┤ 
 │ TC-23 │ Active-exam       │ Routing, timing, answers, and raw  │ integration         │ INV-6    │ 
 │       │ activity during   │ grading unchanged                  │                     │          │ 
 │       │ publish           │                                    │                     │          │ 
 └───────┴───────────────────┴────────────────────────────────────┴─────────────────────┴──────────┘ 
                                                                                                     
 These are planned, not run.                                                                         
                                                                                                     
 9. Rollout and recovery                                                                             
                                                                                                     
 1. Apply migration 0087 first. It is additive and no reader depends on it.                          
 2. Deploy release 1: endpoints plus overlay. With no active revision, behavior is unchanged.        
    Confirm the whole fleet is on release 1.                                                         
 3. Deploy the frontend.                                                                             
 5. Verify the sat_score_overlay_total distribution, spot-check a historical result, and check the
    audit log.                                                                                       
 6. Release 2: remove the per-exam converter code and UI (phase 8).                                  
                                                                                                     
 Telemetry: overlay status counts, publish outcomes, active-revision gauge, and an alert on any      
 checksum-failure count above 0.                                                                     

 Rollback: the raw data is never mutated, so recovery is "publish a restored prior revision"         
 (forward-fix). Reverting the binary after activation is not clean. It shows legacy or raw-only      
 values, so avoid it.                                                                                
                                                                                                     
 10. Open decisions and final gap review                                                             
                                                                                                     
 - D1 (blocking for seeding, not for the build): matrix dimensions.                                  
   - Blueprint operational counts are 25 (R&W) and 20 (Math), so the supplied 28×28 table does not
     fit.                                                                                            
   - Default: dimensions are data-driven and exact-match, and the importer rejects a mismatched      
     table with a clear message.                                                                     
   - Owner must either supply 26×26 / 21×21 matrices, or confirm that pretest questions should count 
     toward the score, which contradicts the current scorer.                                         
   - Do not trim the 28×28 table by dropping rows and columns.                                       
 - D2: initial seed. Run phase 0. If exactly one distinct legacy converter exists and every table is
   points-only with matching counts, it may be expanded to a 2D matrix (cell = f(M1+M2)) as v1.      
   Otherwise staff import v1 from the supplied sheet. Never fabricate a default.                     
 - D3: Builders and observers have no write access. Admins only, matching the doc's "authorized      
   administrators". Alternative: allow builders.                                                     
 - D4: Stale-draft rebase is P1. Until then the loser re-creates their draft.
 - Not located: docs/sat-result.md (referenced in code comments), route-manifest.ts, and prod data   
   volumes. These do not block the plan.                                                             

 Traceability: FR-1 → TC-7, TC-21; FR-2 → TC-3, TC-4; FR-3 → TC-1, TC-2; FR-4 → TC-8, TC-13, TC-15;  
 FR-5 → TC-11; FR-6 → TC-5, TC-12; FR-7 → TC-10; FR-8 → TC-19; FR-9 → TC-16, TC-18; INV-1 → TC-14;
 INV-2 → TC-8, TC-9; INV-3 → TC-5, TC-13; INV-4 → TC-16; INV-5 → TC-8; INV-6 → TC-7, TC-23.          