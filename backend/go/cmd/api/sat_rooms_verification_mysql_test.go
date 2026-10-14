package main

// Characterization evidence for verification/lean/sat-auto-room. These tests
// expose specification gaps; passing them does not approve the deviations.
import (
	"context"
	"encoding/json"
	"sync"
	"testing"

	"example.com/ielts-proctoring/internal/accesslinks"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satrooms"
	"github.com/google/uuid"
)

func TestSatRoomVerificationPolicyAndReplayMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	h := newSatRoomsHarness(f.h)
	ctx := context.Background()
	req := satRoomRequest(t, h, uuid.NewString(), "Original name")
	first, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, req)
	if err != nil {
		t.Fatal(err)
	}
	links := accesslinks.NewService(h.db, tx.NewRunner(h.db))
	t.Run("replay_preserves_original_room_fields", func(t *testing.T) {
		_, err := links.Update(ctx, first.Room.ID, accesslinks.UpdateRequest{
			Revision: first.Room.Revision, Name: "Renamed after commit",
			AudienceType: accesslinks.AudienceAnyone, AccessMode: accesslinks.ModeStudentCode,
			AvailabilityType: accesslinks.AvailabilityAnytime,
		})
		if err != nil {
			t.Fatal(err)
		}
		replay, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, req)
		if err != nil {
			t.Fatal(err)
		}
		if replay.Room.ID != first.Room.ID || replay.Room.Name != first.Room.Name {
			t.Fatal("same key must replay the original room ID and response fields")
		}
		originalJSON, _ := json.Marshal(first)
		replayedJSON, _ := json.Marshal(replay)
		if string(originalJSON) != string(replayedJSON) {
			t.Fatal("all response fields must replay exactly, including creation-time projections")
		}
		t.Log("Fixed: replay retains the original name after a room edit")
	})
	t.Run("full_release_reused_for_math_scope", func(t *testing.T) {
		mathReq := satRoomRequest(t, h, uuid.NewString(), "Math subset")
		mathReq.Room.EnabledSections = []string{"math"}
		out, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, mathReq)
		if err != nil {
			t.Fatal(err)
		}
		if out.Version.ID != first.Version.ID || out.Version.Scope != "full" || out.Version.CreatedNow {
			t.Fatal("expected Full release reused for narrower Math room")
		}
		t.Log("SPEC gap: scope coverage is accepted instead of scope equality")
	})
	t.Run("deleted_room_receipt_remains_recoverable", func(t *testing.T) {
		live, err := links.Get(ctx, first.Room.ID)
		if err != nil {
			t.Fatal(err)
		}
		if err := links.Delete(ctx, live.ID, live.Revision); err != nil {
			t.Fatal(err)
		}
		recovered, _, err := h.rooms.GetOperation(ctx, h.actor, req.OperationKey)
		if err != nil || recovered.Room.ID != first.Room.ID || recovered.Room.Name != first.Room.Name {
			t.Fatalf("deleted room must retain the committed result, got %+v %v", recovered, err)
		}
		if h.count(t, "SELECT COUNT(*) FROM sat_room_operations WHERE actor_id = ? AND operation_key = ?", h.actor, req.OperationKey) != 1 {
			t.Fatal("committed operation receipt must still exist")
		}
		t.Log("Fixed: deleted room has an immutable recovery receipt; live access still remains deleted")
	})
}

func TestSatRoomVerificationRollbackAfterSealMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	h := newSatRoomsHarness(f.h)
	ctx := context.Background()
	const trigger = "codex_sat_room_verification_fail_insert"
	_, err := h.db.Exec(`CREATE TRIGGER ` + trigger + ` BEFORE INSERT ON assessment_access_links
		FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'verification: fail after release and schedule writes'`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = h.db.Exec("DROP TRIGGER IF EXISTS " + trigger) })
	req := satRoomRequest(t, h, uuid.NewString(), "Rollback room")
	if _, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, req); err == nil {
		t.Fatal("injected link INSERT failure must abort the operation")
	}
	if h.publishedCount(t) != 0 || h.roomCount(t) != 0 ||
		h.count(t, "SELECT COUNT(*) FROM exam_schedules WHERE exam_id = ?", h.examID) != 0 ||
		h.count(t, "SELECT COUNT(*) FROM sat_room_operations WHERE actor_id = ?", h.actor) != 0 {
		t.Fatal("failure after seal/schedule writes left partial durable effects")
	}
	if _, err := h.db.Exec("DROP TRIGGER " + trigger); err != nil {
		t.Fatal(err)
	}
	if _, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, req); err != nil {
		t.Fatalf("same-key retry after transaction rollback: %v", err)
	}
	if h.publishedCount(t) != 1 || h.roomCount(t) != 1 {
		t.Fatal("retry must commit one release and one room")
	}
}

