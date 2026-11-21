package main

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satlearning"
	"example.com/ielts-proctoring/internal/schedules"
)

// Configuration given at creation is persisted in the same transaction as the
// blueprint; an invalid one leaves no exam behind.
func TestSatExamConfigAtCreateMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	provider := "sat"
	cfg := exams.DefaultSATExamConfig()
	math := cfg.Sections["math"]
	math.Module1Minutes, math.MinimumCorrectForHigher, math.BreakAfterMinutes = 40, 7, 5
	cfg.Sections["math"] = math
	yes := true
	cfg.ShowClassroomScoreReport = &yes
	slug := "cfg-" + uuid.NewString()
	exam, err := h.exams.Create(ctx, exams.CreateRequest{Slug: slug, Title: "Configured", ExamType: "Academic", Visibility: "private", ProviderKey: &provider, OwnerID: h.actor, SATConfig: &cfg})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.exams.Delete(ctx, exam.ID) })
	if !exam.SatScoreReportEnabled {
		t.Fatal("score report switch not persisted")
	}
	var dur, brk, threshold int
	if err := h.db.QueryRow(`SELECT m.duration_seconds FROM assessment_modules m JOIN assessment_sections s ON s.id=m.section_id JOIN exam_entities e ON e.current_draft_version_id=s.exam_version_id WHERE e.id=? AND m.module_key='math-m1'`, exam.ID).Scan(&dur); err != nil || dur != 2400 {
		t.Fatalf("module1 duration=%d err=%v", dur, err)
	}
	if err := h.db.QueryRow(`SELECT s.break_after_seconds, JSON_EXTRACT(rp.policy_config,'$.minimumCorrectForHigher') FROM assessment_sections s JOIN assessment_routing_policies rp ON rp.section_id=s.id JOIN exam_entities e ON e.current_draft_version_id=s.exam_version_id WHERE e.id=? AND s.section_key='math'`, exam.ID).Scan(&brk, &threshold); err != nil || brk != 300 || threshold != 7 {
		t.Fatalf("break=%d threshold=%d err=%v", brk, threshold, err)
	}
	var sectionSeconds int
	if err := h.db.QueryRow(`SELECT s.duration_seconds FROM assessment_sections s JOIN exam_entities e ON e.current_draft_version_id=s.exam_version_id WHERE e.id=? AND s.section_key='math'`, exam.ID).Scan(&sectionSeconds); err != nil || sectionSeconds != 2400+2100 {
		t.Fatalf("section=%d err=%v", sectionSeconds, err)
	}

	bad := exams.DefaultSATExamConfig()
	b := bad.Sections["reading-writing"]
	b.MinimumCorrectForHigher = 99
	bad.Sections["reading-writing"] = b
	badSlug := "cfg-bad-" + uuid.NewString()
	_, err = h.exams.Create(ctx, exams.CreateRequest{Slug: badSlug, Title: "Bad", ExamType: "Academic", Visibility: "private", ProviderKey: &provider, OwnerID: h.actor, SATConfig: &bad})
	if typed, ok := apperrors.As(err); !ok || typed.Code != apperrors.CodeValidation {
		t.Fatalf("want validation error, got %v", err)
	}
	var n int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM exam_entities WHERE slug=?", badSlug).Scan(&n); err != nil || n != 0 {
		t.Fatalf("invalid config left an exam: %d %v", n, err)
	}
}

func TestSatConfigDefaultsMatchBlueprint(t *testing.T) {
	wasEnabled := exams.SATClassroomCreationEnabled()
	t.Cleanup(func() { exams.SetClassroomCreationEnabled(wasEnabled) })
	for _, classroomEnabled := range []bool{false, true} {
		exams.SetClassroomCreationEnabled(classroomEnabled)
		d := exams.SATConfigDefaultsPayload(exams.SATClassroomCreationEnabled())
		if err := d.Config.Validate(); err != nil {
			t.Fatalf("defaults must validate: %v", err)
		}
		if d.Config.Sections["math"].Module1Minutes != 35 || d.Config.Sections["reading-writing"].Module1Minutes != 32 {
			t.Fatalf("defaults drifted from blueprint: %+v", d.Config.Sections)
		}
		if d.ClassroomCreationEnabled != classroomEnabled {
			t.Fatalf("classroomCreationEnabled=%v, want %v", d.ClassroomCreationEnabled, classroomEnabled)
		}
	}
}

