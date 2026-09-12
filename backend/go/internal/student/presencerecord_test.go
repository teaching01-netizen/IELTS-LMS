package student

import (
	"context"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// D2 RED: memory RecordHeartbeat = Touch + dedupe, zero SQL: same mutation
// retried returns the projection without touching the DB.
func TestRecordHeartbeatMemoryDedupes(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil).SetPresence(NewPresenceMap(90 * 1000000000))
	ctx := context.Background()
	// First beat: no attempt row is locked (memory path skips the tx;
	// identity was established at the HTTP boundary). Projection queries:
	// schedule probe + full V1 attempt row (35 columns, FOR UPDATE suffix
	// harmless on sqlmock match).
	mock.ExpectQuery("SELECT schedule_id FROM student_attempts").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id"}).AddRow("sched-1"))
	mock.ExpectQuery("FROM student_attempts WHERE id").
		WithArgs("att-1", "sched-1").
		WillReturnRows(v1AttemptRows("att-1", "sched-1"))
	if _, deduped, err := svc.RecordHeartbeatMemory(ctx, HeartbeatRequest{
		AttemptID: "att-1", ScheduleID: "sched-1", ClientSessionID: "sess-a",
		MutationID: "mut-1", EventType: "heartbeat",
	}); err != nil {
		t.Fatalf("first: %v", err)
	} else if deduped {
		t.Fatal("first beat must not report deduped")
	}
	// Retry with the same mutation: no SECOND beat is recorded (presence
	// LastSeen unchanged) and no heartbeat-event write occurs. The
	// projection re-read is 2 indexed reads (no tx, no FOR UPDATE, no
	// INSERT): assert exactly that shape.
	before, _ := svc.PresenceMap().Lookup("att-1")
	mock.ExpectQuery("SELECT schedule_id FROM student_attempts").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id"}).AddRow("sched-1"))
	mock.ExpectQuery("FROM student_attempts WHERE id").
		WithArgs("att-1", "sched-1").
		WillReturnRows(v1AttemptRows("att-1", "sched-1"))
	if _, deduped, err := svc.RecordHeartbeatMemory(ctx, HeartbeatRequest{
		AttemptID: "att-1", ScheduleID: "sched-1", ClientSessionID: "sess-a",
		MutationID: "mut-1", EventType: "heartbeat",
	}); err != nil {
		t.Fatalf("retry: %v", err)
	} else if !deduped {
		t.Fatal("retry must report deduped=true")
	}
	after, _ := svc.PresenceMap().Lookup("att-1")
	if !after.LastSeen.Equal(before.LastSeen) {
		t.Fatalf("retry must not re-touch presence")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// v1AttemptRows builds the 35-column projection row the memory path reads.
func v1AttemptRows(attemptID, scheduleID string) *sqlmock.Rows {
	cols := []string{"id", "schedule_id", "student_key", "user_id", "exam_id", "published_version_id", "exam_title", "candidate_id", "candidate_name", "candidate_email", "phase", "current_module", "current_question_id", "answers", "writing_answers", "flags", "violations_snapshot", "integrity", "recovery", "final_submission", "submitted_at", "created_at", "updated_at", "revision", "answer_revision", "protocol_version", "delivery_status", "lease_epoch", "control_epoch", "response_revision", "deadline_at", "closing_grace_until", "final_response_digest", "active_client_session_id", "proctor_status"}
	return sqlmock.NewRows(cols).AddRow(
		attemptID, scheduleID, "sk-1", nil, "exam-1", "v-1", "Exam", "c1", "Alice", "a@x", "lobby", "listening", nil,
		`{}`, `{}`, `{}`, `[]`, `{}`, `{}`, nil, nil, nil, nil, 0, 0, 2, "running", 1, 1, 0, nil, nil, nil, nil, "active",
	)
}

// D2 RED: invalid event types fail closed (never touch presence).
func TestRecordHeartbeatMemoryValidation(t *testing.T) {
	svc := NewService(nil, nil).SetPresence(NewPresenceMap(90 * 1000000000))
	if _, _, err := svc.RecordHeartbeatMemory(context.Background(), HeartbeatRequest{
		AttemptID: "att-1", ScheduleID: "sched-1", EventType: "bogus",
	}); err == nil {
		t.Fatalf("bogus event must fail")
	}
}
