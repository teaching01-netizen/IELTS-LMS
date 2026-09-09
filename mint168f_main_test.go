package main

import (
	"fmt"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/crypto"
)

func TestMint(t *testing.T) {
	lease := uint64(1)
	tok, err := crypto.SignAttemptToken([]byte("live-rehearsal-secret-32bytes-min!"), crypto.AttemptClaims{
		TokenID: "vf_9b55saNdPFWXld2z1pncCMwvroVj1", UserID: "71deb73c-8bbe-496d-aa41-d1e88a8d50c4",
		ScheduleID: "fa8c0db4-8b76-4d3f-b4af-cfd7ee42ed6b", AttemptID: "fa36b9d1-f7dd-4887-9cfd-00420d32d59e",
		ClientSessionID: "8a554c39-c2e6-49db-a29f-c31f9f7ee9a7", LeaseEpoch: &lease,
		Exp: time.Now().Add(2 * time.Hour).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	fmt.Println(tok)
}
