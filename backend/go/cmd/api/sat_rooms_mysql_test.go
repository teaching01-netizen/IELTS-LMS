package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"sync"
	"testing"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/accesslinks"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satrooms"
)

type satRoomsHarness struct {
	*concurrencyHarness
	rooms *satrooms.Service
}

func newSatRoomsHarness(h *concurrencyHarness) *satRoomsHarness {
	runner := tx.NewRunner(h.db)
	return &satRoomsHarness{
		concurrencyHarness: h,
		rooms:              satrooms.NewService(h.db, runner, h.exams, accesslinks.NewService(h.db, runner)),
	}
}

func satRoomRequest(t *testing.T, h *satRoomsHarness, key, name string) satrooms.Request {
	t.Helper()
	var revision int
	var draft sql.NullString
	if err := h.db.QueryRow("SELECT revision, current_draft_version_id FROM exam_entities WHERE id = ?", h.examID).Scan(&revision, &draft); err != nil {
		t.Fatal(err)
	}
	draftID := draft.String
	var draftRevision *int
	if draft.Valid {
		var value int
		if err := h.db.QueryRow("SELECT revision FROM exam_versions WHERE id = ?", draftID).Scan(&value); err != nil {
			t.Fatal(err)
		}
		draftRevision = &value
	}
	return satrooms.Request{
		OperationKey:           key,
		ExpectedExamRevision:   &revision,
		ExpectedDraftVersionID: &draftID,
		ExpectedDraftRevision:  draftRevision,
		AllowSeal:              true,
		Room: accesslinks.CreateRequest{
			Name:             name,
			AudienceType:     accesslinks.AudienceAnyone,
			AccessMode:       accesslinks.ModeStudentCode,
			AvailabilityType: accesslinks.AvailabilityAnytime,
		},
	}
}

func (h *satRoomsHarness) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n int
	if err := h.db.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (h *satRoomsHarness) roomCount(t *testing.T) int {
	return h.count(t, "SELECT COUNT(*) FROM assessment_access_links WHERE exam_id = ?", h.examID)
}

func (h *satRoomsHarness) publishedCount(t *testing.T) int {
	return h.count(t, "SELECT COUNT(*) FROM exam_versions WHERE exam_id = ? AND is_published = TRUE", h.examID)
}

func satRoomCode(t *testing.T, err error) apperrors.Code {
	t.Helper()
	typed, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("want typed error, got %v", err)
	}
	return typed.Code
}

