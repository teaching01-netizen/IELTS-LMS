package exams

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func TestFoldersConcurrentCreates(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	svc := NewService(pool, tx.NewRunner(pool))
	actor := auth.NewActorContext("concurrent-writer", auth.RoleBuilder).WithOrgID(uniqueOrg("concurrent-create"))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := svc.CreateFolderForActor(ctx, actor, CreateFolderRequest{ProviderKey: "sat", Name: "Initial"}); err != nil {
		t.Fatal(err)
	}
	const writers = 8
	start := make(chan struct{})
	errs := make(chan error, writers)
	var pending sync.WaitGroup
	for i := 0; i < writers; i++ {
		pending.Add(1)
		go func(i int) {
			defer pending.Done()
			<-start
			_, err := svc.CreateFolderForActor(ctx, actor, CreateFolderRequest{ProviderKey: "sat", Name: fmt.Sprintf("Concurrent %d", i)})
			errs <- err
		}(i)
	}
	close(start)
	pending.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("independent folder creation failed: %v", err)
		}
	}
	folders, _, err := svc.ListLibraryForActor(ctx, actor, "sat")
	if err != nil {
		t.Fatal(err)
	}
	if len(folders) != writers+1 {
		t.Fatalf("created %d folders, want %d", len(folders), writers+1)
	}
}

func TestFolderIDsStayCanonical(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	svc := NewService(pool, tx.NewRunner(pool))
	actor := auth.NewActorContext("case-writer", auth.RoleBuilder).WithOrgID(uniqueOrg("folder-case"))
	ctx := context.Background()
	root, err := svc.CreateFolderForActor(ctx, actor, CreateFolderRequest{ProviderKey: "sat", Name: "Parent"})
	if err != nil {
		t.Fatal(err)
	}
	upperParent := strings.ToUpper(root.ID)
	child, err := svc.CreateFolderForActor(ctx, actor, CreateFolderRequest{ProviderKey: "sat", Name: "Child", ParentID: &root.ID})
	if err != nil || child.ParentID == nil || *child.ParentID != root.ID {
		t.Fatalf("parent must keep canonical ID: %+v, %v", child, err)
	}
	if _, err := svc.MoveFolderForActor(ctx, actor, upperParent, MoveFolderRequest{ParentID: &child.ID, Revision: root.Revision}); err == nil {
		t.Fatal("case variants must not bypass the descendant-cycle check")
	}
	exam := mustCreateExam(t, svc, "Case Exam", *actor.OrgID)
	upperChild := strings.ToUpper(child.ID)
	entries, err := svc.MoveExamsForActor(ctx, actor, []MoveExamItem{{ExamID: strings.ToUpper(exam.ID), Revision: 0}}, &upperChild)
	if err != nil {
		// Binary-collated deployments reject case variants. CI deployments
		// may resolve them, but must return/store the resource's actual ID.
		if appErr, ok := apperrors.As(err); !ok || appErr.Code != apperrors.CodeNotFound {
			t.Fatal(err)
		}
		_, placed, listErr := svc.ListLibraryForActor(ctx, actor, "sat")
		if listErr != nil || len(placed) != 0 {
			t.Fatalf("rejected IDs must not change placement: %+v, %v", placed, listErr)
		}
		return
	}
	if len(entries) != 1 || entries[0].ExamID != exam.ID || entries[0].FolderID == nil || *entries[0].FolderID != child.ID {
		t.Fatalf("placement must match canonical library IDs: %+v", entries)
	}
}
