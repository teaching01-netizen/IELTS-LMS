package main

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satstartcode"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestSATStartCodeAttemptQuotaMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	now := time.Now().UTC()
	f := newCodeStartFixture(t, db, now.Add(-time.Minute), now.Add(time.Hour))
	c := f.admit(t, "Quota candidate")
	code := f.code(t).Value
	for i := 0; i < 5; i++ {
		if _, err := f.start(c, wrongCode(code)); reasonOf(err) != "START_CODE_INVALID" {
			t.Fatalf("guess %d: %v", i, err)
		}
	}
	if _, err := f.start(c, code); reasonOf(err) != "START_CODE_RATE_LIMITED" {
		t.Fatalf("correct sixth submission must respect the stable attempt quota: %v", err)
	}
	var comparisons, accepted int
	if err := db.QueryRow("SELECT COUNT(*) FROM sat_start_code_reservations WHERE attempt_id = ?", c.attemptID).Scan(&comparisons); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM student_attempts WHERE id = ? AND sat_start_code_accepted_at IS NOT NULL", c.attemptID).Scan(&accepted); err != nil {
		t.Fatal(err)
	}
	if comparisons != 5 || accepted != 0 {
		t.Fatalf("comparisons=%d accepted=%d", comparisons, accepted)
	}
}

