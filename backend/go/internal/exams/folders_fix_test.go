package exams

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func TestFixScopeNeverCollidesPlatformOrg(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	svc := NewService(pool, tx.NewRunner(pool))
	ctx := context.Background()
	admin := auth.NewActorContext("admin-fix", auth.RoleAdmin)
	platformFolder, err := svc.CreateFolderForActor(ctx, admin, CreateFolderRequest{ProviderKey: "sat", Name: "Platform Only " + uuid.NewString()[:6]})
	if err != nil {
		t.Fatalf("platform folder: %v", err)
	}
	org := "platform"
	builder := auth.NewActorContext("builder-platform", auth.RoleBuilder).WithOrgID(org)
	builderFolder, err := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Builder Platform " + uuid.NewString()[:6]})
	if err != nil {
		t.Fatalf("builder org=platform folder: %v", err)
	}
	if platformFolder.ScopeKey == builderFolder.ScopeKey {
		t.Fatalf("scope collision: platform %q vs builder platform %q", platformFolder.ScopeKey, builderFolder.ScopeKey)
	}
	// Builder listing must not see platform folder.
	folders, _, err := svc.ListLibraryForActor(ctx, builder, "sat")
	if err != nil {
		t.Fatalf("list builder: %v", err)
	}
	for _, f := range folders {
		if f.ID == platformFolder.ID {
			t.Fatal("builder must not see platform folder")
		}
	}
	// Platform admin sees both (provider slice).
	afolders, _, err := svc.ListLibraryForActor(ctx, admin, "sat")
	if err != nil {
		t.Fatalf("list admin: %v", err)
	}
	seen := map[string]bool{}
	for _, f := range afolders {
		seen[f.ID] = true
	}
	if !seen[platformFolder.ID] || !seen[builderFolder.ID] {
		t.Fatal("admin must see both scopes")
	}
	// Cross-scope exam->folder move rejected.
	exam := mustCreateExam(t, svc, "CrossScope Exam", org)
	if _, err := svc.MoveExamsForActor(ctx, admin, []MoveExamItem{{ExamID: exam.ID, Revision: 0}}, &platformFolder.ID); err == nil {
		t.Fatal("cross-scope admin move to platform folder must be rejected")
	}
	// Observer write rejected (requireWriteActor).
	observer := auth.NewActorContext("obs-1", auth.RoleAdminObserver)
	if _, err := svc.CreateFolderForActor(ctx, observer, CreateFolderRequest{ProviderKey: "sat", Name: "Nope"}); err == nil {
		t.Fatal("observer must not create folders")
	}
	// No-org builder cannot list (empty, not platform).
	noOrgBuilder := auth.NewActorContext("builder-noorg", auth.RoleBuilder)
	f2, e2, err := svc.ListLibraryForActor(ctx, noOrgBuilder, "sat")
	if err != nil {
		t.Fatalf("no-org list: %v", err)
	}
	if len(f2) != 0 || len(e2) != 0 {
		t.Fatal("no-org builder must see empty library")
	}
}

func TestFixStaleFirstMoveConflicts(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	svc := NewService(pool, tx.NewRunner(pool))
	ctx := context.Background()
	org := uniqueOrg("org-stalefirst")
	builder := auth.NewActorContext("b-stale", auth.RoleBuilder).WithOrgID(org)
	fa, _ := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Stale A " + org})
	fb, _ := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Stale B " + org})
	exam := mustCreateExam(t, svc, "Stale First", org)
	first, err := svc.MoveExamsForActor(ctx, builder, []MoveExamItem{{ExamID: exam.ID, Revision: 0}}, &fa.ID)
	if err != nil {
		t.Fatalf("first move: %v", err)
	}
	if len(first) != 1 || first[0].Revision != 1 {
		t.Fatalf("first implicit-root->folder must advance to 1, got %+v", first)
	}
	// Stale revision-0 to a different folder must conflict, not overwrite.
	if _, err := svc.MoveExamsForActor(ctx, builder, []MoveExamItem{{ExamID: exam.ID, Revision: 0}}, &fb.ID); err == nil {
		t.Fatal("stale first-move to different folder must conflict")
	}
	// Verify still in A with revision 1.
	_, entries, _ := svc.ListLibraryForActor(ctx, builder, "sat")
	for _, e := range entries {
		if e.ExamID == exam.ID {
			if e.FolderID == nil || *e.FolderID != fa.ID {
				t.Fatalf("must remain in A, got %+v", e)
			}
			if e.Revision != 1 {
				t.Fatalf("revision must stay 1, got %d", e.Revision)
			}
		}
	}
}

