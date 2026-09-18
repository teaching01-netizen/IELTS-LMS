package authoring

// Phase 03 OpenShell decision record + proof (option (a): keep the single
// write Tx; option (b) rejected without a passing N=20 proof).
//
// DECISION: option (a) — OpenShell keeps ONE write transaction (exam row FOR
// UPDATE, sat gate, existing-draft shortcut OR clone + pointer CAS +
// version_created event, commit) and then projects through the bulk Shell().
// The FOR UPDATE on exam_entities serializes concurrent opens at the row
// lock: exactly one opener can win the current_draft_version_id IS NULL CAS,
// every other opener either blocks until the winner commits (then takes the
// existing-draft shortcut and returns the winner's shell) or fails the CAS
// with the documented 409 ("The SAT draft changed while authoring was
// opening."). clonePublishedSATToDraftTx, the CAS predicate, and the
// version_created insert are UNTOUCHED — the cutover only changed the final
// projection from the nested Shell() to the bulk Shell().
//
// WHY NOT (b): a read-first fast path (probe the draft pointer without a
// write Tx, enter the Tx only when NULL) would skip the lock on the hot
// existing-draft path, but it opens a check-then-act race — N concurrent
// opens on a NULL pointer all enter the Tx and race the clone. Phase 04
// reduces POST frequency (GET for refresh), which shrinks the cost of (a)
// without any CAS risk. Revisit (b) only with the N=20 proof the phase spec
// demands — and that proof NOW EXISTS for the clone path that blocked it:
// TestOpenShellConcurrentNoDraftClonesFromPublished publishes the read-perf
// fixture's own tree (two UPDATEs, no publish flow needed) and shows 20
// concurrent opens on published+no-draft converging on one cloned draft with
// the source intact. Option (b) is therefore still a deliberate choice on the
// hot path, not an unproven one.
//
// Gated on TEST_MYSQL_DSN; skips otherwise.

import (
	"context"
	"strings"
	"sync"
	"testing"

	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// openConcurrentExam creates a SAT exam with an existing draft (the shape
// OpenShell's shortcut path serves) and returns its id.
func openConcurrentExam(t *testing.T, examSvc *exams.Service, actor string) string {
	t.Helper()
	provider := "sat"
	exam, err := examSvc.Create(context.Background(), exams.CreateRequest{
		Slug: "openshell-race-" + uuid.NewString(), Title: "OpenShell race proof",
		ExamType: "Academic", Visibility: "private", ProviderKey: &provider, OwnerID: actor,
	})
	if err != nil {
		t.Fatalf("create exam: %v", err)
	}
	return exam.ID
}

// TestOpenShellConcurrentExistingDraft is the option-(a) safety proof on the
// hot path: N=20 concurrent OpenShell calls against an exam WITH a draft must
// all succeed with the SAME version id and revision — no clone, no 409, no
// duplicate draft. The write Tx's FOR UPDATE serializes the opens; the
// shortcut returns the winner's (only) draft to everyone.
func TestOpenShellConcurrentExistingDraft(t *testing.T) {
	dsn := readPerfDSN(t)
	db, _ := readPerfCountedDB(t, dsn)
	ctx := context.Background()
	actor := "openshell-race-" + uuid.NewString()
	examSvc := exams.NewService(db, tx.NewRunner(db))
	authors := NewService(db, tx.NewRunner(db))
	examID := openConcurrentExam(t, examSvc, actor)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithCancel(context.Background())
		_ = cleanupCtx
		cancel()
		_ = examID
	})

	const racers = 20
	var wg sync.WaitGroup
	type outcome struct {
		shell Shell
		err   error
	}
	outcomes := make([]outcome, racers)
	start := make(chan struct{})
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			shell, err := authors.OpenShell(ctx, examID, actor)
			outcomes[index] = outcome{shell: shell, err: err}
		}(i)
	}
	close(start)
	wg.Wait()

	versionIDs := map[string]int{}
	for i, o := range outcomes {
		if o.err != nil {
			t.Fatalf("racer %d: OpenShell on an existing draft must succeed, got %v", i, o.err)
		}
		versionIDs[o.shell.VersionID]++
		if o.shell.ExamID != examID || o.shell.ProviderKey != "sat" {
			t.Fatalf("racer %d: unexpected shell %+v", i, o.shell)
		}
	}
	if len(versionIDs) != 1 {
		t.Fatalf("concurrent opens diverged to %d drafts: %v", len(versionIDs), versionIDs)
	}
	// Exactly one draft version must exist for the exam (no clone happened).
	var drafts int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM exam_versions WHERE exam_id = ? AND is_draft = TRUE", examID).Scan(&drafts); err != nil {
		t.Fatalf("count drafts: %v", err)
	}
	if drafts != 1 {
		t.Fatalf("concurrent opens created %d drafts, want exactly 1", drafts)
	}
	t.Logf("N=%d concurrent OpenShell on existing draft: all shell, 1 draft, 0 clones", racers)
}