func TestSatExamLearningDefaultsPinNewRoomsMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	provider := "sat"
	policy := satlearning.DefaultPolicy()
	policy.UnlimitedRetakes = true
	policy.PauseOnLeave = true
	policy.ReportVisible = true
	policy.IncludeAnswerKeyInPdf = true
	cfg := exams.DefaultSATExamConfig()
	cfg.LearningDefaults = &policy
	exam, err := h.exams.Create(ctx, exams.CreateRequest{
		Slug: "learning-" + uuid.NewString(), Title: "Learning defaults", ExamType: "Academic",
		Visibility: "private", ProviderKey: &provider, OwnerID: h.actor, SATConfig: &cfg,
	})
	if err != nil || exam.SatLearningDefaults == nil || *exam.SatLearningDefaults != policy {
		t.Fatalf("create defaults = %+v err=%v", exam.SatLearningDefaults, err)
	}
	t.Cleanup(func() { _ = h.exams.Delete(ctx, exam.ID) })
	svc := schedules.NewService(h.db, tx.NewRunner(h.db))
	roomCreator := uuid.NewString()
	createRoom := func() string {
		t.Helper()
		now := time.Now().UTC()
		room, err := svc.Create(ctx, schedules.CreateRequest{
			ExamID: exam.ID, PublishedVersionID: *exam.CurrentDraftVersionID, CohortName: "Learning defaults",
			StartTime: now, EndTime: now.Add(time.Hour), CreatedBy: roomCreator,
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = h.db.Exec("DELETE FROM exam_schedules WHERE id = ?", room.ID) })
		return room.ID
	}
	firstRoom := createRoom()
	changed := policy
	changed.UnlimitedRetakes = false
	updated, err := h.exams.Update(ctx, exam.ID, exams.UpdateRequest{Revision: exam.Revision, SatLearningDefaults: &changed})
	if err != nil || updated.SatLearningDefaults == nil || *updated.SatLearningDefaults != changed {
		t.Fatalf("update defaults = %+v err=%v", updated.SatLearningDefaults, err)
	}
	secondRoom := createRoom()
	for _, entry := range []struct {
		room string
		want satlearning.Policy
	}{{firstRoom, changed}, {secondRoom, changed}} {
		// firstRoom was saved by the exam fan-out (revision 2); secondRoom
		// pinned the same values at creation (revision 1).
		if entry.room == secondRoom {
			entry.want.Revision = 1
		} else {
			entry.want.Revision = 2
		}
		got, err := satlearning.LoadPolicyTx(ctx, h.db, entry.room)
		if err != nil || got != entry.want {
			t.Fatalf("room %s policy = %+v err=%v, want %+v", entry.room, got, err, entry.want)
		}
	}
}

func TestSatClassroomRetakesDefaultAndSavedOptOutMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	previous := exams.SATClassroomCreationEnabled()
	exams.SetClassroomCreationEnabled(true)
	t.Cleanup(func() { exams.SetClassroomCreationEnabled(previous) })
	provider := "sat"
	exam, err := h.exams.Create(ctx, exams.CreateRequest{
		Slug: "classroom-retakes-" + uuid.NewString(), Title: "Classroom retakes", ExamType: "Academic",
		Visibility: "private", ProviderKey: &provider, OwnerID: h.actor,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.exams.Delete(ctx, exam.ID) })
	svc := schedules.NewService(h.db, tx.NewRunner(h.db))
	roomCreator := uuid.NewString()
	checkRoom := func(mode string, wantRetakes bool) {
		t.Helper()
		now := time.Now().UTC()
		room, err := svc.Create(ctx, schedules.CreateRequest{
			ExamID: exam.ID, PublishedVersionID: *exam.CurrentDraftVersionID, CohortName: "Classroom defaults",
			StartTime: now, EndTime: now.Add(time.Hour), CreatedBy: roomCreator, SatSessionMode: mode,
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = h.db.Exec("DELETE FROM exam_schedules WHERE id = ?", room.ID) })
		policy, err := satlearning.LoadPolicyTx(ctx, h.db, room.ID)
		if err != nil || policy.UnlimitedRetakes != wantRetakes || policy.ReportVisible || policy.IncludeAnswerKeyInPdf {
			t.Fatalf("%s room policy = %+v, err=%v, want retakes=%t and hidden results", mode, policy, err, wantRetakes)
		}
	}
	checkRoom("classroom", true)
	checkRoom("practice", false)
	optOut := satlearning.DefaultPolicy()
	if _, err := h.exams.Update(ctx, exam.ID, exams.UpdateRequest{Revision: exam.Revision, SatLearningDefaults: &optOut}); err != nil {
		t.Fatal(err)
	}
	checkRoom("classroom", false)
}

