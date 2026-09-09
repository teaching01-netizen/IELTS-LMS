package student

// Plan D2/E-exam-day: the presence dashboard slice (touch vs flush) is
// the operator's zero-SQL proof. Beats must count touches; flush batches
// must count flushes; empty flushes must count nothing. RED: counters
// track Touch/FlushPresence exactly.
import (
	"context"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// The service beat path (RecordHeartbeatMemory) must count exactly one
// touch per NEW beat and zero for mutation retries — the touch series is
// the zero-SQL proof, so over/under-counting blinds or lies to operators.
func TestRecordHeartbeatMemoryEmitsOneTouch(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil).SetPresence(NewPresenceMap(90 * time.Second))
	ctx := context.Background()
	beat := func(mut string) {
		mock.ExpectQuery("SELECT schedule_id FROM student_attempts").
			WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"schedule_id"}).AddRow("sched-1"))
		mock.ExpectQuery("FROM student_attempts WHERE id").
			WithArgs("att-1", "sched-1").
			WillReturnRows(v1AttemptRows("att-1", "sched-1"))
		if _, err := svc.RecordHeartbeatMemory(ctx, HeartbeatRequest{
			AttemptID: "att-1", ScheduleID: "sched-1", ClientSessionID: "sess-a",
			MutationID: mut, EventType: "heartbeat",
		}); err != nil {
			t.Fatalf("beat %s: %v", mut, err)
		}
	}
	beat("mut-1")
	if got := telemetry.CounterValueForTest(reg, telemetry.MPresenceTouch); got != 1 {
		t.Fatalf("new beat must count 1 touch, got %v", got)
	}
	beat("mut-1") // same mutation = retry, must not re-touch
	if got := telemetry.CounterValueForTest(reg, telemetry.MPresenceTouch); got != 1 {
		t.Fatalf("mutation retry must not re-touch, got %v", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MPresenceDedupeHit); got != 1 {
		t.Fatalf("mutation retry must count 1 dedupe hit, got %v", got)
	}
	beat("mut-2") // new mutation = new beat
	if got := telemetry.CounterValueForTest(reg, telemetry.MPresenceTouch); got != 2 {
		t.Fatalf("second beat must count 2 touches, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPresenceEmitTouchAndFlush(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil)
	p := NewPresenceMap(90 * time.Second)
	now := time.Now().UTC()
	p.Touch("att-1", "sched-1", "sess-a", "heartbeat", now)
	p.Touch("att-1", "sched-1", "sess-a", "heartbeat", now.Add(time.Second))
	dirty := p.DrainDirty()
	if len(dirty) != 1 {
		t.Fatalf("first touch drains once: %+v", dirty)
	}
	// Touch() itself is counter-silent (the map is pure); the service
	// beat path counts touches. Flush counts batches. Pin both here:
	// direct Touch emits nothing...
	if got := telemetry.CounterValueForTest(reg, telemetry.MPresenceTouch); got != 0 {
		t.Fatalf("map Touch must not emit (service beat path owns the counter), got %v", got)
	}
	mock.ExpectExec("INSERT INTO student_heartbeat_events").
		WithArgs(sqlmock.AnyArg(), "att-1", "sched-1", sqlmock.AnyArg(), "heartbeat", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT integrity, recovery FROM student_attempts").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"integrity", "recovery"}).AddRow(`{}`, `{}`))
	mock.ExpectExec("UPDATE student_attempts SET integrity").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "sess-a", "att-1", "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	if err := svc.FlushPresence(context.Background(), dirty); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MPresenceFlush); got != 1 {
		t.Fatalf("flush batch must count 1, got %v", got)
	}
	if got := telemetry.GaugeValueForTest(reg, telemetry.MPresenceFlushRows); got != 1 {
		t.Fatalf("flush of 1 row must gauge 1, got %v", got)
	}
	if err := svc.FlushPresence(context.Background(), nil); err != nil {
		t.Fatalf("empty flush: %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MPresenceFlush); got != 1 {
		t.Fatalf("empty flush must not count, got %v", got)
	}
}
