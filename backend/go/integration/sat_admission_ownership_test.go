package integration

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// An unbound attempt must not be claimable by an arbitrary authenticated
// student, independent of the single-writer rollout flag.
func TestAdmitRefusesUnrelatedPrincipalForUnboundAttempt(t *testing.T) {
	f := newTransferFixture(t)
	other := uuid.NewString()
	mustExec(t, f.db, `INSERT INTO users (id, email, display_name, role, state) VALUES (?, ?, 'Other', 'student', 'active')`, other, "other-"+other+"@example.test")
	t.Cleanup(func() { _, _ = f.db.Exec(`DELETE FROM users WHERE id = ?`, other) })
	mustExec(t, f.db, `UPDATE student_attempts SET user_id = NULL WHERE id = ?`, f.attemptID)

	for _, enabled := range []bool{false, true} {
		_, err := f.svc.Admit(context.Background(), attempts.AdmitCommand{
			AttemptID: f.attemptID, UserID: other, ClientSessionID: "sess-x", SingleWriterEnabled: enabled,
		}, nil)
		ae, ok := err.(*apperrors.Error)
		if !ok || ae.Code != apperrors.CodeForbidden {
			t.Fatalf("enabled=%v: want FORBIDDEN, got %v", enabled, err)
		}
	}
	var bound *string
	if err := f.db.QueryRow(`SELECT user_id FROM student_attempts WHERE id = ?`, f.attemptID).Scan(&bound); err != nil {
		t.Fatal(err)
	}
	if bound != nil {
		t.Fatalf("attempt was bound to %s by a refused admission", *bound)
	}
}

// F6: a takeover whose response was lost already rotated the session's
// bearer. The current owner can replay it with the superseded bearer; a
// different session cannot use that bearer to mint a credential.
func TestTakeoverReplayAfterLostResponseIsOwnerOnly(t *testing.T) {
	f := newTransferFixture(t)
	ctx := context.Background()
	a := f.admit(t, "sess-a")

	first, err := f.svc.Takeover(ctx, a.Token, f.attemptID, "sess-a", "refresh")
	if err != nil {
		t.Fatalf("takeover: %v", err)
	}
	// Response lost: the client retries with the bearer it still holds.
	replay, err := f.svc.Takeover(ctx, a.Token, f.attemptID, "sess-a", "refresh")
	if err != nil {
		t.Fatalf("owner replay with superseded bearer must recover: %v", err)
	}
	if replay.LeaseEpoch != first.LeaseEpoch {
		t.Fatalf("replay changed lease %d -> %d", first.LeaseEpoch, replay.LeaseEpoch)
	}
	if got := f.ownerRow(t); got.lease != first.LeaseEpoch {
		t.Fatalf("stored lease %d, want %d", got.lease, first.LeaseEpoch)
	}
	// A different session presenting the owner's superseded bearer gets nothing.
	if _, err := f.svc.Takeover(ctx, a.Token, f.attemptID, "sess-b", "steal"); err == nil {
		t.Fatal("a different session must not mint a credential from a superseded bearer")
	}
	if got := f.ownerRow(t); !got.owner.Valid || got.owner.String != "sess-a" {
		t.Fatalf("owner changed to %v", got.owner)
	}
}
