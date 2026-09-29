package integration

// SAT RAWDATA export against real MySQL (skips without TEST_MYSQL_DSN like the
// rest of this package).
//
// The unit suite covers row assembly with sqlmock. This test proves the parts
// sqlmock cannot: the three bulk queries actually execute on MySQL/TiDB
// (CAST(... AS CHAR), the COLLATE in the V2 dedupe ORDER BY, and the
// correlated published_version_id fence), the read-only repeatable-read
// transaction commits, and the projection stays a fixed 50 columns for a
// Student Access group that mixes sections and an attempt with no modules.
import (
	"context"
	"reflect"
	"sync"
	"testing"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/results"
)

func TestSATRawdataExportAgainstMySQL(t *testing.T) {
	f := newAdaptiveExam(t)
	ctx := context.Background()

	// Two Verbal students (Module 1, active) with different V2 scores, one Math
	// student, and one registered-but-never-entered attempt.
	f.seedStudent(f.rw, 2, false)
	f.seedStudent(f.rw, 0, false)
	f.seedStudent(f.math, 1, false)
	seedBareAttempt(t, f)

	out, err := results.NewService(f.db).ExportSATRawdata(ctx,
		auth.NewActorContext("integration-admin", auth.RoleAdmin), f.examID, f.scheduleID)
	if err != nil {
		t.Fatalf("ExportSATRawdata: %v", err)
	}

	if out.SchemaVersion != results.SATRawdataSchemaVersion || out.ColumnCount != results.SATRawdataColumns {
		t.Fatalf("unexpected schema metadata: %+v", out)
	}
	if len(out.HeaderRows) != 2 {
		t.Fatalf("expected 2 header rows, got %d", len(out.HeaderRows))
	}
	for i, header := range out.HeaderRows {
		if len(header) != results.SATRawdataColumns {
			t.Fatalf("header row %d is %d wide, want %d", i+1, len(header), results.SATRawdataColumns)
		}
	}
	// Three module rows plus one blank row for the attempt that never entered.
	if out.RowCount != 4 || len(out.Rows) != 4 {
		t.Fatalf("expected 4 rows, got %d", out.RowCount)
	}

	var (
		verbal, math, blank int
		sawCorrectAnswer    bool
	)
	for i, row := range out.Rows {
		if len(row) != results.SATRawdataColumns {
			t.Fatalf("row %d is %d wide, want %d", i, len(row), results.SATRawdataColumns)
		}
		empty := true
		for _, cell := range row {
			if cell != "" {
				empty = false
				break
			}
		}
		if empty {
			blank++
			continue
		}
		// Every administered row carries the module code and RECHECK anchor.
		if row[48] != "A" || row[49] != "TRUE" {
			t.Fatalf("row %d lost its placement anchors: code=%q recheck=%q", i, row[48], row[49])
		}
		switch row[5] {
		case "27":
			verbal++
		case "22":
			math++
		default:
			t.Fatalf("row %d has an unexpected points-available value %q", i, row[5])
		}
		for q := 0; q < 27; q++ {
			if row[21+q] == "1" {
				sawCorrectAnswer = true
			}
		}
	}
	if verbal != 2 || math != 1 || blank != 1 {
		t.Fatalf("expected 2 verbal + 1 math + 1 blank row, got %d/%d/%d", verbal, math, blank)
	}
	if !sawCorrectAnswer {
		t.Fatal("V2 answers were not projected into any question cell")
	}
}

// TestSATRawdataExportConcurrentReadersAgree covers TC-CONCURRENT-001: two
// admins exporting the same Student Access group at the same moment must both
// succeed — the read-only repeatable-read snapshot takes no lock that would
// serialize or deadlock them — and must see an identical projection.
func TestSATRawdataExportConcurrentReadersAgree(t *testing.T) {
	f := newAdaptiveExam(t)
	f.seedStudent(f.rw, 2, false)
	f.seedStudent(f.math, 1, false)
	seedBareAttempt(t, f)

	svc := results.NewService(f.db)
	actor := auth.NewActorContext("integration-admin", auth.RoleAdmin)

	const readers = 2
	outs := make([]*results.SATRawdataExport, readers)
	errs := make([]error, readers)
	var wg sync.WaitGroup
	for i := 0; i < readers; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			outs[index], errs[index] = svc.ExportSATRawdata(context.Background(), actor, f.examID, f.scheduleID)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("concurrent export %d failed: %v", i, err)
		}
	}
	if outs[0].RowCount == 0 {
		t.Fatal("fixture precondition: the export must project rows")
	}
	if outs[0].RowCount != outs[1].RowCount {
		t.Fatalf("concurrent exports disagree on row count: %d vs %d", outs[0].RowCount, outs[1].RowCount)
	}
	if !reflect.DeepEqual(outs[0].Rows, outs[1].Rows) {
		t.Fatal("concurrent exports produced different rows for the same snapshot")
	}
}

// seedBareAttempt inserts one student_attempts row with no module attempt,
// proving the export boundary is attempt existence, not administered modules.
func seedBareAttempt(t *testing.T, f *adaptiveExam) string {
	t.Helper()
	attemptID := uuid.NewString()
	if _, err := f.db.ExecContext(context.Background(), `INSERT INTO student_attempts (
		id, schedule_id, student_key, organization_id, exam_id,
		published_version_id, exam_title, candidate_id, candidate_name,
		candidate_email, phase, current_module, answers, writing_answers,
		flags, violations_snapshot, integrity, recovery, revision,
		protocol_version, delivery_status, lease_epoch, control_epoch, response_revision,
		wcode
	) VALUES (?, ?, ?, ?, ?, ?, 'SAT adaptive integration', ?, 'Bare Candidate',
		'bare@example.test', 'pre-check', 'reading', '{}', '{}', '{}', '[]', '{}', '{}', 0,
		2, 'running', 1, 1, 0, ?)`,
		attemptID, f.scheduleID, attemptID, "adaptive-org", f.examID, f.versionID,
		"bare-"+attemptID[:8], "W-"+attemptID); err != nil {
		t.Fatalf("seed bare attempt: %v", err)
	}
	return attemptID
}
