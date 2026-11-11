package exams

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func TestFixFolderCreateIdempotentReplay(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	svc := NewService(pool, tx.NewRunner(pool))
	ctx := context.Background()
	org := uniqueOrg("org-folder-replay")
	builder := auth.NewActorContext("b-freplay", auth.RoleBuilder).WithOrgID(org)
	opKey := "fop-" + uuid.NewString()
	name := "Replay Folder " + org
	first, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: name, OperationKey: opKey})
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: name, OperationKey: opKey})
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("replay must return same folder %s vs %s", first.ID, second.ID)
	}
	// Same key, different content must conflict.
	if _, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Different " + org, OperationKey: opKey}); err == nil {
		t.Fatal("same key different content must conflict")
	}
}

func TestFixLegacyDraftSavePreservesMembership(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	svc := NewService(pool, tx.NewRunner(pool))
	ctx := context.Background()
	org := uniqueOrg("org-legacy")
	builder := auth.NewActorContext("b-legacy", auth.RoleBuilder).WithOrgID(org)
	folder, _ := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Legacy " + org})
	exam, err := svc.CreateForActor(ctx, builder, CreateRequest{
		Slug: "sat-legacy-" + uuid.NewString()[:8], Title: "Legacy", ExamType: ExamTypeAcademic,
		Visibility: VisibilityOrganization, ProviderKey: strPtr(ProviderSAT), FolderID: &folder.ID,
	})
	if err != nil {
		t.Fatalf("create in folder: %v", err)
	}
	before, _ := svc.Get(ctx, exam.ID)
	// Actual legacy metadata/draft save: fetch draft version and save new content.
	versions, err := svc.ListVersionsForActor(ctx, builder, exam.ID)
	if err != nil || len(versions) == 0 {
		t.Fatalf("list versions: %v %d", err, len(versions))
	}
	draft := versions[0]
	// SaveDraft with valid empty JSON? Need real content: use current content snapshot? For test, use draft's content?
	// Use minimal valid content: fetch version content via Get? Instead, use SaveDraft with dummy non-empty JSON.
	// The service requires non-empty content/config; use "{}" which passes non-empty check (shape validation only for SAT publish, not save).
	if _, err := svc.SaveDraftForActor(ctx, builder, exam.ID, SaveDraftRequest{Content: json.RawMessage(`{"sections":[]}`), Config: json.RawMessage(`{"sections":{}}`), Revision: draft.Revision}); err != nil {
		t.Fatalf("draft save: %v", err)
	}
	after, _ := svc.Get(ctx, exam.ID)
	// Membership must remain filed.
	folders, entries, _ := svc.ListLibraryForActor(ctx, builder, "sat")
	_ = folders
	found := false
	for _, e := range entries {
		if e.ExamID == exam.ID && e.FolderID != nil && *e.FolderID == folder.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("draft save must preserve folder membership")
	}
	if after.Revision == before.Revision {
		t.Fatal("entity revision must advance on draft save")
	}
}

func TestFixSchemaSiblingsAndCollation(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	// Verify fresh migration has generated parent_key + _ci name collation.
	var genExpr string
	if err := pool.QueryRow(`SELECT GENERATION_EXPRESSION FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'exam_folders' AND column_name = 'parent_key'`).Scan(&genExpr); err != nil {
		t.Fatalf("parent_key generated: %v", err)
	}
	if !strings.Contains(strings.ToLower(genExpr), "coalesce") {
		t.Fatalf("parent_key must be generated COALESCE, got %q", genExpr)
	}
	var collation string
	if err := pool.QueryRow(`SELECT COLLATION_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'exam_folders' AND column_name = 'name'`).Scan(&collation); err != nil {
		t.Fatalf("name collation: %v", err)
	}
	if !strings.Contains(strings.ToLower(collation), "ci") {
		t.Fatalf("name must be case-insensitive collation, got %q", collation)
	}
	// Schema-level duplicate siblings incl root.
	svc := NewService(pool, tx.NewRunner(pool))
	ctx := context.Background()
	org := uniqueOrg("org-sibling")
	builder := auth.NewActorContext("b-sib", auth.RoleBuilder).WithOrgID(org)
	rootName := "Sibling " + org
	if _, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: rootName}); err != nil {
		t.Fatalf("root: %v", err)
	}
	if _, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: strings.ToLower(rootName)}); err == nil {
		t.Fatal("case-insensitive root duplicate must conflict at storage/app layer")
	}
	// Nested duplicate under same parent.
	parent, _ := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Parent " + org})
	if _, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Child", ParentID: &parent.ID}); err != nil {
		t.Fatalf("child: %v", err)
	}
	if _, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "CHILD", ParentID: &parent.ID}); err == nil {
		t.Fatal("case-insensitive nested duplicate must conflict")
	}
}