func TestSATStartCodePendingBudgetWaitsAcrossWindowsMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	f := newCodeStartFixture(t, db, now.Add(-time.Minute), now.Add(time.Hour))
	c := f.admit(t, "Pending budget candidate")
	code := f.code(t)
	var userID, studentKey string
	if err := db.QueryRowContext(ctx, "SELECT COALESCE(user_id, ''), student_key FROM student_attempts WHERE id = ?", c.attemptID).Scan(&userID, &studentKey); err != nil {
		t.Fatal(err)
	}
	principalKey := "student:" + studentKey
	if userID != "" {
		principalKey = "user:" + userID
	}
	quotaCount := func(route, key string) int64 {
		t.Helper()
		var count int64
		if err := db.QueryRowContext(ctx,
			"SELECT COALESCE(SUM(request_count), 0) FROM distributed_rate_limit_counters WHERE route_key = ? AND bucket_key = ?",
			route, key).Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count
	}
	if count := quotaCount("sat_start_code_attempt", c.attemptID); count != 0 {
		t.Fatalf("fresh attempt quota count=%d", count)
	}
	if count := quotaCount("sat_start_code_principal", principalKey); count != 0 {
		t.Fatalf("fresh principal quota count=%d", count)
	}
	// Unresolved reservations from a prior window still occupy capacity while
	// their leases are live. Keep the durable slot inventory consistent with
	// the reservation ledger, as production writes do in one transaction.
	var dbNow time.Time
	if err := db.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&dbNow); err != nil {
		t.Fatal(err)
	}
	oldWindow := dbNow.UTC().Truncate(10 * time.Minute).Add(-20 * time.Minute)
	lease := dbNow.UTC().Add(time.Minute)
	releaseID := ""
	for slotNo := 0; slotNo < 200; slotNo++ {
		reservationID, reservedAttemptID := uuid.NewString(), uuid.NewString()
		seedSATStartCodeReservationSlot(t, db, f.scheduleID, code.Generation, slotNo,
			reservationID, reservedAttemptID, "pending", oldWindow, lease)
		if slotNo == 0 {
			releaseID = reservationID
		}
	}

	waitMetric := telemetry.MSATStartCodeAdmissionWaitTotal
	waitLabels := []string{"stage", "capacity", "outcome", "waiting"}
	waitCount := telemetry.CounterValueForTest(telemetry.DefaultRegistry, waitMetric, waitLabels...)
	result := make(chan struct {
		kind string
		err  error
	}, 1)
	go func() {
		out, err := f.start(c, code.Value)
		kind := ""
		if out != nil {
			kind = out.Kind
		}
		result <- struct {
			kind string
			err  error
		}{kind: kind, err: err}
	}()
	waitForSATStartCodeCounter(t, waitMetric, waitCount, waitLabels...)
	var acceptedAt, moduleStartedAt sql.NullTime
	if err := db.QueryRowContext(ctx,
		"SELECT sat_start_code_accepted_at FROM student_attempts WHERE id = ?", c.attemptID).Scan(&acceptedAt); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx,
		"SELECT started_at FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", c.attemptID, f.baseID).Scan(&moduleStartedAt); err != nil {
		t.Fatal(err)
	}
	if acceptedAt.Valid || moduleStartedAt.Valid {
		t.Fatalf("attempt timer started while waiting for capacity: acceptedAt=%v moduleStartedAt=%v", acceptedAt, moduleStartedAt)
	}
	if inUse := db.Stats().InUse; inUse != 0 {
		t.Fatalf("admission waiter holds %d database connections", inUse)
	}
	var probe int
	if err := db.QueryRowContext(ctx, "SELECT 1").Scan(&probe); err != nil || probe != 1 {
		t.Fatalf("database query while start waits: value=%d error=%v", probe, err)
	}
	var pending, failed int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM sat_start_code_reservations WHERE schedule_id = ? AND generation = ? AND state = 'pending'",
		f.scheduleID, code.Generation).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM sat_start_code_reservations WHERE schedule_id = ? AND generation = ? AND state = 'failed'",
		f.scheduleID, code.Generation).Scan(&failed); err != nil {
		t.Fatal(err)
	}
	if pending != 200 || failed != 0 {
		t.Fatalf("while waiting pending=%d failed=%d; want 200 and 0", pending, failed)
	}
	releaseSATStartCodeReservationSlot(t, db, f.scheduleID, code.Generation, releaseID)
	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	var started struct {
		kind string
		err  error
	}
	select {
	case started = <-result:
	case <-timer.C:
		t.Fatal("start did not resume after pending capacity was released")
	}
	if started.err != nil || started.kind != "started" {
		t.Fatalf("start kind=%q error=%v", started.kind, started.err)
	}
	if count := quotaCount("sat_start_code_attempt", c.attemptID); count != 1 {
		t.Fatalf("internal capacity retry charged attempt quota %d times", count)
	}
	if count := quotaCount("sat_start_code_principal", principalKey); count != 1 {
		t.Fatalf("internal capacity retry charged principal quota %d times", count)
	}
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM student_attempts WHERE id = ? AND sat_start_code_accepted_at IS NOT NULL",
		c.attemptID).Scan(&probe); err != nil || probe != 1 {
		t.Fatalf("accepted attempt count=%d error=%v", probe, err)
	}
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = ?",
		f.scheduleID).Scan(&probe); err != nil || probe != 1 {
		t.Fatalf("runtime count=%d error=%v", probe, err)
	}
}