// An exam save is one cutover: it applies only the fields that changed to the
// scheduled and running rooms, keeps a later room-local choice for the other
// fields, preserves closed rooms, and does nothing on a no-op save.
func TestSatExamSaveAppliesChangedFieldsToRoomsMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	provider := "sat"
	exam, err := h.exams.Create(ctx, exams.CreateRequest{
		Slug: "live-" + uuid.NewString(), Title: "Live settings", ExamType: "Academic",
		Visibility: "private", ProviderKey: &provider, OwnerID: h.actor,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.exams.Delete(context.Background(), exam.ID) })
	svc := schedules.NewService(h.db, tx.NewRunner(h.db))
	createRoom := func() string {
		t.Helper()
		now := time.Now().UTC()
		room, err := svc.Create(ctx, schedules.CreateRequest{
			ExamID: exam.ID, PublishedVersionID: *exam.CurrentDraftVersionID, CohortName: "Live settings",
			StartTime: now, EndTime: now.Add(time.Hour), CreatedBy: h.actor,
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = h.db.Exec("DELETE FROM exam_schedules WHERE id = ?", room.ID) })
		return room.ID
	}
	roomA, roomB, roomC := createRoom(), createRoom(), createRoom()
	policyActor := uuid.NewString()

	load := func(room string) satlearning.Policy {
		t.Helper()
		policy, err := satlearning.LoadPolicyTx(ctx, h.db, room)
		if err != nil {
			t.Fatal(err)
		}
		return policy
	}
	revision := exam.Revision
	saveExam := func(policy satlearning.Policy) exams.Exam {
		t.Helper()
		saved, err := h.exams.Update(ctx, exam.ID, exams.UpdateRequest{Revision: revision, SatLearningDefaults: &policy, ActorID: policyActor})
		if err != nil {
			t.Fatal(err)
		}
		revision = saved.Revision
		return saved
	}

	// Turning retakes on also turns results on in the editor.
	on := satlearning.DefaultPolicy()
	on.UnlimitedRetakes = true
	on.ReportVisible = true
	saved := saveExam(on)
	if saved.SatLearningRoomsUpdated != 3 {
		t.Fatalf("roomsUpdated=%d, want 3", saved.SatLearningRoomsUpdated)
	}
	for _, room := range []string{roomA, roomB, roomC} {
		got := load(room)
		if !got.UnlimitedRetakes || !got.ReportVisible || got.IncludeAnswerKeyInPdf || got.Revision != 1 {
			t.Fatalf("room %s after exam save = %+v", room, got)
		}
	}

	// A room-local save hides results for room C only.
	roomOnly := load(roomC)
	roomOnly.ReportVisible = false
	if _, err := satlearning.SavePolicyTx(ctx, h.db, roomC, roomOnly, 1, policyActor); err != nil {
		t.Fatal(err)
	}
	if got := load(roomC); got.ReportVisible || got.Revision != 2 {
		t.Fatalf("room C local save = %+v", got)
	}

	// A pause-only exam save leaves the room-local hidden results alone.
	pause := on
	pause.PauseOnLeave = true
	saveExam(pause)
	for room, wantRevision := range map[string]int64{roomA: 2, roomB: 2, roomC: 3} {
		got := load(room)
		if !got.PauseOnLeave || got.Revision != wantRevision {
			t.Fatalf("room %s pause-only save = %+v, want revision %d", room, got, wantRevision)
		}
	}
	if got := load(roomC); got.ReportVisible {
		t.Fatalf("room C lost its room-local hidden results: %+v", got)
	}

	// A key-only exam save gives room A and B the key; room C hides results, so
	// its key stays off and the row is unchanged.
	keyed := pause
	keyed.IncludeAnswerKeyInPdf = true
	saveExam(keyed)
	if got := load(roomA); !got.IncludeAnswerKeyInPdf || got.Revision != 3 {
		t.Fatalf("room A key-only save = %+v", got)
	}
	if got := load(roomC); got.IncludeAnswerKeyInPdf || got.ReportVisible || got.Revision != 3 {
		t.Fatalf("room C key-only save = %+v", got)
	}

	// Closing a room removes it from the fan-out; its policy stays as saved.
	if _, err := h.db.ExecContext(ctx, `UPDATE exam_schedules SET status = 'completed' WHERE id = ?`, roomB); err != nil {
		t.Fatal(err)
	}
	closed := keyed
	closed.ReportVisible = false
	closed.IncludeAnswerKeyInPdf = false
	saveExam(closed)
	if got := load(roomA); got.ReportVisible || got.IncludeAnswerKeyInPdf || got.Revision != 4 {
		t.Fatalf("room A results-off save = %+v", got)
	}
	if got := load(roomB); !got.ReportVisible || !got.IncludeAnswerKeyInPdf || got.Revision != 3 {
		t.Fatalf("closed room B changed with the exam: %+v", got)
	}
	if got := load(roomC); got.ReportVisible || got.Revision != 3 {
		t.Fatalf("room C results-off save = %+v", got)
	}

	// Repeating the same save is a no-op: no room revision moves.
	before := map[string]satlearning.Policy{roomA: load(roomA), roomB: load(roomB), roomC: load(roomC)}
	noop := saveExam(closed)
	if noop.SatLearningRoomsUpdated != 0 {
		t.Fatalf("no-op roomsUpdated=%d", noop.SatLearningRoomsUpdated)
	}
	for room, want := range before {
		if got := load(room); got != want {
			t.Fatalf("no-op save moved room %s: %+v -> %+v", room, want, got)
		}
	}
}

