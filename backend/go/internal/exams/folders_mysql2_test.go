package exams

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func uniqueOrg(prefix string) string {
	return prefix + "-" + uuid.NewString()[:8]
}

func TestFoldersMySQLCreateInFolderAndLegacyPreserve(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	svc := NewService(pool, tx.NewRunner(pool))
	ctx := context.Background()
	org := uniqueOrg("org-create")
	builder := auth.NewActorContext("builder-2", auth.RoleBuilder).WithOrgID(org)

	folder, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Create Target"})
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}
	// Create-in-folder atomically files the exam.
	exam, err := svc.CreateForActor(ctx, builder, CreateRequest{
		Slug: "sat-create-in-folder-" + uuid.NewString()[:8], Title: "Create In Folder", ExamType: ExamTypeAcademic,
		Visibility: VisibilityOrganization, ProviderKey: strPtr(ProviderSAT), FolderID: &folder.ID,
	})
	if err != nil {
		t.Fatalf("create in folder: %v", err)
	}
	before, err := svc.Get(ctx, exam.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	folders, entries, err := svc.ListLibraryForActor(ctx, builder, "sat")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	_ = folders
	found := false
	for _, e := range entries {
		if e.ExamID == exam.ID && e.FolderID != nil && *e.FolderID == folder.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("created exam must be filed atomically")
	}
	// Legacy content save (draft) must preserve membership and entity revision
	// moves separately: move the exam and verify entity revision is untouched.
	rev := 0
	for _, e := range entries {
		if e.ExamID == exam.ID {
			rev = e.Revision
		}
	}
	moved, err := svc.MoveExamsForActor(ctx, builder, []MoveExamItem{{ExamID: exam.ID, Revision: rev}}, nil)
	if err != nil {
		t.Fatalf("move to root: %v", err)
	}
	if len(moved) != 1 || moved[0].FolderID != nil {
		t.Fatal("move to root must clear folder")
	}
	after, _ := svc.Get(ctx, exam.ID)
	if after.Revision != before.Revision {
		t.Fatalf("entity revision must be unaffected by moves (before=%d after=%d)", before.Revision, after.Revision)
	}
	// Row persists at root with history (revision bumped).
	_, entries2, _ := svc.ListLibraryForActor(ctx, builder, "sat")
	stillThere := false
	for _, e := range entries2 {
		if e.ExamID == exam.ID {
			stillThere = true
			if e.Revision <= rev {
				t.Fatal("entry revision must advance on move")
			}
		}
	}
	if !stillThere {
		t.Fatal("root entry row must persist for history")
	}
}

func TestFoldersMySQLStaleWritesAndIdempotentRetry(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	svc := NewService(pool, tx.NewRunner(pool))
	ctx := context.Background()
	org := uniqueOrg("org-race")
	builder := auth.NewActorContext("builder-race", auth.RoleBuilder).WithOrgID(org)
	fa, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Race A"})
	if err != nil {
		t.Fatalf("folder A: %v", err)
	}
	fb, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Race B"})
	if err != nil {
		t.Fatalf("folder B: %v", err)
	}
	exam := mustCreateExam(t, svc, "Race Exam", org)
	// First move wins.
	first, err := svc.MoveExamsForActor(ctx, builder, []MoveExamItem{{ExamID: exam.ID, Revision: 0}}, &fa.ID)
	if err != nil {
		t.Fatalf("first move: %v", err)
	}
	if len(first) != 1 || first[0].FolderID == nil || *first[0].FolderID != fa.ID {
		t.Fatal("first move must land in A")
	}
	// Second move with the fresh revision wins.
	second, err := svc.MoveExamsForActor(ctx, builder, []MoveExamItem{{ExamID: exam.ID, Revision: first[0].Revision}}, &fb.ID)
	if err != nil {
		t.Fatalf("second move: %v", err)
	}
	if len(second) != 1 || second[0].FolderID == nil || *second[0].FolderID != fb.ID {
		t.Fatal("second move must land in B")
	}
	// Stale retry to a different target must conflict.
	if _, err := svc.MoveExamsForActor(ctx, builder, []MoveExamItem{{ExamID: exam.ID, Revision: first[0].Revision}}, &fa.ID); err == nil {
		t.Fatal("stale move to a different folder must conflict")
	}
	// Same-target retry converges as no-op without fencing.
	again, err := svc.MoveExamsForActor(ctx, builder, []MoveExamItem{{ExamID: exam.ID, Revision: first[0].Revision}}, &fb.ID)
	if err != nil {
		t.Fatalf("same-target retry must converge: %v", err)
	}
	if len(again) != 1 || again[0].FolderID == nil || *again[0].FolderID != fb.ID {
		t.Fatal("same-target retry must stay in B")
	}
}