// One-action rooms: first room seals the draft, replays converge, unchanged
// exams reuse the release, an edit mints the next version and old rooms stay
// pinned to the version they were created on.
func TestSatRoomsReleaseLifecycleMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	h := newSatRoomsHarness(f.h)
	ctx := context.Background()

	first, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, satRoomRequest(t, h, uuid.NewString(), "Room A"))
	if err != nil {
		t.Fatalf("first room: %v", err)
	}
	if !first.Version.CreatedNow || first.Version.Number < 1 || first.Room.PublishedVersionID != first.Version.ID {
		t.Fatalf("first room must seal and pin a new release: %+v", first.Version)
	}
	if h.publishedCount(t) != 1 {
		t.Fatalf("exactly one release expected, got %d", h.publishedCount(t))
	}

	// Lost-response retry: same key + same body replays the SAME room.
	key := uuid.NewString()
	req := satRoomRequest(t, h, key, "Room B")
	second, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, req)
	if err != nil {
		t.Fatalf("second room: %v", err)
	}
	if second.Version.CreatedNow || second.Version.ID != first.Version.ID {
		t.Fatalf("unchanged exam must reuse the release: %+v vs %+v", second.Version, first.Version)
	}
	replay, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, req)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if !replay.Replayed || replay.Room.ID != second.Room.ID {
		t.Fatalf("replay must return the original room: %s vs %s", replay.Room.ID, second.Room.ID)
	}
	if h.roomCount(t) != 2 {
		t.Fatalf("replay created a duplicate room: %d", h.roomCount(t))
	}
	recovered, examID, err := h.rooms.GetOperation(ctx, h.actor, key)
	if err != nil || recovered.Room.ID != second.Room.ID || examID != h.examID {
		t.Fatalf("receipt lookup: %v %+v %s", err, recovered.Room.ID, examID)
	}

	// Same key, different body: refused, nothing created.
	changed := satRoomRequest(t, h, key, "Room B renamed")
	if _, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, changed); satRoomCode(t, err) != apperrors.CodeOperationKeyConflict {
		t.Fatalf("key reuse with different body must conflict, got %v", err)
	}
	if _, _, err := h.rooms.GetOperation(ctx, h.actor, uuid.NewString()); satRoomCode(t, err) != apperrors.CodeOperationNotFound {
		t.Fatalf("unknown key must be OPERATION_NOT_FOUND, got %v", err)
	}

	// Reopen the draft WITHOUT editing: it is byte-identical to the release,
	// so a new room reuses it and the draft stays open.
	shell, err := h.authors.OpenShell(ctx, h.examID, h.actor)
	if err != nil {
		t.Fatal(err)
	}
	third, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, satRoomRequest(t, h, uuid.NewString(), "Room C"))
	if err != nil {
		t.Fatalf("third room: %v", err)
	}
	if third.Version.CreatedNow || third.Version.ID != first.Version.ID {
		t.Fatalf("an untouched reopened draft must reuse the release: %+v", third.Version)
	}
	var draftPointer sql.NullString
	if err := h.db.QueryRow("SELECT current_draft_version_id FROM exam_entities WHERE id = ?", h.examID).Scan(&draftPointer); err != nil {
		t.Fatal(err)
	}
	if !draftPointer.Valid || draftPointer.String != shell.VersionID {
		t.Fatalf("reuse must leave the working draft open, pointer=%v", draftPointer)
	}

	// Edit one question: the next room seals version N+1; older rooms keep N.
	summaries, err := h.authors.ListQuestions(ctx, shell.Sections[0].Modules[0].ID)
	if err != nil || len(summaries) == 0 {
		t.Fatalf("list questions: %v", err)
	}
	edited := validSATPublishQuestion()
	edited.Prompt = json.RawMessage(`{"version":1,"nodes":[{"type":"paragraph","text":"An edited prompt."}]}`)
	if _, err := h.authors.UpdateQuestion(ctx, summaries[0].ExamQuestionID, h.actor, summaries[0].Revision, edited); err != nil {
		t.Fatalf("edit question: %v", err)
	}
	fourth, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, satRoomRequest(t, h, uuid.NewString(), "Room D"))
	if err != nil {
		t.Fatalf("fourth room: %v", err)
	}
	if !fourth.Version.CreatedNow || fourth.Version.ID == first.Version.ID || fourth.Version.Number <= first.Version.Number {
		t.Fatalf("an edited exam must seal the next release: %+v", fourth.Version)
	}
	for _, id := range []string{first.Room.ID, second.Room.ID, third.Room.ID} {
		var pinned string
		if err := h.db.QueryRow("SELECT published_version_id FROM assessment_access_links WHERE id = ?", id).Scan(&pinned); err != nil {
			t.Fatal(err)
		}
		if pinned != first.Version.ID {
			t.Fatalf("older room %s was re-pinned to %s", id, pinned)
		}
	}
	if h.publishedCount(t) != 2 || h.roomCount(t) != 4 {
		t.Fatalf("want 2 releases and 4 rooms, got %d / %d", h.publishedCount(t), h.roomCount(t))
	}
}

// A double submit with one key must create exactly one room and one release.
func TestSatRoomsSameKeyRaceMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	h := newSatRoomsHarness(f.h)
	ctx := context.Background()
	key := uuid.NewString()
	const racers = 6
	request := satRoomRequest(t, h, key, "Racing room")
	var wg sync.WaitGroup
	roomIDs := make(chan string, racers)
	errs := make(chan error, racers)
	for range racers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, request)
			if err != nil {
				errs <- err
				return
			}
			roomIDs <- out.Room.ID
		}()
	}
	wg.Wait()
	close(roomIDs)
	close(errs)
	for err := range errs {
		// A loser may be told to retry; it must never create a second room.
		if code := satRoomCode(t, err); code != apperrors.CodeConflict && code != apperrors.CodeExamRevisionChanged {
			t.Fatalf("unexpected race loser error: %v", err)
		}
	}
	distinct := map[string]bool{}
	for id := range roomIDs {
		distinct[id] = true
	}
	if len(distinct) != 1 {
		t.Fatalf("one key must converge on one room, got %v", distinct)
	}
	if h.roomCount(t) != 1 || h.publishedCount(t) != 1 {
		t.Fatalf("want 1 room and 1 release, got %d / %d", h.roomCount(t), h.publishedCount(t))
	}
}

