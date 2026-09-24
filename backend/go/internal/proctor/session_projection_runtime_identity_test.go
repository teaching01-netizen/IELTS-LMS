package proctor

// The proctor roster is the only place staff read per-student exam state, so it
// must carry the SAME runtime identity the delivery service and the final result
// use — and enough ordering information for the client to reject a stale
// projection. Presence (`lastActivity`, a heartbeat) is not exam-state
// freshness: two responses can share a heartbeat instant while describing
// different adaptive modules, which is how the staff room could show Module 1
// after the server had already routed the candidate into Module 2 Higher.

import (
	"database/sql"
	"strings"
	"testing"
	"time"
)

func TestStudentSessionColumnsCarryRuntimeIdentity(t *testing.T) {
	for _, column := range []string{
		// Monotonic attempt revision: the primary ordering fence.
		"sa.revision",
		// The active SAT module attempt the roster shows.
		"sat_attempt.id",
		"sat_attempt.module_id",
		"sat_attempt.revision",
	} {
		if !strings.Contains(studentSessionColumns, column) {
			t.Errorf("roster projection must expose %s so a client can order projections (heartbeats cannot)", column)
		}
	}
}

func TestAttemptRowToSessionProjectsSATRuntimeIdentity(t *testing.T) {
	started := time.Unix(1_800_000_000, 0).UTC()
	row := studentSessionRow{
		id: "att-1", candidateID: "cand-1", candidateName: "Candidate",
		scheduleID: "sched-1", currentModule: "m2", phase: "exam",
		examID: "exam-1", examTitle: "SAT", updatedAt: started,
		proctorStatus:            "active",
		providerKey:              "sat",
		satModuleTitle:           sql.NullString{String: "Module 2", Valid: true},
		satModuleKey:             sql.NullString{String: "rw-m2-higher", Valid: true},
		satModuleRole:            sql.NullString{String: "higher_branch", Valid: true},
		satStartedAt:             sql.NullTime{Time: started, Valid: true},
		satAllocated:             sql.NullInt64{Int64: 1_800, Valid: true},
		attemptRevision:          42,
		satModuleAttemptID:       sql.NullString{String: "ma-higher", Valid: true},
		satModuleID:              sql.NullString{String: "MOD-HIGHER", Valid: true},
		satModuleAttemptRevision: sql.NullInt64{Int64: 3, Valid: true},
	}

	got := attemptRowToSession(row, cohortLiveRuntimeWithDeadline())

	if got.RuntimeCurrentModuleRole == nil || *got.RuntimeCurrentModuleRole != "higher_branch" {
		t.Fatalf("role must project the adaptive slot, got %v", got.RuntimeCurrentModuleRole)
	}
	if got.RuntimeCurrentModuleID == nil || *got.RuntimeCurrentModuleID != "MOD-HIGHER" {
		t.Fatalf("the roster must name the module id the route selected, got %v", got.RuntimeCurrentModuleID)
	}
	if got.RuntimeModuleAttemptID == nil || *got.RuntimeModuleAttemptID != "ma-higher" {
		t.Fatalf("the roster must name the active module attempt, got %v", got.RuntimeModuleAttemptID)
	}
	if got.RuntimeModuleAttemptRevision == nil || *got.RuntimeModuleAttemptRevision != 3 {
		t.Fatalf("the roster must carry the module attempt revision, got %v", got.RuntimeModuleAttemptRevision)
	}
	if got.RuntimeAttemptRevision == nil || *got.RuntimeAttemptRevision != 42 {
		t.Fatalf("the roster must carry the attempt revision, got %v", got.RuntimeAttemptRevision)
	}
}

func TestAttemptRowToSessionLeavesRuntimeIdentityEmptyWithoutAnActiveModule(t *testing.T) {
	started := time.Unix(1_800_000_000, 0).UTC()
	row := studentSessionRow{
		id: "att-1", candidateID: "cand-1", candidateName: "Candidate",
		scheduleID: "sched-1", currentModule: "lobby", phase: "lobby",
		examID: "exam-1", examTitle: "SAT", updatedAt: started,
		proctorStatus: "active",
		// Legacy ACT/IELTS rosters have no SAT module attempt at all.
		providerKey:     "ielts",
		attemptRevision: 7,
	}

	got := attemptRowToSession(row, SessionRuntime{Status: "live", ServerNow: started})

	if got.RuntimeCurrentModuleID != nil || got.RuntimeModuleAttemptID != nil || got.RuntimeModuleAttemptRevision != nil {
		t.Fatalf("no active SAT module means no module identity: %+v", got)
	}
	if got.RuntimeCurrentModuleRole != nil {
		t.Fatalf("no adaptive slot outside a live SAT module, got %v", got.RuntimeCurrentModuleRole)
	}
	// The attempt revision is still the ordering fence for the row itself.
	if got.RuntimeAttemptRevision == nil || *got.RuntimeAttemptRevision != 7 {
		t.Fatalf("attempt revision must always project, got %v", got.RuntimeAttemptRevision)
	}
}
