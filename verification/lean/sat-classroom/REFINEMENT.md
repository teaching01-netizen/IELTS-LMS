# Refinement obligations

Lean proves the named statements for the abstract Mode.corrected model. The following mapping is code review plus test evidence, not a mechanized Go/SQL refinement proof.

| Lean step or predicate | Code / database mapping | Evidence | Remaining obligation |
| --- | --- | --- | --- |
| start | ensureBaseModuleAttempt in internal/delivery/service.go | TestEnsureBaseModuleAttemptSeedsPlanEntryModule; legacy standalone seed is rejected by the 0086 MySQL fence test | Verify all entry paths and migration state |
| save | ensureSaveModuleAdmitted, saveInTx | TestSATSaveAfterModuleCloseIsRefusedInsideCloseWindowMySQL (prior run) | Confirm precise cutoff and exhaustive lock order; clocks/W are unknown |
| closeM1 | finalizeModuleWithBasisTx → nextModuleTx in internal/delivery/start_submit.go | staff-selects/forced route unit tests | Audit every caller and writer lock; source correspondence is not proved |
| oldClose | Old application inserts a route without current policy/plan logic | 0084 policy trigger and 0086 plan trigger; TestSATClassroomPlanFenceBlocksLegacyWritesMySQL | Trigger support is DB-specific; verify deployed engine/version and triggers |
| staff | AssignStaffRoute in internal/delivery/staff_route.go | route guard/replay/race tests | HTTP authorization and all retry histories need production-profile evidence |
| closeM2 | Module 2 close via shared finalize path | package tests | Prove transaction and persisted-state mapping for every close caller |
| complete | ensureSATModuleTopologyTx, satExpectedSequence, AwaitingStaffRouteTx in internal/attempts/sat_modules.go | go test ./internal/attempts -count=1 | Lean models one section; global multi-section gate and malformed persisted state are not proved |
| terminate | terminalization.Terminalize with terminated outcome | selected staff-route/terminalization MySQL race test | Verify all terminalization causes and crash boundaries |
| score / release | materializeSATResult, classroomRawScoreTx, RepairClassroomResults | earlier focused result-failure and repair tests | Actual score calculation, pretest correctness, privacy, and production repair liveness are not modeled |
| serve | Student bootstrap/raw-content routes | prior unopened-branch test | Audit every content endpoint and authorization path |

## Atomicity boundary

The Lean relation treats each transition as atomic. In particular, closing Module 1 and recording its snapshot are one modeled step, as are a route decision and opening its branch. That abstraction is justified only if the real transaction and lock paths serialize all relevant writers. The full A-LOCK1 writer audit was not independently completed here; therefore no theorem is claimed about production atomicity, linearizability, or every concurrent caller.

## Explicit non-correspondence

The model does not contain SQL, Go control flow, multiple required sections in one attempt, transaction aborts/deadlocks, crashes, ACK delivery, clock values, HTTP actors, or a real score payload. Passing tests support the listed paths but do not close these gaps. The historical Mode.current counterexamples describe the pre-fix implementation model and are regression witnesses, not findings against the current tree.