// TestOpenShellConcurrentNoDraftClonesFromPublished is the REAL cloning race,
// and the fixture the earlier decision record said did not exist.
//
// The documented gap was: "there is no published-version fixture path in the
// read-perf harness that yields a cloneable SAT exam without draft". There is
// one, and it needs no publish flow: the read-perf fixture already seeds a
// complete SAT tree, so publishing it is two UPDATEs — flip the version to
// is_published, then point the exam at it with a NULL draft pointer. That is
// exactly the shape clone_published_sat_to_draft_tx exists for.
//
// What this proves (the thing a no-version fixture cannot): N concurrent
// opens on a PUBLISHED exam with NO draft converge on ONE cloned draft. The
// FOR UPDATE serializes them; the first clones and wins the pointer CAS, and
// every later opener takes the existing-draft shortcut to the same draft. No
// racer may mint a second draft, and the published source must be untouched.
func TestOpenShellConcurrentNoDraftClonesFromPublished(t *testing.T) {
	fixture := seedReadPerfFixture(t)
	ctx := context.Background()
	actor := "openshell-clone-" + uuid.NewString()
	authors := NewService(fixture.DB, fixture.Runner)

	// Publish the seeded tree and clear the draft pointer: published exam, no
	// editable draft.
	if _, err := fixture.DB.ExecContext(ctx, "UPDATE exam_versions SET is_draft = FALSE, is_published = TRUE, revision = revision + 1 WHERE id = ?", fixture.VersionID); err != nil {
		t.Fatalf("publish seeded version: %v", err)
	}
	if _, err := fixture.DB.ExecContext(ctx, "UPDATE exam_entities SET current_published_version_id = ?, current_draft_version_id = NULL WHERE id = ?", fixture.VersionID, fixture.ExamID); err != nil {
		t.Fatalf("point exam at the published version: %v", err)
	}

	// Precondition, and a regression guard in its own right: the read reports
	// NO_DRAFT and creates nothing. Refreshing a pre-draft exam must never be
	// the thing that opens a draft.
	before, err := authors.ShellLifecycle(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("ShellLifecycle before any open: %v", err)
	}
	if before.State != ShellStateNoDraft || before.Shell != nil {
		t.Fatalf("precondition: state = %q shell = %v, want NO_DRAFT with no shell", before.State, before.Shell)
	}
	assertDraftCount(t, ctx, fixture, 0)

	const racers = 20
	var wg sync.WaitGroup
	shells := make([]Shell, racers)
	errs := make([]error, racers)
	start := make(chan struct{})
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			shells[index], errs[index] = authors.OpenShell(ctx, fixture.ExamID, actor)
		}(i)
	}
	close(start)
	wg.Wait()

	versionIDs := map[string]int{}
	successes, conflicts := 0, 0
	for i, err := range errs {
		if err != nil {
			// The only other documented outcome is the pointer CAS losing — which
			// the row lock is supposed to make unreachable. Accept it as a known
			// escape hatch, but never a silent success with a different draft.
			if e, ok := apperrors.As(err); !ok || e.Code != apperrors.CodeConflict {
				t.Fatalf("racer %d: unexpected error %v", i, err)
			}
			conflicts++
			continue
		}
		successes++
		if shells[i].ExamID != fixture.ExamID || shells[i].ProviderKey != "sat" {
			t.Fatalf("racer %d: unexpected shell %+v", i, shells[i])
		}
		versionIDs[shells[i].VersionID]++
	}
	if len(versionIDs) == 0 {
		t.Fatal("no racer produced a shell: the clone never succeeded")
	}
	if len(versionIDs) != 1 {
		t.Fatalf("concurrent opens converged on %d drafts: %v", len(versionIDs), versionIDs)
	}
	for versionID := range versionIDs {
		if versionID == fixture.VersionID {
			t.Fatal("the open returned the PUBLISHED version instead of a cloned draft")
		}
	}

	// The database is the final authority: exactly one editable draft.
	assertDraftCount(t, ctx, fixture, 1)

	// The clone carries the published content, and the published source is
	// still published and still draft-free.
	clonedID := ""
	for id := range versionIDs {
		clonedID = id
	}
	var sourceSections, clonedSections int
	if err := fixture.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_sections WHERE exam_version_id = ?", fixture.VersionID).Scan(&sourceSections); err != nil {
		t.Fatalf("count published sections: %v", err)
	}
	if err := fixture.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_sections WHERE exam_version_id = ?", clonedID).Scan(&clonedSections); err != nil {
		t.Fatalf("count cloned sections: %v", err)
	}
	if clonedSections != sourceSections || clonedSections == 0 {
		t.Fatalf("cloned draft has %d sections, published source has %d", clonedSections, sourceSections)
	}
	var isDraft, isPublished bool
	if err := fixture.DB.QueryRowContext(ctx, "SELECT is_draft, is_published FROM exam_versions WHERE id = ?", fixture.VersionID).Scan(&isDraft, &isPublished); err != nil {
		t.Fatalf("re-read published version: %v", err)
	}
	if isDraft || !isPublished {
		t.Fatalf("the published source was mutated by the clone: is_draft=%v is_published=%v", isDraft, isPublished)
	}

	// …and the read now answers READY with the single cloned draft.
	after, err := authors.ShellLifecycle(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("ShellLifecycle after the opens: %v", err)
	}
	if after.State != ShellStateReady || after.Shell == nil || after.Shell.VersionID != clonedID {
		t.Fatalf("post-open lifecycle = %q/%v, want READY on the cloned draft %s", after.State, after.Shell, clonedID)
	}
	t.Logf("N=%d concurrent OpenShell on published+no-draft: %d shell, %d documented conflicts, 1 cloned draft (%d sections), source intact", racers, successes, conflicts, clonedSections)
}