func TestSatRoomVerificationDistinctKeysBarrierMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	h := newSatRoomsHarness(f.h)
	ctx := context.Background()
	if _, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, satRoomRequest(t, h, uuid.NewString(), "Initial")); err != nil {
		t.Fatal(err)
	}
	requests := []satrooms.Request{
		satRoomRequest(t, h, uuid.NewString(), "Concurrent A"),
		satRoomRequest(t, h, uuid.NewString(), "Concurrent B"),
	}
	start := make(chan struct{})
	errs := make(chan error, len(requests))
	var ready sync.WaitGroup
	ready.Add(len(requests))
	for _, req := range requests {
		go func() {
			ready.Done()
			<-start
			_, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, req)
			errs <- err
		}()
	}
	ready.Wait()
	close(start)
	for range requests {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	if h.publishedCount(t) != 1 || h.roomCount(t) != 3 {
		t.Fatal("distinct operation keys must create separate rooms on the unchanged release")
	}
}

func TestSatRoomVerificationUnfencedAndNoOpMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	h := newSatRoomsHarness(f.h)
	ctx := context.Background()
	first, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, satRoomRequest(t, h, uuid.NewString(), "First"))
	if err != nil {
		t.Fatal(err)
	}
	shell, err := h.authors.OpenShell(ctx, h.examID, h.actor)
	if err != nil {
		t.Fatal(err)
	}
	questions, err := h.authors.ListQuestions(ctx, shell.Sections[0].Modules[0].ID)
	if err != nil || len(questions) == 0 {
		t.Fatalf("questions: %v", err)
	}
	// Persist exactly the fixture's existing question body through the real
	// authoring command. The new question revision is delivery-equivalent.
	if _, err := h.authors.UpdateQuestion(ctx, questions[0].ExamQuestionID, h.actor, questions[0].Revision, validSATPublishQuestion()); err != nil {
		t.Fatal(err)
	}
	second, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, satRoomRequest(t, h, uuid.NewString(), "No-op save"))
	if err != nil {
		t.Fatal(err)
	}
	if !second.Version.CreatedNow || second.Version.ID == first.Version.ID {
		t.Fatal("expected no-op write to defeat untouched-clone reuse")
	}
	t.Log("SPEC gap: an equivalent question body creates a new release after a no-op save")

	shell, err = h.authors.OpenShell(ctx, h.examID, h.actor)
	if err != nil {
		t.Fatal(err)
	}
	prepared := satRoomRequest(t, h, uuid.NewString(), "Prepared before edit")
	prepared.ExpectedExamRevision = nil
	prepared.ExpectedDraftVersionID = nil
	prepared.ExpectedDraftRevision = nil
	questions, err = h.authors.ListQuestions(ctx, shell.Sections[0].Modules[0].ID)
	if err != nil || len(questions) == 0 {
		t.Fatalf("questions: %v", err)
	}
	changed := validSATPublishQuestion()
	changed.Prompt = json.RawMessage(`{"version":1,"nodes":[{"type":"paragraph","text":"Saved after preparation"}]}`)
	if _, err := h.authors.UpdateQuestion(ctx, questions[0].ExamQuestionID, h.actor, questions[0].Revision, changed); err != nil {
		t.Fatal(err)
	}
	_, err = h.rooms.CreateRoom(ctx, h.actor, h.examID, prepared)
	if satRoomCode(t, err) != apperrors.CodeRoomInvalid {
		t.Fatalf("missing revision fences must be rejected, got %v", err)
	}
	t.Log("Fixed: nil revision fences are rejected before release/room writes")
}
