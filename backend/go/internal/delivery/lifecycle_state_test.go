package delivery

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"reflect"
	"regexp"
	"testing"
	"time"

	examdomain "example.com/ielts-proctoring/internal/exams"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// lifecycleFixtureModule is one module attempt as both read shapes see it.
type lifecycleFixtureModule struct {
	id, moduleID, state, sectionKey                  string
	allocated, accumulated, extension, revision      int
	availableAt, startedAt, pausedAt                 any
	completionReason, rawCorrect, operational, tools any
	generation                                       int
	entryStartsAt, entryConfirmedAt, entryEnteredAt  any
	autoStartAt                                      any
	boundary                                         *lifecycleFixtureBoundary
}

type lifecycleFixtureBoundary struct {
	phase, policyVersion                          string
	workDeadline, entryDeadline, recoveryDeadline any
	nextAction, resolution, resolvedAt, receipt   any
	revision                                      uint64
}

func lifecycleFixture(now time.Time) []lifecycleFixtureModule {
	at := func(d time.Duration) any { return now.Add(d) }
	return []lifecycleFixtureModule{
		{ // submitted, resolved boundary with a receipt
			id: "ma-1", moduleID: "m-rw1", state: "submitted", sectionKey: "rw",
			allocated: 1920, revision: 7, availableAt: at(-40 * time.Minute), startedAt: at(-39 * time.Minute),
			completionReason: "deadline", rawCorrect: int64(21), operational: int64(27), tools: `{"calculator":true}`,
			generation: 1, entryStartsAt: at(-40 * time.Minute), entryConfirmedAt: at(-40 * time.Minute), entryEnteredAt: at(-39 * time.Minute),
			boundary: &lifecycleFixtureBoundary{
				phase: "resolved", policyVersion: "sat-recovery-v1",
				workDeadline: at(-7 * time.Minute), entryDeadline: at(-6 * time.Minute), recoveryDeadline: at(-5 * time.Minute),
				resolution: "closed", resolvedAt: at(-5 * time.Minute), receipt: `{"route":"hard"}`, revision: 4,
			},
		},
		{ // routed successor waiting for client start: entry offer, no boundary, NULL tools
			id: "ma-2", moduleID: "m-rw2", state: "preparing", sectionKey: "rw",
			allocated: 1920, revision: 2, generation: 2, entryStartsAt: at(30 * time.Second), autoStartAt: at(45 * time.Second),
		},
		{ // out of the released scope
			id: "ma-3", moduleID: "m-math1", state: "not_started", sectionKey: "math",
			allocated: 2100, revision: 1, tools: "",
			boundary: &lifecycleFixtureBoundary{phase: "work", policyVersion: "sat-recovery-v1", revision: 1},
		},
		{ // paused with extension, open boundary without a receipt
			id: "ma-4", moduleID: "m-rw3", state: "active", sectionKey: "rw",
			allocated: 600, accumulated: 30, extension: 60, revision: 5,
			availableAt: at(-5 * time.Minute), startedAt: at(-5 * time.Minute), pausedAt: at(-time.Minute), tools: `{}`,
			boundary: &lifecycleFixtureBoundary{phase: "work", policyVersion: "sat-recovery-v1", workDeadline: at(6 * time.Minute), nextAction: at(6 * time.Minute), revision: 2},
		},
	}
}

