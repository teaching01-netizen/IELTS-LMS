package exams

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	platformdb "example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func mysqlPoolForFolders(t *testing.T) *sql.DB {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if raw == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	dsn, err := platformdb.NormalizeDSN(raw)
	if err != nil {
		t.Fatalf("normalize DSN: %v", err)
	}
	pool, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	if err := pool.Ping(); err != nil {
		t.Fatalf("ping db: %v", err)
	}
	return pool
}

func mustCreateExam(t *testing.T, svc *Service, title, org string) Exam {
	t.Helper()
	var orgPtr *string
	if org != "" {
		v := org
		orgPtr = &v
	}
	exam, err := svc.Create(context.Background(), CreateRequest{
		Slug:           "sat-" + strings.ReplaceAll(strings.ToLower(title), " ", "-") + "-" + uuid.NewString()[:8],
		Title:          title,
		ExamType:       ExamTypeAcademic,
		Visibility:     VisibilityOrganization,
		OrganizationID: orgPtr,
		ProviderKey:    strPtr(ProviderSAT),
		OwnerID:        "owner-1",
	})
	if err != nil {
		t.Fatalf("create exam %q: %v", title, err)
	}
	return exam
}

func strPtr(s string) *string { return &s }

func TestFoldersMySQLRootUniquenessNestingAndMoves(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	svc := NewService(pool, tx.NewRunner(pool))
	ctx := context.Background()
	admin := auth.NewActorContext("admin-1", auth.RoleAdmin)
	org := "org-mysql-" + uuid.NewString()[:8]
	builder := auth.NewActorContext("builder-1", auth.RoleBuilder).WithOrgID(org)

	// Root folder + case-insensitive duplicate rejected.
	root, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Physics " + org})
	if err != nil {
		t.Fatalf("create root: %v", err)
	}
	dupName := "  " + "PHYSICS " + org + "  "
	if _, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: dupName}); err == nil {
		t.Fatal("case-insensitive root duplicate must conflict")
	}
	// Nested child + grandchild.
	child, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Mechanics", ParentID: &root.ID})
	if err != nil {
		t.Fatalf("create child: %v", err)
	}
	grand, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Kinematics", ParentID: &child.ID})
	if err != nil {
		t.Fatalf("create grandchild: %v", err)
	}
	// Self move rejected.
	if _, err := svc.MoveFolderForActor(ctx, builder, child.ID, MoveFolderRequest{ParentID: &child.ID, Revision: child.Revision}); err == nil {
		t.Fatal("self move must be rejected")
	}
	// Descendant move rejected (root into grandchild).
	if _, err := svc.MoveFolderForActor(ctx, builder, root.ID, MoveFolderRequest{ParentID: &grand.ID, Revision: root.Revision}); err == nil {
		t.Fatal("descendant move must be rejected")
	}
	// Move grandchild to root.
	moved, err := svc.MoveFolderForActor(ctx, builder, grand.ID, MoveFolderRequest{ParentID: nil, Revision: grand.Revision})
	if err != nil {
		t.Fatalf("move grandchild to root: %v", err)
	}
	if moved.ParentID != nil {
		t.Fatal("moved folder must be root")
	}

	// Cross-org: admin sees builder folder but cannot file builder exam into platform root.
	exam := mustCreateExam(t, svc, "Cross Org Exam", org)
	if _, err := svc.MoveExamsForActor(ctx, admin, []MoveExamItem{{ExamID: exam.ID, Revision: 0}}, nil); err != nil {
		t.Fatalf("admin root move of org exam must succeed (own scope root): %v", err)
	}
	platformRoot, err := svc.CreateFolderForActor(ctx, admin, CreateFolderRequest{ProviderKey: "sat", Name: "Platform Root " + org})
	if err != nil {
		t.Fatalf("admin platform folder: %v", err)
	}
	// Refetch entry revision after the root placement (now 0, row exists).
	_, entries, err := svc.ListLibraryForActor(ctx, admin, "sat")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	rev := 0
	for _, e := range entries {
		if e.ExamID == exam.ID {
			rev = e.Revision
		}
	}
	if _, err := svc.MoveExamsForActor(ctx, admin, []MoveExamItem{{ExamID: exam.ID, Revision: rev}}, &platformRoot.ID); err == nil {
		t.Fatal("cross-scope exam->platform folder must be rejected")
	}

	// Atomic bulk rollback: one stale revision fails everything.
	e2 := mustCreateExam(t, svc, "Bulk Two", org)
	if _, err := svc.MoveExamsForActor(ctx, builder, []MoveExamItem{{ExamID: e2.ID, Revision: 99}}, &child.ID); err == nil {
		t.Fatal("stale revision must conflict")
	}
	// Verify e2 still unfiled.
	_, entries2, _ := svc.ListLibraryForActor(ctx, builder, "sat")
	for _, e := range entries2 {
		if e.ExamID == e2.ID {
			t.Fatal("failed move must not leave a partial entry")
		}
	}

	// Empty delete preserves exams; nonempty blocked.
	filed := mustCreateExam(t, svc, "Filed Exam", org)
	if _, err := svc.MoveExamsForActor(ctx, builder, []MoveExamItem{{ExamID: filed.ID, Revision: 0}}, &child.ID); err != nil {
		t.Fatalf("file exam: %v", err)
	}
	if err := svc.DeleteFolderForActor(ctx, builder, child.ID, child.Revision); err == nil {
		t.Fatal("nonempty folder delete must be blocked")
	}
	// Move exam out, delete child after moving nested content: child still has no exams but grand? grand moved out.
	// Child currently holds filed exam; move it to root then delete child.
	_, entries3, _ := svc.ListLibraryForActor(ctx, builder, "sat")
	frev := 0
	for _, e := range entries3 {
		if e.ExamID == filed.ID {
			frev = e.Revision
		}
	}
	if _, err := svc.MoveExamsForActor(ctx, builder, []MoveExamItem{{ExamID: filed.ID, Revision: frev}}, nil); err != nil {
		t.Fatalf("unfile exam: %v", err)
	}
	// Refresh child revision and delete once empty.
	folders, _, _ := svc.ListLibraryForActor(ctx, builder, "sat")
	var freshChild Folder
	for _, f := range folders {
		if f.ID == child.ID {
			freshChild = f
		}
	}
	if err := svc.DeleteFolderForActor(ctx, builder, child.ID, freshChild.Revision); err != nil {
		t.Fatalf("empty folder delete must succeed: %v", err)
	}
	if _, err := svc.Get(ctx, filed.ID); err != nil {
		t.Fatalf("exam must survive folder deletion: %v", err)
	}
}