// An unready exam is refused with every blocking issue and writes nothing.
func TestSatRoomsNotReadyWritesNothingMySQL(t *testing.T) {
	h := newSatRoomsHarness(newConcurrencyHarness(t))
	_, err := h.rooms.CreateRoom(context.Background(), h.actor, h.examID, satRoomRequest(t, h, uuid.NewString(), "Too early"))
	if code := satRoomCode(t, err); code != apperrors.CodeExamNotReady {
		t.Fatalf("want EXAM_NOT_READY, got %v", err)
	}
	typed, _ := apperrors.As(err)
	issues, ok := typed.Details["issues"].([]map[string]any)
	if !ok || len(issues) < 2 {
		t.Fatalf("details.issues must list every blocker, got %#v", typed.Details["issues"])
	}
	if h.roomCount(t) != 0 || h.publishedCount(t) != 0 {
		t.Fatalf("rejection left rows behind: %d rooms, %d releases", h.roomCount(t), h.publishedCount(t))
	}
	if h.count(t, "SELECT COUNT(*) FROM sat_room_operations WHERE actor_id = ?", h.actor) != 0 {
		t.Fatal("a rejected operation must not leave a receipt")
	}
	if h.count(t, "SELECT COUNT(*) FROM exam_schedules WHERE exam_id = ?", h.examID) != 0 {
		t.Fatal("a rejected operation must not leave a schedule")
	}
}

// A disabled Classroom refusal must roll back the whole one-action room
// transaction, including a release seal attempted earlier in that transaction.
func TestSatRoomsClassroomDisabledRollsBackMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	h := newSatRoomsHarness(f.h)
	ctx := context.Background()
	wasEnabled := exams.SATClassroomCreationEnabled()
	t.Cleanup(func() { exams.SetClassroomCreationEnabled(wasEnabled) })
	exams.SetClassroomCreationEnabled(false)

	classroom := satRoomRequest(t, h, uuid.NewString(), "Classroom is disabled")
	classroom.Room.SatSessionMode = "classroom"
	if _, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, classroom); satRoomCode(t, err) != apperrors.CodeSATClassroomDisabled {
		t.Fatalf("disabled Classroom creation must return SAT_CLASSROOM_DISABLED, got %v", err)
	}
	if h.roomCount(t) != 0 || h.publishedCount(t) != 0 ||
		h.count(t, "SELECT COUNT(*) FROM exam_schedules WHERE exam_id = ?", h.examID) != 0 ||
		h.count(t, "SELECT COUNT(*) FROM sat_room_operations WHERE actor_id = ? AND operation_key = ?", h.actor, classroom.OperationKey) != 0 {
		t.Fatal("disabled Classroom refusal left a room, release, schedule, or operation receipt")
	}
	var draftID, publishedID sql.NullString
	if err := h.db.QueryRow("SELECT current_draft_version_id, current_published_version_id FROM exam_entities WHERE id = ?", h.examID).Scan(&draftID, &publishedID); err != nil {
		t.Fatal(err)
	}
	if !draftID.Valid || publishedID.Valid {
		t.Fatalf("disabled Classroom refusal must preserve the draft and publish nothing: draft=%v published=%v", draftID, publishedID)
	}

	practice := satRoomRequest(t, h, uuid.NewString(), "Practice still works")
	if _, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, practice); err != nil {
		t.Fatalf("the gate must not block Practice creation: %v", err)
	}
	if h.roomCount(t) != 1 {
		t.Fatalf("Practice creation should add exactly one room, got %d", h.roomCount(t))
	}
}

// Fences: a stale draft revision is a retriable 409 and never seals.
func TestSatRoomsStaleFenceMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	h := newSatRoomsHarness(f.h)
	ctx := context.Background()

	stale := f.draftRevision + 1
	req := satRoomRequest(t, h, uuid.NewString(), "Stale")
	req.ExpectedDraftRevision = &stale
	_, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, req)
	if satRoomCode(t, err) != apperrors.CodeExamRevisionChanged {
		t.Fatalf("stale draft revision must be EXAM_REVISION_CHANGED, got %v", err)
	}
	typed, _ := apperrors.As(err)
	if _, ok := typed.Details["currentExamRevision"]; !ok {
		t.Fatal("conflict must report currentExamRevision")
	}

	unfrozen := satRoomRequest(t, h, uuid.NewString(), "No freeze")
	unfrozen.AllowSeal = false
	if _, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, unfrozen); satRoomCode(t, err) != apperrors.CodeExamRevisionChanged {
		t.Fatalf("sealing without the co-edit freeze must be refused, got %v", err)
	}
	if h.roomCount(t) != 0 || h.publishedCount(t) != 0 {
		t.Fatal("refused attempts must leave nothing behind")
	}
}