func TestFixTwoItemBatchAtomic(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	svc := NewService(pool, tx.NewRunner(pool))
	ctx := context.Background()
	org := uniqueOrg("org-batch2")
	builder := auth.NewActorContext("b-batch", auth.RoleBuilder).WithOrgID(org)
	fa, _ := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Batch A " + org})
	fb, _ := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Batch B " + org})
	e1 := mustCreateExam(t, svc, "Batch One", org)
	e2 := mustCreateExam(t, svc, "Batch Two", org)
	// Make the stale item last in the service's deterministic lock order,
	// so the batch must roll back a preceding successful placement.
	if e1.ID > e2.ID {
		e1, e2 = e2, e1
	}
	if _, err := svc.MoveExamsForActor(ctx, builder, []MoveExamItem{{ExamID: e2.ID, Revision: 0}}, &fb.ID); err != nil {
		t.Fatalf("prefile e2: %v", err)
	}
	// The first item changes, then the stale second item rolls the batch back.
	if _, err := svc.MoveExamsForActor(ctx, builder, []MoveExamItem{{ExamID: e1.ID, Revision: 0}, {ExamID: e2.ID, Revision: 0}}, &fa.ID); err == nil {
		t.Fatal("two-item batch with one stale must fail")
	}
	_, entries, _ := svc.ListLibraryForActor(ctx, builder, "sat")
	byID := map[string]FolderEntry{}
	for _, e := range entries {
		byID[e.ExamID] = e
	}
	if en, ok := byID[e1.ID]; ok {
		t.Fatalf("e1 must remain unfiled after failed batch, got %+v", en)
	}
	if en, ok := byID[e2.ID]; !ok || en.FolderID == nil || *en.FolderID != fb.ID {
		t.Fatalf("e2 must remain in B after failed batch, got %+v", en)
	}
}

func TestFixReciprocalFolderMoves(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	svc := NewService(pool, tx.NewRunner(pool))
	ctx := context.Background()
	org := uniqueOrg("org-recip")
	builder := auth.NewActorContext("b-recip", auth.RoleBuilder).WithOrgID(org)
	a, _ := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Recip A " + org})
	b, _ := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Recip B " + org})
	// Concurrent reciprocal moves with bounded context: scope-first ordering must not deadlock.
	ctx2, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, errs[0] = svc.MoveFolderForActor(ctx2, builder, a.ID, MoveFolderRequest{ParentID: &b.ID, Revision: a.Revision})
	}()
	go func() {
		defer wg.Done()
		_, errs[1] = svc.MoveFolderForActor(ctx2, builder, b.ID, MoveFolderRequest{ParentID: &a.ID, Revision: b.Revision})
	}()
	wg.Wait()
	if (errs[0] == nil) == (errs[1] == nil) {
		t.Fatalf("exactly one reciprocal move must succeed: %v", errs)
	}
	for _, err := range errs {
		if err != nil {
			appErr, ok := apperrors.As(err)
			if !ok || (appErr.Code != apperrors.CodeValidation && appErr.Code != apperrors.CodeConflict) {
				t.Fatalf("move must reject the cycle without a database error: %v", err)
			}
		}
	}
	// At most one can be nested under the other (descendant check prevents cycle).
	folders, _, _ := svc.ListLibraryForActor(ctx, builder, "sat")
	byID := map[string]Folder{}
	for _, f := range folders {
		byID[f.ID] = f
	}
	// If both succeeded, they'd form a cycle which is invalid; at least one must have failed validation.
	// So assert no cycle: a parent != b and b parent != a simultaneously.
	if fa, ok := byID[a.ID]; ok {
		if fb, ok2 := byID[b.ID]; ok2 {
			aParent := ""
			if fa.ParentID != nil {
				aParent = *fa.ParentID
			}
			bParent := ""
			if fb.ParentID != nil {
				bParent = *fb.ParentID
			}
			if aParent == b.ID && bParent == a.ID {
				t.Fatal("reciprocal moves formed a cycle")
			}
		}
	}
}

