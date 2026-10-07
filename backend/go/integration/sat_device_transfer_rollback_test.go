package integration

import (
	"context"
	"testing"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func TestSATTransferRollbackRetainsOwnerAndRecoversOutstandingRequest(t *testing.T) {
	f := newTransferFixture(t)
	owner := f.admit(t, "sess-a")
	request, err := f.request(t, "rollback-existing", "sess-b", owner.LeaseEpoch)
	if err != nil {
		t.Fatal(err)
	}
	f.policy.Enabled = false
	_, err = f.request(t, "rollback-new", "sess-c", owner.LeaseEpoch)
	wantCode(t, err, apperrors.CodeTransferConflict)
	resumed, err := f.svc.Admit(context.Background(), attempts.AdmitCommand{
		AttemptID: f.attemptID, UserID: f.userID, ClientSessionID: "sess-a",
	}, f.issuer("sess-a"))
	if err != nil || resumed.Outcome != attempts.AdmissionAuthorized || resumed.LeaseEpoch != owner.LeaseEpoch {
		t.Fatalf("rollback must retain current-owner renewal: %+v %v", resumed, err)
	}
	approved, err := f.svc.ConfirmTransferByWriter(context.Background(), resumed.Token, request.RequestID, f.policy)
	if err != nil || approved.State != attempts.TransferApproved {
		t.Fatalf("rollback must allow outstanding request resolution: %+v %v", approved, err)
	}
	committed, err := f.commit("sess-b", request.RequestID)
	if err != nil || committed.Admission.LeaseEpoch != owner.LeaseEpoch+1 {
		t.Fatalf("outstanding transfer commit: %+v %v", committed, err)
	}
	recovered, err := f.commit("sess-b", request.RequestID)
	if err != nil || recovered.Admission.LeaseEpoch != committed.Admission.LeaseEpoch {
		t.Fatalf("rollback must recover receipt without another ownership change: %+v %v", recovered, err)
	}
	blocked, err := f.svc.Admit(context.Background(), attempts.AdmitCommand{
		AttemptID: f.attemptID, UserID: f.userID, ClientSessionID: "sess-a",
	}, f.issuer("sess-a"))
	if err != nil || blocked.Outcome != attempts.AdmissionBlocked || blocked.Token != "" {
		t.Fatalf("rollback must not resurrect superseded writer: %+v %v", blocked, err)
	}
	row := f.ownerRow(t)
	if row.owner.String != "sess-b" || row.lease != owner.LeaseEpoch+1 || row.policy.String != attempts.WriterPolicySATSingleWriter {
		t.Fatalf("rollback must preserve committed ownership snapshot: %+v", row)
	}
}
