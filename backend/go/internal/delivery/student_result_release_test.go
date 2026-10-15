package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/sat"
)

// The student release policy must fail closed: only an explicitly visible
// status ever exposes score fields, and an unknown provider/status/NULL never
// does. This is the single predicate behind every student-facing score field.
func TestStudentResultScoreVisible(t *testing.T) {
	cases := []struct {
		name     string
		provider string
		release  string
		want     bool
	}{
		{"released sat is visible", "sat", "released", true},
		{"released is case insensitive", "SAT", "Released", true},
		{"pending sat is withheld", "sat", "pending", false},
		{"ready_to_release sat is withheld until a release step exists", "sat", "ready_to_release", false},
		{"invalidated sat is withheld", "sat", "invalidated", false},
		{"empty status fails closed", "sat", "", false},
		{"whitespace status fails closed", "sat", "   ", false},
		{"released act is visible", "act", "released", true},
		{"pending act is withheld", "act", "pending", false},
		{"unknown provider only trusts released", "unknown-provider", "released", true},
		{"unknown provider withholds anything else", "unknown-provider", "pending", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := StudentResultScoreVisible(tc.provider, tc.release); got != tc.want {
				t.Fatalf("StudentResultScoreVisible(%q, %q) = %v, want %v", tc.provider, tc.release, got, tc.want)
			}
		})
	}
}

// A withheld SAT result keeps the completion receipt (the student client gates
// its complete phase on result != null and reads the outcome) but must serialise
// no score fields at all.
func TestStudentSafeBootstrapResultWithholdsSATTotals(t *testing.T) {
	total := 1380
	released := &sat.AssessmentResult{
		ID: "res-1", AttemptID: "att-1", ProviderKey: "sat",
		OutcomeStatus: "scored", ScoreKind: "practice", TotalScore: &total,
		ScorePayload:  map[string]any{"raw": 39},
		ReleaseStatus: "released",
		Sections:      []sat.SectionResult{{SectionKey: "reading-writing"}},
	}

	// Released keeps the score fields; the payload is narrowed to the
	// allowlisted raw summary (see satReleasedProjection).
	got, ok := studentSafeBootstrapResult("sat", released).(*sat.AssessmentResult)
	if !ok || got.TotalScore == nil || *got.TotalScore != total || len(got.Sections) != 1 || got.ScorePayload != nil {
		t.Fatalf("released result must keep totals and drop non-allowlisted payload, got %#v", got)
	}

	pending := *released
	pending.ReleaseStatus = "pending"
	projected, ok := studentSafeBootstrapResult("sat", &pending).(*sat.AssessmentResult)
	if !ok {
		t.Fatalf("expected *sat.AssessmentResult receipt projection, got %T", studentSafeBootstrapResult("sat", &pending))
	}
	if projected.ID != "res-1" || projected.OutcomeStatus != "scored" || projected.ReleaseStatus != "pending" {
		t.Fatalf("receipt must keep identity/outcome/release, got %#v", projected)
	}
	if projected.TotalScore != nil || projected.ScorePayload != nil || projected.Sections != nil || projected.ScoreKind != "" {
		t.Fatalf("withheld result must drop every score field, got %#v", projected)
	}

	raw, err := json.Marshal(projected)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	if wire["totalScore"] != nil || wire["scorePayload"] != nil || wire["sections"] != nil {
		t.Fatalf("withheld wire payload leaked a score field: %s", raw)
	}
	if wire["outcomeStatus"] != "scored" || wire["releaseStatus"] != "pending" {
		t.Fatalf("withheld wire payload lost its receipt fields: %s", raw)
	}

	// A nil result stays nil: withholding must not resurrect a result for an
	// attempt that never had one.
	if got := studentSafeBootstrapResult("sat", (*sat.AssessmentResult)(nil)); got != (*sat.AssessmentResult)(nil) {
		t.Fatalf("nil SAT result must stay nil, got %#v", got)
	}
}

// The ACT bootstrap result is a free-form map; the receipt projection keeps the
// identity + outcome keys and drops the score payload.
func TestStudentSafeBootstrapResultWithholdsACTScorePayload(t *testing.T) {
	released := map[string]any{
		"id": "res-2", "attemptId": "att-2", "providerKey": "act",
		"outcomeStatus": "scored", "releaseStatus": "released",
		"totalScore": int64(30), "scorePayload": map[string]any{"percentile": 92.0},
	}
	if got := studentSafeBootstrapResult("act", released); got == nil {
		t.Fatal("released ACT result must pass through")
	}

	pending := map[string]any{
		"id": "res-2", "submissionId": "sub-2", "attemptId": "att-2", "providerKey": "act",
		"outcomeStatus": "scored", "releaseStatus": "pending",
		"totalScore": int64(30), "scorePayload": map[string]any{"percentile": 92.0},
	}
	projected, ok := studentSafeBootstrapResult("act", pending).(map[string]any)
	if !ok {
		t.Fatal("expected map receipt projection")
	}
	if _, leaked := projected["totalScore"]; leaked {
		t.Fatalf("withheld ACT receipt leaked totalScore: %#v", projected)
	}
	if _, leaked := projected["scorePayload"]; leaked {
		t.Fatalf("withheld ACT receipt leaked scorePayload: %#v", projected)
	}
	if projected["outcomeStatus"] != "scored" || projected["releaseStatus"] != "pending" || projected["submissionId"] != "sub-2" {
		t.Fatalf("withheld ACT receipt lost receipt fields: %#v", projected)
	}
}

