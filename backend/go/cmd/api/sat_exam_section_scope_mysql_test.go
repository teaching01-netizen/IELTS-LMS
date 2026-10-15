package main

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func TestSATExamSectionScopeMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false, &exams.SATExamConfig{SectionScope: exams.SATPublishScopeReadingWriting})
	h := newSatRoomsHarness(f.h)
	ctx := context.Background()
	exam, err := h.exams.Get(ctx, h.examID)
	if err != nil {
		t.Fatal(err)
	}
	if exam.SatSectionScope != "reading-writing" {
		t.Fatalf("exam scope = %q", exam.SatSectionScope)
	}

	for _, sections := range [][]string{{"math"}, {"reading-writing", "math"}, nil} {
		if _, err := h.rooms.NeedsSeal(ctx, h.examID, sections); satRoomCode(t, err) != apperrors.CodeExamScopeUnavailable {
			t.Fatalf("preflight accepted excluded sections: %v", err)
		}
		req := satRoomRequest(t, h, uuid.NewString(), "Outside exam scope")
		req.Room.EnabledSections = sections
		if _, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, req); satRoomCode(t, err) != apperrors.CodeExamScopeUnavailable {
			t.Fatalf("room accepted excluded sections: %v", err)
		}
	}
	if h.roomCount(t) != 0 || h.publishedCount(t) != 0 {
		t.Fatal("scope rejection wrote room or release")
	}

	req := satRoomRequest(t, h, uuid.NewString(), "Reading & Writing")
	req.Room.EnabledSections = []string{"reading-writing"}
	created, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, req)
	if err != nil {
		t.Fatal(err)
	}
	if !created.Version.CreatedNow || created.Version.Scope != "reading-writing" {
		t.Fatalf("must seal RW release: %+v", created.Version)
	}
	var storedScope string
	if err := h.db.QueryRowContext(ctx, "SELECT sat_publish_scope FROM exam_versions WHERE id = ?", created.Version.ID).Scan(&storedScope); err != nil {
		t.Fatal(err)
	}
	if storedScope != "reading-writing" {
		t.Fatalf("persisted release scope = %q", storedScope)
	}

	// Scope remains enforced after the working draft has been sealed.
	both := satRoomRequest(t, h, uuid.NewString(), "Both after seal")
	if _, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, both); satRoomCode(t, err) != apperrors.CodeExamScopeUnavailable {
		t.Fatalf("released exam accepted both sections: %v", err)
	}
	repeat := satRoomRequest(t, h, uuid.NewString(), "RW again")
	repeat.Room.EnabledSections = []string{"reading-writing"}
	reused, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, repeat)
	if err != nil {
		t.Fatal(err)
	}
	if reused.Version.CreatedNow || reused.Version.ID != created.Version.ID {
		t.Fatalf("must reuse RW release: %+v", reused.Version)
	}
}
