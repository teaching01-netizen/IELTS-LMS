# Requirement-to-theorem and implementation traceability

Formal status is about the Lean statement only. Correspondence status is about the Go/SQL mapping. Production evidence is limited to the stated local test profile.

| Requirement | Formal statement / status | Code and database boundary | Verification evidence | Correspondence | Production evidence |
| --- | --- | --- | --- | --- | --- |
| No M2 is opened under staff_selects until staff commits the route | t2_staff_only, PROVED in the abstract model | internal/delivery/start_submit.go; internal/delivery/staff_route.go; internal/exams/sat_route_policy.go; 0084 policy fence | Delivery routing unit tests, exams unit suite, and selected MySQL tests; exact commands in PROOF_REPORT.md | REVIEWED_WITH_TESTS | PARTIAL |
| A committed route is stable and identifies the opened branch | t1_decision_stable, t3_route_fidelity, PROVED | Unique (attempt_id, section_id) constraint; nextModuleTx; staff route transaction | Selected StaffRouteRaceMySQL, StaffRouteAcrossAPIBinariesMySQL; unit route tests | REVIEWED_WITH_TESTS | PARTIAL |
| A route respects the pinned section plan, including against an older binary | t3_plan_fidelity and corrected_fence_rejects_plan_bypass, PROVED in the abstract model | satpublish/plan.go; nextModuleTx; migration 0086 route-decision trigger | TestSATClassroomPlanFenceBlocksLegacyWritesMySQL on local MySQL 9.6.0 | REVIEWED_WITH_TESTS | PARTIAL; production DB engine and trigger state UNKNOWN |
| Standalone M2 creates no M1 or synthetic decision | g7_standalone, PROVED | delivery/service.go entry seeding; migration 0086 module-attempt trigger | Plan-fence MySQL test rejects legacy base seed and permits configured M2 | REVIEWED_WITH_TESTS | PARTIAL |
| Completion rejects incomplete, extra, or plan-inconsistent classroom modules | t5_sealed_gate, PROVED only for the abstract single-section gate | attempts/sat_modules.go: ensureSATModuleTopologyTx, satExpectedSequence, AwaitingStaffRouteTx | go test ./internal/attempts -count=1; gate unit cases | REVIEWED_WITH_TESTS; full attempt/multi-section refinement not mechanized | PARTIAL |
| Save snapshot is the accepted write set at close | t4_snapshot, PROVED for atomic abstract steps | saveInTx, finalizeModuleWithBasisTx, attempt/module locks | Prior local test TestSATSaveAfterModuleCloseIsRefusedInsideCloseWindowMySQL; not rerun in this final subset | UNVERIFIED for exhaustive writer/lock refinement | PARTIAL |
| Release implies successful score and seal | t6_release, PROVED for boolean abstract state | terminalization/service.go: result materialization, raw score projection, repair | Prior tests named TestClassroomScoreFailureKeepsReceiptAndWithholds, TestClassroomUnscoredModuleStaysPending, TestRepairClassroomResults; not rerun in this final subset | REVIEWED_WITH_TESTS; scoring implementation not mechanized | PARTIAL |
| Student is served only an opened branch | t7_served, PROVED for abstract state | Student bootstrap/raw-content handlers | Prior test TestStudentRawContentRoutesFenceUnassignedBranch; not rerun in this final subset | REVIEWED_WITH_TESTS | PARTIAL |
| Staff HTTP authorization is enforced | Not modeled; NOT_RUN | cmd/api/handlers_sat_route.go, requireStaffSchedule, authz | HTTP authorization suite was not part of this final run | UNVERIFIED | NOT_TESTED in this engagement |
| Standard SAT behavior remains unchanged | Not modeled; NOT_RUN | Practice-mode bypass in satExpectedSequence; existing adaptive routing | Attempt, delivery routing, and exams package tests passed; no full regression suite | REVIEWED_WITH_TESTS | PARTIAL |
| Every section in a multi-section attempt meets its plan before global seal | Not modeled at multi-section granularity; INCOMPLETE | attempts.SATModuleTopology.Validate plus per-section satExpectedSequence | Package tests passed; no Lean theorem over a section map | UNVERIFIED | PARTIAL |
| Eventual route assignment, reconciliation, and score repair | No liveness theorem; NOT_RUN | Reconciler, staff operations, repair worker | No fair-scheduler or outage recovery run | UNVERIFIED | NOT_TESTED |
| Production throughput and recovery bounds | Out of formal scope | Deployment and database topology | No production-like load/soak run | UNVERIFIED | NOT_TESTED |

## Concrete correspondence map

- start ↔ ensureBaseModuleAttempt in internal/delivery/service.go.
- save ↔ ensureSaveModuleAdmitted / saveInTx; exact timing and lock ordering are refinement obligations.
- closeM1 ↔ finalizeModuleWithBasisTx and nextModuleTx in internal/delivery/start_submit.go.
- legacy route writes ↔ migrations 0084 and 0086; these SQL triggers are exercised only on MySQL in this engagement.
- staff ↔ AssignStaffRoute in internal/delivery/staff_route.go, behind the API authorization handler.
- complete ↔ ensureSATModuleTopologyTx, including plan parse, row counts, route association, and AwaitingStaffRouteTx.
- terminate ↔ terminalization.Terminalize; it intentionally bypasses successful-completion topology.
- score / release ↔ materializeSATResult, classroomRawScoreTx, and repair logic.
- serve ↔ student bootstrap and raw-content route checks.

This is source review plus tests, not a semantics-preserving translation proof.