func TestSATStartCodeExpiredReservationCountsInOriginalWindowMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	f := newCodeStartFixture(t, db, now.Add(-time.Minute), now.Add(time.Hour))
	c := f.admit(t, "Expired reservation candidate")
	code := f.code(t)
	var dbNow time.Time
	if err := db.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&dbNow); err != nil {
		t.Fatal(err)
	}
	windowStart := dbNow.UTC().Truncate(10 * time.Minute)
	expiredID := uuid.NewString()
	expiredLease := dbNow.UTC().Add(-time.Second)
	seedSATStartCodeReservationSlot(t, db, f.scheduleID, code.Generation, 0,
		expiredID, uuid.NewString(), "pending", windowStart, expiredLease)
	for slotNo := 1; slotNo < 200; slotNo++ {
		seedSATStartCodeReservationSlot(t, db, f.scheduleID, code.Generation, slotNo,
			uuid.NewString(), uuid.NewString(), "failed", windowStart, dbNow.UTC())
	}
	if _, err := f.start(c, code.Value); reasonOf(err) != "START_CODE_COOLDOWN" {
		t.Fatalf("expired comparison must exhaust the original-window failure budget: %v", err)
	}
	var state string
	var storedWindow time.Time
	if err := db.QueryRowContext(ctx,
		"SELECT state, window_start FROM sat_start_code_reservations WHERE id = ?", expiredID).Scan(&state, &storedWindow); err != nil {
		t.Fatal(err)
	}
	if state != "failed" || !storedWindow.Equal(windowStart) {
		t.Fatalf("expired reservation state=%q window=%s, want failed in %s", state, storedWindow, windowStart)
	}
	var failures, accepted, runtimes int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM sat_start_code_reservations WHERE schedule_id = ? AND generation = ? AND window_start = ? AND state = 'failed'",
		f.scheduleID, code.Generation, windowStart).Scan(&failures); err != nil {
		t.Fatal(err)
	}
	if failures != 200 {
		t.Fatalf("failed comparisons=%d, want exactly 200", failures)
	}
	for range 2 {
		if _, err := f.app.Delivery.SweepStartCodeReservations(ctx, 500); err != nil {
			t.Fatalf("sweep expired reservations: %v", err)
		}
	}
	if err := db.QueryRowContext(ctx,
		"SELECT state, window_start FROM sat_start_code_reservations WHERE id = ?", expiredID).Scan(&state, &storedWindow); err != nil {
		t.Fatal(err)
	}
	if state != "failed" || !storedWindow.Equal(windowStart) {
		t.Fatalf("sweeper changed expired reservation state=%q window=%s", state, storedWindow)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM student_attempts WHERE id = ? AND sat_start_code_accepted_at IS NOT NULL", c.attemptID).Scan(&accepted); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = ?", f.scheduleID).Scan(&runtimes); err != nil {
		t.Fatal(err)
	}
	if accepted != 0 || runtimes != 0 {
		t.Fatalf("invalid capacity state: accepted=%d runtimes=%d", accepted, runtimes)
	}
}