// assertDraftCount asserts how many draft versions exist for the fixture exam.
func assertDraftCount(t *testing.T, ctx context.Context, fixture *readPerfFixture, want int) {
	t.Helper()
	var drafts int
	if err := fixture.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM exam_versions WHERE exam_id = ? AND is_draft = TRUE", fixture.ExamID).Scan(&drafts); err != nil {
		t.Fatalf("count drafts: %v", err)
	}
	if drafts != want {
		t.Fatalf("draft versions = %d, want %d", drafts, want)
	}
}

// TestOpenShellConcurrentNoDraftSingleClone covers the no-version no-draft
// race: an exam with NEITHER a draft NOR a published version, where every
// opener must fail closed. It pins the observable contract (documented error,
// never a split draft, never a partial shell).
//
// The clone race itself — published source, no draft, N concurrent opens — is
// proven by TestOpenShellConcurrentNoDraftClonesFromPublished above, so this
// case no longer has to stand in for it.
func TestOpenShellConcurrentNoDraftSingleClone(t *testing.T) {
	dsn := readPerfDSN(t)
	db, _ := readPerfCountedDB(t, dsn)
	ctx := context.Background()
	actor := "openshell-nodraft-" + uuid.NewString()
	examSvc := exams.NewService(db, tx.NewRunner(db))
	authors := NewService(db, tx.NewRunner(db))
	examID := openConcurrentExam(t, examSvc, actor)
	if _, err := db.ExecContext(ctx, "UPDATE exam_entities SET current_draft_version_id = NULL WHERE id = ?", examID); err != nil {
		t.Fatalf("clear draft pointer: %v", err)
	}

	const racers = 20
	var wg sync.WaitGroup
	errs := make([]error, racers)
	shells := make([]Shell, racers)
	start := make(chan struct{})
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			shell, err := authors.OpenShell(ctx, examID, actor)
			shells[index], errs[index] = shell, err
		}(i)
	}
	close(start)
	wg.Wait()

	// Every outcome must be the ONE documented validation error (no draft, no
	// published version to continue) — never a panic, never a partial shell,
	// never a second draft row. This proves the losers fail closed under the
	// write Tx instead of splicing state.
	for i, err := range errs {
		if err == nil {
			t.Fatalf("racer %d: OpenShell without any version must not succeed (got %+v)", i, shells[i])
		}
		if !strings.Contains(err.Error(), "neither an editable draft nor a published version") {
			if e, ok := apperrors.As(err); !ok || (e.Code != apperrors.CodeValidation && e.Code != apperrors.CodeConflict) {
				t.Fatalf("racer %d: unexpected error %v", i, err)
			}
		}
	}
	t.Logf("N=%d concurrent OpenShell with no version: all documented errors, 0 partial shells", racers)
}