// expectLegacyLifecycleModules stages the four reads LifecycleState issued
// before loadSATLifecycleModules: scope module ids, module attempts,
// boundaries and entry offers.
func expectLegacyLifecycleModules(mock sqlmock.Sqlmock, fixture []lifecycleFixtureModule) {
	scopeRows := sqlmock.NewRows([]string{"id", "section_key"})
	for _, m := range fixture {
		scopeRows.AddRow(m.moduleID, m.sectionKey)
	}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT m.id, s.section_key")).WithArgs("ver-1").WillReturnRows(scopeRows)

	moduleRows := sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason", "raw_correct", "operational_question_count", "tool_state", "revision"})
	for _, m := range fixture {
		moduleRows.AddRow(m.id, m.moduleID, m.state, m.allocated, m.availableAt, m.startedAt, m.pausedAt, m.accumulated, m.extension, m.completionReason, m.rawCorrect, m.operational, m.tools, m.revision)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? ORDER BY created_at, id")).WithArgs("att-1").WillReturnRows(moduleRows)

	boundaryRows := sqlmock.NewRows([]string{"module_attempt_id", "phase", "policy_version", "work_deadline_at", "entry_deadline_at", "recovery_deadline_at", "next_action_at", "resolution", "resolved_at", "resolution_receipt", "revision"})
	for _, m := range fixture {
		if b := m.boundary; b != nil {
			boundaryRows.AddRow(m.id, b.phase, b.policyVersion, b.workDeadline, b.entryDeadline, b.recoveryDeadline, b.nextAction, b.resolution, b.resolvedAt, b.receipt, b.revision)
		}
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_boundaries WHERE attempt_id = ?")).WithArgs("att-1").WillReturnRows(boundaryRows)

	entryRows := sqlmock.NewRows([]string{"id", "entry_generation", "entry_starts_at", "entry_confirmed_at", "entry_entered_at", "auto_start_at"})
	for _, m := range fixture {
		entryRows.AddRow(m.id, m.generation, m.entryStartsAt, m.entryConfirmedAt, m.entryEnteredAt, m.autoStartAt)
	}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, entry_generation")).WithArgs("att-1").WillReturnRows(entryRows)
}

func expectCombinedLifecycleModules(mock sqlmock.Sqlmock, fixture []lifecycleFixtureModule) {
	rows := sqlmock.NewRows([]string{
		"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at",
		"accumulated_paused_seconds", "extension_seconds", "completion_reason", "raw_correct", "operational_question_count",
		"tool_state", "revision", "entry_generation", "entry_starts_at", "entry_confirmed_at", "entry_entered_at", "auto_start_at",
		"section_key", "module_attempt_id", "phase", "policy_version", "work_deadline_at", "entry_deadline_at", "recovery_deadline_at",
		"next_action_at", "resolution", "resolved_at", "resolution_receipt", "boundary_revision",
	})
	for _, m := range fixture {
		values := []driver.Value{
			m.id, m.moduleID, m.state, m.allocated, m.availableAt, m.startedAt, m.pausedAt,
			m.accumulated, m.extension, m.completionReason, m.rawCorrect, m.operational,
			m.tools, m.revision, m.generation, m.entryStartsAt, m.entryConfirmedAt, m.entryEnteredAt, m.autoStartAt,
			m.sectionKey,
		}
		if b := m.boundary; b != nil {
			values = append(values, m.id, b.phase, b.policyVersion, b.workDeadline, b.entryDeadline, b.recoveryDeadline, b.nextAction, b.resolution, b.resolvedAt, b.receipt, b.revision)
		} else {
			values = append(values, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
		}
		rows.AddRow(values...)
	}
	mock.ExpectQuery(regexp.QuoteMeta("LEFT JOIN assessment_module_boundaries b")).WithArgs("att-1", "ver-1").WillReturnRows(rows)
}

// legacyLifecycleModules is the pre-change assembly, kept here as the oracle.
func legacyLifecycleModules(t *testing.T, svc *Service, scope map[string]bool, now time.Time) []ModuleAttempt {
	t.Helper()
	ctx := context.Background()
	rows, err := svc.db.QueryContext(ctx, `SELECT m.id, s.section_key FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE s.exam_version_id = ?`, "ver-1")
	if err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{}
	for rows.Next() {
		var moduleID, sectionKey string
		if err := rows.Scan(&moduleID, &sectionKey); err != nil {
			t.Fatal(err)
		}
		if examdomain.AllowsSection(scope, sectionKey) {
			allowed[moduleID] = true
		}
	}
	rows.Close()
	all, err := svc.loadModuleAttempts(ctx, "att-1", now)
	if err != nil {
		t.Fatal(err)
	}
	modules := make([]ModuleAttempt, 0, len(all))
	for _, m := range all {
		if allowed[m.ModuleID] {
			modules = append(modules, m)
		}
	}
	if err := svc.loadSATModuleBoundaries(ctx, "att-1", modules); err != nil {
		t.Fatal(err)
	}
	if err := svc.loadPersonalEntryOffers(ctx, "att-1", modules); err != nil {
		t.Fatal(err)
	}
	return modules
}

// The combined projection must equal the four-read assembly it replaces —
// same rows, order, scope filtering, nullable boundary, entry pointers and
// tool-state default — while issuing exactly one statement.
func TestSATLifecycleModulesMatchLegacyReads(t *testing.T) {
	now := time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
	scopes := map[string]map[string]bool{
		"unrestricted": nil,
		"rw-only":      {"rw": true},
		"denied":       {},
	}
	for name, scope := range scopes {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			svc := deliverySvc(db)
			fixture := lifecycleFixture(now)

			expectLegacyLifecycleModules(mock, fixture)
			want := legacyLifecycleModules(t, svc, scope, now)

			expectCombinedLifecycleModules(mock, fixture)
			got, err := svc.loadSATLifecycleModules(context.Background(), "att-1", "ver-1", scope, now)
			if err != nil {
				t.Fatal(err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("combined projection differs:\n got %+v\nwant %+v", got, want)
			}
			gotJSON, _ := json.Marshal(got)
			wantJSON, _ := json.Marshal(want)
			if string(gotJSON) != string(wantJSON) {
				t.Fatalf("wire projection differs:\n got %s\nwant %s", gotJSON, wantJSON)
			}
			if scope != nil && len(scope) == 0 && string(gotJSON) != "[]" {
				t.Fatalf("a denied scope must project an empty array, got %s", gotJSON)
			}
		})
	}
}

func TestSATLifecycleModulesProjection(t *testing.T) {
	now := time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	expectCombinedLifecycleModules(mock, lifecycleFixture(now))
	got, err := deliverySvc(db).loadSATLifecycleModules(context.Background(), "att-1", "ver-1", map[string]bool{"rw": true}, now)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, len(got))
	for _, m := range got {
		ids = append(ids, m.ID)
	}
	if !reflect.DeepEqual(ids, []string{"ma-1", "ma-2", "ma-4"}) {
		t.Fatalf("scoped rows in query order = %v", ids)
	}
	if got[1].SATBoundary != nil {
		t.Fatalf("a NULL boundary must stay nil, got %+v", got[1].SATBoundary)
	}
	if string(got[1].ToolState) != "{}" {
		t.Fatalf("NULL tool state must default to {}, got %s", got[1].ToolState)
	}
	if got[1].EntryGeneration == nil || *got[1].EntryGeneration != 2 || got[1].AutoStartAt == nil {
		t.Fatalf("entry offer lost: %+v", got[1])
	}
	if b := got[0].SATBoundary; b == nil || b.Phase != "resolved" || b.Revision != 4 || string(b.ResolutionReceipt) != `{"route":"hard"}` {
		t.Fatalf("resolved boundary lost: %+v", b)
	}
	// Paused: remaining is frozen at the pause instant (600+60+30 from start, paused 4 min in).
	if r := got[2].RemainingSeconds; r == nil || *r != 690-240 {
		t.Fatalf("paused remaining = %v", r)
	}
}