func TestSATStartCodeRotationWhileCapacityWaitsMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	f := newCodeStartFixture(t, db, now.Add(-time.Minute), now.Add(time.Hour))
	c := f.admit(t, "Rotation waiter")
	code := f.code(t)
	oldWindow := time.Now().UTC().Truncate(10 * time.Minute).Add(-20 * time.Minute)
	lease := time.Now().UTC().Add(time.Minute)
	releaseID := ""
	for slotNo := 0; slotNo < 200; slotNo++ {
		reservationID, reservedAttemptID := uuid.NewString(), uuid.NewString()
		seedSATStartCodeReservationSlot(t, db, f.scheduleID, code.Generation, slotNo,
			reservationID, reservedAttemptID, "pending", oldWindow, lease)
		if slotNo == 0 {
			releaseID = reservationID
		}
	}
	waitMetric := telemetry.MSATStartCodeAdmissionWaitTotal
	labels := []string{"stage", "capacity", "outcome", "waiting"}
	before := telemetry.CounterValueForTest(telemetry.DefaultRegistry, waitMetric, labels...)
	result := make(chan error, 1)
	go func() {
		_, err := f.start(c, code.Value)
		result <- err
	}()
	waitForSATStartCodeCounter(t, waitMetric, before, labels...)
	var rotated satstartcode.Code
	if err := tx.NewRunner(db).WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		var err error
		rotated, err = satstartcode.RotateTx(ctx, q, f.scheduleID, code.Generation, "proctor-1")
		return err
	}); err != nil {
		t.Fatalf("rotate while candidate waits: %v", err)
	}
	if rotated.Generation != code.Generation+1 {
		t.Fatalf("rotated generation=%d, want %d", rotated.Generation, code.Generation+1)
	}
	releaseSATStartCodeReservationSlot(t, db, f.scheduleID, code.Generation, releaseID)
	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	var startErr error
	select {
	case startErr = <-result:
	case <-timer.C:
		t.Fatal("rotated waiter did not leave capacity wait")
	}
	if reasonOf(startErr) != "START_CODE_ROTATED" {
		t.Fatalf("old-generation waiter result=%v, want START_CODE_ROTATED", startErr)
	}
	var newGenerationReservations, accepted int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM sat_start_code_reservations WHERE schedule_id = ? AND generation = ? AND state IN ('pending', 'failed')",
		f.scheduleID, rotated.Generation).Scan(&newGenerationReservations); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM student_attempts WHERE id = ? AND sat_start_code_accepted_at IS NOT NULL",
		c.attemptID).Scan(&accepted); err != nil {
		t.Fatal(err)
	}
	if newGenerationReservations != 0 || accepted != 0 {
		t.Fatalf("new-generation reservations=%d accepted=%d", newGenerationReservations, accepted)
	}
}
func TestSATStartCodeDistinctCandidatesDoNotWaitOnGenerationGuardMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	now := time.Now().UTC()
	f := newCodeStartFixture(t, db, now.Add(-time.Minute), now.Add(time.Hour))
	code := f.code(t)
	const candidateCount = 32
	candidates := make([]codeStartCandidate, candidateCount)
	for i := range candidates {
		candidates[i] = f.admit(t, "Independent slot claimant")
	}

	guardTx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = guardTx.Rollback() }()
	var lockedGeneration int
	if err := guardTx.QueryRowContext(context.Background(),
		"SELECT generation FROM sat_start_code_guards WHERE schedule_id = ? AND generation = ? FOR UPDATE",
		f.scheduleID, code.Generation).Scan(&lockedGeneration); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	results := make(chan error, candidateCount)
	for _, candidate := range candidates {
		candidate := candidate
		go func() {
			_, err := f.startWithContext(ctx, candidate, wrongCode(code.Value))
			results <- err
		}()
	}
	var firstFailure error
	for i := 0; i < candidateCount; i++ {
		select {
		case err := <-results:
			if reasonOf(err) != "START_CODE_INVALID" && firstFailure == nil {
				firstFailure = err
			}
		case <-ctx.Done():
			cancel()
			_ = guardTx.Rollback()
			for remaining := i; remaining < candidateCount; remaining++ {
				<-results
			}
			t.Fatalf("slot claims waited on the generation guard: completed=%d", i)
		}
	}
	if firstFailure != nil {
		_ = guardTx.Rollback()
		t.Fatalf("independent comparison failed while guard was locked: %v", firstFailure)
	}
	if err := guardTx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var total, pending, failed int
	if err := db.QueryRowContext(context.Background(),
		`SELECT COUNT(*), COUNT(CASE WHEN state = 'pending' THEN 1 END),
			COUNT(CASE WHEN state = 'failed' THEN 1 END)
		FROM sat_start_code_reservation_slots WHERE schedule_id = ? AND generation = ?`,
		f.scheduleID, code.Generation).Scan(&total, &pending, &failed); err != nil {
		t.Fatal(err)
	}
	if total != 200 || pending != 0 || failed != candidateCount {
		t.Fatalf("slots total=%d pending=%d failed=%d; want 200, 0, %d", total, pending, failed, candidateCount)
	}
}