// Two writers racing to create the first policy row must not both advance one
// revision. The room-row lock in SavePolicyTx is what makes the second writer
// observe the committed revision instead of silently overwriting it.
func TestSatRoomPolicyAbsentRowWritersConflictMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	provider := "sat"
	exam, err := h.exams.Create(ctx, exams.CreateRequest{
		Slug: "race-" + uuid.NewString(), Title: "Absent row", ExamType: "Academic",
		Visibility: "private", ProviderKey: &provider, OwnerID: h.actor,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.exams.Delete(context.Background(), exam.ID) })
	svc := schedules.NewService(h.db, tx.NewRunner(h.db))
	now := time.Now().UTC()
	room, err := svc.Create(ctx, schedules.CreateRequest{
		ExamID: exam.ID, PublishedVersionID: *exam.CurrentDraftVersionID, CohortName: "Absent row",
		StartTime: now, EndTime: now.Add(time.Hour), CreatedBy: h.actor,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = h.db.Exec("DELETE FROM exam_schedules WHERE id = ?", room.ID) })
	// The exam has no defaults, so the room has no policy row to lock.
	if _, err := h.db.ExecContext(ctx, "DELETE FROM sat_activity_policies WHERE schedule_id = ?", room.ID); err != nil {
		t.Fatal(err)
	}
	policyActor := uuid.NewString()
	first := satlearning.DefaultPolicy()
	first.PauseOnLeave = true
	second := satlearning.DefaultPolicy()
	second.ReportVisible = true

	start := make(chan struct{})
	errs := make(chan error, 2)
	for _, policy := range []satlearning.Policy{first, second} {
		go func(policy satlearning.Policy) {
			<-start
			errs <- tx.NewRunner(h.db).WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
				_, err := satlearning.SavePolicyTx(ctx, q, room.ID, policy, 0, policyActor)
				return err
			})
		}(policy)
	}
	close(start)
	var conflicts int
	for i := 0; i < 2; i++ {
		err := <-errs
		if err == nil {
			continue
		}
		var conflict *satlearning.RevisionConflict
		if !errors.As(err, &conflict) {
			t.Fatalf("unexpected writer error: %v", err)
		}
		conflicts++
	}
	if conflicts != 1 {
		t.Fatalf("conflicts=%d, want exactly 1", conflicts)
	}
	if got := loadPolicyForTest(t, ctx, h.db, room.ID); got.Revision != 1 {
		t.Fatalf("final revision=%d, want 1", got.Revision)
	}
}

func loadPolicyForTest(t *testing.T, ctx context.Context, db *sql.DB, scheduleID string) satlearning.Policy {
	t.Helper()
	policy, err := satlearning.LoadPolicyTx(ctx, db, scheduleID)
	if err != nil {
		t.Fatal(err)
	}
	return policy
}