func TestFixRootOrgChangeThenRefile(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	svc := NewService(pool, tx.NewRunner(pool))
	ctx := context.Background()
	org1 := uniqueOrg("org-one")
	org2 := uniqueOrg("org-two")
	builder1 := auth.NewActorContext("b-org1", auth.RoleBuilder).WithOrgID(org1)
	exam, err := svc.CreateForActor(ctx, builder1, CreateRequest{
		Slug: "sat-orgchange-" + uuid.NewString()[:8], Title: "Org Change", ExamType: ExamTypeAcademic,
		Visibility: VisibilityOrganization, ProviderKey: strPtr(ProviderSAT),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// Root org change allowed (no filed entry).
	updated, err := svc.Update(ctx, exam.ID, UpdateRequest{OrganizationID: &org2, Revision: exam.Revision})
	if err != nil {
		t.Fatalf("root org change: %v", err)
	}
	if updated.OrganizationID == nil || *updated.OrganizationID != org2 {
		t.Fatalf("org not updated: %+v", updated)
	}
	// Refile in new org scope must succeed.
	builder2 := auth.NewActorContext("b-org2", auth.RoleBuilder).WithOrgID(org2)
	folder, err := svc.CreateFolderForActor(ctx, builder2, CreateFolderRequest{ProviderKey: "sat", Name: "Refile " + org2})
	if err != nil {
		t.Fatalf("folder in new org: %v", err)
	}
	if _, err := svc.MoveExamsForActor(ctx, builder2, []MoveExamItem{{ExamID: exam.ID, Revision: 0}}, &folder.ID); err != nil {
		t.Fatalf("refile after org change: %v", err)
	}
}

func TestFixFingerprintOmitempty(t *testing.T) {
	// Omitted folder must equal legacy bytes/hash (no FolderID key).
	legacy := struct {
		OperationKey     string
		Slug             string
		Title            string
		ExamType         string
		Visibility       string
		OrganizationID   *string
		ProviderKey      *string
		ProviderExamType *string
		OwnerID          string
		SATConfig        *SATExamConfig
	}{
		OperationKey: "", Slug: "s", Title: "t", ExamType: ExamTypeAcademic, Visibility: VisibilityOrganization, OwnerID: "u",
	}
	rawLegacy, _ := json.Marshal(legacy)
	sum := sha256.Sum256(rawLegacy)
	sumLegacy := fmt.Sprintf("%x", sum[:])
	req := CreateRequest{Slug: "s", Title: "t", ExamType: ExamTypeAcademic, Visibility: VisibilityOrganization, OwnerID: "u"}
	fp, err := createRequestFingerprint(req)
	if err != nil {
		t.Fatalf("fingerprint: %v", err)
	}
	if fp != sumLegacy {
		t.Fatalf("omitted folder fingerprint must equal legacy hash:\n got %s\nwant %s\nraw %s", fp, sumLegacy, string(rawLegacy))
	}
	withFolder := req
	fid := "f-1"
	withFolder.FolderID = &fid
	fp2, _ := createRequestFingerprint(withFolder)
	if fp2 == fp {
		t.Fatal("nonempty folder must change hash")
	}
}

func TestFixCreateInFolderIdempotentReplay(t *testing.T) {
	pool := mysqlPoolForFolders(t)
	svc := NewService(pool, tx.NewRunner(pool))
	ctx := context.Background()
	org := uniqueOrg("org-replay")
	builder := auth.NewActorContext("b-replay", auth.RoleBuilder).WithOrgID(org)
	folder, _ := svc.CreateFolderForActor(ctx, builder, CreateFolderRequest{ProviderKey: "sat", Name: "Replay " + org})
	opKey := "op-" + uuid.NewString()
	req := CreateRequest{Slug: "sat-replay-" + uuid.NewString()[:8], Title: "Replay", ExamType: ExamTypeAcademic, Visibility: VisibilityOrganization, ProviderKey: strPtr(ProviderSAT), OwnerID: "b-replay", FolderID: &folder.ID, OperationKey: opKey}
	first, err := svc.CreateForActor(ctx, builder, req)
	if err != nil {
		t.Fatalf("first create: %v", err)
	}
	// Lost-response replay with same payload+key must converge to same exam.
	second, err := svc.CreateForActor(ctx, builder, req)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("replay must return same exam %s vs %s", first.ID, second.ID)
	}
	// New content with same key must conflict.
	req2 := req
	req2.Title = "Different"
	if _, err := svc.CreateForActor(ctx, builder, req2); err == nil {
		t.Fatal("same key with different content must conflict")
	}
}