func TestSATStartCodeSlotInventoryLifecycleMySQL(t *testing.T) {

	const budgetSlots = 200
	db := staleETagTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	f := newCodeStartFixture(t, db, now.Add(-time.Minute), now.Add(time.Hour))
	assertInventory := func(generation int, want int, wantState string) {
		t.Helper()
		var total, matching int
		if err := db.QueryRowContext(ctx,
			"SELECT COUNT(*), COUNT(CASE WHEN state = ? THEN 1 END) FROM sat_start_code_reservation_slots WHERE schedule_id = ? AND generation = ?",
			wantState, f.scheduleID, generation).Scan(&total, &matching); err != nil {
			t.Fatal(err)
		}
		if total != want || matching != want {
			t.Fatalf("generation %d slot inventory total=%d %s=%d; want %d", generation, total, wantState, matching, want)
		}
	}

	assertInventory(1, budgetSlots, "free")
	var rotated satstartcode.Code
	if err := tx.NewRunner(db).WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		var err error
		rotated, err = satstartcode.RotateTx(ctx, q, f.scheduleID, 1, "proctor-1")
		return err
	}); err != nil {
		t.Fatalf("rotate code: %v", err)
	}
	if rotated.Generation != 2 {
		t.Fatalf("rotated generation=%d, want 2", rotated.Generation)
	}
	assertInventory(1, budgetSlots, "free")
	assertInventory(2, budgetSlots, "free")

	if err := tx.NewRunner(db).WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		return satstartcode.SwitchModeTx(ctx, q, f.scheduleID, "sat", "code start cohort", satstartcode.ModeProctor, "proctor-1")
	}); err != nil {
		t.Fatalf("switch to proctor start: %v", err)
	}
	var remaining int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM sat_start_code_reservation_slots WHERE schedule_id = ?", f.scheduleID).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("proctor-mode schedule retained %d start-code slots", remaining)
	}
}

func seedSATStartCodeReservationSlot(t *testing.T, db *sql.DB, scheduleID string, generation, slotNo int, reservationID, attemptID, state string, windowStart, leaseExpiresAt time.Time) {
	t.Helper()
	if state != "pending" && state != "failed" {
		t.Fatalf("unsupported fixture reservation state %q", state)
	}
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO sat_start_code_reservations
		(id, schedule_id, generation, attempt_id, window_start, lease_expires_at, state)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		reservationID, scheduleID, generation, attemptID, windowStart, leaseExpiresAt, state); err != nil {
		t.Fatal(err)
	}
	result, err := tx.ExecContext(ctx,
		`UPDATE sat_start_code_reservation_slots
		SET state = ?,
			reservation_id = CASE WHEN ? = 'pending' THEN ? ELSE NULL END,
			attempt_id = CASE WHEN ? = 'pending' THEN ? ELSE NULL END,
			window_start = ?,
			lease_expires_at = CASE WHEN ? = 'pending' THEN ? ELSE NULL END
		WHERE schedule_id = ? AND generation = ? AND slot_no = ? AND state = 'free'`,
		state, state, reservationID, state, attemptID, windowStart, state, leaseExpiresAt,
		scheduleID, generation, slotNo)
	if err != nil {
		t.Fatal(err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		t.Fatalf("seed slot %d affected=%d error=%v", slotNo, affected, err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func releaseSATStartCodeReservationSlot(t *testing.T, db *sql.DB, scheduleID string, generation int, reservationID string) {
	t.Helper()
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx,
		"UPDATE sat_start_code_reservations SET state = 'released', settled_at = UTC_TIMESTAMP(6) WHERE id = ? AND schedule_id = ? AND state = 'pending'",
		reservationID, scheduleID)
	if err != nil {
		t.Fatal(err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		t.Fatalf("release reservation affected=%d error=%v", affected, err)
	}
	result, err = tx.ExecContext(ctx,
		`UPDATE sat_start_code_reservation_slots
		SET state = 'free', reservation_id = NULL, attempt_id = NULL,
			window_start = NULL, lease_expires_at = NULL
		WHERE schedule_id = ? AND generation = ? AND reservation_id = ? AND state = 'pending'`,
		scheduleID, generation, reservationID)
	if err != nil {
		t.Fatal(err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		t.Fatalf("release slot affected=%d error=%v", affected, err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func waitForSATStartCodeCounter(t *testing.T, metric string, before float64, labels ...string) {
	t.Helper()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for {
		if telemetry.CounterValueForTest(telemetry.DefaultRegistry, metric, labels...) > before {
			return
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatalf("timed out waiting for telemetry counter %s labels=%v", metric, labels)
		}
	}
}