func TestStudentSafeBootstrapResultReleasedSATExposesOnlyRawSummary(t *testing.T) {
	in := &sat.AssessmentResult{
		ID: "r1", AttemptID: "a1", ProviderKey: "sat", OutcomeStatus: "scored", ReleaseStatus: "released",
		ScorePayload: map[string]any{
			"classroomRaw": map[string]any{"rawCorrect": 35, "total": 49},
			"snapshot":     map[string]any{"answers": map[string]any{"q1": "B"}},
		},
	}
	got, ok := studentSafeBootstrapResult("sat", in).(*sat.AssessmentResult)
	if !ok {
		t.Fatal("expected a SAT result projection")
	}
	if len(got.ScorePayload) != 1 || got.ScorePayload["classroomRaw"] == nil {
		t.Fatalf("released payload must carry only classroomRaw, got %v", got.ScorePayload)
	}
	if in.ScorePayload["snapshot"] == nil {
		t.Fatal("projection must not mutate the stored result")
	}
}

// Model: verification/lean/sat-result (Release.student_view_gate,
// Release.flag_off_hides_released): the exam's score-report flag is read
// live, so turning it off hides an already-released report.
func TestLoadBootstrapResultReadsScoreReportFlagLive(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		mock.ExpectQuery("FROM assessment_results WHERE attempt_id").WithArgs("a1").
			WillReturnRows(sqlmock.NewRows([]string{"id", "attempt_id", "submission_id", "provider_key", "outcome_status", "total_score", "score_payload", "release_status"}).
				AddRow("r1", "a1", "s1", "sat", "scored", nil, `{"classroomRaw":{"rawCorrect":7,"total":10},"snapshot":{}}`, "released"))
		mock.ExpectQuery("FROM assessment_section_results").WithArgs("r1").
			WillReturnRows(sqlmock.NewRows([]string{"section_key", "route", "raw_correct", "operational_question_count", "scaled_score", "details"}))
		mock.ExpectQuery("sat_score_report_enabled").WithArgs("a1").
			WillReturnRows(sqlmock.NewRows([]string{"enabled"}).AddRow(enabled))
		submitted := time.Now()
		got, err := NewService(db, nil).loadBootstrapResult(context.Background(), "sat", "a1", attemptControl{submittedAt: &submitted})
		if err != nil {
			t.Fatal(err)
		}
		res, ok := got.(*sat.AssessmentResult)
		if !ok || res == nil || res.ReleaseStatus != "released" {
			t.Fatalf("enabled=%v: want the released receipt, got %#v", enabled, got)
		}
		if shown := res.ScorePayload["classroomRaw"] != nil; shown != enabled {
			t.Fatalf("enabled=%v: classroomRaw shown=%v", enabled, shown)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}

func TestStudentSATResultUsesLiveGateAndStripsSnapshot(t *testing.T) {
	for _, tc := range []struct {
		name    string
		release string
		enabled bool
		readErr error
		visible bool
	}{
		{name: "released and enabled", release: "released", enabled: true, visible: true},
		{name: "disabled after release", release: "released"},
		{name: "missing gate fails closed", release: "released", readErr: sql.ErrNoRows},
		{name: "gate read failure", release: "released", readErr: errors.New("database unavailable")},
		{name: "pending", release: "pending"},
		{name: "invalidated", release: "invalidated"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if tc.release == "released" {
				query := mock.ExpectQuery("sat_score_report_enabled").WithArgs("a1")
				if tc.readErr != nil {
					query.WillReturnError(tc.readErr)
				} else {
					query.WillReturnRows(sqlmock.NewRows([]string{"enabled"}).AddRow(tc.enabled))
				}
			}
			in := &sat.AssessmentResult{
				ID: "r1", AttemptID: "a1", ReleaseStatus: tc.release,
				ScorePayload: map[string]any{
					"classroomRaw": map[string]any{"totalScaled": map[string]any{"low": 1100, "high": 1100}},
					"snapshot":     map[string]any{"answers": "private"},
				},
			}
			out, err := StudentSATResult(context.Background(), db, in)
			if tc.readErr != nil && tc.readErr != sql.ErrNoRows {
				if !errors.Is(err, tc.readErr) || out != nil {
					t.Fatalf("read failure must not expose result: %+v, %v", out, err)
				}
			} else {
				if err != nil || out == nil || out.ID != in.ID {
					t.Fatalf("receipt = %+v, %v", out, err)
				}
				if (out.ScorePayload["classroomRaw"] != nil) != tc.visible {
					t.Fatalf("unexpected score visibility: %+v", out)
				}
				if out.ScorePayload["snapshot"] != nil {
					t.Fatal("snapshot exposed")
				}
				if in.ScorePayload["snapshot"] == nil {
					t.Fatal("stored payload mutated")
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
